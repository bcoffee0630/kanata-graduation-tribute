import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

// The compiled core and its FieldValue transforms must share one Admin SDK/app registry.
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { applicationDefault, deleteApp, initializeApp } = requireFunctions('firebase-admin/app');
const { getAuth } = requireFunctions('firebase-admin/auth');
const { FieldValue, getFirestore } = requireFunctions('firebase-admin/firestore');

const PRODUCTION = 'kanata-memorial';
const STAGING = 'kanata-memorial-admin';
const DEMO = 'demo-kanata-governance';
const PRODUCTION_BUCKET = 'kanata-memorial.firebasestorage.app';
const REVIEWED_PATH = new URL('./curated-fanart.json', import.meta.url);
class ImportGuardError extends Error {}
const HELP = `Import three reviewed X fan-art references. Default: read-only dry-run.
  --project <kanata-memorial|kanata-memorial-admin|demo-kanata-governance>
  --owner-uid <existing-owner-uid>
  --apply --confirm-eligibility-date <today-in-Asia/Taipei>
Production apply additionally requires:
  --confirm-production kanata-memorial --release-tag <annotated-HEAD-tag>
  --backup-operation <successful-final-export-operation>
Apply reads a short-lived Owner Password-session ID token only from hidden TTY/stdin.
No token arguments, credential files, automated like scraping, or image copying.
`;

export function parseOptions(args) {
  const options = { apply: false, help: false };
  const flags = new Map([
    ['--project', 'project'], ['--owner-uid', 'ownerUid'],
    ['--confirm-production', 'confirmation'], ['--release-tag', 'releaseTag'],
    ['--backup-operation', 'backupOperation'],
    ['--confirm-eligibility-date', 'eligibilityDate']
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--apply' || flag === '--help') {
      options[flag === '--apply' ? 'apply' : 'help'] = true;
    } else if (flags.has(flag) && args[index + 1] && !args[index + 1].startsWith('--')) {
      const key = flags.get(flag);
      if (options[key]) throw new ImportGuardError(`Duplicate option: ${flag}.`);
      options[key] = args[++index];
    } else {
      throw new ImportGuardError('Unknown option or missing value. Use --help.');
    }
  }
  if (options.help) return options;
  if (![PRODUCTION, STAGING, DEMO].includes(options.project) ||
      !/^[^/\s]{1,128}$/.test(options.ownerUid || '')) {
    throw new ImportGuardError('An explicit allowed --project and --owner-uid are required.');
  }
  const emulatorKeys = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
  if (options.project === DEMO && emulatorKeys.some((key) => !process.env[key])) {
    throw new ImportGuardError('The demo project requires both Auth and Firestore emulators.');
  }
  if (options.project !== DEMO && emulatorKeys.some((key) => process.env[key])) {
    throw new ImportGuardError('Remote imports refuse emulator environment overrides.');
  }
  if (options.apply && options.eligibilityDate !== taipeiDate()) {
    throw new ImportGuardError('Apply requires today\'s --confirm-eligibility-date after human review of all three posts.');
  }
  if (options.apply && options.project === PRODUCTION && (
    options.confirmation !== PRODUCTION || !options.releaseTag ||
    !new RegExp(`^projects/${PRODUCTION}/databases/\\(default\\)/operations/[^/]+$`)
      .test(options.backupOperation || '')
  )) {
    throw new ImportGuardError('Production apply requires project confirmation, annotated release tag, and final --backup-operation.');
  }
  return options;
}

export function taipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function loadReviewedEntries(helper) {
  const manifest = JSON.parse(readFileSync(REVIEWED_PATH, 'utf8'));
  if (manifest.version !== 1 || manifest.reviewTimezone !== 'Asia/Taipei' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(manifest.reviewedDate) || manifest.entries?.length !== 3) {
    throw new ImportGuardError('The immutable three-entry review manifest is invalid.');
  }
  const entries = manifest.entries.map((entry) => {
    if (entry.humanVerifiedMoreThan100Likes !== true || entry.humanVerifiedFanartTag !== '#かなたーと' ||
        entry.humanVerifiedKanataArtwork !== true || !entry.observedLikeLabel || !entry.proofSource) {
      throw new ImportGuardError('Every curated post requires the stored human artwork, tag, and >100 likes review.');
    }
    const post = helper.parseXPostUrl(entry.postUrl);
    return { ...entry, post, id: helper.xFanartDocumentId(post) };
  });
  if (new Set(entries.map((entry) => entry.id)).size !== 3) {
    throw new ImportGuardError('The curated manifest contains duplicate posts.');
  }
  return { manifest, entries };
}

export function checkExisting(entry, snapshot) {
  if (!snapshot.exists) return 'add';
  const data = snapshot.data();
  const removedReference = data?.deleted === true && !data.postId;
  if (data?.sourceType !== 'x' || (data.postId !== entry.post.postId && !removedReference)) {
    throw new ImportGuardError(`The deterministic document ID ${entry.id} conflicts with existing content.`);
  }
  return 'skip';
}

async function readOwnerToken() {
  const input = process.stdin;
  if (input.isTTY) process.stderr.write('Owner Password-session ID token (hidden): ');
  return new Promise((resolveToken, reject) => {
    let token = '';
    const cleanup = () => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onError);
      if (input.isTTY) { input.setRawMode(false); process.stderr.write('\n'); }
      input.pause();
    };
    const finish = () => {
      cleanup();
      if (!token.trim()) reject(new ImportGuardError('An Owner session token is required on stdin.'));
      else resolveToken(token.trim());
    };
    const onError = () => { cleanup(); reject(new ImportGuardError('Unable to read the Owner session token.')); };
    const onEnd = () => finish();
    const onData = (chunk) => {
      if (chunk.includes('\u0003')) { cleanup(); reject(new ImportGuardError('Owner authentication cancelled.')); return; }
      token += chunk;
      if (token.length > 16000) { cleanup(); reject(new ImportGuardError('Invalid Owner session token.')); return; }
      if (/\r|\n/.test(chunk)) finish();
    };
    input.setEncoding('utf8');
    if (input.isTTY) input.setRawMode(true);
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
    input.resume();
  });
}

async function verifyFinalBackup(credential, options) {
  const token = await credential.getAccessToken();
  const response = await fetch(`https://firestore.googleapis.com/v1/${options.backupOperation}`, {
    headers: { Authorization: `Bearer ${token.access_token}`, 'X-Goog-User-Project': PRODUCTION },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new ImportGuardError(`Unable to verify the final backup (${response.status}).`);
  const operation = await response.json();
  const destination = new RegExp(`^gs://${PRODUCTION_BUCKET.replace(/\./g, '\\.')}\\/governance-backups\\/[^/]+-final\\/firestore$`);
  if (operation.done !== true || operation.error || operation.metadata?.operationState !== 'SUCCESSFUL' ||
      !destination.test(operation.metadata?.outputUriPrefix || '')) {
    throw new ImportGuardError('Apply requires a successful production final export to the approved backup destination.');
  }
}

export async function writeCuratedEntry({ db, entry, data, actor, audit, production }) {
  return db.runTransaction(async (transaction) => {
    const fanartRef = db.collection('fanart').doc(entry.id);
    const accountRef = db.collection('adminAccounts').doc(actor.uid);
    const reads = [transaction.get(fanartRef), transaction.get(accountRef)];
    if (production) reads.push(transaction.get(db.collection('system').doc('maintenance')));
    const [existing, accountSnapshot, maintenance] = await Promise.all(reads);
    const account = accountSnapshot.data();
    if (!accountSnapshot.exists || account?.disabled === true || account?.role !== 'owner' ||
        account.sessionVersion !== actor.sessionVersion) {
      throw new ImportGuardError('Owner authorization changed; import stopped.');
    }
    if (production && maintenance?.data()?.enabled !== true) {
      throw new ImportGuardError('Production imports require the verified maintenance lock.');
    }
    if (checkExisting(entry, existing) === 'skip') return 'skipped';
    transaction.create(fanartRef, data);
    transaction.set(db.collection('system').doc('publicContentRevision'), {
      fanartRevision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(db.collection('userStats').doc(actor.uid), {
      uid: actor.uid, fanartCount: FieldValue.increment(1),
      lastFanartAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.create(db.collection('adminAuditLogs').doc(), audit);
    return 'added';
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return; }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
    process.env[key] = options.project;
  }
  if (options.apply && options.project === PRODUCTION) {
    try { requireProductionReleaseTag(options.releaseTag); }
    catch (error) { throw new ImportGuardError(error.message); }
  }
  let helper;
  try { helper = await import('../functions/lib/fanart-link.js'); }
  catch { throw new ImportGuardError('Build the shared Functions helper first: npm run build.'); }
  const { manifest, entries } = loadReviewedEntries(helper);
  const credential = options.project === DEMO ? undefined : applicationDefault();
  const app = initializeApp({ projectId: options.project, ...(credential ? { credential } : {}) });
  const core = options.apply ? await import('../functions/lib/core.js') : null;
  const auth = getAuth(app);
  const db = getFirestore(app);
  try {
    if (credential) await credential.getAccessToken();
    const owner = await auth.getUser(options.ownerUid);
    const checks = await Promise.allSettled([
      db.collection('adminAccounts').doc(options.ownerUid).get(),
      db.getAll(...entries.map((entry) => db.collection('fanart').doc(entry.id)))
    ]);
    const failedCheck = checks.find((check) => check.status === 'rejected');
    if (failedCheck) throw failedCheck.reason;
    const [accountSnapshot, snapshots] = checks.map((check) => check.value);
    const account = accountSnapshot.data();
    if (owner.disabled || !accountSnapshot.exists || account?.disabled === true ||
        account?.role !== 'owner' || owner.customClaims?.adminRole !== 'owner' ||
        !Number.isSafeInteger(account.sessionVersion) || account.sessionVersion < 1 ||
        owner.customClaims?.adminSessionVersion !== account.sessionVersion) {
      throw new ImportGuardError('The specified UID is not an active Owner with matching session claims.');
    }
    const plan = entries.map((entry, index) => ({
      id: entry.id, postUrl: entry.post.postUrl, action: checkExisting(entry, snapshots[index]),
      reviewedDate: manifest.reviewedDate, observedLikeLabel: entry.observedLikeLabel
    }));
    if (!options.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', projectId: options.project, ownerValidated: true,
        add: plan.filter((entry) => entry.action === 'add').length,
        skip: plan.filter((entry) => entry.action === 'skip').length, entries: plan,
        applyRequirements: ['fresh human review of all three posts', 'Owner Password-session token on hidden stdin',
          ...(options.project === PRODUCTION ? ['project confirmation', 'annotated HEAD release tag', 'successful final backup', 'maintenance lock'] : [])]
      }, null, 2));
      return;
    }
    if (options.project === PRODUCTION) {
      await verifyFinalBackup(credential, options);
      const maintenance = await db.collection('system').doc('maintenance').get();
      if (maintenance.data()?.enabled !== true) {
        throw new ImportGuardError('Production imports require the verified maintenance lock.');
      }
    }
    let ownerToken = await readOwnerToken();
    try {
      const validateOwner = async () => {
        const decoded = await auth.verifyIdToken(ownerToken, true);
        if (decoded.uid !== options.ownerUid) throw new ImportGuardError('The Owner token UID does not match --owner-uid.');
        const actor = await core.validateAdminIdentity(decoded.uid, decoded);
        if (actor.role !== 'owner') throw new ImportGuardError('Only an Owner may import curated references.');
        return actor;
      };
      await validateOwner();
      // Fresh oEmbed checks prove current embeddability; like counts remain a human review.
      for (const entry of entries.filter((entry, index) => plan[index].action === 'add')) {
        await helper.verifyXPost(entry.post);
      }
      const results = [];
      for (const entry of entries) {
        const actor = await validateOwner();
        const data = helper.buildXFanartData({ post: entry.post, caption: '', submissionSource: 'curated',
          createdAt: FieldValue.serverTimestamp(), submitter: {
            uid: owner.uid, displayName: owner.displayName?.trim() || 'Anonymous',
            avatarUrl: core.safeHttpsUrl(owner.photoURL), providerId: 'password', profileLink: ''
          }
        });
        data.curation = { reviewedDate: manifest.reviewedDate, reviewedTimezone: manifest.reviewTimezone,
          creatorDisplayName: entry.creatorDisplayName, description: entry.description,
          observedLikeLabel: entry.observedLikeLabel, tag: '#かなたーと', moreThan100Likes: true,
          proofSource: entry.proofSource, eligibilityReconfirmedDate: options.eligibilityDate };
        const audit = core.auditData(actor, 'fanart.import_curated', 'fanart', entry.id,
          'Import human-reviewed Kanata fan artwork references', {
            postId: entry.post.postId, postUrl: entry.post.postUrl, reviewedDate: manifest.reviewedDate,
            eligibilityReconfirmedDate: options.eligibilityDate, quotaBypass: 'curated-owner-import',
            releaseTag: options.releaseTag || '', submissionSource: 'curated'
          });
        const result = await writeCuratedEntry({ db, entry, data, actor, audit, production: options.project === PRODUCTION });
        results.push({ id: entry.id, result });
      }
      console.log(JSON.stringify({ mode: 'apply', projectId: options.project, results }, null, 2));
    } finally { ownerToken = ''; }
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    // SDK failures can carry credentials or request bodies; do not log arbitrary errors.
    const knownGuard = error instanceof ImportGuardError ? error.message : '';
    const adcUnavailable = /default credentials|Could not load.*credentials/i.test(String(error?.message || ''));
    const dnsBlocked = /ENOTFOUND|EAI_AGAIN/i.test(String(error?.message || ''));
    const expiredAdc = /invalid_grant/i.test(String(error?.message || ''));
    const safeCode = /^[a-z0-9/_-]{1,80}$/i.test(String(error?.code || '')) ? String(error.code) : '';
    console.error(knownGuard || (adcUnavailable
      ? 'Curated import stopped: Application Default Credentials are unavailable; authenticate locally before a remote dry-run.'
      : dnsBlocked ? 'Curated import stopped: DNS/network access to the credential or project service failed; credentials were not proven invalid.'
      : expiredAdc ? 'Curated import stopped: the ADC credential exchange was rejected; refresh Application Default Credentials locally.'
      : `Curated import stopped: project/Owner access or post validation failed${safeCode ? ` (${safeCode})` : ''}. No credentials were logged.`));
    process.exitCode = 1;
  });
}
