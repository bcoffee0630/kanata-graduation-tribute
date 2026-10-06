import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions';
import { db, REGION, TIME_ZONE } from './core.js';
import {
  PUBLIC_MESSAGE_LIMIT, PUBLIC_SNAPSHOT_COALESCE_MS, PUBLIC_GALLERY_BATCH_SIZE,
  type PublicContentRevisions, type PublicSourceDocument, type PublicSnapshotProducerResult, type PublicMessageItem,
  nextPublicSnapshotTask, producePublicSnapshots, publicRevisionsMatch, publicSnapshotWindow,
  parsePublicFeedArtifact, publicSnapshotObject
} from './public-snapshot-core.js';
import { publicSnapshotBucket, readPrivateSnapshotJson, readSnapshotPointer, snapshotArtifactsAvailable, writePublicSnapshotGeneration } from './public-snapshot-storage.js';

export { writePublicSnapshotGeneration } from './public-snapshot-storage.js';
export const PUBLIC_SNAPSHOT_QUEUE = 'publishPublicSnapshots';
const MAX_ATTEMPTS = 3;
const CLAIM_LEASE_MS = 120_000;
interface Claim { attempt: number; windowKey: number }
function revision(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid public content revision.');
  return value;
}
export async function readContentRevisions(): Promise<PublicContentRevisions> {
  const data = (await db.collection('system').doc('publicContentRevision').get()).data() ?? {};
  return { messagesRevision: revision(data.messagesRevision), fanartRevision: revision(data.fanartRevision) };
}
async function claimSnapshotWindow(windowKey: number): Promise<Claim | null> {
  const ref = db.collection('publicSnapshotCycles').doc(String(windowKey));
  return db.runTransaction(async transaction => {
    const stored = (await transaction.get(ref)).data(); const now = Date.now();
    const attempts = revision(stored?.attempts);
    if (stored?.status === 'complete' || attempts >= MAX_ATTEMPTS ||
      stored?.status === 'running' && stored.leaseUntil instanceof Timestamp && stored.leaseUntil.toMillis() > now) return null;
    const attempt = attempts + 1;
    transaction.set(ref, { windowKey, attempts: attempt, status: 'running', claimedAt: Timestamp.fromMillis(now),
      leaseUntil: Timestamp.fromMillis(now + CLAIM_LEASE_MS), expiresAt: Timestamp.fromMillis(now + 2 * 24 * 60 * 60 * 1000) });
    return { attempt, windowKey };
  });
}
async function finishSnapshotWindow(claim: Claim, status: 'complete' | 'failed'): Promise<void> {
  const ref = db.collection('publicSnapshotCycles').doc(String(claim.windowKey));
  await db.runTransaction(async transaction => {
    const stored = (await transaction.get(ref)).data();
    if (stored?.attempts !== claim.attempt || stored?.status !== 'running') return;
    transaction.update(ref, { status, finishedAt: Timestamp.now(), leaseUntil: Timestamp.fromMillis(0) });
  });
}
export async function queryPublicGallerySample(pivot: number, limit: number, wrap: boolean): Promise<PublicSourceDocument[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > PUBLIC_GALLERY_BATCH_SIZE || !Number.isFinite(pivot) || pivot < 0 || pivot >= 1) throw new Error('Invalid bounded gallery query.');
  const snapshot = await db.collection('fanart').where('sourceType', '==', 'x').where('hidden', '==', false).where('deleted', '==', false)
    .where('sampleKey', wrap ? '<' : '>=', pivot).orderBy('sampleKey').limit(limit)
    .select('postId', 'postUrl', 'caption', 'submitter', 'artist', 'createdAt').get();
  return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
}
async function queryLatestGallery(): Promise<PublicSourceDocument[]> {
  const snapshot = await db.collection('fanart').where('sourceType', '==', 'x').where('hidden', '==', false).where('deleted', '==', false)
    .orderBy('createdAt', 'desc').limit(PUBLIC_GALLERY_BATCH_SIZE).select('postId', 'postUrl', 'caption', 'submitter', 'artist', 'createdAt').get();
  return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
}
async function queryPublicMessages(): Promise<PublicSourceDocument[]> {
  const snapshot = await db.collection('messages').where('hidden', '==', false).where('deleted', '==', false)
    .orderBy('createdAt', 'desc').limit(PUBLIC_MESSAGE_LIMIT).select('author', 'content', 'authorLink', 'authorAvatar').get();
  return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
}
export async function enqueuePublicSnapshotTask(now = Date.now()): Promise<boolean> {
  const task = nextPublicSnapshotTask(now);
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST) {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
    if (!project.startsWith('demo-')) throw new Error('Snapshot task emulation requires a demo project.');
    // Firebase's emulator has no persistent Cloud Tasks service. Integration tests invoke the private helper explicitly.
    if (!process.env.CLOUD_TASKS_EMULATOR_HOST) { logger.info('Snapshot task skipped in local emulator.', { taskId: task.id }); return false; }
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.CLOUD_TASKS_EMULATOR_HOST)) throw new Error('Snapshot task emulator must be local.');
  }
  try {
    await getFunctions().taskQueue<{ windowKey: number }>(`locations/${REGION}/functions/${PUBLIC_SNAPSHOT_QUEUE}`).enqueue(
      { windowKey: task.windowKey }, { id: task.id, scheduleTime: new Date(task.scheduledAt), dispatchDeadlineSeconds: 120 });
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 'functions/task-already-exists' || (error as { code?: unknown }).code === 'functions/already-exists') return false;
    throw error;
  }
}
/** Private task/CLI entry point. Each two-second window has at most three persisted source attempts. */
export async function runPublicSnapshotPublisher(scheduledAt = Date.now()): Promise<PublicSnapshotProducerResult> {
  if (!Number.isSafeInteger(scheduledAt) || scheduledAt < 0 || scheduledAt > Date.now() + PUBLIC_SNAPSHOT_COALESCE_MS) throw new Error('Invalid snapshot task time.');
  const bucket = publicSnapshotBucket(); let claim: Claim | null = null;
  try {
    const result = await producePublicSnapshots({
      claimWindow: async windowKey => { claim = await claimSnapshotWindow(windowKey); return claim !== null; },
      readRevisions: readContentRevisions, readPointer: () => readSnapshotPointer(bucket),
      artifactsAvailable: pointer => snapshotArtifactsAvailable(bucket, pointer),
      readMessageArtifact: async pointer => {
        try { return parsePublicFeedArtifact<PublicMessageItem>(await readPrivateSnapshotJson(bucket,
          publicSnapshotObject(pointer.messages.version, 'messages')), pointer.messages, 'messages')?.items ?? null; }
        catch { return null; }
      },
      queryLatestGallery, queryGallery: queryPublicGallerySample, queryMessages: queryPublicMessages,
      publish: generation => writePublicSnapshotGeneration(bucket, generation, {
        canPublish: async () => publicRevisionsMatch(generation.pointer, await readContentRevisions())
      }),
      now: Date.now, random: () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48
    }, publicSnapshotWindow(scheduledAt));
    // Changes during a build and losing CAS attempts get a trailing job even if their original event was already delivered.
    // The claim must remain retryable until Cloud Tasks acknowledges that follow-up.
    if (result === 'dirty' || result === 'superseded') await enqueuePublicSnapshotTask();
    if (claim) await finishSnapshotWindow(claim, 'complete');
    logger.info('Public snapshot update completed.', { windowKey: publicSnapshotWindow(scheduledAt), result });
    return result;
  } catch (error) {
    if (claim) await finishSnapshotWindow(claim, 'failed');
    throw error;
  }
}
export const publishPublicSnapshots = onTaskDispatched<{ windowKey: number }>({
  region: REGION, invoker: 'private', maxInstances: 1, concurrency: 1, timeoutSeconds: 120, memory: '256MiB',
  rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 0.5 },
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 1, maxBackoffSeconds: 10, maxDoublings: 3 }
}, async request => {
  const windowKey = request.data?.windowKey;
  if (!Number.isSafeInteger(windowKey) || windowKey < 0) throw new Error('Invalid snapshot task.');
  await runPublicSnapshotPublisher(windowKey * PUBLIC_SNAPSHOT_COALESCE_MS);
});
export const queuePublicSnapshotUpdate = onDocumentWritten({
  document: 'system/publicContentRevision', region: REGION, maxInstances: 1, concurrency: 1, timeoutSeconds: 30, retry: true
}, async event => {
  if (!event.data?.after.exists) return;
  await enqueuePublicSnapshotTask();
});
// The watchdog renews confirmed leases; the producer rotates gallery groups once per five-minute period.
export const maintainPublicSnapshots = onSchedule({
  schedule: 'every 1 minutes', timeZone: TIME_ZONE, region: REGION, maxInstances: 1, concurrency: 1,
  timeoutSeconds: 30, memory: '256MiB', retryCount: 1
}, async () => { await enqueuePublicSnapshotTask(); });
