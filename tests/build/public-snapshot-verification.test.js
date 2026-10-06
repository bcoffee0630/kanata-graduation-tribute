import { describe, expect, it } from 'vitest';
import { verifyPublicSnapshotInfrastructure } from '../../scripts/verify-public-snapshot-infrastructure.mjs';

function fixture() {
  const project = 'snapshot-project';
  const reader = `public-feed-reader@${project}.iam.gserviceaccount.com`;
  const writer = '123-compute@developer.gserviceaccount.com';
  const bucket = 'dedicated-private-snapshots';
  const now = 1_000_000;
  const version = { version: '1', generatedAt: now - 1000, confirmedAt: now - 500, validUntil: now + 10_000 };
  const inventory = ['publicGalleryFeed', 'publicMessagesFeed', 'publicFeedVersion', 'publishPublicSnapshots',
    'queuePublicSnapshotUpdate', 'maintainPublicSnapshots'].map(name => ({
      name: `projects/${project}/locations/asia-east1/functions/${name}`, state: 'ACTIVE', buildConfig: { runtime: 'nodejs22' },
      serviceConfig: { service: `projects/${project}/locations/asia-east1/services/${name.toLowerCase()}`,
        serviceAccountEmail: name.startsWith('public') ? reader : writer, uri: `https://${name}.test`,
        environmentVariables: { PUBLIC_SNAPSHOT_BUCKET: bucket }, maxInstanceCount: 1, maxInstanceRequestConcurrency: 1 }
    }));
  const queue = { state: 'RUNNING', rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 0.5 },
    retryConfig: { maxAttempts: 3, minBackoff: '1s', maxBackoff: '10s', maxDoublings: 3 } };
  const workerPolicy = { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${writer}`] }] };
  const api = async (url, options = {}) => {
    if (url.includes('policytroubleshooter')) {
      const tuple = JSON.parse(options.body).accessTuple;
      return { access: tuple.principal === reader
        ? tuple.permission === 'storage.objects.get' && tuple.fullResourceName.includes('/objects/public-snapshots/') ? 'GRANTED' : 'NOT_GRANTED'
        : 'GRANTED' };
    }
    if (url.includes('firestore.googleapis.com')) return { ttlConfig: { state: 'ACTIVE' } };
    if (url.includes('cloudresourcemanager')) return { projectNumber: '123' };
    if (url.includes('storage.googleapis.com')) return url.includes('/iam') ? { bindings: [] }
      : { projectNumber: '123', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } };
    if (url.includes('run.googleapis.com')) return workerPolicy;
    if (url.includes('cloudtasks.googleapis.com')) return url.includes(':getIamPolicy') ? { bindings: [] } : queue;
    throw new Error(`Unexpected URL ${url}`);
  };
  const bodies = { publicGalleryFeed: { ...version, latestIds: [], items: [] }, publicMessagesFeed: { ...version, items: [] },
    publicFeedVersion: { messages: { ...version }, gallery: { ...version } } };
  const fetchFeed = async url => ({ status: 200, json: async () => bodies[Object.keys(bodies).find(name => name.toLowerCase() === new URL(url).hostname.split('.')[0])] });
  return { project, inventory, api, fetchFeed, now: () => now, bodies, workerPolicy, queue, reader };
}

describe('snapshot release preflight', () => {
  it('verifies private IAM, task bounds and the actual separate version response', async () => {
    const setup = fixture();
    expect(await verifyPublicSnapshotInfrastructure(setup)).toMatchObject({
      privateTaskWorker: true, dedicatedReaderFirestoreAccess: 'NOT_GRANTED', feeds: 3, activeTtlPolicies: 2
    });
  });

  it('waits for deployed TTL policies instead of trusting local fields or pending creation', async () => {
    const setup = fixture();
    const api = setup.api;
    setup.api = async (url, options) => url.includes('/fields/expiresAt') ? { ttlConfig: { state: 'CREATING' } } : api(url, options);
    await expect(verifyPublicSnapshotInfrastructure(setup)).rejects.toThrow(/TTL publicEndpointLimits.expiresAt is not ACTIVE/);
  });

  it('rejects inherited reader Firestore grants and publicly invokable workers', async () => {
    const inherited = fixture();
    const api = inherited.api;
    inherited.api = async (url, options) => url.includes('policytroubleshooter') && options.body.includes('datastore.entities.get')
      ? { access: 'GRANTED' } : api(url, options);
    await expect(verifyPublicSnapshotInfrastructure(inherited)).rejects.toThrow(/NOT_GRANTED/);
    const publicWorker = fixture();
    publicWorker.workerPolicy.bindings.push({ role: 'roles/run.invoker', members: ['allAuthenticatedUsers'] });
    await expect(verifyPublicSnapshotInfrastructure(publicWorker)).rejects.toThrow(/publicly invokable/);
  });

  it('rejects unbounded queues, overfilled galleries and expired per-content leases', async () => {
    const unbounded = fixture();
    unbounded.queue.rateLimits.maxConcurrentDispatches = 2;
    await expect(verifyPublicSnapshotInfrastructure(unbounded)).rejects.toThrow(/resource\/retry bounds/);
    const gallery = fixture();
    gallery.bodies.publicGalleryFeed.items = Array.from({ length: 7 }, () => ({}));
    await expect(verifyPublicSnapshotInfrastructure(gallery)).rejects.toThrow(/Fresh bounded/);
    const expiredVersion = fixture();
    expiredVersion.bodies.publicFeedVersion.gallery.validUntil = expiredVersion.now();
    await expect(verifyPublicSnapshotInfrastructure(expiredVersion)).rejects.toThrow(/Fresh bounded/);
  });
});
