import { describe, expect, it, vi } from 'vitest';
import { createPublicFeedService, createPublicFeedRateLimiter } from './public-feed.js';
import { PUBLIC_POINTER_OBJECT, PUBLIC_SNAPSHOT_TTL_MS, type PublicSnapshotPointer, publicSnapshotObject, publicSnapshotCycle } from './public-snapshot-core.js';
const start = 1800000000000;
function pointer(at = start): PublicSnapshotPointer {
  return { schemaVersion: 2, generation: at, confirmedAt: at, validUntil: at + PUBLIC_SNAPSHOT_TTL_MS,
    messages: { version: String(start), generatedAt: start, revision: 1 },
    gallery: { version: String(start), generatedAt: start, revision: 1, rotation: publicSnapshotCycle(at) } };
}
function fixture(now: () => number = () => start + 2000) {
  const current = pointer();
  const objects = new Map<string, unknown>([[PUBLIC_POINTER_OBJECT, current],
    [publicSnapshotObject(current.messages.version, 'messages'), { ...current.messages, items: [{ id: 'message', author: 'B', content: 'Thanks!', authorLink: '', authorAvatar: '' }] }],
    [publicSnapshotObject(current.gallery.version, 'gallery', 0), { ...current.gallery, latestIds: ['1993918268065239540'], items: [{
      id: 'art', postId: '1993918268065239540', postUrl: 'https://x.com/i/web/status/1993918268065239540', submitter: 'A', caption: 'Art', createdAt: new Date(start).toISOString()
    }] }]]);
  const read = vi.fn(async (path: string) => { if (!objects.has(path)) throw new Error('Missing'); await Promise.resolve(); return objects.get(path); });
  return { objects, read, service: createPublicFeedService(read, now) };
}
describe('bounded storage-only public delivery', () => {
  it('reports each validated pointer revision in version descriptors and content envelopes', async () => {
    const { service, objects, read } = fixture(); const current = pointer();
    current.gallery.revision = 0; current.messages.revision = 3; objects.set(PUBLIC_POINTER_OBJECT, current);
    expect(await service.version()).toMatchObject({ status: 200, body: {
      gallery: { version: String(start), revision: 0 }, messages: { version: String(start), revision: 3 }
    } });
    expect(await service.read('gallery', 0, String(start))).toMatchObject({ status: 200, body: { revision: 0 } });
    expect(await service.read('messages', 0, String(start))).toMatchObject({ status: 200, body: { revision: 3 } });
    expect(read.mock.calls.map(([path]) => path)).toEqual([PUBLIC_POINTER_OBJECT,
      publicSnapshotObject(String(start), 'gallery', 0), publicSnapshotObject(String(start), 'messages')]);
  });
  it('keeps source revisions unchanged when empty gallery samples rotate to a new version', async () => {
    let time = start + 2000; const { service, objects, read } = fixture(() => time);
    const current = pointer(); current.gallery.revision = 0; objects.set(PUBLIC_POINTER_OBJECT, current);
    objects.set(publicSnapshotObject(String(start), 'gallery', 0), { version: String(start), generatedAt: start, latestIds: [], items: [] });
    expect(await service.read('gallery', 0)).toMatchObject({ status: 200, body: { version: String(start), revision: 0, items: [] } });
    time = start + PUBLIC_SNAPSHOT_TTL_MS; const rotated = pointer(time);
    rotated.gallery = { version: String(time), generatedAt: time, revision: 0, rotation: publicSnapshotCycle(time) };
    objects.set(PUBLIC_POINTER_OBJECT, rotated);
    objects.set(publicSnapshotObject(String(time), 'gallery', 0), { version: String(time), generatedAt: time, latestIds: [], items: [] });
    expect(await service.version()).toMatchObject({ status: 200, body: { gallery: { version: String(time), revision: 0 } } });
    expect(await service.read('gallery', 0, String(time))).toMatchObject({ status: 200, body: { version: String(time), revision: 0, items: [] } });
    expect(read.mock.calls.map(([path]) => path)).toEqual([PUBLIC_POINTER_OBJECT,
      publicSnapshotObject(String(start), 'gallery', 0), PUBLIC_POINTER_OBJECT, publicSnapshotObject(String(time), 'gallery', 0)]);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', undefined])('fails closed for invalid pointer revision %s before reading artifacts', async invalidRevision => {
    for (const kind of ['gallery', 'messages'] as const) {
      const { service, objects, read } = fixture(); const current = pointer();
      objects.set(PUBLIC_POINTER_OBJECT, { ...current, [kind]: { ...current[kind], revision: invalidRevision } });
      expect(await service.version()).toMatchObject({ status: 503, body: { reason: 'snapshot_unavailable' } });
      expect(await service.read(kind)).toMatchObject({ status: 503, body: { reason: 'snapshot_unavailable' } });
      expect(read.mock.calls.map(([path]) => path)).toEqual([PUBLIC_POINTER_OBJECT]);
    }
  });
  it('coalesces simultaneous version checks and cards into fixed origin object reads', async () => {
    const { service, read } = fixture();
    const versions = await Promise.all(Array.from({ length: 100 }, () => service.version())); expect(versions.every(result => result.status === 200)).toBe(true);
    expect(read.mock.calls.map(([path]) => path)).toEqual([PUBLIC_POINTER_OBJECT]);
    await Promise.all(Array.from({ length: 100 }, () => service.read('gallery', 0)));
    expect(read.mock.calls.map(([path]) => path)).toEqual([PUBLIC_POINTER_OBJECT, publicSnapshotObject(String(start), 'gallery', 0)]);
  });
  it('rejects malformed versions/batches before storage and unknown numeric versions before artifact reads', async () => {
    const { service, read } = fixture();
    for (const batch of [-1, 8, 0.5, NaN]) expect((await service.read('gallery', batch)).status).toBe(400);
    expect((await service.read('messages', 0, '../private')).status).toBe(400); expect(read).not.toHaveBeenCalled();
    expect(await service.read('messages', 0, '123')).toMatchObject({ status: 409, body: { reason: 'version_unavailable' } });
    expect(read.mock.calls.map(([path]) => path)).toEqual([PUBLIC_POINTER_OBJECT]);
  });
  it('renews the current content lease without downloading immutable content again', async () => {
    let time = start + 2000; const { service, objects, read } = fixture(() => time);
    expect(await service.read('messages')).toMatchObject({ status: 200, body: { generatedAt: start, revision: 1, confirmedAt: start } });
    time = start + 600000; const renewed = pointer(time); objects.set(PUBLIC_POINTER_OBJECT, renewed);
    expect(await service.read('messages', 0, String(start))).toMatchObject({ status: 200, body: { version: String(start), generatedAt: start, revision: 1, confirmedAt: time, validUntil: time + PUBLIC_SNAPSHOT_TTL_MS } });
    expect(read.mock.calls.filter(([path]) => path.includes('/generations/'))).toHaveLength(1);
  });
  it('uses one-second CDN/origin caches and refuses the exact lease boundary', async () => {
    let time = start + 2000; const { service, read } = fixture(() => time);
    expect(await service.read('gallery', 0)).toMatchObject({ status: 200, cacheControl: 'public, max-age=0, s-maxage=1, must-revalidate' });
    time += 999; await service.version(); expect(read).toHaveBeenCalledTimes(2);
    time++; await service.version(); expect(read).toHaveBeenCalledTimes(3);
    time = start + PUBLIC_SNAPSHOT_TTL_MS; expect((await service.read('messages')).status).toBe(503);
  });
  it('does not serve an artifact when its download crosses expiry', async () => {
    let time = start + PUBLIC_SNAPSHOT_TTL_MS - 2000; const { objects } = fixture();
    const service = createPublicFeedService(async path => { if (path.includes('/generations/')) time = start + PUBLIC_SNAPSHOT_TTL_MS; return objects.get(path); }, () => time);
    expect(await service.read('messages')).toMatchObject({ status: 503, body: { reason: 'snapshot_expired' } });
  });
  it('fails closed and briefly caches a missing pointer without visitor regeneration', async () => {
    const { service, objects, read } = fixture(); objects.delete(PUBLIC_POINTER_OBJECT);
    await Promise.all(Array.from({ length: 100 }, () => service.version())); expect(read).toHaveBeenCalledTimes(1);
    expect(await service.read('messages')).toMatchObject({ status: 503, body: { reason: 'snapshot_unavailable' } });
  });
  it('rejects regressions after observing a newer pointer and recovers on a newer generation', async () => {
    let time = start + 2000; const { service, objects } = fixture(() => time);
    objects.set(PUBLIC_POINTER_OBJECT, pointer(time)); expect((await service.version()).status).toBe(200);
    time += 1001; objects.set(PUBLIC_POINTER_OBJECT, pointer()); expect((await service.version()).status).toBe(503);
    time += 1001; objects.set(PUBLIC_POINTER_OBJECT, pointer(time)); expect((await service.version()).status).toBe(200);
  });
  it('drops an obsolete in-flight artifact even when it completes after pointer eviction', async () => {
    let time = start + 2000; const { objects } = fixture();
    let release!: (value: unknown) => void; let downloading!: () => void;
    const started = new Promise<void>(resolve => { downloading = resolve; });
    const oldPath = publicSnapshotObject(String(start), 'messages');
    const service = createPublicFeedService(async path => {
      if (path === oldPath) { downloading(); return new Promise(resolve => { release = resolve; }); }
      return objects.get(path);
    }, () => time);
    const pending = service.read('messages'); await started;
    time += 2000;
    const newer = pointer(time); newer.messages = { version: String(time), generatedAt: time, revision: 2 };
    objects.set(PUBLIC_POINTER_OBJECT, newer);
    expect((await service.version()).status).toBe(200);
    release(objects.get(oldPath));
    expect(await pending).toMatchObject({ status: 409, body: { reason: 'version_unavailable' } });
    expect(service.cachedObjectCount()).toBe(1);
  });
  it('strips malformed/private artifact data and never rebuilds content', async () => {
    const { service, objects, read } = fixture(); objects.set(publicSnapshotObject(String(start), 'messages'), { version: '123', generatedAt: start, items: [] });
    expect((await service.read('messages')).status).toBe(503); expect(read).toHaveBeenCalledTimes(2);
  });
  it('limits an instance to a burst of 200 and refills at 100 requests/second', () => {
    let now = 1000; const allow = createPublicFeedRateLimiter(() => now);
    expect(Array.from({ length: 200 }, allow).every(Boolean)).toBe(true); expect(allow()).toBe(false);
    now += 500; expect(Array.from({ length: 50 }, allow).every(Boolean)).toBe(true); expect(allow()).toBe(false);
    now -= 100; expect(allow()).toBe(false); now += 10000; expect(Array.from({ length: 200 }, allow).every(Boolean)).toBe(true); expect(allow()).toBe(false);
  });
});
