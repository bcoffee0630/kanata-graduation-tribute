import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_POINTER_OBJECT, PUBLIC_SNAPSHOT_TTL_MS, type PublicSnapshotGeneration, type PublicSnapshotPointer, publicSnapshotObject, publicSnapshotCycle } from './public-snapshot-core.js';
import { type PublicSnapshotBucket, publicSnapshotPrivateAcl, writePublicSnapshotGeneration, snapshotArtifactsAvailable } from './public-snapshot-storage.js';
const now = 1800000001000;
const pointer = (at = now): PublicSnapshotPointer => ({ schemaVersion: 2, generation: at, confirmedAt: at, validUntil: at + PUBLIC_SNAPSHOT_TTL_MS,
  messages: { version: String(at), generatedAt: at, revision: 1 }, gallery: { version: String(at), generatedAt: at, revision: 2, rotation: publicSnapshotCycle(at) } });
function generation(at = now): PublicSnapshotGeneration { return { pointer: pointer(at), gallery: Array.from({ length: 8 }, () => []), messages: [], latestIds: [] }; }
function memoryBucket(uniform = true, prevention = 'enforced') {
  type Stored = { data: unknown; generation: number }; const objects = new Map<string, Stored>();
  const writes: Array<{ path: string; options: Record<string, unknown> }> = []; let beforeSave: ((path: string) => void) | null = null; let nextGeneration = 2;
  function missing(): never { throw Object.assign(new Error('Not found'), { code: 404 }); }
  const bucket = { storage: { projectId: 'demo-snapshot-unit', apiEndpoint: 'http://127.0.0.1:9194' },
    getMetadata: vi.fn(async () => [{ iamConfiguration: { uniformBucketLevelAccess: { enabled: uniform }, publicAccessPrevention: prevention } }]),
    file(path: string, selected?: { generation?: string | number }) { return {
      async getMetadata() { const stored = objects.get(path) ?? missing(); return [{ generation: String(stored.generation) }]; },
      async download() { const stored = objects.get(path) ?? missing(); if (selected?.generation !== undefined && String(selected.generation) !== String(stored.generation)) missing(); return [Buffer.from(JSON.stringify(stored.data))]; },
      async save(value: string, options: Record<string, unknown>) { beforeSave?.(path);
        const expected = (options.preconditionOpts as { ifGenerationMatch: string | number }).ifGenerationMatch; const current = objects.get(path)?.generation ?? 0;
        if (String(expected) !== String(current)) throw Object.assign(new Error('Precondition'), { code: 412 });
        writes.push({ path, options }); objects.set(path, { data: JSON.parse(value), generation: nextGeneration++ }); }
    }; }
  } as unknown as PublicSnapshotBucket;
  return { bucket, objects, writes, setBeforeSave: (callback: (path: string) => void) => { beforeSave = callback; } };
}
describe('immutable content and source-confirmed pointer publication', () => {
  it('emulator ACL fallback only accepts a local demo Storage client', async () => {
    const { bucket } = memoryBucket(); vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9194'); vi.stubEnv('GCLOUD_PROJECT', 'demo-snapshot-unit'); vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'demo-snapshot-unit');
    try { expect(await publicSnapshotPrivateAcl(bucket)).toBe(true); expect(bucket.getMetadata).not.toHaveBeenCalled();
      vi.stubEnv('GCLOUD_PROJECT', 'kanata-memorial'); await expect(publicSnapshotPrivateAcl(bucket)).rejects.toThrow('local demo project');
      vi.stubEnv('GCLOUD_PROJECT', 'demo-snapshot-unit'); vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', 'remote.example.test:9194'); await expect(publicSnapshotPrivateAcl(bucket)).rejects.toThrow('local demo project');
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([[false, 'enforced'], [true, 'inherited'], [true, undefined]])('rejects insufficient production bucket privacy before writes: %s %s', async (uniform, prevention) => {
    const { bucket, writes } = memoryBucket(uniform, prevention); if (prevention === undefined) vi.mocked(bucket.getMetadata).mockResolvedValue([{ iamConfiguration: { uniformBucketLevelAccess: { enabled: uniform } } } as never]);
    await expect(writePublicSnapshotGeneration(bucket, generation(), { now: () => now })).rejects.toThrow('uniform access'); expect(writes).toHaveLength(0);
  });
  it('writes nine immutable private objects before the pointer without ACL overrides or download tokens', async () => {
    const { bucket, objects, writes } = memoryBucket(); expect(await writePublicSnapshotGeneration(bucket, generation(), { now: () => now })).toBe(true);
    expect(writes).toHaveLength(10); expect(writes.at(-1)?.path).toBe(PUBLIC_POINTER_OBJECT); expect(objects.get(PUBLIC_POINTER_OBJECT)?.data).toEqual(pointer());
    for (const write of writes) { expect(write.options).toMatchObject({ resumable: false, metadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' } });
      expect(write.options.predefinedAcl).toBeUndefined(); expect(write.options.metadata).not.toHaveProperty('firebaseStorageDownloadTokens'); }
    expect(writes.slice(0, 9).every(write => (write.options.preconditionOpts as { ifGenerationMatch: number }).ifGenerationMatch === 0)).toBe(true);
    expect(objects.get(publicSnapshotObject(String(now), 'messages'))?.data).not.toHaveProperty('validUntil');
  });
  it('handles one hundred maximum-length multilingual messages within the JSON bound', async () => {
    const { bucket } = memoryBucket(); const snapshot = generation(); const url = `https://example.test/${'a'.repeat(470)}`;
    snapshot.messages = Array.from({ length: 100 }, (_, index) => ({ id: `message-${index}`, author: '字'.repeat(100), content: '言'.repeat(500), authorLink: url, authorAvatar: url }));
    expect(Buffer.byteLength(JSON.stringify(snapshot.messages))).toBeGreaterThan(256 * 1024); expect(await writePublicSnapshotGeneration(bucket, snapshot, { now: () => now })).toBe(true);
  });
  it('preserves the newer pointer when another producer wins the CAS', async () => {
    const { bucket, objects, writes, setBeforeSave } = memoryBucket(); objects.set(PUBLIC_POINTER_OBJECT, { data: pointer(now - 1000), generation: 100 });
    setBeforeSave(path => { if (path === PUBLIC_POINTER_OBJECT) objects.set(PUBLIC_POINTER_OBJECT, { data: pointer(now + 1000), generation: 101 }); });
    expect(await writePublicSnapshotGeneration(bucket, generation(), { now: () => now })).toBe(false); expect(objects.get(PUBLIC_POINTER_OBJECT)?.data).toEqual(pointer(now + 1000)); expect(writes.some(write => write.path === PUBLIC_POINTER_OBJECT)).toBe(false);
  });
  it('a partial object failure never changes the pointer or retries artifacts inside the CAS loop', async () => {
    const { bucket, objects, writes, setBeforeSave } = memoryBucket(); objects.set(PUBLIC_POINTER_OBJECT, { data: pointer(now - 1000), generation: 100 });
    setBeforeSave(path => { if (path.endsWith('/gallery-4.json')) throw new Error('Storage failure'); });
    await expect(writePublicSnapshotGeneration(bucket, generation(), { now: () => now })).rejects.toThrow('Storage failure'); expect(writes).toHaveLength(4); expect(objects.get(PUBLIC_POINTER_OBJECT)?.data).toEqual(pointer(now - 1000));
  });
  it('does not publish a newly confirmed lease after the authoritative content revision changed', async () => {
    const { bucket, objects, writes, setBeforeSave } = memoryBucket(); let valid = true; setBeforeSave(path => { if (path.endsWith('/messages.json')) valid = false; });
    expect(await writePublicSnapshotGeneration(bucket, generation(), { now: () => now, canPublish: async () => valid })).toBe(false); expect(writes).toHaveLength(9); expect(objects.has(PUBLIC_POINTER_OBJECT)).toBe(false);
  });
  it('renews only the lease when both immutable content versions are unchanged', async () => {
    const { bucket, objects, writes } = memoryBucket(); const initial = generation(now - 1000); expect(await writePublicSnapshotGeneration(bucket, initial, { now: () => now })).toBe(true);
    const renewed: PublicSnapshotGeneration = { pointer: { ...initial.pointer, generation: now, confirmedAt: now, validUntil: now + PUBLIC_SNAPSHOT_TTL_MS }, messages: null, gallery: null, latestIds: [] };
    expect(await writePublicSnapshotGeneration(bucket, renewed, { now: () => now })).toBe(true); expect(writes).toHaveLength(11); expect(objects.get(PUBLIC_POINTER_OBJECT)?.data).toEqual(renewed.pointer);
    expect(await snapshotArtifactsAvailable(bucket, renewed.pointer)).toEqual({ messages: true, gallery: true }); objects.delete(publicSnapshotObject(initial.pointer.messages.version, 'messages'));
    expect(await snapshotArtifactsAvailable(bucket, renewed.pointer)).toEqual({ messages: false, gallery: true });
  });
  it('does not restore an older reused content version after a concurrent rebuild wins CAS', async () => {
    const { bucket, objects, setBeforeSave } = memoryBucket(); const previous = pointer(now - 2000);
    objects.set(PUBLIC_POINTER_OBJECT, { data: previous, generation: 100 });
    const next: PublicSnapshotGeneration = { pointer: { ...previous, generation: now, confirmedAt: now, validUntil: now + PUBLIC_SNAPSHOT_TTL_MS }, messages: null, gallery: null, latestIds: [] };
    const winner = pointer(now - 1000);
    setBeforeSave(path => { if (path === PUBLIC_POINTER_OBJECT) objects.set(PUBLIC_POINTER_OBJECT, { data: winner, generation: 101 }); });
    expect(await writePublicSnapshotGeneration(bucket, next, { now: () => now })).toBe(false);
    expect(objects.get(PUBLIC_POINTER_OBJECT)?.data).toEqual(winner);
  });
  it('rejects source-check failures, expired leases, and revision downgrades before writes', async () => {
    const blocked = memoryBucket(); expect(await writePublicSnapshotGeneration(blocked.bucket, generation(), { now: () => now, canPublish: async () => false })).toBe(false); expect(blocked.writes).toHaveLength(0);
    const expired = memoryBucket(); expect(await writePublicSnapshotGeneration(expired.bucket, generation(), { now: () => pointer().validUntil })).toBe(false); expect(expired.writes).toHaveLength(0);
    const newer = memoryBucket(); const previous = pointer(now - 1000); previous.messages.revision = 2; newer.objects.set(PUBLIC_POINTER_OBJECT, { data: previous, generation: 100 });
    expect(await writePublicSnapshotGeneration(newer.bucket, generation(), { now: () => now })).toBe(false); expect(newer.writes).toHaveLength(0);
  });
});
