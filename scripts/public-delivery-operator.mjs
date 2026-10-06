import { createRequire } from 'node:module';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

export const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
export const PRODUCTION = 'kanata-memorial';
export const STAGING = 'kanata-memorial-admin';
export const DEMO = 'demo-kanata-governance';
export class DeliveryOperatorError extends Error {}

export function parseOperatorOptions(args, extra = {}) {
  const options = { apply: false, help: false };
  const flags = new Map(Object.entries({ '--project': 'project', '--bucket': 'bucket',
    '--confirm-production': 'confirmation', '--release-tag': 'releaseTag',
    '--owner-uid': 'ownerUid', '--reason': 'reason', ...extra }));
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--apply' || flag === '--help') {
      const key = flag === '--apply' ? 'apply' : 'help';
      if (options[key]) throw new DeliveryOperatorError(`Duplicate option: ${flag}.`);
      options[key] = true;
    } else if (flags.has(flag) && args[index + 1] && !args[index + 1].startsWith('--')) {
      const key = flags.get(flag);
      if (options[key] !== undefined) throw new DeliveryOperatorError(`Duplicate option: ${flag}.`);
      options[key] = args[++index];
    } else throw new DeliveryOperatorError('Unknown option or missing value. Use --help.');
  }
  if (options.help) return options;
  if (![PRODUCTION, STAGING, DEMO].includes(options.project)) {
    throw new DeliveryOperatorError('An explicit allowed --project is required.');
  }
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    if (options.project === DEMO && !process.env[key]) throw new DeliveryOperatorError('Demo operations require all three Firebase emulators.');
    if (options.project !== DEMO && process.env[key]) throw new DeliveryOperatorError('Remote operations refuse emulator overrides.');
  }
  if (options.apply && options.project === PRODUCTION) {
    if (options.confirmation !== PRODUCTION) throw new DeliveryOperatorError('Production apply requires matching --confirm-production.');
    requireProductionReleaseTag(options.releaseTag);
  }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) process.env[key] = options.project;
  return options;
}

export function initializeOperator(options) {
  if (!/^[a-z0-9][a-z0-9._-]{2,221}$/.test(options.bucket || '')) {
    throw new DeliveryOperatorError('An explicit --bucket matching PUBLIC_SNAPSHOT_BUCKET is required.');
  }
  process.env.PUBLIC_SNAPSHOT_BUCKET = options.bucket;
  const { applicationDefault, initializeApp } = requireFunctions('firebase-admin/app');
  const credential = options.project === DEMO ? undefined : applicationDefault();
  const app = initializeApp({ projectId: options.project,
    storageBucket: `${options.project}.firebasestorage.app`,
    ...(options.writerServiceAccount ? { serviceAccountId: options.writerServiceAccount } : {}),
    ...(credential ? { credential } : {}) });
  const { getAuth } = requireFunctions('firebase-admin/auth');
  const { getFirestore } = requireFunctions('firebase-admin/firestore');
  return { app, credential, db: getFirestore(app), auth: getAuth(app) };
}

async function hiddenOwnerToken() {
  const input = process.stdin;
  if (input.isTTY) process.stderr.write('Existing Owner Password-session token (hidden): ');
  return new Promise((resolveToken, reject) => {
    let token = '';
    let finished = false;
    const cleanup = () => {
      finished = true;
      input.off('data', onData); input.off('end', onEnd); input.off('error', onError);
      if (input.isTTY) { input.setRawMode(false); process.stderr.write('\n'); }
      input.pause();
    };
    const finish = () => {
      if (finished) return;
      cleanup();
      if (!token.trim()) reject(new DeliveryOperatorError('A valid Owner session token is required on stdin.'));
      else resolveToken(token.trim());
    };
    const onEnd = () => finish();
    const onError = () => { cleanup(); reject(new DeliveryOperatorError('Cannot read the Owner session token.')); };
    const onData = (chunk) => {
      if (chunk.includes('\u0003')) { cleanup(); reject(new DeliveryOperatorError('Owner authorization cancelled.')); return; }
      token += chunk;
      if (token.length > 16000) { cleanup(); reject(new DeliveryOperatorError('Invalid Owner token size.')); return; }
      if (/\r|\n/.test(chunk)) finish();
    };
    input.setEncoding('utf8');
    if (input.isTTY) input.setRawMode(true);
    input.on('data', onData); input.on('end', onEnd); input.on('error', onError); input.resume();
  });
}

export async function ownerSession(operator, options, operation) {
  if (!/^[^/\s]{1,128}$/.test(options.ownerUid || '') || !(options.reason || '').trim()
    || options.reason.length > 500) throw new DeliveryOperatorError('Apply requires --owner-uid and a 1-500 character --reason.');
  const { validateAdminIdentity } = await import('../functions/lib/core.js');
  let token = await hiddenOwnerToken();
  try {
    const decoded = await operator.auth.verifyIdToken(token, true);
    if (decoded.uid !== options.ownerUid) throw new DeliveryOperatorError('The Owner token UID does not match --owner-uid.');
    const actor = await validateAdminIdentity(options.ownerUid, decoded);
    if (actor.role !== 'owner') throw new DeliveryOperatorError('Only an active Owner may operate private public snapshots.');
    return await operation(actor);
  } finally { token = ''; }
}

export function assertTransactionOwner(account, actor) {
  const data = account.data();
  if (!account.exists || data?.disabled === true || data?.role !== 'owner'
    || data?.sessionVersion !== actor.sessionVersion) {
    throw new DeliveryOperatorError('Owner authorization changed during the operation.');
  }
}

export function reportOperatorError(error) {
  console.error(error instanceof DeliveryOperatorError ? error.message
    : 'Public delivery operation failed. Check ADC, permissions, compiled Functions, and project configuration locally; no credentials were logged.');
  process.exitCode = 1;
}
