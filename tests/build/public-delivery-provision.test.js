import { afterEach, describe, expect, it, vi } from 'vitest';

const operatorMocks = vi.hoisted(() => ({
  initializeOperator: vi.fn(), ownerSession: vi.fn(), requireFunctions: vi.fn(), parseOperatorOptions: vi.fn()
}));
vi.mock('../../scripts/public-delivery-operator.mjs', async importOriginal => ({
  ...(await importOriginal()), ...operatorMocks
}));
vi.mock('../../functions/lib/core.js', () => ({
  auditData: (_actor, action, _type, _id, _reason, metadata) => ({ action, metadata })
}));

import {
  ensureIamVerificationApi, iamVerificationApiPlan, IAM_PROPAGATION_DELAYS_MS,
  IAM_PROPAGATION_TIMEOUT_MS, IAM_VERIFICATION_API, infrastructureFailure,
  isCustomRolePropagationFailure, main, putBucketIamWithPropagationRetry
} from '../../scripts/provision-public-delivery.mjs';
import { DeliveryOperatorError } from '../../scripts/public-delivery-operator.mjs';

const projectId = 'kanata-memorial-admin';
const projectNumber = '123';
const role = `projects/${projectId}/roles/publicFeedSnapshotReader`;
const missingRoleBody = (name = role) => ({ error: {
  message: `Role (${name}) does not exist in the resource's hierarchy.`
} });
const propagationFailure = () => infrastructureFailure('PUT', 400, missingRoleBody(), [role]);
const serviceUrl = `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${IAM_VERIFICATION_API}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.values(operatorMocks).forEach(mock => mock.mockReset());
});

describe('snapshot IAM role propagation retry', () => {
  it('recognizes the actual Storage parenthesized role/hierarchy sentence and exact controlled aliases', () => {
    expect(isCustomRolePropagationFailure(400, missingRoleBody(), [role])).toBe(true);
    for (const message of [`Role ${role} does not exist.`, `Role '${role}' was not found.`,
      `Role "${role}" is not found.`, `Role \`${role}\` does not exist in the resource’s hierarchy.`]) {
      expect(isCustomRolePropagationFailure(400, { error: { message } }, [role])).toBe(true);
    }
    expect(isCustomRolePropagationFailure(400, { error: { errors: [{ message: missingRoleBody().error.message }] } }, [role]))
      .toBe(true);
  });

  it('does not retry unrelated 400, different roles/projects, broader error text, 403 or 412', () => {
    for (const status of [403, 404, 409, 412, 429, 500]) {
      expect(isCustomRolePropagationFailure(status, missingRoleBody(), [role])).toBe(false);
    }
    for (const body of [null, {}, { error: { message: 'Invalid condition expression.' } },
      missingRoleBody(role.replace(projectId, 'other-project')),
      missingRoleBody(role.replace('publicFeedSnapshotReader', 'publicFeedSnapshotWriter')),
      missingRoleBody(role.toLowerCase()),
      { error: { message: `${missingRoleBody().error.message} Permission denied.` } },
      { error: { message: `Permission denied. ${missingRoleBody().error.message}` } }]) {
      expect(isCustomRolePropagationFailure(400, body, [role])).toBe(false);
    }
    expect(isCustomRolePropagationFailure(400, missingRoleBody(), [])).toBe(false);
  });

  it('accepts a structured missing-role reason only when it names a controlled role', () => {
    const body = (reason, name, type = 'type.googleapis.com/google.rpc.ErrorInfo') => ({ error: { details: [{
      '@type': type, reason, metadata: { role: name }
    }] } });
    expect(isCustomRolePropagationFailure(400, body('IAM_ROLE_NOT_FOUND', role), [role])).toBe(true);
    expect(isCustomRolePropagationFailure(400, body('ROLE_NOT_FOUND', role), [role])).toBe(true);
    expect(isCustomRolePropagationFailure(400, body('PERMISSION_DENIED', role), [role])).toBe(false);
    expect(isCustomRolePropagationFailure(400, body('ROLE_NOT_FOUND', `${role}Other`), [role])).toBe(false);
    expect(isCustomRolePropagationFailure(400, body('ROLE_NOT_FOUND', role, 'other-type'), [role])).toBe(false);
  });

  it('retains only a safe error category without raw response, token or policy data', () => {
    const body = { ...missingRoleBody(), token: 'private-fixture-token', policy: { etag: 'private-fixture-etag' } };
    const error = infrastructureFailure('PUT', 400, body, [role]);
    expect(error).toBeInstanceOf(DeliveryOperatorError);
    expect(error.httpStatus).toBe(400);
    expect(error.customRolePropagation).toBe(true);
    expect(`${error.message} ${JSON.stringify(error)}`).not.toMatch(/private-fixture|publicFeedSnapshotReader|hierarchy/);
  });

  it('retries eventual propagation while preserving the same policy etag and bindings', async () => {
    const policy = { etag: 'etag-original', bindings: [{ role, members: ['serviceAccount:reader@example.test'] }] };
    const payloads = [];
    let elapsed = 0;
    const pause = vi.fn(async delay => { elapsed += delay; });
    const write = vi.fn(async timeout => {
      payloads.push({ timeout, body: JSON.stringify(policy) });
      if (payloads.length < 3) throw propagationFailure();
      return { etag: 'etag-new' };
    });
    await expect(putBucketIamWithPropagationRetry(write, { pause, now: () => elapsed })).resolves.toEqual({ etag: 'etag-new' });
    expect(pause.mock.calls.flat()).toEqual([5000, 10000]);
    expect(write).toHaveBeenCalledTimes(3);
    expect(new Set(payloads.map(entry => entry.body)).size).toBe(1);
    expect(payloads.every(entry => entry.timeout === 30_000)).toBe(true);
    expect(policy.etag).toBe('etag-original');
  });

  it('exhausts at eight attempts with 155 seconds of backoff and a sanitized actionable failure', async () => {
    let elapsed = 0;
    const pause = vi.fn(async delay => { elapsed += delay; });
    const write = vi.fn(async () => { throw propagationFailure(); });
    await expect(putBucketIamWithPropagationRetry(write, { pause, now: () => elapsed }))
      .rejects.toThrow(/still propagating after bounded IAM retries/);
    expect(write).toHaveBeenCalledTimes(8);
    expect(pause.mock.calls.flat()).toEqual([...IAM_PROPAGATION_DELAYS_MS]);
    expect(elapsed).toBe(155_000);
    expect(elapsed).toBeLessThan(IAM_PROPAGATION_TIMEOUT_MS);
    expect(write.mock.calls.map(([timeout]) => timeout)).toEqual([
      30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 25_000
    ]);
  });

  it('includes request time in the 180-second deadline and stops before backoff would exceed it', async () => {
    let elapsed = 0;
    const timeouts = [];
    const pause = vi.fn(async delay => { elapsed += delay; });
    const write = vi.fn(async timeout => {
      timeouts.push(timeout);
      elapsed += timeout;
      throw propagationFailure();
    });
    await expect(putBucketIamWithPropagationRetry(write, { pause, now: () => elapsed })).rejects.toThrow(/bounded IAM retries/);
    expect(timeouts).toEqual([30_000, 30_000, 30_000, 30_000]);
    expect(elapsed).toBe(155_000);
    expect(elapsed).toBeLessThan(IAM_PROPAGATION_TIMEOUT_MS);
    expect(pause.mock.calls.flat()).toEqual([5000, 10000, 20_000]);
    expect(write).toHaveBeenCalledTimes(4);
  });

  it('also bounds attempts and sleep if the wall clock stays still', async () => {
    const pause = vi.fn(async () => {});
    const write = vi.fn(async () => { throw propagationFailure(); });
    await expect(putBucketIamWithPropagationRetry(write, { pause, now: () => 0 })).rejects.toThrow(/bounded IAM retries/);
    expect(write).toHaveBeenCalledTimes(8);
    expect(pause.mock.calls.flat().reduce((sum, delay) => sum + delay, 0)).toBe(155_000);
  });

  it.each([
    ['unrelated 400', () => infrastructureFailure('PUT', 400, { error: { message: 'Invalid IAM condition' } }, [role])],
    ['permission 403', () => infrastructureFailure('PUT', 403, missingRoleBody(), [role])],
    ['etag 412', () => infrastructureFailure('PUT', 412, missingRoleBody(), [role])],
    ['timeout', () => Object.assign(new Error('fixture timeout'), { name: 'TimeoutError' })],
    ['network failure', () => new TypeError('fixture network failure')]
  ])('stops immediately for %s even after a propagation retry', async (_label, makeError) => {
    const error = makeError();
    const pause = vi.fn(async () => {});
    const initialWrite = vi.fn().mockRejectedValue(error);
    await expect(putBucketIamWithPropagationRetry(initialWrite, { pause, now: () => 0 })).rejects.toBe(error);
    expect(initialWrite).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
    const write = vi.fn().mockRejectedValueOnce(propagationFailure()).mockRejectedValue(error);
    await expect(putBucketIamWithPropagationRetry(write, { pause, now: () => 0 })).rejects.toBe(error);
    expect(write).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

describe('IAM verification API prerequisite', () => {
  it('plans enable/reuse only for known Service Usage states', () => {
    expect(iamVerificationApiPlan({ state: 'ENABLED' })).toEqual({ name: IAM_VERIFICATION_API, action: 'reuse-enabled', maxEnablePolls: 30 });
    expect(iamVerificationApiPlan({ state: 'DISABLED' })).toEqual({ name: IAM_VERIFICATION_API, action: 'enable', maxEnablePolls: 30 });
    for (const state of [undefined, 'UNKNOWN', 'ENABLING']) expect(() => iamVerificationApiPlan({ state })).toThrow(/cannot be verified/);
  });

  it('rechecks an enabled API without making any mutation', async () => {
    const request = vi.fn(async () => ({ state: 'ENABLED' }));
    await ensureIamVerificationApi(projectNumber, request);
    expect(request.mock.calls).toEqual([[serviceUrl]]);
    await expect(ensureIamVerificationApi('123/other', request)).rejects.toThrow(/verified project number/);
    expect(request).toHaveBeenCalledOnce();
  });

  it('enables exactly the approved API, polls its operation, and confirms enabled state before returning', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ state: 'DISABLED' })
      .mockResolvedValueOnce({ name: 'operations/verification.123' })
      .mockResolvedValueOnce({ done: true })
      .mockResolvedValueOnce({ state: 'ENABLED' });
    const pause = vi.fn(async () => {});
    await ensureIamVerificationApi(projectNumber, request, { now: () => 0, pause });
    expect(request.mock.calls).toEqual([
      [serviceUrl], [`${serviceUrl}:enable`, 'POST', {}],
      ['https://serviceusage.googleapis.com/v1/operations/verification.123'], [serviceUrl]
    ]);
    expect(pause).toHaveBeenCalledWith(2000);
  });

  it('stops on enable errors, invalid operation URLs, unconfirmed state and exhausted polling', async () => {
    for (const operation of [{ done: true, error: { message: 'private-operation-detail' } },
      { name: 'https://other.test/operation' }]) {
      const request = vi.fn().mockResolvedValueOnce({ state: 'DISABLED' }).mockResolvedValueOnce(operation);
      await expect(ensureIamVerificationApi(projectNumber, request)).rejects.toThrow(/bounded checks; no IAM writes/);
      expect(request).toHaveBeenCalledTimes(2);
    }
    const unconfirmed = vi.fn().mockResolvedValueOnce({ state: 'DISABLED' })
      .mockResolvedValueOnce({ done: true }).mockResolvedValueOnce({ state: 'DISABLED' });
    await expect(ensureIamVerificationApi(projectNumber, unconfirmed)).rejects.toThrow(/not enabled; no IAM writes/);
    const pending = vi.fn().mockResolvedValueOnce({ state: 'DISABLED' })
      .mockResolvedValueOnce({ name: 'operations/verification.123' })
      .mockResolvedValue({ name: 'operations/verification.123' });
    await expect(ensureIamVerificationApi(projectNumber, pending, { now: () => 0, pause: async () => {} }))
      .rejects.toThrow(/bounded checks; no IAM writes/);
    expect(pending).toHaveBeenCalledTimes(32);
  });
});

function fakeInfrastructure({ apply = false, serviceState = 'DISABLED', enableError = false,
  unauthorizedOwner = false, bucketPutStatus = 200 } = {}) {
  const bucketName = `${projectId}-public-snapshots`;
  const writer = `publisher@${projectId}.iam.gserviceaccount.com`;
  const projectUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`;
  const iamUrl = `https://iam.googleapis.com/v1/projects/${projectId}`;
  const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}`;
  const queueName = `projects/${projectId}/locations/asia-east1/queues/publishPublicSnapshots`;
  const queueUrl = `https://cloudtasks.googleapis.com/v2/${queueName}`;
  const writerUrl = `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(writer)}`;
  const readerUrl = `${iamUrl}/serviceAccounts/public-feed-reader@${projectId}.iam.gserviceaccount.com`;
  const bucket = { projectNumber, metageneration: '1', iamConfiguration: {
    uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' }, lifecycle: { rule: [] } };
  const events = [];
  const requests = [];
  let enabled = serviceState === 'ENABLED';
  let bucketAttempts = 0;
  let resolveFirstBucketWrite;
  const firstBucketWrite = new Promise(resolve => { resolveFirstBucketWrite = resolve; });
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
  const existingRoles = {
    publicFeedSnapshotReader: ['storage.objects.get'],
    publicFeedSnapshotWriter: ['storage.objects.get', 'storage.objects.create', 'storage.objects.delete', 'storage.objects.update'],
    publicFeedSnapshotMetadataReader: ['storage.buckets.get'],
    publicFeedWorkerMetadataReader: ['cloudfunctions.functions.get']
  };
  const fetch = vi.fn(async (url, init) => {
    const method = init.method;
    requests.push({ url, method, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    if (url === projectUrl && method === 'GET') return response({ projectId, projectNumber, lifecycleState: 'ACTIVE' });
    if ([bucketUrl, `${bucketUrl}?projection=full`].includes(url) && method === 'GET') return response(bucket);
    if (url === `${bucketUrl}/iam?optionsRequestedPolicyVersion=3` && method === 'GET') return response({ etag: 'bucket-etag', version: 3, bindings: [] });
    if (url === `${projectUrl}:getIamPolicy` && method === 'POST') return response({ etag: 'project-etag', bindings: [] });
    if (url === readerUrl && method === 'GET') return response({ disabled: false });
    if (url === writerUrl && method === 'GET') return response({ disabled: false, projectId, email: writer });
    if ((url === queueUrl || url.startsWith('https://cloudfunctions.googleapis.com/')) && method === 'GET') return response({}, 404);
    if (url === serviceUrl || url === serviceUrl.replace(projectNumber, projectId)) {
      if (enabled && url === serviceUrl) events.push('verification-api-ready');
      return response({ state: enabled ? 'ENABLED' : 'DISABLED' });
    }
    for (const [id, includedPermissions] of Object.entries(existingRoles)) {
      if (url === `${iamUrl}/roles/${id}` && method === 'GET') return response({ stage: 'GA', includedPermissions });
    }
    if (url === `${serviceUrl}:enable` && method === 'POST') {
      events.push('verification-api-enable');
      if (enableError) return response({ error: { message: 'private-api-error' } }, 403);
      enabled = true;
      return response({ done: true });
    }
    if (url === `${bucketUrl}/iam` && method === 'PUT') {
      events.push('bucket-iam-write');
      const status = Array.isArray(bucketPutStatus) ? bucketPutStatus[bucketAttempts] : bucketPutStatus;
      bucketAttempts++;
      resolveFirstBucketWrite();
      return response(status === 200 ? {} : missingRoleBody(), status);
    }
    if (url === 'https://policytroubleshooter.googleapis.com/v1/iam:troubleshoot') {
      events.push('reader-denial-verification');
      return response({ access: 'NOT_GRANTED' });
    }
    if (url.endsWith(':getIamPolicy')) return response({ etag: 'fixture-etag', bindings: [] });
    if (url.endsWith(':setIamPolicy')) return response({});
    if (url === `${bucketUrl}?ifMetagenerationMatch=1` && method === 'PATCH') return response({});
    if (url === `https://cloudtasks.googleapis.com/v2/projects/${projectId}/locations/asia-east1/queues` && method === 'POST') return response({});
    throw new Error('Unexpected fixture request');
  });
  vi.stubGlobal('fetch', fetch);
  operatorMocks.parseOperatorOptions.mockReturnValue({ project: projectId, bucket: bucketName, writerServiceAccount: writer,
    apply, ownerUid: 'fixture-owner', reason: 'Fixture provision verification' });
  const db = {
    collection: name => ({ doc: id => ({ name, id }), add: async data => { events.push(data.action); } }),
    runTransaction: async callback => {
      await callback({
        get: async () => ({ exists: true, data: () => ({ disabled: false, role: unauthorizedOwner ? 'moderator' : 'owner', sessionVersion: 1 }) }),
        create: (_reference, data) => { events.push(data.action); }
      });
      events.push('owner-audit-committed');
    },
    terminate: vi.fn(async () => {})
  };
  operatorMocks.initializeOperator.mockReturnValue({ app: {}, db, credential: { getAccessToken: async () => ({ access_token: 'private-fixture-token' }) } });
  operatorMocks.ownerSession.mockImplementation(async (_operator, _options, callback) => {
    events.push('owner-authorized');
    return callback({ uid: 'fixture-owner', role: 'owner', sessionVersion: 1 });
  });
  const deleteApp = vi.fn(async () => {});
  operatorMocks.requireFunctions.mockImplementation(name => {
    if (name !== 'firebase-admin/app') throw new Error('Unexpected fixture dependency');
    return { deleteApp };
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  return { events, requests, fetch, db, deleteApp, log, bucketUrl, writer, bucketName, firstBucketWrite };
}

describe('provision CLI prerequisite and CAS integration', () => {
  it.each(['DISABLED', 'ENABLED'])('shows %s verification API enable/reuse in dry-run without Owner session or writes', async serviceState => {
    const fixture = fakeInfrastructure({ serviceState });
    await main([]);
    const plan = JSON.parse(fixture.log.mock.calls[0][0]);
    expect(plan.mode).toBe('dry-run');
    expect(plan.iamVerificationApi).toMatchObject({ name: IAM_VERIFICATION_API, action: serviceState === 'ENABLED' ? 'reuse-enabled' : 'enable' });
    expect(plan.bucketIamPropagationRetry).toEqual({ maxAttempts: 8, maxElapsedSeconds: 180 });
    expect(operatorMocks.ownerSession).not.toHaveBeenCalled();
    expect(fixture.requests.every(request => request.method === 'GET' || request.url.endsWith(':getIamPolicy'))).toBe(true);
    expect(fixture.db.terminate).toHaveBeenCalledOnce();
    expect(fixture.deleteApp).toHaveBeenCalledOnce();
  });

  it('commits the Owner audit, enables only verification API, then writes private IAM and verifies inherited denial', async () => {
    const fixture = fakeInfrastructure({ apply: true });
    await main([]);
    const { events, requests } = fixture;
    expect(events.indexOf('owner-audit-committed')).toBeLessThan(events.indexOf('verification-api-enable'));
    expect(events.indexOf('verification-api-enable')).toBeLessThan(events.indexOf('verification-api-ready'));
    expect(events.indexOf('verification-api-ready')).toBeLessThan(events.indexOf('bucket-iam-write'));
    expect(events.filter(event => event === 'reader-denial-verification')).toHaveLength(2);
    expect(events.at(-1)).toBe('public_delivery.infrastructure_provisioned');
    const enables = requests.filter(request => request.url.endsWith(':enable'));
    expect(enables).toEqual([{ url: `${serviceUrl}:enable`, method: 'POST', body: {} }]);
    expect(requests.some(request => request.method === 'POST' && /\/roles$|\/serviceAccounts$/.test(request.url))).toBe(false);
    const bucketWrite = requests.find(request => request.method === 'PUT');
    expect(bucketWrite.url).toBe(`${fixture.bucketUrl}/iam`);
    expect(bucketWrite.body.etag).toBe('bucket-etag');
    expect(bucketWrite.body.bindings).toHaveLength(3);
    expect(bucketWrite.body.bindings[0]).toMatchObject({ role, members: [`serviceAccount:public-feed-reader@${projectId}.iam.gserviceaccount.com`],
      condition: { expression: `resource.name.startsWith('projects/_/buckets/${fixture.bucketName}/objects/public-snapshots/')` } });
    const queueWrite = requests.find(request => request.url.endsWith('/queues') && request.method === 'POST');
    expect(queueWrite.body.queue.rateLimits).toEqual({ maxDispatchesPerSecond: 0.5, maxConcurrentDispatches: 1 });
    expect(queueWrite.body.queue.retryConfig.maxAttempts).toBe(3);
    expect(requests.filter(request => request.url.endsWith('iam:troubleshoot')).map(request => request.body.accessTuple.permission))
      .toEqual(['datastore.entities.get', 'datastore.entities.list']);
    expect(requests.some(request => /billing|\.appspot\.com|\.firebasestorage\.app/.test(request.url))).toBe(false);
    expect(fixture.log.mock.calls.join(' ')).not.toContain('private-fixture-token');
  });

  it('reuses enabled verification API and existing reader/custom roles without creating them again', async () => {
    const fixture = fakeInfrastructure({ apply: true, serviceState: 'ENABLED' });
    await main([]);
    expect(fixture.requests.some(request => request.url.endsWith(':enable'))).toBe(false);
    expect(fixture.requests.some(request => request.method === 'POST' && /\/roles$|\/serviceAccounts$/.test(request.url))).toBe(false);
    expect(fixture.events.indexOf('owner-audit-committed')).toBeLessThan(fixture.events.indexOf('verification-api-ready'));
    expect(fixture.events.indexOf('verification-api-ready')).toBeLessThan(fixture.events.indexOf('bucket-iam-write'));
  });

  it('stops before IAM writes when verification API enable is denied, without logging its raw error', async () => {
    const fixture = fakeInfrastructure({ apply: true, enableError: true });
    await expect(main([])).rejects.toThrow(/Infrastructure POST failed \(403\)/);
    expect(fixture.events).toContain('owner-audit-committed');
    expect(fixture.events).not.toContain('bucket-iam-write');
    expect(fixture.requests.some(request => request.method === 'PUT' || request.url.endsWith(':setIamPolicy'))).toBe(false);
    expect(fixture.log.mock.calls.join(' ')).not.toMatch(/private-api-error|private-fixture-token/);
    expect(fixture.db.terminate).toHaveBeenCalledOnce();
  });

  it('retains the transaction Owner guard before enabling any service', async () => {
    const fixture = fakeInfrastructure({ apply: true, unauthorizedOwner: true });
    await expect(main([])).rejects.toThrow(/Owner authorization changed/);
    expect(fixture.requests.some(request => request.url.endsWith(':enable') || request.method === 'PUT' || request.url.endsWith(':setIamPolicy'))).toBe(false);
  });

  it('retries the actual role/hierarchy HTTP 400 with identical etag policy before creating the queue', async () => {
    vi.useFakeTimers();
    const fixture = fakeInfrastructure({ apply: true, bucketPutStatus: [400, 200] });
    const provision = main([]);
    await fixture.firstBucketWrite;
    await vi.runAllTimersAsync();
    await provision;
    const writes = fixture.requests.filter(request => request.method === 'PUT');
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toEqual(writes[1].body);
    expect(writes[0].body.etag).toBe('bucket-etag');
    const queueIndex = fixture.requests.findIndex(request => request.url.endsWith('/queues') && request.method === 'POST');
    expect(queueIndex).toBeGreaterThan(fixture.requests.lastIndexOf(writes[1]));
    expect(fixture.log.mock.calls.join(' ')).not.toMatch(/hierarchy|bucket-etag|private-fixture-token/);
  });

  it('does not retry a conflicting bucket etag or continue to create the queue', async () => {
    const fixture = fakeInfrastructure({ apply: true, bucketPutStatus: 412 });
    await expect(main([])).rejects.toThrow(/Infrastructure PUT failed \(412\)/);
    expect(fixture.requests.filter(request => request.method === 'PUT')).toHaveLength(1);
    expect(fixture.requests.some(request => request.url.endsWith('/queues') && request.method === 'POST')).toBe(false);
    expect(fixture.events).not.toContain('public_delivery.infrastructure_provisioned');
  });
});
