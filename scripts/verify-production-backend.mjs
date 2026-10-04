import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationDefault } from 'firebase-admin/app';

const PROJECT = 'kanata-memorial';
const REGION = 'asia-east1';
const MANIFEST_DIRECTORY = '.production-backups';
const callableNames = [
  'beginFanartUpload',
  'bootstrapOwner',
  'finalizeFanartUpload',
  'getDashboard',
  'getUser',
  'inviteAdmin',
  'listUsers',
  'moderateContent',
  'recordAdminLogin',
  'resolveReportCase',
  'setUserRestriction',
  'submitMessage',
  'submitFanartLink',
  'submitReport',
  'updateAdminAccount'
];
const publicHttpNames = [...callableNames, 'fanartMedia'];
const scheduledNames = ['cleanupExpiredUploads', 'expireMutedRestrictions'];
const expectedNames = [...publicHttpNames, ...scheduledNames];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || '') : '';
}

const repairInvokers = process.argv.includes('--repair-public-invokers');
const expectedBootstrapState = argument('--expect-bootstrap');
if (
  argument('--project') !== PROJECT ||
  argument('--confirm-production') !== PROJECT ||
  !process.argv.includes('--verify') ||
  !['enabled', 'disabled'].includes(expectedBootstrapState) ||
  (repairInvokers && argument('--confirm-public-invokers') !== 'allUsers')
) {
  console.error(
    'Refusing production backend verification without project confirmation and --verify; ' +
    '--expect-bootstrap <enabled|disabled> is required; IAM repair additionally requires ' +
    '--confirm-public-invokers allUsers.'
  );
  process.exit(1);
}

const credential = applicationDefault();
const accessToken = await credential.getAccessToken();
const headers = {
  Authorization: `Bearer ${accessToken.access_token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': PROJECT
};

async function api(url, options = {}) {
  const response = await fetch(url, { headers, ...options });
  if (!response.ok) {
    const path = new URL(url).pathname;
    throw new Error(`Production backend verification request failed (${response.status}) for ${path}.`);
  }
  return response.json();
}

const functionsPayload = await api(
  `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions?pageSize=100`
);
const functions = functionsPayload.functions || [];
const functionsByName = new Map(functions.map((fn) => [fn.name.split('/').at(-1).toLowerCase(), fn]));
const missingFunctions = expectedNames.filter((name) => !functionsByName.has(name.toLowerCase()));
const unexpectedFunctions = functions
  .map((fn) => fn.name.split('/').at(-1))
  .filter((name) => !expectedNames.some((expected) => expected.toLowerCase() === name.toLowerCase()));
if (missingFunctions.length || unexpectedFunctions.length) {
  throw new Error(
    `Function inventory mismatch. Missing: ${missingFunctions.join(', ') || 'none'}; ` +
    `unexpected: ${unexpectedFunctions.join(', ') || 'none'}.`
  );
}
const inactiveFunctions = expectedNames.filter(
  (name) => functionsByName.get(name.toLowerCase())?.state !== 'ACTIVE'
);
if (inactiveFunctions.length) {
  throw new Error(`Functions are not ACTIVE: ${inactiveFunctions.join(', ')}.`);
}
const wrongRuntimeFunctions = expectedNames.filter(
  (name) => functionsByName.get(name.toLowerCase())?.buildConfig?.runtime !== 'nodejs22'
);
if (wrongRuntimeFunctions.length) {
  throw new Error(`Functions are not using Node.js 22: ${wrongRuntimeFunctions.join(', ')}.`);
}

const bootstrapFunction = functionsByName.get('bootstrapowner');
const deployedBootstrapUid = String(
  bootstrapFunction?.serviceConfig?.environmentVariables?.BOOTSTRAP_OWNER_UID || ''
).trim();
if (
  (expectedBootstrapState === 'enabled' && !deployedBootstrapUid) ||
  (expectedBootstrapState === 'disabled' && deployedBootstrapUid)
) {
  throw new Error(`Remote Owner bootstrap state is not ${expectedBootstrapState}.`);
}

async function runPolicy(serviceName) {
  return api(`https://run.googleapis.com/v2/${serviceName}:getIamPolicy`);
}

function hasPublicInvoker(policy) {
  return (policy.bindings || []).some((binding) =>
    binding.role === 'roles/run.invoker' &&
    !binding.condition &&
    (binding.members || []).includes('allUsers')
  );
}

const iamResults = [];
for (const functionName of publicHttpNames) {
  const fn = functionsByName.get(functionName.toLowerCase());
  const serviceName = fn?.serviceConfig?.service;
  if (!serviceName) throw new Error(`Cloud Run service is missing for ${functionName}.`);
  let policy = await runPolicy(serviceName);
  let repaired = false;
  if (!hasPublicInvoker(policy) && repairInvokers) {
    const bindings = [...(policy.bindings || [])];
    const unconditionedInvoker = bindings.find((binding) =>
      binding.role === 'roles/run.invoker' && !binding.condition
    );
    if (unconditionedInvoker) {
      unconditionedInvoker.members = [...new Set([...(unconditionedInvoker.members || []), 'allUsers'])];
    } else {
      bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] });
    }
    policy = await api(`https://run.googleapis.com/v2/${serviceName}:setIamPolicy`, {
      method: 'POST',
      body: JSON.stringify({ policy: { ...policy, bindings }, updateMask: 'bindings,etag' })
    });
    repaired = true;
  }
  const publicInvoker = hasPublicInvoker(policy);
  iamResults.push({ functionName, serviceName, publicInvoker, repaired });
}

const missingInvokers = iamResults.filter((result) => !result.publicInvoker);
if (missingInvokers.length) {
  throw new Error(
    `Cloud Run allUsers invoker is missing: ${missingInvokers.map((item) => item.functionName).join(', ')}.`
  );
}

for (const functionName of callableNames) {
  const uri = functionsByName.get(functionName.toLowerCase())?.serviceConfig?.uri;
  if (!uri) throw new Error(`Callable URI is missing for ${functionName}.`);
  const response = await fetch(uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} })
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.error?.status !== 'UNAUTHENTICATED') {
    throw new Error(`Anonymous callable verification failed for ${functionName} (${response.status}).`);
  }
}

const fanartUri = functionsByName.get('fanartmedia')?.serviceConfig?.uri;
const mediaResponse = await fetch(`${fanartUri}?fanartId=backend-verification-missing`);
if (mediaResponse.status !== 404) {
  throw new Error(`Anonymous fanart media verification failed (${mediaResponse.status}).`);
}

const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
const expectedIndexes = indexConfig.indexes || [];
function indexKey(index) {
  return JSON.stringify({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope || 'COLLECTION',
    fields: (index.fields || [])
      .filter((field) => field.fieldPath !== '__name__')
      .map((field) => ({ fieldPath: field.fieldPath, order: field.order }))
  });
}

const deployedIndexes = [];
for (const collectionGroup of [...new Set(expectedIndexes.map((index) => index.collectionGroup))]) {
  const payload = await api(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/` +
    `${encodeURIComponent(collectionGroup)}/indexes`
  );
  deployedIndexes.push(...(payload.indexes || []).map((index) => ({
    ...index,
    collectionGroup
  })));
}
const deployedByKey = new Map(deployedIndexes.map((index) => [indexKey(index), index]));
const missingIndexes = expectedIndexes.filter((index) => !deployedByKey.has(indexKey(index)));
const unreadyIndexes = expectedIndexes.filter((index) => {
  const deployed = deployedByKey.get(indexKey(index));
  return deployed && deployed.state !== 'READY';
});
if (missingIndexes.length || unreadyIndexes.length) {
  throw new Error(
    `Firestore indexes are not ready. Missing: ${missingIndexes.length}; unready: ${unreadyIndexes.length}.`
  );
}

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const manifest = {
  projectId: PROJECT,
  verifiedAt: new Date().toISOString(),
  functions: {
    expected: expectedNames.length,
    active: expectedNames.length,
    runtime: 'nodejs22',
    bootstrapState: expectedBootstrapState
  },
  publicHttp: {
    expected: publicHttpNames.length,
    allUsersInvoker: iamResults.filter((result) => result.publicInvoker).length,
    repaired: iamResults.filter((result) => result.repaired).map((result) => result.functionName)
  },
  anonymousCallables: { expected: callableNames.length, unauthenticated: callableNames.length },
  indexes: { expected: expectedIndexes.length, ready: expectedIndexes.length }
};
if (!existsSync(MANIFEST_DIRECTORY)) mkdirSync(MANIFEST_DIRECTORY, { recursive: true });
const manifestPath = join(MANIFEST_DIRECTORY, `backend-verification-${timestamp}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
