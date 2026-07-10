import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

const PROJECT = 'kanata-memorial';
const BUCKET = 'kanata-memorial.firebasestorage.app';
const BACKUP_PREFIX = 'governance-backups/';
const MANIFEST_DIRECTORY = '.production-backups';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || '') : '';
}

const project = argument('--project');
const confirmation = argument('--confirm-production');
const label = argument('--label');
const apply = process.argv.includes('--apply');

if (
  project !== PROJECT ||
  confirmation !== PROJECT ||
  !['preflight', 'final'].includes(label)
) {
  console.error(
    'Refusing production backup. Project confirmation and --label <preflight|final> are required.'
  );
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupRoot = `${BACKUP_PREFIX}${timestamp}-${label}`;
const outputUriPrefix = `gs://${BUCKET}/${backupRoot}/firestore`;

if (!apply) {
  console.log(JSON.stringify({
    projectId: PROJECT,
    mode: 'dry-run',
    label,
    outputUriPrefix
  }, null, 2));
  process.exit(0);
}

const release = requireProductionReleaseTag(argument('--release-tag'));

const credential = applicationDefault();
const app = initializeApp({ projectId: PROJECT, storageBucket: BUCKET, credential });
const db = getFirestore(app);
const bucket = getStorage(app).bucket(BUCKET);
const accessToken = await credential.getAccessToken();
const headers = {
  Authorization: `Bearer ${accessToken.access_token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': PROJECT
};

if (!existsSync(MANIFEST_DIRECTORY)) mkdirSync(MANIFEST_DIRECTORY, { recursive: true });
const manifestPath = join(MANIFEST_DIRECTORY, `${timestamp}-${label}.json`);
function saveManifest(value) {
  writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function verifyFinalMaintenanceLock() {
  if (label !== 'final') return;
  const maintenance = await db.collection('system').doc('maintenance').get();
  if (!maintenance.exists || maintenance.data()?.enabled !== true) {
    throw new Error('The final production backup requires the verified maintenance lock.');
  }
}

await verifyFinalMaintenanceLock();

const [allFiles] = await bucket.getFiles();
const sourceFiles = allFiles.filter((file) => !file.name.startsWith(BACKUP_PREFIX));
let copiedStorageObjects = 0;
for (const file of sourceFiles) {
  await file.copy(bucket.file(`${backupRoot}/storage/${file.name}`));
  copiedStorageObjects += 1;
}

await verifyFinalMaintenanceLock();

const exportResponse = await fetch(
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default):exportDocuments`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({ outputUriPrefix })
  }
);
if (!exportResponse.ok) {
  throw new Error(`Unable to start production Firestore export (${exportResponse.status}).`);
}

let operation = await exportResponse.json();
if (typeof operation.name !== 'string' || !operation.name.startsWith(
  `projects/${PROJECT}/databases/(default)/operations/`
)) {
  throw new Error('Firestore returned an unexpected export operation resource.');
}

saveManifest({
  projectId: PROJECT,
  label,
  status: 'running',
  operationName: operation.name,
  outputUriPrefix,
  sourceStorageObjects: sourceFiles.length,
  copiedStorageObjects,
  startedAt: new Date().toISOString()
});
console.log(`Firestore export operation: ${operation.name}`);

const deadline = Date.now() + 30 * 60 * 1000;
while (operation.done !== true && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const pollResponse = await fetch(`https://firestore.googleapis.com/v1/${operation.name}`, { headers });
  if (!pollResponse.ok) {
    throw new Error(`Unable to poll production Firestore export (${pollResponse.status}).`);
  }
  operation = await pollResponse.json();
}

if (
  operation.done !== true ||
  operation.error ||
  operation.metadata?.operationState !== 'SUCCESSFUL' ||
  operation.metadata?.outputUriPrefix !== outputUriPrefix
) {
  saveManifest({
    projectId: PROJECT,
    label,
    status: operation.done === true ? 'failed' : 'timed-out',
    operationName: operation.name,
    outputUriPrefix,
    sourceStorageObjects: sourceFiles.length,
    copiedStorageObjects,
    operationState: operation.metadata?.operationState || 'UNKNOWN',
    updatedAt: new Date().toISOString()
  });
  throw new Error('Production Firestore export did not complete successfully within 30 minutes.');
}

const manifest = {
  projectId: PROJECT,
  label,
  status: 'complete',
  operationName: operation.name,
  outputUriPrefix,
  sourceStorageObjects: sourceFiles.length,
  copiedStorageObjects,
  operationState: operation.metadata.operationState,
  releaseTag: release.releaseTag,
  releaseCommit: release.commit,
  completedAt: new Date().toISOString()
};
saveManifest(manifest);
console.log(JSON.stringify(manifest, null, 2));
