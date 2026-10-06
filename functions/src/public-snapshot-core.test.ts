import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  PUBLIC_SNAPSHOT_TTL_MS, PUBLIC_MESSAGE_ARTIFACT_RENEW_MS, type PublicSnapshotProducerDependencies, type PublicSnapshotPointer,
  parsePublicFeedArtifact, parsePublicSnapshotPointer, publicGalleryItem, publicMessageItem,
  producePublicSnapshots, publicSnapshotObject, publicSnapshotCycle, publicSnapshotWindow, nextPublicSnapshotTask, samplePublicGallery
} from './public-snapshot-core.js';
const now = 1800000001000;
const pointer = (at = now - 1000): PublicSnapshotPointer => ({
  schemaVersion: 2, generation: at, confirmedAt: at, validUntil: at + PUBLIC_SNAPSHOT_TTL_MS,
  messages: { version: String(at), generatedAt: at, revision: 4 },
  gallery: { version: String(at), generatedAt: at, revision: 8, rotation: publicSnapshotCycle(now) }
});
const document = (id: string) => ({ id, data: {
  postId: String(1993918268065239540n + BigInt(createHash('sha256').update(id).digest().readUIntBE(0, 6))),
  createdAt: new Date(now), caption: 'Art', artist: 'Contributor', author: 'Author', content: 'Thank you!', authorId: 'private-user'
} });
function dependencies(overrides: Partial<PublicSnapshotProducerDependencies> = {}): PublicSnapshotProducerDependencies {
  return { claimWindow: vi.fn(async () => true), readRevisions: vi.fn(async () => ({ messagesRevision: 4, fanartRevision: 8 })),
    readPointer: vi.fn(async () => null), artifactsAvailable: vi.fn(async () => ({ messages: true, gallery: true })),
    readMessageArtifact: vi.fn(async () => [publicMessageItem(document('message'))!]),
    queryLatestGallery: vi.fn(async () => [document('latest-1'), document('latest-2')]),
    queryGallery: vi.fn(async (_pivot, limit) => Array.from({ length: limit }, (_, index) => document(`random-${index}`))),
    queryMessages: vi.fn(async () => [document('message')]), publish: vi.fn(async () => true), now: () => now, random: () => 0.5, ...overrides };
}
describe('bounded source production and confirmed leases', () => {
  it('queries latest two once, eight bounded candidate groups and one bounded message group', async () => {
    const deps = dependencies(); expect(await producePublicSnapshots(deps, publicSnapshotWindow(now))).toBe('published');
    expect(deps.queryLatestGallery).toHaveBeenCalledTimes(1); expect(deps.queryGallery).toHaveBeenCalledTimes(8);
    expect(deps.queryMessages).toHaveBeenCalledTimes(1);
    const published = vi.mocked(deps.publish).mock.calls[0]![0];
    expect(published.gallery?.every(items => items.length === 6)).toBe(true);
    expect(published.gallery?.[0]?.slice(0, 2).map(item => item.id)).toEqual(['latest-1', 'latest-2']);
    expect(published.latestIds).toEqual(published.gallery?.[0]?.slice(0, 2).map(item => item.postId));
    expect(published.pointer).toMatchObject({ generation: now, confirmedAt: now, validUntil: now + PUBLIC_SNAPSHOT_TTL_MS });
  });
  it('excludes both latest posts with six candidates, without extra queries or duplicate cards', async () => {
    const newest = [document('new-1'), document('new-2')]; const latest = newest.map(item => publicGalleryItem(item)!);
    const query = vi.fn(async () => [...newest, ...Array.from({ length: 4 }, (_, index) => document(`old-${index}`))]);
    const result = await samplePublicGallery(query, 0.5, latest);
    expect(result.map(item => item.id)).toEqual(['new-1', 'new-2', 'old-0', 'old-1', 'old-2', 'old-3']);
    expect(query.mock.calls).toEqual([[0.5, 6, false]]);
  });
  it('selects two distinct latest posts from six bounded candidates despite historical aliases', async () => {
    const newest = document('newest'); const second = document('second-newest');
    const deps = dependencies({ queryLatestGallery: vi.fn(async () => [newest,
      { ...document('newest-alias'), data: newest.data }, second, document('older-1'), document('older-2'), document('older-3')]) });
    expect(await producePublicSnapshots(deps, 1)).toBe('published');
    const published = vi.mocked(deps.publish).mock.calls[0]![0];
    expect(published.gallery?.[0]?.slice(0, 2).map(item => item.id)).toEqual(['newest', 'second-newest']);
    expect(published.latestIds).toEqual([newest.data.postId, second.data.postId]);
    expect(deps.queryLatestGallery).toHaveBeenCalledTimes(1);
  });
  it('wraps only missing candidate slots and bounds empty-tail reads to one empty query plus six documents', async () => {
    const latest = [publicGalleryItem(document('new-1'))!, publicGalleryItem(document('new-2'))!];
    const query = vi.fn(async (_pivot: number, limit: number, wrap: boolean) => wrap ? Array.from({ length: limit }, (_, index) => document(`old-${index}`)) : []);
    expect(await samplePublicGallery(query, 0.99, latest)).toHaveLength(6);
    expect(query.mock.calls).toEqual([[0.99, 6, false], [0.99, 6, true]]);
    await expect(samplePublicGallery(query, 1)).rejects.toThrow('Invalid gallery sample');
  });
  it('deduplicates malformed IDs and post IDs without unbounded refill queries', async () => {
    const first = document('first'); const query = vi.fn(async () => [first, { ...document('duplicate-post'), data: first.data },
      { ...document('duplicate-id'), id: first.id }, document('other-1'), document('other-2'), document('other-3')]);
    expect((await samplePublicGallery(query, 0.5)).map(item => item.id)).toEqual(['first', 'other-1', 'other-2', 'other-3']);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('a duplicate persisted claim prevents all source and revision reads', async () => {
    const deps = dependencies({ claimWindow: async () => false });
    expect(await producePublicSnapshots(deps, 1)).toBe('duplicate');
    expect(deps.readRevisions).not.toHaveBeenCalled(); expect(deps.queryGallery).not.toHaveBeenCalled();
  });
  it('renews an old unchanged content version after checking revisions and object availability', async () => {
    const previous = pointer(); previous.messages.generatedAt = now - 86400000; previous.messages.version = String(now - 21600000);
    const deps = dependencies({ readPointer: async () => previous });
    expect(await producePublicSnapshots(deps, 1)).toBe('published');
    expect(deps.queryMessages).not.toHaveBeenCalled(); expect(deps.queryGallery).not.toHaveBeenCalled();
    expect(deps.readRevisions).toHaveBeenCalledTimes(2);
    expect(deps.publish).toHaveBeenCalledWith(expect.objectContaining({ messages: null, gallery: null,
      pointer: expect.objectContaining({ messages: previous.messages, gallery: previous.gallery, confirmedAt: now, validUntil: now + PUBLIC_SNAPSHOT_TTL_MS }) }));
  });
  it('rebuilds missing artifacts even when the revision did not change', async () => {
    const deps = dependencies({ readPointer: async () => pointer(), artifactsAvailable: async () => ({ messages: false, gallery: true }) });
    expect(await producePublicSnapshots(deps, 1)).toBe('published'); expect(deps.queryMessages).toHaveBeenCalledTimes(1); expect(deps.queryGallery).not.toHaveBeenCalled();
  });
  it('renews a twelve-hour message artifact from Storage without reading unchanged Firestore messages', async () => {
    const previous = pointer(); previous.messages.version = String(now - PUBLIC_MESSAGE_ARTIFACT_RENEW_MS);
    previous.messages.generatedAt = now - 86400000;
    const deps = dependencies({ readPointer: async () => previous });
    expect(await producePublicSnapshots(deps, 1)).toBe('published');
    expect(deps.readMessageArtifact).toHaveBeenCalledWith(previous);
    expect(deps.queryMessages).not.toHaveBeenCalled(); expect(deps.queryGallery).not.toHaveBeenCalled();
    expect(deps.publish).toHaveBeenCalledWith(expect.objectContaining({
      messages: [publicMessageItem(document('message'))!], gallery: null,
      pointer: expect.objectContaining({ messages: { version: String(now), generatedAt: previous.messages.generatedAt, revision: 4 } })
    }));
  });
  it('uses the bounded message query if an artifact to be copied is missing or corrupt', async () => {
    const previous = pointer(); previous.messages.version = String(now - PUBLIC_MESSAGE_ARTIFACT_RENEW_MS);
    const deps = dependencies({ readPointer: async () => previous, readMessageArtifact: async () => null });
    expect(await producePublicSnapshots(deps, 1)).toBe('published'); expect(deps.queryMessages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.publish).mock.calls[0]?.[0].pointer.messages.generatedAt).toBe(now);
  });
  it('rotates only gallery content every five minutes while preserving message versions', async () => {
    const previous = pointer(); previous.gallery.rotation--;
    const deps = dependencies({ readPointer: async () => previous });
    expect(await producePublicSnapshots(deps, 1)).toBe('published'); expect(deps.queryMessages).not.toHaveBeenCalled(); expect(deps.queryGallery).toHaveBeenCalledTimes(8);
  });
  it('does not renew or publish a lease if a content mutation occurs during building', async () => {
    const readRevisions = vi.fn().mockResolvedValueOnce({ messagesRevision: 4, fanartRevision: 8 }).mockResolvedValueOnce({ messagesRevision: 5, fanartRevision: 8 });
    const deps = dependencies({ readRevisions }); expect(await producePublicSnapshots(deps, 1)).toBe('dirty'); expect(deps.publish).not.toHaveBeenCalled();
  });
  it('fails bounded retries when source revisions regress below an existing pointer, before any source query', async () => {
    const previous = pointer(); previous.messages.revision = 5;
    const deps = dependencies({ readPointer: async () => previous });
    await expect(producePublicSnapshots(deps, 1)).rejects.toThrow('revisions regressed');
    expect(deps.queryMessages).not.toHaveBeenCalled(); expect(deps.queryGallery).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
  it('bounds coalescing tasks to one trailing slot and gives boundary writes a fresh task ID', () => {
    expect(nextPublicSnapshotTask(2000)).toEqual({ windowKey: 2, id: 'snapshot-2', scheduledAt: 4000 });
    expect(nextPublicSnapshotTask(3999)).toEqual(nextPublicSnapshotTask(2000));
    expect(nextPublicSnapshotTask(4000).id).toBe('snapshot-3');
  });
});
describe('private data sanitization and immutable artifact validation', () => {
  it('normalizes canonical post URLs and exposes no private author fields', () => {
    const source = document('safe'); source.data.caption = '<script>text</script>';
    expect(publicGalleryItem(source)).not.toHaveProperty('authorId');
    expect(publicMessageItem({ ...source, data: { ...source.data, authorLink: 'javascript:alert(1)', authorAvatar: 'https://user:secret@example.test/' } })).toMatchObject({ authorLink: '', authorAvatar: '' });
  });
  it('accepts renewed leases whose content was generated more than five minutes earlier', () => {
    const previous = pointer(); previous.messages.generatedAt = now - 86400000; previous.messages.version = String(now - 86400000);
    expect(parsePublicSnapshotPointer(previous)).toEqual(previous);
    expect(parsePublicSnapshotPointer({ ...previous, validUntil: previous.confirmedAt + PUBLIC_SNAPSHOT_TTL_MS + 1 })).toBeNull();
    expect(() => publicSnapshotObject('../private', 'messages')).toThrow();
  });
  it('rejects duplicate post IDs and invalid latest anchors in gallery artifacts', () => {
    const item = publicGalleryItem(document('a'))!; const expected = pointer().gallery;
    const artifact = { version: expected.version, generatedAt: expected.generatedAt, latestIds: [item.postId], items: [item] };
    expect(parsePublicFeedArtifact(artifact, expected, 'gallery')).not.toBeNull();
    expect(parsePublicFeedArtifact({ ...artifact, items: [item, { ...item, id: 'other' }] }, expected, 'gallery')).toBeNull();
    expect(parsePublicFeedArtifact({ ...artifact, latestIds: ['123'] }, expected, 'gallery')).toBeNull();
  });
});
