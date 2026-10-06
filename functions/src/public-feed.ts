import { defineString } from 'firebase-functions/params';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import {
  PUBLIC_POINTER_OBJECT, PUBLIC_GALLERY_BATCH_COUNT, PUBLIC_SNAPSHOT_TTL_MS,
  type PublicGalleryItem, type PublicMessageItem, type PublicFeedEnvelope, type PublicSnapshotPointer,
  makePublicFeedEnvelope, parsePublicFeedArtifact, parsePublicSnapshotPointer, publicSnapshotObject, validPublicSnapshotVersion
} from './public-snapshot-core.js';
import { publicSnapshotBucket, readPrivateSnapshotJson } from './public-snapshot-storage.js';

export const PUBLIC_FEED_SERVICE_ACCOUNT = defineString('PUBLIC_FEED_SERVICE_ACCOUNT');
export const PUBLIC_FEED_CACHE_MS = 1000;
export type PublicVersionEnvelope = {
  messages: { version: string; generatedAt: number; confirmedAt: number; validUntil: number };
  gallery: { version: string; generatedAt: number; confirmedAt: number; validUntil: number };
};
export type PublicFeedResult = {
  status: 200; cacheControl: string; body: PublicFeedEnvelope<PublicGalleryItem | PublicMessageItem> | PublicVersionEnvelope;
} | {
  status: 400 | 409 | 429 | 503; cacheControl: 'no-store'; body: { reason: string; items: [] };
};
export interface PublicFeedService {
  read(kind: 'gallery' | 'messages', batch?: number, version?: string): Promise<PublicFeedResult>;
  version(): Promise<PublicFeedResult>;
  cachedObjectCount(): number;
}
export function createPublicFeedRateLimiter(now: () => number = Date.now, rate = 100, burst = 200): () => boolean {
  let tokens = burst; let updatedAt = now();
  return () => {
    const time = now(); tokens = Math.min(burst, tokens + Math.max(0, time - updatedAt) * rate / 1000); updatedAt = Math.max(updatedAt, time);
    if (tokens < 1) return false; tokens -= 1; return true;
  };
}
function failure(status: 400 | 409 | 429 | 503, reason: string): PublicFeedResult {
  return { status, cacheControl: 'no-store', body: { reason, items: [] } };
}
/** Only fixed pointer and current-generation keys enter this cache, including for URL cache-busting requests. */
export function createPublicFeedService(readObject: (path: string) => Promise<unknown>, now: () => number = Date.now): PublicFeedService {
  const cache = new Map<string, { value: unknown; expiresAt: number }>();
  const inflight = new Map<string, Promise<unknown>>(); let highestPointer: PublicSnapshotPointer | null = null;
  async function cachedRead<T>(key: string, ttl: number, parse: (value: unknown) => T | null): Promise<T | null> {
    const cached = cache.get(key); if (cached && cached.expiresAt > now()) return cached.value as T | null;
    const pending = inflight.get(key); if (pending) return pending as Promise<T | null>;
    const promise = (async () => {
      let value: T | null = null;
      try { value = parse(await readObject(key)); } catch { /* Fail closed without querying source data. */ }
      cache.set(key, { value, expiresAt: value ? (ttl === Infinity ? Infinity : now() + ttl) : now() + PUBLIC_FEED_CACHE_MS });
      return value;
    })();
    inflight.set(key, promise); try { return await promise; } finally { inflight.delete(key); }
  }
  async function pointer(): Promise<PublicSnapshotPointer | null> {
    const value = await cachedRead(PUBLIC_POINTER_OBJECT, PUBLIC_FEED_CACHE_MS, parsePublicSnapshotPointer);
    if (!value || value.confirmedAt > now() + 1000 || value.validUntil > now() + PUBLIC_SNAPSHOT_TTL_MS + 1000 || now() >= value.validUntil) return null;
    if (highestPointer && value.generation < highestPointer.generation) return null;
    if (!highestPointer || value.generation > highestPointer.generation) {
      highestPointer = value;
      const currentKeys = new Set([PUBLIC_POINTER_OBJECT, publicSnapshotObject(value.messages.version, 'messages'),
        ...Array.from({ length: PUBLIC_GALLERY_BATCH_COUNT }, (_, batch) => publicSnapshotObject(value.gallery.version, 'gallery', batch))]);
      for (const key of cache.keys()) if (!currentKeys.has(key)) cache.delete(key);
    }
    return value;
  }
  function cacheControl(value: PublicSnapshotPointer): string | null {
    const remaining = Math.floor((value.validUntil - now()) / 1000);
    return remaining > 0 ? `public, max-age=0, s-maxage=${Math.min(1, remaining)}, must-revalidate` : null;
  }
  return {
    cachedObjectCount: () => cache.size,
    async version() {
      const current = await pointer(); if (!current) return failure(503, 'snapshot_unavailable');
      const control = cacheControl(current); if (!control) return failure(503, 'snapshot_expired');
      const meta = (kind: 'messages' | 'gallery') => ({ version: current[kind].version, generatedAt: current[kind].generatedAt,
        confirmedAt: current.confirmedAt, validUntil: current.validUntil });
      return { status: 200, cacheControl: control, body: { messages: meta('messages'), gallery: meta('gallery') } };
    },
    async read(kind, batch = 0, version) {
      if (kind === 'gallery' && (!Number.isInteger(batch) || batch < 0 || batch >= PUBLIC_GALLERY_BATCH_COUNT)) return failure(400, 'invalid_batch');
      if (version !== undefined && !validPublicSnapshotVersion(version)) return failure(400, 'invalid_version');
      const current = await pointer(); if (!current) return failure(503, 'snapshot_unavailable');
      if (version !== undefined && version !== current[kind].version) return failure(409, 'version_unavailable');
      const path = publicSnapshotObject(current[kind].version, kind, batch);
      const artifact = await cachedRead(path, Infinity, value => parsePublicFeedArtifact<PublicGalleryItem | PublicMessageItem>(value, current[kind], kind));
      // An in-flight old artifact may finish after another request has observed a newer publication.
      if (highestPointer && highestPointer[kind].version !== current[kind].version) {
        cache.delete(path);
        return failure(409, 'version_unavailable');
      }
      if (!artifact) return failure(503, 'snapshot_unavailable');
      const confirmed = highestPointer ?? current; const control = cacheControl(confirmed);
      if (!control) return failure(503, 'snapshot_expired');
      return { status: 200, cacheControl: control, body: makePublicFeedEnvelope(confirmed, kind, artifact) };
    }
  };
}
let defaultService: PublicFeedService | null = null;
function service(): PublicFeedService {
  if (!defaultService) defaultService = createPublicFeedService(path => readPrivateSnapshotJson(publicSnapshotBucket(), path));
  return defaultService;
}
const allowRequest = createPublicFeedRateLimiter();
const OPTIONS = { region: 'asia-east1', cors: false, invoker: 'public' as const,
  serviceAccount: PUBLIC_FEED_SERVICE_ACCOUNT, minInstances: 0, maxInstances: 1, concurrency: 80, timeoutSeconds: 15, memory: '256MiB' as const };
function requestedVersion(request: Request): string | undefined | null {
  if (Object.keys(request.query).some(key => key !== 'version')) return null;
  const version = request.query.version;
  return version === undefined || typeof version === 'string' && validPublicSnapshotVersion(version) ? version : null;
}
function respond(response: Response, result: PublicFeedResult): void {
  if (result.status === 429 || result.status === 503) response.set('Retry-After', '1');
  response.set('Cache-Control', result.cacheControl).status(result.status).json(result.body);
}
export const publicGalleryFeed = onRequest(OPTIONS, async (request, response) => {
  response.set('X-Content-Type-Options', 'nosniff');
  if (!allowRequest()) { respond(response, failure(429, 'rate_limited')); return; }
  if (request.method !== 'GET') { response.set('Allow', 'GET').set('Cache-Control', 'no-store').status(405).json({ reason: 'method_not_allowed', items: [] }); return; }
  const batch = /^\/api\/gallery\/batches\/([0-7])\/?$/.exec(request.path)?.[1]; const version = requestedVersion(request);
  if (batch === undefined) { response.set('Cache-Control', 'no-store').status(404).json({ reason: 'invalid_batch', items: [] }); return; }
  respond(response, version === null ? failure(400, 'invalid_version') : await service().read('gallery', Number(batch), version));
});
export const publicMessagesFeed = onRequest(OPTIONS, async (request, response) => {
  response.set('X-Content-Type-Options', 'nosniff');
  if (!allowRequest()) { respond(response, failure(429, 'rate_limited')); return; }
  if (request.method !== 'GET') { response.set('Allow', 'GET').set('Cache-Control', 'no-store').status(405).json({ reason: 'method_not_allowed', items: [] }); return; }
  if (!/^\/api\/messages\/?$/.test(request.path)) { response.set('Cache-Control', 'no-store').status(404).json({ reason: 'invalid_path', items: [] }); return; }
  const version = requestedVersion(request);
  respond(response, version === null ? failure(400, 'invalid_version') : await service().read('messages', 0, version));
});
export const publicFeedVersion = onRequest(OPTIONS, async (request, response) => {
  response.set('X-Content-Type-Options', 'nosniff');
  if (!allowRequest()) { respond(response, failure(429, 'rate_limited')); return; }
  if (request.method !== 'GET') { response.set('Allow', 'GET').set('Cache-Control', 'no-store').status(405).json({ reason: 'method_not_allowed', items: [] }); return; }
  if (!/^\/api\/feed\/version\/?$/.test(request.path) || Object.keys(request.query).length) {
    response.set('Cache-Control', 'no-store').status(404).json({ reason: 'invalid_path', items: [] }); return;
  }
  respond(response, await service().version());
});
