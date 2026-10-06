import { describe, expect, it, vi } from 'vitest';
import { assertSetupBucketName, snapshotBucketCreation, validateSetupBucket, waitForServiceEnable } from '../../scripts/setup-public-snapshot-resources.mjs';
import { parseOperatorOptions } from '../../scripts/public-delivery-operator.mjs';

const project = { projectId: 'kanata-memorial-admin', projectNumber: '123' };
const name = 'kanata-memorial-admin-public-snapshots';
const bucket = { ...snapshotBucketCreation(name), projectNumber: '123' };

describe('Owner-guarded private prerequisite setup', () => {
  it('keeps remote setup dry-run by default and requires the existing production release guard', () => {
    expect(parseOperatorOptions(['--project', project.projectId, '--bucket', name]).apply).toBe(false);
    expect(() => parseOperatorOptions(['--project', 'kanata-memorial', '--apply'])).toThrow(/confirm-production/);
    expect(() => parseOperatorOptions(['--project', 'kanata-memorial', '--apply', '--confirm-production', 'kanata-memorial'])).toThrow(/release-tag/);
  });

  it('only creates the explicitly project-prefixed regional private bucket without ACL, billing or legacy mutations', () => {
    expect(snapshotBucketCreation(name)).toEqual({ name, location: 'ASIA-EAST1', storageClass: 'STANDARD',
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } });
    expect(() => assertSetupBucketName(project.projectId, name)).not.toThrow();
    for (const bad of ['kanata-memorial-admin.appspot.com', 'kanata-memorial-admin.firebasestorage.app', 'unrelated-private-bucket', `${project.projectId}-UPPER`, `${project.projectId}-${'x'.repeat(70)}`]) {
      expect(() => assertSetupBucketName(project.projectId, bad)).toThrow();
    }
  });

  it('reuses compliant resources but stops rather than repairing a different bucket', () => {
    expect(() => validateSetupBucket(bucket, project, name)).not.toThrow();
    for (const invalid of [{ ...bucket, projectNumber: '456' }, { ...bucket, location: 'ASIA' },
      { ...bucket, storageClass: 'NEARLINE' }, { ...bucket, name: 'other' },
      { ...bucket, iamConfiguration: { uniformBucketLevelAccess: { enabled: false }, publicAccessPrevention: 'enforced' } },
      { ...bucket, iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'inherited' } }]) {
      expect(() => validateSetupBucket(invalid, project, name)).toThrow(/Existing bucket/);
    }
  });

  it('waits for the one approved API operation and stops on errors, foreign operation names and bounded timeouts', async () => {
    const pause = vi.fn(async () => {});
    const read = vi.fn(async () => ({ done: true }));
    await waitForServiceEnable({ name: 'operations/acf.123' }, read, { pause, now: () => 0 });
    expect(read).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledWith('operations/acf.123');
    await expect(waitForServiceEnable({ done: true, error: { code: 7 } }, read)).rejects.toThrow(/failed/);
    await expect(waitForServiceEnable({ name: 'https://other.test/operation' }, read)).rejects.toThrow(/pending\/invalid/);
    let now = 0;
    await expect(waitForServiceEnable({ name: 'operations/acf.123' }, async () => ({ name: 'operations/acf.123' }), {
      pause: async delay => { now += delay; }, now: () => now, timeoutMs: 3000
    })).rejects.toThrow(/pending\/invalid/);
    const neverFinishes = vi.fn(async () => ({ name: 'operations/acf.123' }));
    await expect(waitForServiceEnable({ name: 'operations/acf.123' }, neverFinishes, { pause, now: () => 0 })).rejects.toThrow(/polling limit/);
    expect(neverFinishes).toHaveBeenCalledTimes(30);
  });
});
