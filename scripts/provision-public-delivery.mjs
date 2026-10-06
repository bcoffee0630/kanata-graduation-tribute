import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assertTransactionOwner, DeliveryOperatorError, initializeOperator, ownerSession,
  parseOperatorOptions, PRODUCTION, STAGING, reportOperatorError, requireFunctions } from './public-delivery-operator.mjs';
import { waitForServiceEnable } from './setup-public-snapshot-resources.mjs';
import { verifyReaderFirestoreIsolation, PublicDeliveryIamVerificationError } from './public-delivery-iam-verification.mjs';

const PREFIX = 'public-snapshots/';
const REGION = 'asia-east1';
const WORKER = 'publishPublicSnapshots';
const SA_ID = 'public-feed-reader';
const ROLE_ID = 'publicFeedSnapshotReader';
const WRITER_ROLE_ID = 'publicFeedSnapshotWriter';
const METADATA_ROLE_ID = 'publicFeedSnapshotMetadataReader';
const FUNCTION_ROLE_ID = 'publicFeedWorkerMetadataReader';
const WRITER_PERMISSIONS = ['storage.objects.get', 'storage.objects.create', 'storage.objects.delete', 'storage.objects.update'];
export const IAM_VERIFICATION_API = 'policytroubleshooter.googleapis.com';
export const IAM_PROPAGATION_DELAYS_MS = Object.freeze([5000, 10000, 20000, 30000, 30000, 30000, 30000]);
export const IAM_PROPAGATION_TIMEOUT_MS = 180_000;
const HELP = `Provision private snapshots and a bounded private task queue. Default: read-only inventory/plan.
  --project <kanata-memorial|kanata-memorial-admin>
  --bucket <existing-dedicated-private-UBLA-PAP-project-bucket>
  --writer-service-account <verified-existing-publisher-runtime-identity>
Apply also requires --apply --owner-uid <existing-owner> --reason <reason>
Production: --confirm-production kanata-memorial --release-tag <annotated-HEAD-tag>
Creates/reuses a GCS-get-only reader, private prefix IAM, bounded task queue and
prefix-only generation lifecycle. Rerun after backend deployment to grant the
private worker invoker. Existing media bucket settings remain unchanged.
Enables/reuses only the IAM Policy Troubleshooter verification API before IAM writes.
No billing, budget, notification, Hosting or database Rules resources are changed.
`;

export function iamVerificationApiPlan(service) {
  if (!['ENABLED', 'DISABLED'].includes(service?.state)) {
    throw new DeliveryOperatorError('IAM verification API state cannot be verified; no infrastructure changes were made.');
  }
  return { name: IAM_VERIFICATION_API, action: service.state === 'ENABLED' ? 'reuse-enabled' : 'enable', maxEnablePolls: 30 };
}

export async function ensureIamVerificationApi(projectNumber, request, waitOptions = {}) {
  if (!/^\d{1,30}$/.test(String(projectNumber))) throw new DeliveryOperatorError('A verified project number is required for IAM verification API setup.');
  const serviceUrl = `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${IAM_VERIFICATION_API}`;
  const service = await request(serviceUrl);
  if (iamVerificationApiPlan(service).action === 'reuse-enabled') return;
  const operation = await request(`${serviceUrl}:enable`, 'POST', {});
  try {
    await waitForServiceEnable(operation, name => request(`https://serviceusage.googleapis.com/v1/${name}`), waitOptions);
  } catch {
    throw new DeliveryOperatorError('IAM verification API enable did not complete within its bounded checks; no IAM writes were performed. Inspect API state and rerun the dry-run.');
  }
  if ((await request(serviceUrl)).state !== 'ENABLED') {
    throw new DeliveryOperatorError('IAM verification API is not enabled; no IAM writes were performed. Inspect API state and rerun the dry-run.');
  }
}

export function isCustomRolePropagationFailure(status, body, knownRoles) {
  if (status !== 400 || !Array.isArray(knownRoles) || !knownRoles.length) return false;
  const error = body?.error;
  if (!error || typeof error !== 'object') return false;
  const messages = [error.message, ...(Array.isArray(error.errors) ? error.errors.map(entry => entry?.message) : [])];
  for (const role of knownRoles) {
    if (typeof role !== 'string' || !/^projects\/[a-z0-9-]+\/roles\/[A-Za-z0-9_.]+$/.test(role)) continue;
    const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const qualified = `(?:\\(${escaped}\\)|${escaped}|['"\x60]${escaped}['"\x60])`;
    const missing = new RegExp(`^Role\\s+${qualified}\\s+(?:does not exist(?: in the resource['’]s hierarchy)?|(?:was |is )?not found)\\.?$`);
    if (messages.some(message => typeof message === 'string' && missing.test(message.trim()))) return true;
  }
  return Array.isArray(error.details) && error.details.some(detail =>
    detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' &&
    ['ROLE_NOT_FOUND', 'IAM_ROLE_NOT_FOUND'].includes(detail.reason) &&
    knownRoles.includes(detail.metadata?.role || detail.metadata?.roleName || detail.metadata?.resource));
}

export function infrastructureFailure(method, status, body, knownRoles = []) {
  const error = new DeliveryOperatorError(`Infrastructure ${method} failed (${status}); verify API availability and operator permissions locally.`);
  error.httpStatus = status;
  error.customRolePropagation = isCustomRolePropagationFailure(status, body, knownRoles);
  return error;
}

export async function putBucketIamWithPropagationRetry(write, { now = () => performance.now(),
  pause = delay => new Promise(resolve => setTimeout(resolve, delay)) } = {}) {
  const started = now();
  let paused = 0;
  for (let attempt = 0; attempt <= IAM_PROPAGATION_DELAYS_MS.length; attempt++) {
    const remaining = IAM_PROPAGATION_TIMEOUT_MS - Math.max(0, now() - started, paused);
    if (remaining <= 0) break;
    try { return await write(Math.min(30_000, remaining)); }
    catch (error) {
      if (!(error instanceof DeliveryOperatorError) || error.httpStatus !== 400 || error.customRolePropagation !== true) throw error;
      const delay = IAM_PROPAGATION_DELAYS_MS[attempt];
      const left = IAM_PROPAGATION_TIMEOUT_MS - Math.max(0, now() - started, paused);
      if (delay === undefined || delay >= left) break;
      await pause(delay);
      paused += delay;
    }
  }
  throw new DeliveryOperatorError('Custom snapshot roles are still propagating after bounded IAM retries; no further IAM writes were attempted. Inspect state and rerun the dry-run.');
}

export function desiredSnapshotQueue(name) {
  return { name, rateLimits: { maxDispatchesPerSecond: 0.5, maxConcurrentDispatches: 1 },
    retryConfig: { maxAttempts: 3, minBackoff: '1s', maxBackoff: '10s', maxDoublings: 3 } };
}

export function snapshotLifecycle(existing = []) {
  const rule = { action: { type: 'Delete' }, condition: { age: 1, matchesPrefix: [`${PREFIX}generations/`] } };
  const matched = existing.some((entry) => entry.action?.type === 'Delete' && entry.condition?.age === 1
    && entry.condition.matchesPrefix?.length === 1 && entry.condition.matchesPrefix[0] === `${PREFIX}generations/`
    && Object.keys(entry.condition).every((key) => ['age', 'matchesPrefix'].includes(key)));
  return matched ? existing : [...existing, rule];
}

export function addPrivateIamBinding(policy, role, member, condition) {
  const binding = policy.bindings?.find((entry) => entry.role === role
    && (entry.condition?.expression || '') === (condition?.expression || ''));
  if (binding) { if (!binding.members.includes(member)) binding.members.push(member); }
  else { policy.bindings ||= []; policy.bindings.push({ role, members: [member], ...(condition ? { condition } : {}) }); }
  if (condition) policy.version = 3;
  return policy;
}

export function assertPrivateSnapshotBucket(bucket, project, name) {
  if (String(bucket.projectNumber) !== String(project.projectNumber)
    || name === `${project.projectId}.appspot.com` || name === `${project.projectId}.firebasestorage.app`) {
    throw new DeliveryOperatorError('Use a dedicated existing snapshot bucket owned by the selected project.');
  }
  if (bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true
    || bucket.iamConfiguration?.publicAccessPrevention !== 'enforced') {
    throw new DeliveryOperatorError('Snapshot bucket must already enable uniform bucket access and enforce public access prevention. Review bucket creation separately; this script does not modify whole-bucket access settings.');
  }
}

const hasPublicMember = (policy) => policy.bindings?.some((binding) =>
  binding.members?.some((member) => ['allUsers', 'allAuthenticatedUsers'].includes(member)));

export async function main(args = process.argv.slice(2)) {
  const options = parseOperatorOptions(args, { '--writer-service-account': 'writerServiceAccount' });
  if (options.help) { console.log(HELP); return; }
  if (![PRODUCTION, STAGING].includes(options.project)
    || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(options.bucket || '')
    || !/^[a-z0-9-]+@(?:[a-z0-9-]+\.iam\.gserviceaccount\.com|developer\.gserviceaccount\.com)$/.test(options.writerServiceAccount || '')) {
    throw new DeliveryOperatorError('Explicit remote project, dedicated bucket and verified writer identity are required.');
  }
  const operator = initializeOperator(options);
  const { deleteApp } = requireFunctions('firebase-admin/app');
  const access = await operator.credential.getAccessToken();
  const headers = { Authorization: `Bearer ${access.access_token}`, 'X-Goog-User-Project': options.project };
  const request = async (url, method = 'GET', body, missing = false, knownRoles = [], timeoutMs = 30_000) => {
    const response = await fetch(url, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      let errorBody;
      if (response.status === 400 && knownRoles.length) {
        try { errorBody = await response.json(); } catch {}
      }
      throw infrastructureFailure(method, response.status, errorBody, knownRoles);
    }
    return response.status === 204 ? {} : response.json();
  };
  const projectUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${options.project}`;
  const iamProject = `https://iam.googleapis.com/v1/projects/${options.project}`;
  const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(options.bucket)}`;
  const queueName = `projects/${options.project}/locations/${REGION}/queues/${WORKER}`;
  const queueUrl = `https://cloudtasks.googleapis.com/v2/${queueName}`;
  const workerUrl = `https://cloudfunctions.googleapis.com/v2/projects/${options.project}/locations/${REGION}/functions/${WORKER}`;
  const saEmail = `${SA_ID}@${options.project}.iam.gserviceaccount.com`;
  const saUrl = `${iamProject}/serviceAccounts/${saEmail}`;
  const writerUrl = `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(options.writerServiceAccount)}`;
  const definitions = [
    [ROLE_ID, 'Private public-feed object reader', ['storage.objects.get']],
    [WRITER_ROLE_ID, 'Private public-feed artifact writer', WRITER_PERMISSIONS],
    [METADATA_ROLE_ID, 'Private public-feed bucket metadata reader', ['storage.buckets.get']],
    [FUNCTION_ROLE_ID, 'Private public-feed worker metadata reader', ['cloudfunctions.functions.get']]
  ];
  const roles = Object.fromEntries(definitions.map(([id]) => [id, `projects/${options.project}/roles/${id}`]));
  try {
    const results = await Promise.allSettled([
      request(projectUrl), request(`${bucketUrl}?projection=full`), request(`${bucketUrl}/iam?optionsRequestedPolicyVersion=3`),
      request(`${projectUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } }),
      request(saUrl, 'GET', undefined, true), request(writerUrl),
      request(queueUrl, 'GET', undefined, true), request(workerUrl, 'GET', undefined, true),
      request(`https://serviceusage.googleapis.com/v1/projects/${options.project}/services/${IAM_VERIFICATION_API}`),
      ...definitions.map(([id]) => request(`${iamProject}/roles/${id}`, 'GET', undefined, true))
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [project, bucket, bucketPolicy, projectPolicy, serviceAccount, writerAccount, queue, worker, verificationService, ...existingRoles] = results.map((result) => result.value);
    assertPrivateSnapshotBucket(bucket, project, options.bucket);
    if (hasPublicMember(projectPolicy) || hasPublicMember(bucketPolicy)
      || bucket.defaultObjectAcl?.some((entry) => ['allUsers', 'allAuthenticatedUsers'].includes(entry.entity))) {
      throw new DeliveryOperatorError('Public IAM/default ACL access prevents a private snapshot bucket; review it before provisioning.');
    }
    const readerMember = `serviceAccount:${saEmail}`;
    const writerMember = `serviceAccount:${options.writerServiceAccount}`;
    if (projectPolicy.bindings?.some((binding) => binding.members?.includes(readerMember))) {
      throw new DeliveryOperatorError('The dedicated reader already has project IAM grants; review/remove them before provisioning.');
    }
    const expectedCondition = `resource.name.startsWith('projects/_/buckets/${options.bucket}/objects/${PREFIX}')`;
    if (bucketPolicy.bindings?.some((binding) => binding.members?.includes(readerMember)
      && (binding.role !== roles[ROLE_ID] || binding.condition?.expression !== expectedCondition))) {
      throw new DeliveryOperatorError('The dedicated reader has broader bucket access than the snapshot prefix.');
    }
    if (serviceAccount?.disabled || writerAccount.disabled || writerAccount.projectId !== options.project || writerAccount.email === saEmail) {
      throw new DeliveryOperatorError('Reader must be active and writer must be an existing active same-project identity distinct from the reader.');
    }
    for (let index = 0; index < definitions.length; index += 1) {
      const role = existingRoles[index];
      if (role && (role.deleted || role.stage === 'DISABLED' || !Array.isArray(role.includedPermissions)
        || JSON.stringify([...role.includedPermissions].sort()) !== JSON.stringify([...definitions[index][2]].sort()))) {
        throw new DeliveryOperatorError('An existing custom snapshot role has unexpected permissions.');
      }
    }
    if (queue && queue.state !== 'RUNNING') throw new DeliveryOperatorError('Existing snapshot queue is paused/disabled; resume requires separate operator review.');
    let workerPolicy = null;
    if (worker) {
      if (worker.serviceConfig?.serviceAccountEmail !== options.writerServiceAccount || !worker.serviceConfig?.service) {
        throw new DeliveryOperatorError('Deployed worker runtime identity does not match the reviewed writer.');
      }
      workerPolicy = await request(`https://run.googleapis.com/v2/${worker.serviceConfig.service}:getIamPolicy`);
      if (hasPublicMember(workerPolicy)) throw new DeliveryOperatorError('Snapshot worker is publicly invokable; remove public IAM before provisioning.');
    }
    if (queue && hasPublicMember(await request(`${queueUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } }))) {
      throw new DeliveryOperatorError('Snapshot queue has public IAM; review it before provisioning.');
    }
    const plan = { projectId: options.project, bucket: options.bucket, readerServiceAccount: saEmail,
      readerRole: 'storage.objects.get on public-snapshots/ only; no Firestore/project grants',
      writerServiceAccount: options.writerServiceAccount,
      iamVerificationApi: iamVerificationApiPlan(verificationService),
      bucketIamPropagationRetry: { maxAttempts: IAM_PROPAGATION_DELAYS_MS.length + 1, maxElapsedSeconds: IAM_PROPAGATION_TIMEOUT_MS / 1000 },
      writerRole: 'Snapshot prefix object get/create/delete/update and bucket metadata get.',
      serviceAccount: serviceAccount ? 'reuse' : 'create', customRoles: definitions.map(([id], index) => ({ id, action: existingRoles[index] ? 'reuse' : 'create' })),
      queue: { action: queue ? 'update-existing' : 'create', ...desiredSnapshotQueue(queueName) },
      workerInvoker: worker ? 'grant private writer invoker' : 'pending backend deployment; rerun this command afterwards',
      enqueuePermissions: 'Queue enqueuer, self service-account actAs, Functions metadata get; no reader grants.',
      lifecycle: 'Add one-day deletion only for public-snapshots/generations/; preserve existing rules and soft-delete setting.' };
    if (!options.apply) { console.log(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2)); return; }
    await ownerSession(operator, options, async (actor) => {
      const { auditData } = await import('../functions/lib/core.js');
      await operator.db.runTransaction(async (transaction) => {
        assertTransactionOwner(await transaction.get(operator.db.collection('adminAccounts').doc(actor.uid)), actor);
        transaction.create(operator.db.collection('adminAuditLogs').doc(), auditData(actor,
          'public_delivery.infrastructure_provision_requested', 'system', 'publicSnapshots', options.reason,
          { bucket: options.bucket, readerServiceAccount: saEmail, writerServiceAccount: options.writerServiceAccount,
            enableIamVerificationApi: verificationService.state !== 'ENABLED', releaseTag: options.releaseTag || '' }));
      });
      await ensureIamVerificationApi(project.projectNumber, request);
      if (!serviceAccount) await request(`${iamProject}/serviceAccounts`, 'POST', {
        accountId: SA_ID, serviceAccount: { displayName: 'Private public snapshot reader; no Firestore access' }
      });
      for (let index = 0; index < definitions.length; index += 1) {
        const [id, title, permissions] = definitions[index];
        if (!existingRoles[index]) await request(`${iamProject}/roles`, 'POST', { roleId: id,
          role: { title, stage: 'GA', includedPermissions: permissions } });
      }
      const policy = await request(`${bucketUrl}/iam?optionsRequestedPolicyVersion=3`);
      const prefixCondition = { title: 'private-public-snapshot-prefix', expression: expectedCondition };
      addPrivateIamBinding(policy, roles[ROLE_ID], readerMember, prefixCondition);
      addPrivateIamBinding(policy, roles[WRITER_ROLE_ID], writerMember, prefixCondition);
      addPrivateIamBinding(policy, roles[METADATA_ROLE_ID], writerMember);
      await putBucketIamWithPropagationRetry(timeoutMs => request(`${bucketUrl}/iam`, 'PUT', policy, false, Object.values(roles), timeoutMs));
      const desiredQueue = desiredSnapshotQueue(queueName);
      if (!queue) await request(`https://cloudtasks.googleapis.com/v2/projects/${options.project}/locations/${REGION}/queues`, 'POST', desiredQueue);
      else await request(`${queueUrl}?updateMask=rateLimits,retryConfig`, 'PATCH', desiredQueue);
      const queuePolicy = await request(`${queueUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
      if (hasPublicMember(queuePolicy)) throw new DeliveryOperatorError('Queue IAM changed to public during provisioning.');
      addPrivateIamBinding(queuePolicy, 'roles/cloudtasks.enqueuer', writerMember);
      await request(`${queueUrl}:setIamPolicy`, 'POST', { policy: queuePolicy });
      const selfPolicy = await request(`${writerUrl}:getIamPolicy?options.requestedPolicyVersion=3`, 'POST');
      addPrivateIamBinding(selfPolicy, 'roles/iam.serviceAccountUser', writerMember);
      await request(`${writerUrl}:setIamPolicy`, 'POST', { policy: selfPolicy });
      const metadataPolicy = await request(`${projectUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
      addPrivateIamBinding(metadataPolicy, roles[FUNCTION_ROLE_ID], writerMember);
      await request(`${projectUrl}:setIamPolicy`, 'POST', { policy: metadataPolicy });
      if (worker) {
        const serviceUrl = `https://run.googleapis.com/v2/${worker.serviceConfig.service}`;
        const policy = await request(`${serviceUrl}:getIamPolicy`);
        if (hasPublicMember(policy)) throw new DeliveryOperatorError('Worker IAM changed to public during provisioning.');
        addPrivateIamBinding(policy, 'roles/run.invoker', writerMember);
        await request(`${serviceUrl}:setIamPolicy`, 'POST', { policy, updateMask: 'bindings,etag' });
      }
      const currentBucket = await request(bucketUrl);
      await request(`${bucketUrl}?ifMetagenerationMatch=${currentBucket.metageneration}`, 'PATCH', {
        lifecycle: { rule: snapshotLifecycle(currentBucket.lifecycle?.rule || []) }
      });
      try {
        await verifyReaderFirestoreIsolation({ project: options.project, reader: saEmail,
          api: (url, init) => request(url, init.method, JSON.parse(init.body)) });
      } catch (error) {
        if (error instanceof PublicDeliveryIamVerificationError) throw new DeliveryOperatorError(error.message);
        throw error;
      }
      await operator.db.collection('adminAuditLogs').add(auditData(actor,
        'public_delivery.infrastructure_provisioned', 'system', 'publicSnapshots', options.reason,
        { bucket: options.bucket, readerServiceAccount: saEmail, writerServiceAccount: options.writerServiceAccount, workerInvokerReady: !!worker, releaseTag: options.releaseTag || '' }));
      console.log(JSON.stringify({ mode: 'apply', ...plan,
        functionParameters: { PUBLIC_FEED_SERVICE_ACCOUNT: saEmail, PUBLIC_SNAPSHOT_BUCKET: options.bucket },
        nextStep: worker ? 'Bootstrap a private snapshot, then run backend verification before Rules/frontend release.'
          : 'Deploy the backend using these parameters, rerun provisioning to grant the private worker invoker, then bootstrap and verify.' }, null, 2));
    });
  } finally { await operator.db.terminate(); await deleteApp(operator.app); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(reportOperatorError);
