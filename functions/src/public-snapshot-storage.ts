import { initializeApp, getApps } from 'firebase-admin/app';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { defineString } from 'firebase-functions/params';
import {
  PUBLIC_POINTER_OBJECT, PUBLIC_GALLERY_BATCH_COUNT, type PublicSnapshotGeneration, type PublicSnapshotPointer,
  parsePublicFeedArtifact, parsePublicSnapshotPointer, publicSnapshotObject
} from './public-snapshot-core.js';

export type PublicSnapshotBucket = ReturnType<Storage['bucket']>;
export const PUBLIC_SNAPSHOT_BUCKET = defineString('PUBLIC_SNAPSHOT_BUCKET');
export function publicSnapshotBucket(): PublicSnapshotBucket {
  const name = PUBLIC_SNAPSHOT_BUCKET.value();
  if (!/^[a-z0-9][a-z0-9._-]{2,221}$/.test(name)) throw new Error('A dedicated private snapshot bucket is required.');
  if (getApps().length === 0) initializeApp();
  return getStorage().bucket(name);
}
export async function publicSnapshotPrivateAcl(bucket: PublicSnapshotBucket): Promise<boolean> {
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (emulatorHost) {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost) || !project.startsWith('demo-') ||
      bucket.storage.apiEndpoint !== `http://${emulatorHost}` ||
      [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].some(project => project && !project.startsWith('demo-'))) {
      throw new Error('Snapshot emulator access requires a local demo project.');
    }
    return true;
  }
  const [metadata] = await bucket.getMetadata();
  if (metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
    metadata.iamConfiguration?.publicAccessPrevention !== 'enforced') {
    throw new Error('Snapshot publication requires uniform access and enforced public access prevention.');
  }
  return false;
}
const MAX_JSON_BYTES = 512 * 1024;
export function storageErrorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : typeof code === 'string' ? Number(code) : null;
}
export async function readPrivateSnapshotJson(bucket: PublicSnapshotBucket, path: string): Promise<unknown> {
  const [bytes] = await bucket.file(path).download();
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('Snapshot object exceeds its size limit.');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
export async function readSnapshotPointer(bucket: PublicSnapshotBucket): Promise<PublicSnapshotPointer | null> {
  try { return parsePublicSnapshotPointer(await readPrivateSnapshotJson(bucket, PUBLIC_POINTER_OBJECT)); }
  catch { return null; }
}
export async function snapshotArtifactsAvailable(bucket: PublicSnapshotBucket, pointer: PublicSnapshotPointer): Promise<{ messages: boolean; gallery: boolean }> {
  async function exists(path: string): Promise<boolean> {
    try { await bucket.file(path).getMetadata(); return true; } catch (error) {
      if (storageErrorCode(error) === 404) return false;
      throw error;
    }
  }
  const [messages, ...gallery] = await Promise.all([
    exists(publicSnapshotObject(pointer.messages.version, 'messages')),
    ...Array.from({ length: PUBLIC_GALLERY_BATCH_COUNT }, (_, batch) => exists(publicSnapshotObject(pointer.gallery.version, 'gallery', batch)))
  ]);
  return { messages: messages === true, gallery: gallery.every(Boolean) };
}
async function savePrivateJson(bucket: PublicSnapshotBucket, path: string, data: unknown, generation: string | number, privateAcl: boolean): Promise<void> {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX_JSON_BYTES) throw new Error('Snapshot object exceeds its size limit.');
  await bucket.file(path).save(json, {
    resumable: false, validation: 'crc32c', ...(privateAcl ? { predefinedAcl: 'private' } : {}),
    metadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' },
    preconditionOpts: { ifGenerationMatch: generation }
  });
}
async function readPointerForCas(bucket: PublicSnapshotBucket): Promise<{ generation: string | number; pointer: PublicSnapshotPointer | null }> {
  try {
    const [metadata] = await bucket.file(PUBLIC_POINTER_OBJECT).getMetadata();
    const generation = metadata.generation;
    if (generation === undefined) throw new Error('Snapshot pointer has no object generation.');
    const [bytes] = await bucket.file(PUBLIC_POINTER_OBJECT, { generation }).download();
    if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('Snapshot pointer exceeds its size limit.');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    const pointer = parsePublicSnapshotPointer(value);
    // Only the explicitly known previous format may be replaced during the private bootstrap migration.
    if (!pointer && (value as { schemaVersion?: unknown } | null)?.schemaVersion !== 1) throw new Error('Invalid existing snapshot pointer.');
    return { generation, pointer };
  } catch (error) {
    if (storageErrorCode(error) === 404) return { generation: 0, pointer: null };
    throw error;
  }
}
export interface WritePublicSnapshotOptions { now?: () => number; canPublish?: () => Promise<boolean> }
function superseded(current: PublicSnapshotPointer | null, next: PublicSnapshotPointer): boolean {
  return current !== null && (current.generation >= next.generation || current.confirmedAt > next.confirmedAt ||
    current.messages.revision > next.messages.revision || current.gallery.revision > next.gallery.revision || current.gallery.rotation > next.gallery.rotation);
}
function reusedVersionsMatch(current: PublicSnapshotPointer | null, next: PublicSnapshotGeneration): boolean {
  return (next.messages !== null || current?.messages.version === next.pointer.messages.version) &&
    (next.gallery !== null || current?.gallery.version === next.pointer.gallery.version);
}
/** Immutable content is written first; the lease pointer is advanced with a generation-pinned CAS. */
export async function writePublicSnapshotGeneration(bucket: PublicSnapshotBucket, generation: PublicSnapshotGeneration, options: WritePublicSnapshotOptions = {}): Promise<boolean> {
  const { pointer, messages, gallery, latestIds } = generation;
  if (!parsePublicSnapshotPointer(pointer) || (gallery !== null && (gallery.length !== PUBLIC_GALLERY_BATCH_COUNT ||
    gallery.some(items => !parsePublicFeedArtifact({ ...pointer.gallery, items, latestIds }, pointer.gallery, 'gallery')))) ||
    (messages !== null && !parsePublicFeedArtifact({ ...pointer.messages, items: messages }, pointer.messages, 'messages'))) throw new Error('Invalid snapshot generation.');
  const now = options.now ?? Date.now; const canPublish = options.canPublish ?? (async () => true);
  if (now() >= pointer.validUntil || !await canPublish()) return false;
  const privateAcl = await publicSnapshotPrivateAcl(bucket);
  const initial = await readPointerForCas(bucket);
  if (superseded(initial.pointer, pointer) || !reusedVersionsMatch(initial.pointer, generation)) return false;
  if (gallery !== null) {
    for (let batch = 0; batch < PUBLIC_GALLERY_BATCH_COUNT; batch++) {
      await savePrivateJson(bucket, publicSnapshotObject(pointer.gallery.version, 'gallery', batch),
        { version: pointer.gallery.version, generatedAt: pointer.gallery.generatedAt, latestIds, items: gallery[batch]! }, 0, privateAcl);
    }
  }
  if (messages !== null) {
    await savePrivateJson(bucket, publicSnapshotObject(pointer.messages.version, 'messages'),
      { version: pointer.messages.version, generatedAt: pointer.messages.generatedAt, items: messages }, 0, privateAcl);
  }
  let current = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (now() >= pointer.validUntil || !await canPublish() || superseded(current.pointer, pointer) ||
      !reusedVersionsMatch(current.pointer, generation)) return false;
    try { await savePrivateJson(bucket, PUBLIC_POINTER_OBJECT, pointer, current.generation, privateAcl); return true; }
    catch (error) { if (storageErrorCode(error) !== 412) throw error; current = await readPointerForCas(bucket); }
  }
  return false;
}
