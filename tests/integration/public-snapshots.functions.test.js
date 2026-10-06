import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Separate data and Storage objects keep parallel governance integration tests independent.
const projectId = 'demo-kanata-public-snapshots';
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
let db;
let bucket;
let publisher;
let server;
let origin;
let core;

beforeAll(async () => {
  for (const variable of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[variable] || '')) {
      throw new Error(`${variable} must point to a local emulator; production access is forbidden.`);
    }
  }
  process.env.GCLOUD_PROJECT = projectId;
  process.env.GOOGLE_CLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId, storageBucket: `${projectId}.appspot.com` });
  process.env.PUBLIC_SNAPSHOT_BUCKET = `${projectId}.appspot.com`;
  core = requireFunctions('./lib/public-snapshot-core.js');
  const runtime = requireFunctions('./lib/core.js');
  db = runtime.db;
  bucket = runtime.storage.bucket();
  publisher = requireFunctions('./lib/public-snapshots.js');
  const feed = requireFunctions('./lib/public-feed.js');
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    request.path = url.pathname;
    request.query = {};
    for (const [key, value] of url.searchParams) {
      request.query[key] = request.query[key] === undefined ? value : [request.query[key], value].flat();
    }
    response.set = (name, value) => { response.setHeader(name, value); return response; };
    response.status = status => { response.statusCode = status; return response; };
    response.json = body => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
      return response;
    };
    const handler = request.path.startsWith('/api/gallery/') ? feed.publicGalleryFeed
      : request.path.startsWith('/api/feed/') ? feed.publicFeedVersion : feed.publicMessagesFeed;
    Promise.resolve(handler(request, response)).catch(error => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}, 30_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise(resolve => server.close(resolve));
  if (bucket) {
    const [files] = await bucket.getFiles({ prefix: 'public-snapshots/' });
    await Promise.all(files.map(file => file.delete({ ignoreNotFound: true })));
  }
  if (db) {
    for (const collection of ['fanart', 'messages', 'publicSnapshotCycles', 'system']) {
      await db.recursiveDelete(db.collection(collection));
    }
    await db.terminate();
  }
}, 30_000);

describe.sequential('bounded producer and private Storage delivery with emulators', () => {
  it('publishes bounded sanitized snapshots, deduplicates the cycle, and serves HTTP reads without source regeneration', async () => {
    // Pin the lease clock so starting this test at a five-minute boundary cannot expire publication mid-test.
    const now = Math.floor(Date.now() / 300000) * 300000 + 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const batch = db.batch();
    for (let index = 0; index < 12; index += 1) {
      batch.set(db.collection('fanart').doc(`snapshot-art-${index}`), {
        sourceType: 'x', postId: String(1993918268065239540n + BigInt(index)),
        sampleKey: index / 12, createdAt: new Date(now - index), caption: `Art ${index}`,
        submitter: { displayName: `Contributor ${index}`, uid: `private-${index}`, email: 'private@example.test' },
        hidden: index >= 9, deleted: false, html: '<script>never public</script>'
      });
    }
    for (let index = 0; index < 105; index += 1) {
      batch.set(db.collection('messages').doc(`snapshot-message-${index}`), {
        author: `Author ${index}`, content: `Thank you ${index}`,
        authorLink: 'javascript:alert(1)', authorAvatar: '', authorId: `private-${index}`,
        createdAt: new Date(now + index), hidden: false, deleted: false
      });
    }
    batch.set(db.collection('system').doc('publicContentRevision'), { messagesRevision: 1, fanartRevision: 1 });
    await batch.commit();
    expect(await publisher.runPublicSnapshotPublisher()).toBe('published');
    expect(await publisher.runPublicSnapshotPublisher()).toBe('duplicate');
    const [pointerBytes] = await bucket.file(core.PUBLIC_POINTER_OBJECT).download();
    const pointer = JSON.parse(pointerBytes.toString('utf8'));
    expect(pointer.schemaVersion).toBe(2);
    expect(pointer.validUntil - pointer.confirmedAt).toBeLessThanOrEqual(300000);
    expect(pointer.messages.revision).toBe(1);
    const versionResponse = await fetch(`${origin}/api/feed/version`);
    expect(versionResponse.status).toBe(200);
    const versions = await versionResponse.json();
    expect(versions.messages).toEqual({ version: pointer.messages.version, generatedAt: now, confirmedAt: now, validUntil: pointer.validUntil });
    expect(versions.gallery.version).toBe(pointer.gallery.version);
    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(`${origin}/api/gallery/batches/${index}?version=${pointer.gallery.version}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items).toHaveLength(6);
      expect(body.items.slice(0, 2).map(item => item.id)).toEqual(['snapshot-art-0', 'snapshot-art-1']);
      expect(body.latestIds).toEqual(body.items.slice(0, 2).map(item => item.postId));
      expect(body).not.toHaveProperty('mode');
      expect(body.items.every(item => Number(item.id.replace('snapshot-art-', '')) < 9)).toBe(true);
      expect(Object.keys(body.items[0]).sort()).toEqual(['caption', 'createdAt', 'id', 'postId', 'postUrl', 'submitter']);
      expect(response.headers.get('cache-control')).toMatch(/s-maxage=\d+, must-revalidate/);
    }
    const messages = await fetch(`${origin}/api/messages`).then(response => response.json());
    expect(messages.items).toHaveLength(100);
    expect(messages.items[0]).toEqual({ id: 'snapshot-message-104', author: 'Author 104', content: 'Thank you 104', authorLink: '', authorAvatar: '' });
    const [artifactMetadata] = await bucket.file(core.publicSnapshotObject(pointer.messages.version, 'messages')).getMetadata();
    expect(artifactMetadata.metadata?.firebaseStorageDownloadTokens).toBeUndefined();

    // Visitor requests only read the leased artifact and never create source-production work.
    await db.collection('fanart').doc('snapshot-art-0').delete();
    const before = await fetch(`${origin}/api/gallery/batches/0`).then(response => response.json());
    const repeated = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      fetch(`${origin}/api/gallery/batches/0?version=${pointer.gallery.version}`).then(response => response.json())));
    expect(repeated.every(body => JSON.stringify(body) === JSON.stringify(before))).toBe(true);
    expect((await db.collection('publicSnapshotCycles').get()).size).toBe(1);
    expect((await fetch(`${origin}/api/gallery/batches/0?cacheBust=arbitrary`)).status).toBe(400);
    expect((await fetch(`${origin}/api/messages?version=123`)).status).toBe(409);
    expect((await fetch(`${origin}/api/messages?version=../private`)).status).toBe(400);
    expect((await fetch(`${origin}/api/gallery/batches/8`)).status).toBe(404);
    expect((await fetch(`${origin}/api/messages`, { method: 'POST' })).status).toBe(405);

    // A watchdog confirmation renews the lease while preserving unchanged content versions.
    clock.mockReturnValue(now + 60000);
    expect(await publisher.runPublicSnapshotPublisher()).toBe('published');
    const renewedResponse = await fetch(`${origin}/api/messages?version=${pointer.messages.version}`);
    expect(renewedResponse.status).toBe(200);
    expect(await renewedResponse.json()).toMatchObject({ version: pointer.messages.version, generatedAt: now, confirmedAt: now + 60000, validUntil: now + 360000 });

    // Source mutations and their revision advance together; a private trailing window publishes current content.
    clock.mockReturnValue(now + 62000);
    const changed = db.batch();
    changed.set(db.collection('messages').doc('snapshot-message-105'), {
      author: 'Newest', content: 'New message', createdAt: new Date(now + 62000), hidden: false, deleted: false
    });
    changed.update(db.collection('system').doc('publicContentRevision'), { messagesRevision: 2, fanartRevision: 2 });
    await changed.commit();
    expect(await publisher.runPublicSnapshotPublisher()).toBe('published');
    expect((await fetch(`${origin}/api/messages?version=${pointer.messages.version}`)).status).toBe(409);
    const newest = await fetch(`${origin}/api/messages`).then(response => response.json());
    expect(newest.version).not.toBe(pointer.messages.version);
    expect(newest.items[0]).toMatchObject({ id: 'snapshot-message-105', content: 'New message' });
    const gallery = await fetch(`${origin}/api/gallery/batches/0`).then(response => response.json());
    expect(gallery.items.some(item => item.id === 'snapshot-art-0')).toBe(false);

    // Moderation also advances both revisions, so readers cannot request an obsolete public artifact.
    clock.mockReturnValue(now + 64000);
    const moderated = db.batch();
    moderated.update(db.collection('messages').doc('snapshot-message-105'), { hidden: true });
    moderated.update(db.collection('fanart').doc('snapshot-art-1'), { hidden: true });
    moderated.update(db.collection('system').doc('publicContentRevision'), { messagesRevision: 3, fanartRevision: 3 });
    await moderated.commit();
    expect(await publisher.runPublicSnapshotPublisher()).toBe('published');
    expect((await fetch(`${origin}/api/messages?version=${newest.version}`)).status).toBe(409);
    const visible = await fetch(`${origin}/api/messages`).then(response => response.json());
    expect(visible.items.some(item => item.id === 'snapshot-message-105')).toBe(false);
    const moderatedGallery = await fetch(`${origin}/api/gallery/batches/0`).then(response => response.json());
    expect(moderatedGallery.items.some(item => item.id === 'snapshot-art-1')).toBe(false);

    clock.mockReturnValue(visible.validUntil);
    const expired = await fetch(`${origin}/api/messages`);
    expect(expired.status).toBe(503);
    expect(expired.headers.get('cache-control')).toBe('no-store');
    expect(await expired.json()).toMatchObject({ items: [] });
  }, 30_000);
});
