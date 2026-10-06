import { describe, expect, it } from 'vitest';
import { verifyPublicSnapshotInfrastructure } from '../../scripts/verify-public-snapshot-infrastructure.mjs';

function fixture() {
  const project = 'snapshot-project';
  const reader = `public-feed-reader@${project}.iam.gserviceaccount.com`;
  const writer = '123-compute@developer.gserviceaccount.com';
  const bucket = 'dedicated-private-snapshots';
  const bucketResource = `//storage.googleapis.com/projects/_/buckets/${bucket}`;
  const readerRole = `projects/${project}/roles/publicFeedSnapshotReader`;
  const member = `serviceAccount:${reader}`;
  const condition = { title: 'private-public-snapshot-prefix',
    expression: `resource.name.startsWith('projects/_/buckets/${bucket}/objects/public-snapshots/')` };
  const readerBinding = { role: readerRole, members: [member], condition };
  const bucketPolicy = { etag: 'bucket-policy', version: 3, bindings: [readerBinding] };
  const storageProof = { overallAccessState: 'UNKNOWN_CONDITIONAL',
    allowPolicyExplanation: { allowAccessState: 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL', explainedPolicies: [
      { fullResourceName: bucketResource, allowAccessState: 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL',
        policy: { version: 3, bindings: [structuredClone(readerBinding)] }, bindingExplanations: [
          { role: readerRole, rolePermission: 'ROLE_PERMISSION_INCLUDED', allowAccessState: 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL',
            condition, combinedMembership: { membership: 'MEMBERSHIP_MATCHED' }, memberships: { [member]: { membership: 'MEMBERSHIP_MATCHED' } } }
        ] },
      { fullResourceName: `//cloudresourcemanager.googleapis.com/projects/${project}`, allowAccessState: 'ALLOW_ACCESS_STATE_NOT_GRANTED',
        policy: { etag: 'project-policy', bindings: [] }, bindingExplanations: [] }
    ] }, denyPolicyExplanation: { denyAccessState: 'DENY_ACCESS_STATE_NOT_DENIED' } };
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
      if (url.includes('/v3/')) {
        if (tuple.fullResourceName !== bucketResource) throw new Error('Unsupported object target');
        return storageProof;
      }
      if (tuple.permission.startsWith('datastore.entities.')) {
        if (tuple.fullResourceName !== `//cloudresourcemanager.googleapis.com/projects/${project}`) throw new Error('Unsupported database target');
        return { access: 'NOT_GRANTED', explainedPolicies: [{ access: 'NOT_GRANTED', fullResourceName: tuple.fullResourceName,
          policy: { etag: 'visible-empty-policy', bindings: [] }, bindingExplanations: [] }] };
      }
      return { access: tuple.principal === reader
        ? tuple.permission === 'storage.objects.get' && tuple.fullResourceName.includes('/objects/public-snapshots/') ? 'GRANTED' : 'NOT_GRANTED'
        : 'GRANTED' };
    }
    if (url.includes('firestore.googleapis.com')) return { ttlConfig: { state: 'ACTIVE' } };
    if (url.includes('cloudresourcemanager')) return { projectNumber: '123' };
    if (url === `https://iam.googleapis.com/v1/${readerRole}`) return { name: readerRole, stage: 'GA', includedPermissions: ['storage.objects.get'] };
    if (url.includes('storage.googleapis.com')) return url.includes('/iam') ? bucketPolicy
      : { projectNumber: '123', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } };
    if (url.includes('run.googleapis.com')) return workerPolicy;
    if (url.includes('cloudtasks.googleapis.com')) return url.includes(':getIamPolicy') ? { bindings: [] } : queue;
    throw new Error(`Unexpected URL ${url}`);
  };
  const bodies = { publicGalleryFeed: { ...version, latestIds: [], items: [] }, publicMessagesFeed: { ...version, items: [] },
    publicFeedVersion: { messages: { ...version }, gallery: { ...version } } };
  const fetchFeed = async url => ({ status: 200, json: async () => bodies[Object.keys(bodies).find(name => name.toLowerCase() === new URL(url).hostname.split('.')[0])] });
  return { project, inventory, api, fetchFeed, now: () => now, bodies, workerPolicy, queue, reader, storageProof, bucketPolicy };
}

describe('snapshot release preflight', () => {
  it('verifies private IAM, task bounds and the actual separate version response', async () => {
    const setup = fixture();
    expect(await verifyPublicSnapshotInfrastructure(setup)).toMatchObject({
      privateTaskWorker: true, dedicatedReaderFirestoreAccess: 'NOT_GRANTED', feeds: 3, activeTtlPolicies: 2,
      dedicatedReaderStorageIsolation: { outsidePrefix: 'NO_ALLOW_GRANT', insidePrefixRead: 'VERIFIED_BY_THREE_ACTUAL_READER_FEED_200' }
    });
  });

  it('does not treat a fixed-prefix policy proof as an effective read without all real reader feeds succeeding', async () => {
    const setup = fixture();
    setup.fetchFeed = async () => ({ status: 503, json: async () => ({ items: [] }) });
    await expect(verifyPublicSnapshotInfrastructure(setup)).rejects.toThrow(/Fresh bounded snapshot is unavailable/);
  });

  it('rejects storage matrix changes and unknown deny evaluation before fetching any public feed', async () => {
    for (const change of [
      setup => { setup.storageProof.denyPolicyExplanation.denyAccessState = 'DENY_ACCESS_STATE_UNKNOWN_INFO'; },
      setup => { setup.bucketPolicy.bindings = []; }
    ]) {
      const setup = fixture(); change(setup);
      let fetches = 0; setup.fetchFeed = async () => { fetches++; return { status: 200, json: async () => ({}) }; };
      await expect(verifyPublicSnapshotInfrastructure(setup)).rejects.toThrow(/Storage isolation/);
      expect(fetches).toBe(0);
    }
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
