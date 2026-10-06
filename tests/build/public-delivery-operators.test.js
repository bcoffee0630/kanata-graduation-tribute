import { describe, expect, it } from 'vitest';
import { addPrivateIamBinding, assertPrivateSnapshotBucket, desiredSnapshotQueue, snapshotLifecycle } from '../../scripts/provision-public-delivery.mjs';
import { parseOperatorOptions } from '../../scripts/public-delivery-operator.mjs';

describe('public delivery operator safeguards', () => {
  it('defaults to dry-run, requires a named project, and rejects ambiguous flags', () => {
    expect(parseOperatorOptions(['--project', 'kanata-memorial-admin']).apply).toBe(false);
    expect(() => parseOperatorOptions([])).toThrow();
    expect(() => parseOperatorOptions(['--project', 'kanata-memorial', '--project', 'kanata-memorial-admin'])).toThrow();
    expect(() => parseOperatorOptions(['--project', 'kanata-memorial', '--apply'])).toThrow(/confirm-production/);
    expect(() => parseOperatorOptions(['--project', 'kanata-memorial', '--apply', '--confirm-production', 'kanata-memorial']))
      .toThrow(/release-tag/);
  });

  it('does not accept removed fee-controller flags', () => {
    for (const flag of ['--billing-account', '--budget-amount', '--owner-email', '--baseline-cost', '--period-start']) {
      expect(() => parseOperatorOptions(['--project', 'kanata-memorial-admin', flag, 'value'])).toThrow(/Unknown option/);
    }
  });

  it('requires an existing dedicated same-project UBLA bucket with enforced public access prevention', () => {
    const project = { projectId: 'kanata-memorial-admin', projectNumber: '123' };
    const bucket = { projectNumber: '123', iamConfiguration: {
      uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } };
    expect(() => assertPrivateSnapshotBucket(bucket, project, 'private-snapshots')).not.toThrow();
    expect(() => assertPrivateSnapshotBucket(bucket, project, 'kanata-memorial-admin.appspot.com')).toThrow(/dedicated/);
    expect(() => assertPrivateSnapshotBucket({ ...bucket, projectNumber: '456' }, project, 'private-snapshots')).toThrow(/dedicated/);
    expect(() => assertPrivateSnapshotBucket({ ...bucket, iamConfiguration: {
      uniformBucketLevelAccess: { enabled: false }, publicAccessPrevention: 'enforced' } }, project, 'private-snapshots')).toThrow(/uniform/);
    expect(() => assertPrivateSnapshotBucket({ ...bucket, iamConfiguration: {
      uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'inherited' } }, project, 'private-snapshots')).toThrow(/prevention/);
  });

  it('bounds task dispatch and retries without accepting visitor-generated work', () => {
    expect(desiredSnapshotQueue('projects/p/locations/asia-east1/queues/publishPublicSnapshots')).toEqual({
      name: 'projects/p/locations/asia-east1/queues/publishPublicSnapshots',
      rateLimits: { maxDispatchesPerSecond: 0.5, maxConcurrentDispatches: 1 },
      retryConfig: { maxAttempts: 3, minBackoff: '1s', maxBackoff: '10s', maxDoublings: 3 }
    });
  });

  it('preserves all existing lifecycle rules and adds deletion for generations only, idempotently', () => {
    const mediaRule = { action: { type: 'SetStorageClass', storageClass: 'NEARLINE' }, condition: { age: 30, matchesPrefix: ['fanart/'] } };
    const result = snapshotLifecycle([mediaRule]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(mediaRule);
    expect(result[1]).toEqual({ action: { type: 'Delete' }, condition: { age: 1, matchesPrefix: ['public-snapshots/generations/'] } });
    expect(snapshotLifecycle(result)).toBe(result);
    expect(snapshotLifecycle([{ condition: { matchesPrefix: ['public-snapshots/generations/'], age: 1 }, action: { type: 'Delete' } }]))
      .toHaveLength(1);
  });

  it('adds private conditional bindings without dropping policies or duplicating members', () => {
    const legacy = { role: 'roles/storage.admin', members: ['serviceAccount:legacy@example.test'] };
    const policy = { etag: 'etag-1', bindings: [legacy] };
    const condition = { title: 'prefix', expression: "resource.name.startsWith('projects/_/buckets/private/objects/public-snapshots/')" };
    addPrivateIamBinding(policy, 'projects/p/roles/reader', 'serviceAccount:reader@example.test', condition);
    addPrivateIamBinding(policy, 'projects/p/roles/reader', 'serviceAccount:reader@example.test', condition);
    addPrivateIamBinding(policy, 'projects/p/roles/metadata', 'serviceAccount:writer@example.test');
    expect(policy.etag).toBe('etag-1');
    expect(policy.version).toBe(3);
    expect(policy.bindings[0]).toBe(legacy);
    expect(policy.bindings[1].members).toEqual(['serviceAccount:reader@example.test']);
    expect(policy.bindings).toHaveLength(3);
  });
});
