export const PUBLIC_SNAPSHOT_PREFIX = 'public-snapshots';
export const PUBLIC_POINTER_OBJECT = `${PUBLIC_SNAPSHOT_PREFIX}/current.json`;
export const PUBLIC_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
export const PUBLIC_SNAPSHOT_COALESCE_MS = 2000;
export const PUBLIC_GALLERY_BATCH_COUNT = 8;
export const PUBLIC_GALLERY_BATCH_SIZE = 6;
export const PUBLIC_GALLERY_LATEST_SIZE = 2;
export const PUBLIC_GALLERY_RANDOM_SIZE = 4;
export const PUBLIC_MESSAGE_LIMIT = 100;
// Refresh immutable objects before the one-day bucket lifecycle can remove an active message version.
export const PUBLIC_MESSAGE_ARTIFACT_RENEW_MS = 12 * 60 * 60 * 1000;

export interface PublicGalleryItem {
  id: string; postId: string; postUrl: string; caption: string; submitter: string; createdAt: string;
}
export interface PublicMessageItem {
  id: string; author: string; content: string; authorLink: string; authorAvatar: string;
}
export interface PublicContentVersion { version: string; generatedAt: number; revision: number }
export interface PublicSnapshotPointer {
  schemaVersion: 2; generation: number; confirmedAt: number; validUntil: number;
  messages: PublicContentVersion;
  gallery: PublicContentVersion & { rotation: number };
}
export interface PublicSnapshotArtifact<T> { version: string; generatedAt: number; items: T[]; latestIds?: string[] }
export interface PublicFeedEnvelope<T> extends PublicSnapshotArtifact<T> { confirmedAt: number; validUntil: number }
export interface PublicSnapshotGeneration {
  pointer: PublicSnapshotPointer; messages: PublicMessageItem[] | null; gallery: PublicGalleryItem[][] | null; latestIds: string[];
}
export interface PublicSourceDocument { id: string; data: Record<string, unknown> }
export interface PublicContentRevisions { messagesRevision: number; fanartRevision: number }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
export function validPublicSnapshotVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value) && Number.isSafeInteger(Number(value));
}
export function publicSnapshotCycle(nowMs: number): number { return Math.floor(nowMs / PUBLIC_SNAPSHOT_TTL_MS); }
export function publicSnapshotWindow(nowMs: number): number { return Math.floor(nowMs / PUBLIC_SNAPSHOT_COALESCE_MS); }
export function nextPublicSnapshotTask(nowMs: number): { windowKey: number; id: string; scheduledAt: number } {
  if (!integer(nowMs)) throw new Error('Invalid task time.');
  const windowKey = publicSnapshotWindow(nowMs) + 1;
  return { windowKey, id: `snapshot-${windowKey}`, scheduledAt: windowKey * PUBLIC_SNAPSHOT_COALESCE_MS };
}
function contentVersion(value: unknown): PublicContentVersion | null {
  const data = record(value);
  return data && validPublicSnapshotVersion(data.version) && integer(data.generatedAt) && integer(data.revision)
    ? { version: data.version, generatedAt: data.generatedAt, revision: data.revision } : null;
}
export function parsePublicSnapshotPointer(value: unknown): PublicSnapshotPointer | null {
  const data = record(value);
  if (!data || data.schemaVersion !== 2 || !integer(data.generation) || !integer(data.confirmedAt) ||
    !integer(data.validUntil) || data.validUntil <= data.confirmedAt || data.validUntil - data.confirmedAt > PUBLIC_SNAPSHOT_TTL_MS) return null;
  const messages = contentVersion(data.messages); const gallery = contentVersion(data.gallery); const galleryData = record(data.gallery);
  if (!messages || !gallery || !galleryData || !integer(galleryData.rotation) || messages.generatedAt > data.confirmedAt ||
    gallery.generatedAt > data.confirmedAt || Number(messages.version) > data.generation || Number(gallery.version) > data.generation) return null;
  return { schemaVersion: 2, generation: data.generation, confirmedAt: data.confirmedAt, validUntil: data.validUntil,
    messages, gallery: { ...gallery, rotation: galleryData.rotation } };
}
export function publicSnapshotObject(version: string, kind: 'messages' | 'gallery', batch = 0): string {
  if (!validPublicSnapshotVersion(version)) throw new Error('Invalid snapshot version.');
  if (kind === 'gallery' && (!Number.isInteger(batch) || batch < 0 || batch >= PUBLIC_GALLERY_BATCH_COUNT)) throw new Error('Invalid gallery batch.');
  return `${PUBLIC_SNAPSHOT_PREFIX}/generations/${version}/${kind === 'messages' ? 'messages' : `gallery-${batch}`}.json`;
}
function text(value: unknown, maxLength: number): string { return typeof value === 'string' ? value.slice(0, maxLength) : ''; }
function safeHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '';
  try { const url = new URL(value); const normalized = url.toString();
    return url.protocol === 'https:' && !url.username && !url.password && normalized.length <= 500 ? normalized : '';
  } catch { return ''; }
}
function documentId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/'); }
function timestampIso(value: unknown): string | null {
  try { const candidate = value as { toDate?: () => Date; seconds?: number } | null;
    const date = value instanceof Date ? value : typeof candidate?.toDate === 'function' ? candidate.toDate()
      : typeof candidate?.seconds === 'number' ? new Date(candidate.seconds * 1000) : typeof value === 'string' ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch { return null; }
}
export function publicGalleryItem(document: PublicSourceDocument): PublicGalleryItem | null {
  const { id, data } = document; const postId = data.postId; const createdAt = timestampIso(data.createdAt);
  if (!documentId(id) || typeof postId !== 'string' || !/^[1-9]\d{0,24}$/.test(postId) || !createdAt) return null;
  const submitter = record(data.submitter);
  return { id, postId, postUrl: `https://x.com/i/web/status/${postId}`, caption: text(data.caption, 300),
    submitter: text(submitter?.displayName ?? data.artist, 100), createdAt };
}
export function publicMessageItem(document: PublicSourceDocument): PublicMessageItem | null {
  const { id, data } = document;
  if (!documentId(id) || typeof data.content !== 'string' || !data.content.trim()) return null;
  return { id, author: text(data.author, 100), content: text(data.content, 500), authorLink: safeHttpsUrl(data.authorLink), authorAvatar: safeHttpsUrl(data.authorAvatar) };
}
export function makePublicFeedEnvelope<T>(pointer: PublicSnapshotPointer, kind: 'messages' | 'gallery', artifact: PublicSnapshotArtifact<T>): PublicFeedEnvelope<T> {
  return { version: pointer[kind].version, generatedAt: pointer[kind].generatedAt, confirmedAt: pointer.confirmedAt,
    validUntil: pointer.validUntil, items: artifact.items, ...(kind === 'gallery' ? { latestIds: artifact.latestIds ?? [] } : {}) };
}
export function parsePublicFeedArtifact<T extends PublicGalleryItem | PublicMessageItem>(value: unknown, expected: PublicContentVersion, kind: 'gallery' | 'messages'): PublicSnapshotArtifact<T> | null {
  const data = record(value);
  if (!data || data.version !== expected.version || data.generatedAt !== expected.generatedAt || !Array.isArray(data.items) ||
    data.items.length > (kind === 'gallery' ? PUBLIC_GALLERY_BATCH_SIZE : PUBLIC_MESSAGE_LIMIT)) return null;
  const items: Array<PublicGalleryItem | PublicMessageItem> = []; const ids = new Set<string>(); const posts = new Set<string>();
  for (const item of data.items) {
    const itemData = record(item);
    if (!itemData || !documentId(itemData.id) || ids.has(itemData.id)) return null;
    ids.add(itemData.id);
    const sanitized = kind === 'gallery' ? publicGalleryItem({ id: itemData.id, data: { ...itemData, artist: itemData.submitter } }) : publicMessageItem({ id: itemData.id, data: itemData });
    if (!sanitized) return null;
    if ('postId' in sanitized) { if (posts.has(sanitized.postId)) return null; posts.add(sanitized.postId); }
    items.push(sanitized);
  }
  if (kind === 'gallery' && (!Array.isArray(data.latestIds) || data.latestIds.length > PUBLIC_GALLERY_LATEST_SIZE ||
    data.latestIds.some((id, index) => typeof id !== 'string' || !posts.has(id) || (items[index] as PublicGalleryItem | undefined)?.postId !== id) ||
    new Set(data.latestIds).size !== data.latestIds.length)) return null;
  return { version: expected.version, generatedAt: expected.generatedAt, items: items as T[], ...(kind === 'gallery' ? { latestIds: data.latestIds as string[] } : {}) };
}
export function parsePublicFeedEnvelope<T extends PublicGalleryItem | PublicMessageItem>(value: unknown, pointer: PublicSnapshotPointer, kind: 'gallery' | 'messages'): PublicFeedEnvelope<T> | null {
  const artifact = parsePublicFeedArtifact<T>(value, pointer[kind], kind);
  return artifact ? makePublicFeedEnvelope(pointer, kind, artifact) : null;
}
export interface PublicSnapshotProducerDependencies {
  claimWindow(windowKey: number): Promise<boolean>;
  readRevisions(): Promise<PublicContentRevisions>;
  readPointer(): Promise<PublicSnapshotPointer | null>;
  artifactsAvailable(pointer: PublicSnapshotPointer): Promise<{ messages: boolean; gallery: boolean }>;
  readMessageArtifact(pointer: PublicSnapshotPointer): Promise<PublicMessageItem[] | null>;
  queryLatestGallery(): Promise<PublicSourceDocument[]>;
  queryGallery(pivot: number, limit: number, wrap: boolean): Promise<PublicSourceDocument[]>;
  queryMessages(): Promise<PublicSourceDocument[]>;
  publish(generation: PublicSnapshotGeneration): Promise<boolean>;
  now(): number; random(): number;
}
export type PublicSnapshotProducerResult = 'published' | 'duplicate' | 'superseded' | 'dirty';
export function publicRevisionsMatch(pointer: PublicSnapshotPointer, revisions: PublicContentRevisions): boolean {
  return pointer.messages.revision === revisions.messagesRevision && pointer.gallery.revision === revisions.fanartRevision;
}
/** Six indexed candidates are sufficient to exclude the two shared latest posts without a second range field. */
export async function samplePublicGallery(query: PublicSnapshotProducerDependencies['queryGallery'], pivot: number, latest: PublicGalleryItem[] = []): Promise<PublicGalleryItem[]> {
  if (!Number.isFinite(pivot) || pivot < 0 || pivot >= 1 || latest.length > PUBLIC_GALLERY_LATEST_SIZE) throw new Error('Invalid gallery sample.');
  const initial = await query(pivot, PUBLIC_GALLERY_BATCH_SIZE, false);
  if (initial.length > PUBLIC_GALLERY_BATCH_SIZE) throw new Error('Gallery query exceeded its limit.');
  const documents = [...initial];
  if (initial.length < PUBLIC_GALLERY_BATCH_SIZE) {
    const remaining = PUBLIC_GALLERY_BATCH_SIZE - initial.length; const wrapped = await query(pivot, remaining, true);
    if (wrapped.length > remaining) throw new Error('Gallery wrap query exceeded its limit.'); documents.push(...wrapped);
  }
  const ids = new Set(latest.map(item => item.id)); const posts = new Set(latest.map(item => item.postId)); const random: PublicGalleryItem[] = [];
  for (const document of documents) { const item = publicGalleryItem(document);
    if (!item || ids.has(item.id) || posts.has(item.postId)) continue;
    ids.add(item.id); posts.add(item.postId); random.push(item); if (random.length === PUBLIC_GALLERY_RANDOM_SIZE) break;
  }
  return [...latest, ...random];
}
export async function producePublicSnapshots(dependencies: PublicSnapshotProducerDependencies, windowKey: number): Promise<PublicSnapshotProducerResult> {
  if (!integer(windowKey)) throw new Error('Invalid snapshot window.');
  if (!await dependencies.claimWindow(windowKey)) return 'duplicate';
  const [revisions, previous] = await Promise.all([dependencies.readRevisions(), dependencies.readPointer()]);
  if (!integer(revisions.messagesRevision) || !integer(revisions.fanartRevision)) throw new Error('Invalid content revision.');
  if (previous && (previous.messages.revision > revisions.messagesRevision || previous.gallery.revision > revisions.fanartRevision)) {
    // A missing/restored revision document must not create an endless chain of two-second trailing tasks.
    throw new Error('Public content revisions regressed below the published snapshot.');
  }
  const available = previous ? await dependencies.artifactsAvailable(previous) : { messages: false, gallery: false };
  const rotation = publicSnapshotCycle(dependencies.now());
  let queryMessages = !previous || !available.messages || previous.messages.revision !== revisions.messagesRevision;
  const renewMessageArtifact = previous !== null && dependencies.now() - Number(previous.messages.version) >= PUBLIC_MESSAGE_ARTIFACT_RENEW_MS;
  const updateMessages = queryMessages || renewMessageArtifact;
  const updateGallery = !previous || !available.gallery || previous.gallery.revision !== revisions.fanartRevision || previous.gallery.rotation !== rotation;
  let messages: PublicMessageItem[] | null = null; let gallery: PublicGalleryItem[][] | null = null; const latest: PublicGalleryItem[] = [];
  if (renewMessageArtifact && !queryMessages) {
    messages = await dependencies.readMessageArtifact(previous!);
    if (messages === null) queryMessages = true;
  }
  if (queryMessages) { const documents = await dependencies.queryMessages();
    if (documents.length > PUBLIC_MESSAGE_LIMIT) throw new Error('Message query exceeded its limit.'); const ids = new Set<string>();
    messages = documents.flatMap(document => { const item = publicMessageItem(document); if (!item || ids.has(item.id)) return []; ids.add(item.id); return [item]; });
  }
  if (updateGallery) { const documents = await dependencies.queryLatestGallery();
    if (documents.length > PUBLIC_GALLERY_BATCH_SIZE) throw new Error('Latest gallery query exceeded its limit.');
    for (const document of documents) {
      const item = publicGalleryItem(document);
      if (item && !latest.some(existing => existing.id === item.id || existing.postId === item.postId)) latest.push(item);
      if (latest.length === PUBLIC_GALLERY_LATEST_SIZE) break;
    }
    gallery = [];
    for (let batch = 0; batch < PUBLIC_GALLERY_BATCH_COUNT; batch++) gallery.push(await samplePublicGallery(dependencies.queryGallery, dependencies.random(), latest));
  }
  // A mutation during the build must get a trailing task, never a fresh lease for stale moderation data.
  const confirmed = await dependencies.readRevisions();
  if (confirmed.messagesRevision !== revisions.messagesRevision || confirmed.fanartRevision !== revisions.fanartRevision) return 'dirty';
  const confirmedAt = dependencies.now(); const generation = Math.max(confirmedAt, (previous?.generation ?? 0) + 1); const version = String(generation);
  const pointer: PublicSnapshotPointer = { schemaVersion: 2, generation, confirmedAt, validUntil: confirmedAt + PUBLIC_SNAPSHOT_TTL_MS,
    messages: updateMessages ? { version, generatedAt: queryMessages ? confirmedAt : previous!.messages.generatedAt,
      revision: revisions.messagesRevision } : previous!.messages,
    gallery: updateGallery ? { version, generatedAt: confirmedAt, revision: revisions.fanartRevision, rotation } : previous!.gallery };
  return await dependencies.publish({ pointer, messages, gallery, latestIds: latest.map(item => item.postId) }) ? 'published' : 'superseded';
}
