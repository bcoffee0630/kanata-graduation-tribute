import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assertTransactionOwner, DeliveryOperatorError, initializeOperator, ownerSession,
  parseOperatorOptions, PRODUCTION, STAGING, reportOperatorError, requireFunctions } from './public-delivery-operator.mjs';

const HELP = `Prepare private snapshot prerequisites. Default: read-only inventory/plan.
  --project <kanata-memorial|kanata-memorial-admin>
  --bucket <dedicated-private-bucket-name>
Apply: --apply --owner-uid <existing-owner> --reason <reason>
Production also requires --confirm-production kanata-memorial --release-tag <annotated-HEAD-tag>.
Enables only the Cloud Tasks API and creates only the explicitly named project bucket
in asia-east1, STANDARD storage, uniform bucket access and enforced public access prevention.
Existing compliant resources are reused. Existing noncompliant buckets are never changed.
Does not modify billing, other APIs, legacy media, IAM, Rules, soft-delete or existing lifecycle settings.
`;
const API_NAME = 'cloudtasks.googleapis.com';

export function assertSetupBucketName(projectId, name) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name || '') || !name.startsWith(`${projectId}-`)
    || name === `${projectId}.appspot.com` || name === `${projectId}.firebasestorage.app`) {
    throw new DeliveryOperatorError('Use an explicit dedicated bucket named with the selected project prefix, 3–63 lowercase letters/digits/hyphens.');
  }
}
export function validateSetupBucket(bucket, project, name) {
  assertSetupBucketName(project.projectId, name);
  if (bucket.name !== name || String(bucket.projectNumber) !== String(project.projectNumber)
    || bucket.location !== 'ASIA-EAST1' || bucket.storageClass !== 'STANDARD'
    || bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true
    || bucket.iamConfiguration?.publicAccessPrevention !== 'enforced') {
    throw new DeliveryOperatorError('Existing bucket ownership, location, class or privacy settings differ. Review a new dedicated bucket; no existing bucket will be modified.');
  }
}
export function snapshotBucketCreation(name) {
  return { name, location: 'ASIA-EAST1', storageClass: 'STANDARD',
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } };
}
export async function waitForServiceEnable(operation, readOperation, { now = Date.now,
  pause = delay => new Promise(resolve => setTimeout(resolve, delay)), timeoutMs = 75_000 } = {}) {
  const deadline = now() + timeoutMs;
  let current = operation;
  for (let poll = 0; poll < 30; poll++) {
    if (current.done) {
      if (current.error) throw new DeliveryOperatorError('Cloud Tasks API enable operation failed; inspect the current API state before retrying.');
      return;
    }
    if (typeof current.name !== 'string' || !/^operations\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(current.name)
      || now() >= deadline) throw new DeliveryOperatorError('Cloud Tasks API enable is pending/invalid; no bucket was created. Inspect state and rerun the dry-run.');
    await pause(2000);
    current = await readOperation(current.name);
  }
  throw new DeliveryOperatorError('Cloud Tasks API enable polling limit reached; no bucket was created. Inspect state and rerun the dry-run.');
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOperatorOptions(args);
  if (options.help) { console.log(HELP); return; }
  if (![PRODUCTION, STAGING].includes(options.project)) throw new DeliveryOperatorError('An explicit remote staging/production project is required.');
  assertSetupBucketName(options.project, options.bucket);
  const operator = initializeOperator(options);
  const { deleteApp } = requireFunctions('firebase-admin/app');
  try {
    const access = await operator.credential.getAccessToken();
    const request = async (url, method = 'GET', body, missing = false) => {
      const response = await fetch(url, { method,
        headers: { Authorization: `Bearer ${access.access_token}`, 'X-Goog-User-Project': options.project,
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
      if (missing && response.status === 404) return null;
      if (!response.ok) throw new DeliveryOperatorError(`Private resource setup ${method} failed (${response.status}); inspect operator IAM/API state before retrying.`);
      return response.status === 204 ? {} : response.json();
    };
    const projectUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${options.project}`;
    const serviceUrl = `https://serviceusage.googleapis.com/v1/projects/${options.project}/services/${API_NAME}`;
    const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(options.bucket)}`;
    const results = await Promise.allSettled([
      request(projectUrl), request(serviceUrl), request(bucketUrl, 'GET', undefined, true)
    ]);
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    const [project, service, existingBucket] = results.map(result => result.value);
    if (project.projectId !== options.project || project.lifecycleState !== 'ACTIVE' || !project.projectNumber
      || !['ENABLED', 'DISABLED'].includes(service.state)) throw new DeliveryOperatorError('Selected project/API state cannot be verified as active and usable.');
    const assertNoPublicAccess = async () => {
      const policy = await request(`${bucketUrl}/iam?optionsRequestedPolicyVersion=3`);
      if (policy.bindings?.some(binding => binding.members?.some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member)))) {
        throw new DeliveryOperatorError('Existing snapshot bucket has public IAM; this setup does not alter existing access policies.');
      }
    };
    if (existingBucket) { validateSetupBucket(existingBucket, project, options.bucket); await assertNoPublicAccess(); }
    const plan = { projectId: options.project, bucket: options.bucket,
      cloudTasksApi: service.state === 'ENABLED' ? 'reuse-enabled' : 'enable',
      bucketAction: existingBucket ? 'reuse-private-bucket' : 'create-private-bucket',
      desiredBucket: snapshotBucketCreation(options.bucket), maxEnablePolls: 30, requestTimeoutSeconds: 15 };
    if (!options.apply) { console.log(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2)); return; }
    await ownerSession(operator, options, async actor => {
      const { auditData } = await import('../functions/lib/core.js');
      await operator.db.runTransaction(async transaction => {
        assertTransactionOwner(await transaction.get(operator.db.collection('adminAccounts').doc(actor.uid)), actor);
        transaction.create(operator.db.collection('adminAuditLogs').doc(), auditData(actor,
          'public_delivery.private_resources_setup_requested', 'system', 'publicSnapshots', options.reason,
          { bucket: options.bucket, enableCloudTasksApi: service.state !== 'ENABLED', createBucket: !existingBucket, releaseTag: options.releaseTag || '' }));
      });
      if (service.state !== 'ENABLED') {
        const operation = await request(`https://serviceusage.googleapis.com/v1/projects/${project.projectNumber}/services/${API_NAME}:enable`, 'POST', {});
        await waitForServiceEnable(operation, name => request(`https://serviceusage.googleapis.com/v1/${name}`));
        if ((await request(serviceUrl)).state !== 'ENABLED') throw new DeliveryOperatorError('Cloud Tasks API is not yet enabled; no bucket was created. Retry the dry-run later.');
      }
      if (!existingBucket) await request(`https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(options.project)}`,
        'POST', snapshotBucketCreation(options.bucket));
      validateSetupBucket(await request(bucketUrl), project, options.bucket);
      await assertNoPublicAccess();
      await operator.db.collection('adminAuditLogs').add(auditData(actor,
        'public_delivery.private_resources_setup_completed', 'system', 'publicSnapshots', options.reason,
        { bucket: options.bucket, cloudTasksApiEnabled: true, releaseTag: options.releaseTag || '' }));
      console.log(JSON.stringify({ mode: 'apply', ...plan, cloudTasksApiEnabled: true,
        nextStep: 'Run provision-public-delivery.mjs dry-run and Owner-authorized apply for reader/writer/queue IAM before backend deployment.' }, null, 2));
    });
  } finally { await operator.db.terminate(); await deleteApp(operator.app); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(reportOperatorError);
