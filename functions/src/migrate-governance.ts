import { applicationDefault, initializeApp, type AppOptions } from 'firebase-admin/app';
import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const STAGING_PROJECT = 'kanata-memorial-admin';
const PRODUCTION_PROJECT = 'kanata-memorial';
const PRODUCTION_BUCKET = 'kanata-memorial.firebasestorage.app';
const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const projectId = projectIndex >= 0 ? (args[projectIndex + 1] || '') : (process.env.GCLOUD_PROJECT || '');
const bucketIndex = args.indexOf('--storage-bucket');
const storageBucket = bucketIndex >= 0
  ? (args[bucketIndex + 1] || '')
  : (process.env.FIREBASE_STORAGE_BUCKET || '');
const confirmationIndex = args.indexOf('--confirm-production');
const productionConfirmation = confirmationIndex >= 0 ? (args[confirmationIndex + 1] || '') : '';
const backupOperationIndex = args.indexOf('--backup-operation');
const backupOperation = backupOperationIndex >= 0 ? (args[backupOperationIndex + 1] || '') : '';
const apply = args.includes('--apply');
const isProduction = projectId === PRODUCTION_PROJECT;

if (!projectId) {
  console.error('Usage: npm run migrate:governance -- --project <project-id> [--storage-bucket <bucket>] [--apply]');
  process.exit(1);
}
if (projectId !== PRODUCTION_PROJECT && projectId !== STAGING_PROJECT && !projectId.startsWith('demo-')) {
  console.error(`Refusing governance migration for ${projectId}.`);
  process.exit(1);
}
if (isProduction && productionConfirmation !== PRODUCTION_PROJECT) {
  console.error('Production migration requires --confirm-production kanata-memorial.');
  process.exit(1);
}
if (apply && !storageBucket) {
  console.error('--storage-bucket is required when applying the governance migration.');
  process.exit(1);
}
if (isProduction && apply && storageBucket !== PRODUCTION_BUCKET) {
  console.error(`Production apply requires --storage-bucket ${PRODUCTION_BUCKET}.`);
  process.exit(1);
}
if (
  isProduction &&
  apply &&
  !backupOperation.startsWith(`projects/${PRODUCTION_PROJECT}/databases/(default)/operations/`)
) {
  console.error('Production apply requires a matching --backup-operation resource name.');
  process.exit(1);
}

const credential = process.env.FIRESTORE_EMULATOR_HOST ? undefined : applicationDefault();
const appOptions: AppOptions = { projectId };
if (storageBucket) appOptions.storageBucket = storageBucket;
if (credential) appOptions.credential = credential;
const app = initializeApp(appOptions);
const db = getFirestore();
const bucket = storageBucket ? getStorage(app).bucket(storageBucket) : null;

interface Stats {
  messageCount: number;
  fanartCount: number;
}

const stats = new Map<string, Stats>();
let batch: WriteBatch = db.batch();
let batchSize = 0;
const batchContentRevisions = new Set<string>();
let contentUpdates = 0;
let legacyReports = 0;
let sanitizedStorageObjects = 0;
let missingStorageObjects = 0;

async function verifyProductionBackup() {
  if (!isProduction || !apply || !credential) return;
  const accessToken = await credential.getAccessToken();
  const response = await fetch(`https://firestore.googleapis.com/v1/${backupOperation}`, {
    headers: { Authorization: `Bearer ${accessToken.access_token}` }
  });
  if (!response.ok) {
    throw new Error(`Unable to verify Firestore backup operation (${response.status}).`);
  }
  const operation = await response.json() as {
    done?: boolean;
    error?: unknown;
    metadata?: { outputUriPrefix?: string; operationState?: string };
  };
  const outputPrefix = String(operation.metadata?.outputUriPrefix || '');
  const finalBackupPattern = new RegExp(
    `^gs://${PRODUCTION_BUCKET.replace(/\./g, '\\.')}\\/governance-backups\\/[^/]+-final\\/firestore$`
  );
  if (
    operation.done !== true ||
    operation.error ||
    operation.metadata?.operationState !== 'SUCCESSFUL' ||
    !finalBackupPattern.test(outputPrefix)
  ) {
    throw new Error('The production final Firestore backup is incomplete or uses an unexpected destination.');
  }
}

async function verifyProductionMaintenanceLock() {
  if (!isProduction || !apply) return;
  const lock = await db.collection('system').doc('maintenance').get();
  if (!lock.exists || lock.data()?.enabled !== true) {
    throw new Error('Production migration requires the verified backend maintenance lock.');
  }
}

function safeHttpsUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function validatedFanartStoragePath(fanartId: string, artistId: string, value: unknown): string {
  const path = typeof value === 'string' ? value : '';
  if (!path) return '';
  if (!fanartId || fanartId.includes('/') || !artistId || artistId.includes('/')) return '';
  const prefix = `fanart/${artistId}/${fanartId}/`;
  if (!path.startsWith(prefix)) return '';
  const fileName = path.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(fileName) ? path : '';
}

async function commitIfNeeded(force = false) {
  if (!apply || batchSize === 0 || (!force && batchSize < 400)) return;
  if (batchContentRevisions.size) batch.set(db.doc('system/publicContentRevision'), {
    ...Object.fromEntries([...batchContentRevisions].map(field => [field, FieldValue.increment(1)])),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await batch.commit();
  batch = db.batch();
  batchSize = 0;
  batchContentRevisions.clear();
}

async function migrateCollection(collection: 'messages' | 'fanart') {
  const type = collection === 'messages' ? 'message' : 'fanart';
  const snapshot = await db.collection(collection).get();

  for (const document of snapshot.docs) {
    const data = document.data();
    const uid = String(type === 'message' ? data.authorId || '' : data.artistId || '');
    const displayName = String(type === 'message' ? data.author || 'Anonymous' : data.artist || 'Anonymous');
    const avatarUrl = safeHttpsUrl(type === 'message' ? data.authorAvatar : data.artistAvatar);
    const providerId = String(type === 'message' ? data.authorProvider || '' : data.artistProvider || '');
    const profileLink = safeHttpsUrl(type === 'message' ? data.authorLink : data.artistLink);
    const reporters = Array.isArray(data.reportedBy)
      ? [...new Set(data.reportedBy.filter((value): value is string => typeof value === 'string'))]
      : [];

    if (uid) {
      const current = stats.get(uid) || { messageCount: 0, fanartCount: 0 };
      if (type === 'message') current.messageCount += 1;
      else current.fanartCount += 1;
      stats.set(uid, current);
    }

    const update: Record<string, unknown> = {
      submitter: { uid, displayName, avatarUrl, providerId, profileLink },
      hidden: data.hidden === true || data.deleted === true,
      deleted: data.deleted === true,
      reportCount: Math.max(Number(data.reportCount || 0), reporters.length),
      reportedBy: FieldValue.delete(),
      migrationVersion: 1
    };
    if (type === 'fanart') {
      update.imageUrl = `/api/fanart-media?fanartId=${encodeURIComponent(document.id)}`;
      const originalImagePath = typeof data.imagePath === 'string' ? data.imagePath : '';
      const imagePath = validatedFanartStoragePath(document.id, uid, originalImagePath);
      if (originalImagePath && !imagePath) {
        throw new Error(`Refusing unowned fan art Storage path: ${document.ref.path}`);
      }
      if (apply && imagePath && bucket) {
        try {
          const file = bucket.file(imagePath);
          const [metadata] = await file.getMetadata();
          const [imageBytes] = await file.download();
          const safeMetadata = { ...(metadata.metadata || {}) };
          delete safeMetadata.firebaseStorageDownloadTokens;
          await file.save(imageBytes, {
            resumable: false,
            validation: 'crc32c',
            metadata: {
              contentType: metadata.contentType || 'application/octet-stream',
              cacheControl: 'no-store',
              metadata: safeMetadata
            }
          });
          sanitizedStorageObjects += 1;
        } catch (error) {
          if ((error as { code?: number }).code === 404) missingStorageObjects += 1;
          else throw error;
        }
      }
    }
    if (reporters.length > 0) {
      if (reporters.length > 450) {
        throw new Error(`Legacy report set is too large for atomic migration: ${document.ref.path}`);
      }
      const caseId = `${type}_${document.id}`;
      const caseRef = db.collection('reportCases').doc(caseId);
      if (apply) {
        await commitIfNeeded(true);
        const reportRefs = reporters.map((reporterUid) =>
          caseRef.collection('reports').doc(reporterUid)
        );
        await db.runTransaction(async (transaction) => {
          const [latestDocument, latestCase, ...latestReports] = await Promise.all([
            transaction.get(document.ref),
            transaction.get(caseRef),
            ...reportRefs.map((reportRef) => transaction.get(reportRef))
          ]);
          if (!latestDocument.exists) {
            throw new Error(`Content disappeared during migration: ${document.ref.path}`);
          }

          const latestData = latestDocument.data() || {};
          const latestCaseData = latestCase.data() || {};
          const migratedReportCount = Math.max(
            Number(latestData.reportCount || 0),
            Number(latestCaseData.reportCount || 0),
            reporters.length
          );
          transaction.set(document.ref, {
            ...update,
            hidden: latestData.hidden === true || latestData.deleted === true,
            deleted: latestData.deleted === true,
            reportCount: migratedReportCount
          }, { merge: true });
          transaction.set(db.doc('system/publicContentRevision'), {
            [type === 'message' ? 'messagesRevision' : 'fanartRevision']: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          const targetRemoved = latestCaseData.targetRemoved === true;
          const caseUpdate: Record<string, unknown> = {
            caseId,
            targetType: type,
            targetId: document.id,
            targetAuthorUid: uid,
            targetPreview: targetRemoved
              ? ''
              : type === 'message'
                ? String(latestData.content || '').slice(0, 200)
                : String(latestData.caption || '').slice(0, 200),
            targetImageUrl: targetRemoved || type !== 'fanart'
              ? ''
              : `/api/fanart-media?fanartId=${encodeURIComponent(document.id)}`,
            reportCount: migratedReportCount
          };
          if (!latestCase.exists) {
            Object.assign(caseUpdate, {
              status: 'open',
              latestReason: 'legacy_unknown',
              latestAt: null,
              createdAt: null,
              source: 'legacy',
              legacyReasonUnknown: true,
              legacyTimeUnknown: true,
              autoHidden: latestData.hidden === true
            });
          }
          transaction.set(caseRef, caseUpdate, { merge: true });

          latestReports.forEach((reportSnapshot, index) => {
            if (reportSnapshot.exists) return;
            transaction.create(reportRefs[index]!, {
              reporterUid: reporters[index]!,
              reason: 'legacy_unknown',
              details: '',
              source: 'legacy',
              createdAt: null
            });
          });
        });
      }
      legacyReports += reporters.length;
    } else if (apply) {
      batch.set(document.ref, update, { merge: true });
      batchSize += 1;
      batchContentRevisions.add(type === 'message' ? 'messagesRevision' : 'fanartRevision');
      await commitIfNeeded();
    }
    contentUpdates += 1;
  }
}

async function main() {
  await verifyProductionMaintenanceLock();
  await verifyProductionBackup();
  await migrateCollection('messages');
  await migrateCollection('fanart');

  for (const [uid, counts] of stats) {
    if (apply) {
      batch.set(db.collection('userStats').doc(uid), {
        uid,
        messageCount: counts.messageCount,
        fanartCount: counts.fanartCount,
        migrationVersion: 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      batchSize += 1;
    }
    await commitIfNeeded();
  }

  await commitIfNeeded(true);
  console.log(JSON.stringify({
    projectId,
    mode: apply ? 'apply' : 'dry-run',
    contentUpdates,
    legacyReports,
    userStats: stats.size,
    sanitizedStorageObjects,
    missingStorageObjects
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
