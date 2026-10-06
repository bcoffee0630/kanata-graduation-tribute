import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  enqueue: vi.fn(), produce: vi.fn(), bucket: vi.fn(() => ({}))
}));
vi.mock('./core.js', () => ({
  REGION: 'asia-east1', TIME_ZONE: 'Asia/Taipei',
  db: {
    collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      get: async (ref: string) => ({ data: () => mocks.rows.get(ref) }),
      set: (ref: string, data: Record<string, unknown>) => mocks.rows.set(ref, data),
      update: (ref: string, data: Record<string, unknown>) => mocks.rows.set(ref, { ...mocks.rows.get(ref), ...data })
    })
  }
}));
vi.mock('firebase-admin/functions', () => ({ getFunctions: () => ({ taskQueue: () => ({ enqueue: mocks.enqueue }) }) }));
vi.mock('./public-snapshot-storage.js', () => ({
  publicSnapshotBucket: mocks.bucket, readPrivateSnapshotJson: vi.fn(), readSnapshotPointer: vi.fn(), snapshotArtifactsAvailable: vi.fn(), writePublicSnapshotGeneration: vi.fn()
}));
vi.mock('./public-snapshot-core.js', async importOriginal => ({
  ...await importOriginal<typeof import('./public-snapshot-core.js')>(), producePublicSnapshots: mocks.produce
}));
import { enqueuePublicSnapshotTask, runPublicSnapshotPublisher } from './public-snapshots.js';
import { publicSnapshotWindow, type PublicSnapshotProducerDependencies } from './public-snapshot-core.js';

const now = 1800000001000;
beforeEach(() => {
  mocks.rows.clear(); mocks.enqueue.mockReset().mockResolvedValue(undefined); mocks.produce.mockReset(); mocks.bucket.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubEnv('FUNCTIONS_EMULATOR', 'false'); vi.stubEnv('FIRESTORE_EMULATOR_HOST', ''); vi.stubEnv('CLOUD_TASKS_EMULATOR_HOST', '');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function producer(result: 'published' | 'dirty' | 'superseded' = 'published') {
  mocks.produce.mockImplementation(async (deps: PublicSnapshotProducerDependencies, window: number) =>
    await deps.claimWindow(window) ? result : 'duplicate');
}
describe('private coalesced task reliability', () => {
  it('finishes the persisted claim only after its trailing task is acknowledged, and retries transient failures', async () => {
    producer('dirty'); mocks.enqueue.mockRejectedValueOnce(new Error('Cloud Tasks unavailable'));
    const key = `publicSnapshotCycles/${publicSnapshotWindow(now)}`;
    await expect(runPublicSnapshotPublisher(now)).rejects.toThrow('Cloud Tasks unavailable');
    expect(mocks.rows.get(key)).toMatchObject({ attempts: 1, status: 'failed' });
    expect(await runPublicSnapshotPublisher(now)).toBe('dirty');
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.rows.get(key)).toMatchObject({ attempts: 2, status: 'complete' });
    expect(await runPublicSnapshotPublisher(now)).toBe('duplicate');
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });
  it('allows at most three persisted attempts for a failing source window', async () => {
    mocks.produce.mockImplementation(async (deps: PublicSnapshotProducerDependencies, window: number) => {
      if (!await deps.claimWindow(window)) return 'duplicate'; throw new Error('Storage unavailable');
    });
    for (let attempt = 0; attempt < 3; attempt++) await expect(runPublicSnapshotPublisher(now)).rejects.toThrow('Storage unavailable');
    expect(await runPublicSnapshotPublisher(now)).toBe('duplicate');
    expect(mocks.rows.get(`publicSnapshotCycles/${publicSnapshotWindow(now)}`)).toMatchObject({ attempts: 3, status: 'failed' });
  });
  it('does not reclaim an unexpired in-flight lease and can recover an abandoned lease', async () => {
    producer(); const key = `publicSnapshotCycles/${publicSnapshotWindow(now)}`;
    mocks.rows.set(key, { attempts: 1, status: 'running', leaseUntil: Timestamp.fromMillis(now + 1) });
    expect(await runPublicSnapshotPublisher(now)).toBe('duplicate');
    mocks.rows.set(key, { attempts: 1, status: 'running', leaseUntil: Timestamp.fromMillis(now) });
    expect(await runPublicSnapshotPublisher(now)).toBe('published');
    expect(mocks.rows.get(key)).toMatchObject({ attempts: 2, status: 'complete' });
  });
  it('coalesces duplicate task IDs without treating acknowledgement as a publish failure', async () => {
    mocks.enqueue.mockRejectedValueOnce(Object.assign(new Error('Exists'), { code: 'functions/task-already-exists' }));
    expect(await enqueuePublicSnapshotTask(now)).toBe(false);
    expect(mocks.enqueue).toHaveBeenCalledWith({ windowKey: publicSnapshotWindow(now) + 1 },
      expect.objectContaining({ id: `snapshot-${publicSnapshotWindow(now) + 1}`, dispatchDeadlineSeconds: 120 }));
  });
  it('never attempts real Cloud Tasks access while Firebase emulators are enabled', async () => {
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8085'); vi.stubEnv('GCLOUD_PROJECT', 'demo-snapshot-unit');
    expect(await enqueuePublicSnapshotTask(now)).toBe(false); expect(mocks.enqueue).not.toHaveBeenCalled();
    vi.stubEnv('GCLOUD_PROJECT', 'production-project'); await expect(enqueuePublicSnapshotTask(now)).rejects.toThrow('demo project');
  });
  it('rejects malformed task times before claiming a window', async () => {
    for (const time of [-1, 0.5, NaN, now + 2001]) await expect(runPublicSnapshotPublisher(time)).rejects.toThrow('Invalid snapshot task time');
    expect(mocks.produce).not.toHaveBeenCalled(); expect(mocks.rows.size).toBe(0);
  });
});
