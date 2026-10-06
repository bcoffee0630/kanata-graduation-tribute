// Read-only checks shared by staging and production release preflights.
import { verifyReaderFirestoreIsolation, verifyReaderSnapshotStorageIsolation } from './public-delivery-iam-verification.mjs';
export const PUBLIC_FEED_NAMES = ['publicGalleryFeed', 'publicMessagesFeed', 'publicFeedVersion'];
const REGION = 'asia-east1';
const WORKER = 'publishPublicSnapshots';
const publicMember = policy => (policy.bindings || []).some(binding =>
  (binding.members || []).some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member)));

export async function verifyPublicSnapshotInfrastructure({ project, inventory, api, fetchFeed = fetch, now = Date.now }) {
  const byName = new Map(inventory.map(fn => [fn.name.split('/').at(-1).toLowerCase(), fn]));
  const getFunction = name => {
    const fn = byName.get(name.toLowerCase());
    if (fn?.state !== 'ACTIVE' || fn.buildConfig?.runtime !== 'nodejs22') throw new Error(`Snapshot function ${name} is not active on Node.js 22.`);
    return fn;
  };
  const ttlCollections = ['publicEndpointLimits', 'publicSnapshotCycles'];
  const ttlResults = await Promise.allSettled(ttlCollections.map(collection => api(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/${collection}/fields/expiresAt`)));
  for (let index = 0; index < ttlResults.length; index++) {
    const result = ttlResults[index];
    if (result.status !== 'fulfilled' || result.value.ttlConfig?.state !== 'ACTIVE') {
      throw new Error(`Snapshot TTL ${ttlCollections[index]}.expiresAt is not ACTIVE; wait for backend policy propagation before release.`);
    }
  }
  const reader = `public-feed-reader@${project}.iam.gserviceaccount.com`;
  const bucketName = getFunction('publicGalleryFeed').serviceConfig?.environmentVariables?.PUBLIC_SNAPSHOT_BUCKET;
  if (!bucketName || bucketName === `${project}.appspot.com` || bucketName === `${project}.firebasestorage.app`) {
    throw new Error('Public reader needs an explicit dedicated snapshot bucket.');
  }
  const projectInfo = await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`);
  const bucket = await api(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}`);
  if (String(bucket.projectNumber) !== String(projectInfo.projectNumber)
    || bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true
    || bucket.iamConfiguration?.publicAccessPrevention !== 'enforced') throw new Error('Dedicated snapshot bucket ownership or UBLA/PAP is incorrect.');
  const bucketPolicy = await api(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/iam?optionsRequestedPolicyVersion=3`);
  if (publicMember(bucketPolicy)) throw new Error('Snapshot bucket has public IAM.');
  const permission = async (principal, fullResourceName, permissionName, expected) => {
    const result = await api('https://policytroubleshooter.googleapis.com/v1/iam:troubleshoot', {
      method: 'POST', body: JSON.stringify({ accessTuple: { principal, fullResourceName, permission: permissionName } })
    });
    if (result.access !== expected) throw new Error(`Snapshot IAM ${permissionName} is not proven ${expected}, including inherited policies.`);
  };
  await verifyReaderFirestoreIsolation({ project, reader, api });
  const storageIsolation = await verifyReaderSnapshotStorageIsolation({ project, reader, bucketName, bucketPolicy, api });
  const worker = getFunction(WORKER);
  const writer = worker.serviceConfig?.serviceAccountEmail;
  if (!writer || writer === reader || !worker.serviceConfig?.service || worker.serviceConfig?.environmentVariables?.PUBLIC_SNAPSHOT_BUCKET !== bucketName) {
    throw new Error('Private snapshot worker identity/bucket configuration is incorrect.');
  }
  for (const name of ['queuePublicSnapshotUpdate', 'maintainPublicSnapshots']) {
    const fn = getFunction(name);
    if (fn.serviceConfig?.serviceAccountEmail !== writer || fn.serviceConfig?.environmentVariables?.PUBLIC_SNAPSHOT_BUCKET !== bucketName) {
      throw new Error(`Snapshot ${name} must use the reviewed writer identity and bucket.`);
    }
  }
  if (Number(worker.serviceConfig?.maxInstanceCount) !== 1 || Number(worker.serviceConfig?.maxInstanceRequestConcurrency) !== 1) {
    throw new Error('Private snapshot worker instance/concurrency limits are incorrect.');
  }
  const workerPolicy = await api(`https://run.googleapis.com/v2/${worker.serviceConfig.service}:getIamPolicy`);
  if (publicMember(workerPolicy)) throw new Error('Snapshot task worker is publicly invokable.');
  await permission(writer, `//run.googleapis.com/${worker.serviceConfig.service}`, 'run.routes.invoke', 'GRANTED');
  const queueName = `projects/${project}/locations/${REGION}/queues/${WORKER}`;
  const queue = await api(`https://cloudtasks.googleapis.com/v2/${queueName}`);
  if (queue.state !== 'RUNNING' || queue.rateLimits?.maxConcurrentDispatches !== 1
    || queue.rateLimits?.maxDispatchesPerSecond !== 0.5 || queue.retryConfig?.maxAttempts !== 3
    || queue.retryConfig?.minBackoff !== '1s' || queue.retryConfig?.maxBackoff !== '10s'
    || queue.retryConfig?.maxDoublings !== 3) throw new Error('Private snapshot queue is not running with the reviewed resource/retry bounds.');
  const queuePolicy = await api(`https://cloudtasks.googleapis.com/v2/${queueName}:getIamPolicy`, {
    method: 'POST', body: JSON.stringify({ options: { requestedPolicyVersion: 3 } })
  });
  if (publicMember(queuePolicy)) throw new Error('Snapshot queue has public IAM.');
  await permission(writer, `//cloudtasks.googleapis.com/${queueName}`, 'cloudtasks.tasks.create', 'GRANTED');
  const writerResource = `//iam.googleapis.com/projects/${project}/serviceAccounts/${writer}`;
  await permission(writer, writerResource, 'iam.serviceAccounts.actAs', 'GRANTED');
  const tasksServiceAgent = `service-${projectInfo.projectNumber}@gcp-sa-cloudtasks.iam.gserviceaccount.com`;
  await permission(tasksServiceAgent, writerResource, 'iam.serviceAccounts.getOpenIdToken', 'GRANTED');
  await permission(writer, `//cloudfunctions.googleapis.com/${worker.name}`, 'cloudfunctions.functions.get', 'GRANTED');
  for (const functionName of PUBLIC_FEED_NAMES) {
    const fn = getFunction(functionName);
    if (fn.serviceConfig?.serviceAccountEmail !== reader || fn.serviceConfig?.environmentVariables?.PUBLIC_SNAPSHOT_BUCKET !== bucketName) {
      throw new Error(`Dedicated reader identity/bucket is incorrect for ${functionName}.`);
    }
    const path = functionName === 'publicGalleryFeed' ? '/api/gallery/batches/0'
      : functionName === 'publicMessagesFeed' ? '/api/messages' : '/api/feed/version';
    const response = await fetchFeed(`${fn.serviceConfig.uri}${path}`, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({}));
    const bound = functionName === 'publicGalleryFeed' ? 6 : 100;
    const fresh = value => value && typeof value.version === 'string' && /^(0|[1-9]\d{0,15})$/.test(value.version)
      && Number.isSafeInteger(value.generatedAt) && Number.isSafeInteger(value.confirmedAt)
      && value.generatedAt <= value.confirmedAt && Number.isSafeInteger(value.validUntil)
      && value.validUntil > now() && value.validUntil > value.confirmedAt
      && value.validUntil - value.confirmedAt <= 300_000;
    const valid = response.status === 200 && (functionName === 'publicFeedVersion'
      ? fresh(payload.messages) && fresh(payload.gallery)
      : fresh(payload) && Array.isArray(payload.items) && payload.items.length <= bound);
    if (!valid) throw new Error(`Fresh bounded snapshot is unavailable for ${functionName}; do not switch public Rules/frontend.`);
  }
  return { snapshotBucket: bucketName, dedicatedReaderFirestoreAccess: 'NOT_GRANTED', feeds: PUBLIC_FEED_NAMES.length,
    dedicatedReaderStorageIsolation: { ...storageIsolation, insidePrefixRead: 'VERIFIED_BY_THREE_ACTUAL_READER_FEED_200' },
    privateTaskWorker: true, activeTtlPolicies: ttlCollections.length, taskQueueBounds: '0.5/s, one concurrent dispatch, three attempts' };
}
