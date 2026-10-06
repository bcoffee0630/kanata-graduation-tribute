import { describe, expect, it, vi } from 'vitest';
import { assertReaderFirestoreDenied, assertReaderSnapshotStorageIsolation, IAM_TROUBLESHOOTER_URL,
  STORAGE_IAM_TROUBLESHOOTER_URL, verifyReaderFirestoreIsolation, verifyReaderSnapshotStorageIsolation } from '../../scripts/public-delivery-iam-verification.mjs';

const project = 'snapshot-project';
const reader = `public-feed-reader@${project}.iam.gserviceaccount.com`;
const resource = `//cloudresourcemanager.googleapis.com/projects/${project}`;
const other = 'user:other@example.test';

function denied() {
  return { access: 'NOT_GRANTED', explainedPolicies: [{ access: 'NOT_GRANTED', fullResourceName: resource,
    policy: { etag: 'visible-policy', bindings: [{ role: 'roles/datastore.user', members: [other] }] },
    bindingExplanations: [{ access: 'NOT_GRANTED', role: 'roles/datastore.user', rolePermission: 'ROLE_PERMISSION_INCLUDED',
      memberships: { [other]: { membership: 'MEMBERSHIP_NOT_INCLUDED' } } }] }] };
}

describe('complete reader Firestore IAM denial', () => {
  it('uses supported project policy targets and checks both datastore permissions with the plain reader identity', async () => {
    const api = vi.fn(async () => denied());
    await expect(verifyReaderFirestoreIsolation({ project, reader, api })).resolves.toEqual({
      access: 'NOT_GRANTED', scope: 'project-hierarchy', permissions: ['datastore.entities.get', 'datastore.entities.list']
    });
    expect(api.mock.calls.map(([url, options]) => ({ url, method: options.method, body: JSON.parse(options.body) }))).toEqual(
      ['datastore.entities.get', 'datastore.entities.list'].map(permission => ({ url: IAM_TROUBLESHOOTER_URL, method: 'POST',
        body: { accessTuple: { principal: reader, fullResourceName: resource, permission } } })));
  });

  it('accepts fully visible empty protobuf policies only when their explanation is empty too', () => {
    for (const explicit of [false, true]) {
      const data = { access: 'NOT_GRANTED', explainedPolicies: [{ access: 'NOT_GRANTED', fullResourceName: resource,
        policy: { etag: 'visible-empty-policy', ...(explicit ? { bindings: [] } : {}) },
        ...(explicit ? { bindingExplanations: [] } : {}) }] };
      expect(assertReaderFirestoreDenied(data, { project })).toBe(true);
    }
  });

  it('rejects a conditional per-database reader grant even when its project evaluation and overall state say NOT_GRANTED', () => {
    const data = denied(); const policy = data.explainedPolicies[0];
    const condition = { expression: `resource.name == 'projects/${project}/databases/(default)'` };
    policy.policy.bindings[0] = { role: 'roles/datastore.user', members: [`serviceAccount:${reader}`], condition };
    policy.bindingExplanations[0] = { access: 'NOT_GRANTED', role: 'roles/datastore.user', rolePermission: 'ROLE_PERMISSION_INCLUDED',
      condition, memberships: { [`serviceAccount:${reader}`]: { membership: 'MEMBERSHIP_INCLUDED' } } };
    expect(() => assertReaderFirestoreDenied(data, { project })).toThrow(/NOT_GRANTED/);
  });

  it('also rejects unconditional and inherited potential grants, and permits reader roles excluding datastore permissions', () => {
    const data = denied(); const policy = data.explainedPolicies[0];
    policy.policy.bindings[0].members = [`serviceAccount:${reader}`];
    policy.bindingExplanations[0].memberships = { [`serviceAccount:${reader}`]: { membership: 'MEMBERSHIP_INCLUDED' } };
    expect(() => assertReaderFirestoreDenied(data, { project })).toThrow();
    const inherited = structuredClone(policy); inherited.fullResourceName = '//cloudresourcemanager.googleapis.com/organizations/123';
    const withParent = denied(); withParent.explainedPolicies.push(inherited);
    expect(() => assertReaderFirestoreDenied(withParent, { project })).toThrow();
    policy.bindingExplanations[0].rolePermission = 'ROLE_PERMISSION_NOT_INCLUDED';
    expect(assertReaderFirestoreDenied(data, { project })).toBe(true);
  });

  it.each(['UNKNOWN_CONDITIONAL', 'UNKNOWN_INFO_DENIED', 'GRANTED', undefined])('rejects incomplete overall %s access', access => {
    const data = denied(); data.access = access;
    expect(() => assertReaderFirestoreDenied(data, { project })).toThrow();
  });

  it.each(['ROLE_PERMISSION_UNKNOWN_INFO', undefined])('rejects unknown permission inclusion %s', value => {
    const data = denied(); data.explainedPolicies[0].bindingExplanations[0].rolePermission = value;
    expect(() => assertReaderFirestoreDenied(data, { project })).toThrow();
  });

  it.each(['MEMBERSHIP_UNKNOWN_INFO_DENIED', 'MEMBERSHIP_UNKNOWN_UNSUPPORTED', undefined])('rejects unknown membership %s', value => {
    const data = denied(); data.explainedPolicies[0].bindingExplanations[0].memberships[other].membership = value;
    expect(() => assertReaderFirestoreDenied(data, { project })).toThrow();
  });

  it('requires a one-to-one policy/explanation/member matrix and known policy hierarchy', () => {
    const mutations = [
      data => { data.explainedPolicies[0].bindingExplanations = []; },
      data => { data.explainedPolicies[0].policy.bindings.push(structuredClone(data.explainedPolicies[0].policy.bindings[0])); },
      data => { data.explainedPolicies[0].bindingExplanations[0].role = 'roles/editor'; },
      data => { data.explainedPolicies[0].bindingExplanations[0].memberships = {}; },
      data => { data.explainedPolicies[0].bindingExplanations[0].condition = { expression: 'true' }; },
      data => { delete data.explainedPolicies[0].policy.etag; },
      data => { data.explainedPolicies[0].fullResourceName = '//cloudresourcemanager.googleapis.com/projects/other-project'; },
      data => { data.explainedPolicies.push(structuredClone(data.explainedPolicies[0])); },
      data => { data.errors = [{ code: 13, message: 'private-api-error' }]; },
      data => { data.explainedPolicies[0].errors = [{ code: 13 }]; }
    ];
    for (const change of mutations) { const data = denied(); change(data); expect(() => assertReaderFirestoreDenied(data, { project })).toThrow(); }
  });

  it('keeps failures sanitized and inspects both independent API results', async () => {
    const data = denied(); data.errors = [{ code: 13, message: 'private-api-error' }];
    expect(() => assertReaderFirestoreDenied(data, { project })).toThrow(/complete inherited IAM bindings/);
    try { assertReaderFirestoreDenied(data, { project }); } catch (error) { expect(error.message).not.toContain('private-api-error'); }
    const api = vi.fn(async (_url, options) => JSON.parse(options.body).accessTuple.permission.endsWith('.get') ? denied() : data);
    await expect(verifyReaderFirestoreIsolation({ project, reader, api })).rejects.toThrow(/NOT_GRANTED/);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('refuses other principals and invalid project names before making any requests', async () => {
    const api = vi.fn();
    for (const inputs of [{ project, reader: `serviceAccount:${reader}` }, { project: '../other', reader }, { project, reader: 'other@example.test' }]) {
      await expect(verifyReaderFirestoreIsolation({ ...inputs, api })).rejects.toThrow();
    }
    expect(api).not.toHaveBeenCalled();
  });
});

function storageProof() {
  const bucketName = 'dedicated-private-snapshots';
  const bucketResource = `//storage.googleapis.com/projects/_/buckets/${bucketName}`;
  const role = `projects/${project}/roles/publicFeedSnapshotReader`;
  const condition = { title: 'private-public-snapshot-prefix',
    expression: `resource.name.startsWith('projects/_/buckets/${bucketName}/objects/public-snapshots/')` };
  const member = `serviceAccount:${reader}`;
  const binding = { role, members: [member], condition };
  const row = { role, condition, rolePermission: 'ROLE_PERMISSION_INCLUDED', allowAccessState: 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL',
    combinedMembership: { membership: 'MEMBERSHIP_MATCHED' }, memberships: { [member]: { membership: 'MEMBERSHIP_MATCHED' } },
    conditionExplanation: { value: false } };
  const data = { overallAccessState: 'UNKNOWN_CONDITIONAL',
    allowPolicyExplanation: { allowAccessState: 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL', explainedPolicies: [
      { fullResourceName: bucketResource, allowAccessState: 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL',
        policy: { version: 3, bindings: [structuredClone(binding)] }, bindingExplanations: [row] },
      { fullResourceName: resource, allowAccessState: 'ALLOW_ACCESS_STATE_NOT_GRANTED',
        policy: { etag: 'project-policy', bindings: [] }, bindingExplanations: [] }
    ] }, denyPolicyExplanation: { denyAccessState: 'DENY_ACCESS_STATE_NOT_DENIED' } };
  const options = { project, reader, bucketName, bucketPolicy: { etag: 'bucket-policy', version: 3, bindings: [binding] },
    roleDefinition: { name: role, stage: 'GA', includedPermissions: ['storage.objects.get'] } };
  return { data, options, binding, row, bucketResource, role };
}

describe('fixed-prefix Storage allow-policy proof', () => {
  it('proves no outside-prefix allow grant without claiming that UNKNOWN_CONDITIONAL grants an effective read', () => {
    const { data, options } = storageProof();
    expect(assertReaderSnapshotStorageIsolation(data, options)).toEqual({
      method: 'complete-v3-allow-matrix-and-fixed-literal-get-only-prefix', outsidePrefix: 'NO_ALLOW_GRANT',
      otherStoragePermissions: 'NO_ALLOW_GRANT', insidePrefixRead: 'REQUIRES_ACTUAL_READER_FEED_200', denyEvaluation: 'NOT_DENIED'
    });
    data.overallAccessState = 'CANNOT_ACCESS';
    data.allowPolicyExplanation.allowAccessState = 'ALLOW_ACCESS_STATE_NOT_GRANTED';
    data.allowPolicyExplanation.explainedPolicies[0].allowAccessState = 'ALLOW_ACCESS_STATE_NOT_GRANTED';
    data.allowPolicyExplanation.explainedPolicies[0].bindingExplanations[0].allowAccessState = 'ALLOW_ACCESS_STATE_NOT_GRANTED';
    expect(assertReaderSnapshotStorageIsolation(data, options).insidePrefixRead).toBe('REQUIRES_ACTUAL_READER_FEED_200');
    data.overallAccessState = 'CAN_ACCESS';
    data.allowPolicyExplanation.allowAccessState = 'ALLOW_ACCESS_STATE_GRANTED';
    data.allowPolicyExplanation.explainedPolicies[0].allowAccessState = 'ALLOW_ACCESS_STATE_GRANTED';
    data.allowPolicyExplanation.explainedPolicies[0].bindingExplanations[0].allowAccessState = 'ALLOW_ACCESS_STATE_GRANTED';
    data.allowPolicyExplanation.explainedPolicies[0].bindingExplanations[0].conditionExplanation.value = true;
    expect(assertReaderSnapshotStorageIsolation(data, options).insidePrefixRead).toBe('REQUIRES_ACTUAL_READER_FEED_200');
  });

  it('uses only v3 bucket context and the actual custom role, not unsupported object resources or v1 error bypasses', async () => {
    const { data, options, bucketResource, role } = storageProof();
    const api = vi.fn(async url => url === STORAGE_IAM_TROUBLESHOOTER_URL ? data : options.roleDefinition);
    await expect(verifyReaderSnapshotStorageIsolation({ ...options, api })).resolves.toMatchObject({ outsidePrefix: 'NO_ALLOW_GRANT' });
    expect(api.mock.calls).toEqual([
      [STORAGE_IAM_TROUBLESHOOTER_URL, { method: 'POST', body: JSON.stringify({ accessTuple: {
        principal: reader, fullResourceName: bucketResource, permission: 'storage.objects.get', conditionContext: { resource: {
          service: 'storage.googleapis.com', type: 'storage.googleapis.com/Object',
          name: `projects/_/buckets/${options.bucketName}/objects/public-snapshots/current.json`
        } }
      } }) }], [`https://iam.googleapis.com/v1/${role}`]
    ]);
  });

  it('rejects extra matching grants, including roles that grant only create/delete and omit get', () => {
    for (const permission of ['ROLE_PERMISSION_INCLUDED', 'ROLE_PERMISSION_NOT_INCLUDED']) {
      const { data, options } = storageProof();
      const policy = data.allowPolicyExplanation.explainedPolicies[0];
      const extra = { role: 'roles/storage.objectCreator', members: [`serviceAccount:${reader}`] };
      policy.policy.bindings.push(extra); options.bucketPolicy.bindings.push(structuredClone(extra));
      policy.bindingExplanations.push({ role: extra.role, rolePermission: permission,
        allowAccessState: 'ALLOW_ACCESS_STATE_NOT_GRANTED', combinedMembership: { membership: 'MEMBERSHIP_MATCHED' },
        memberships: { [`serviceAccount:${reader}`]: { membership: 'MEMBERSHIP_MATCHED' } } });
      expect(() => assertReaderSnapshotStorageIsolation(data, options)).toThrow(/Storage isolation/);
    }
  });

  it('rejects inherited and group/domain grants even when they use the expected prefix or currently evaluate false', () => {
    const inherited = storageProof();
    const parent = inherited.data.allowPolicyExplanation.explainedPolicies[1];
    parent.policy.bindings.push(structuredClone(inherited.binding));
    parent.bindingExplanations.push(structuredClone(inherited.row));
    expect(() => assertReaderSnapshotStorageIsolation(inherited.data, inherited.options)).toThrow();
    const group = storageProof(); const member = 'group:readers@example.test';
    group.data.allowPolicyExplanation.explainedPolicies[0].policy.bindings[0].members = [member];
    group.options.bucketPolicy.bindings[0].members = [member];
    group.row.memberships = { [member]: { membership: 'MEMBERSHIP_MATCHED' } };
    expect(() => assertReaderSnapshotStorageIsolation(group.data, group.options)).toThrow();
  });

  it.each(['true', "resource.name.startsWith('projects/_/buckets/other/objects/')", "resource.name.startsWith('public-snapshots/') || true"])
    ('rejects any different conditional expression %s', expression => {
      const { data, options, row } = storageProof();
      const condition = { expression };
      row.condition = condition;
      data.allowPolicyExplanation.explainedPolicies[0].policy.bindings[0].condition = condition;
      options.bucketPolicy.bindings[0].condition = condition;
      expect(() => assertReaderSnapshotStorageIsolation(data, options)).toThrow();
    });

  it('rejects unknown membership, permission, allow state, deny state and inconsistent combined membership', () => {
    const changes = [
      ({ data }) => { data.overallAccessState = 'UNKNOWN_INFO'; },
      ({ data }) => { data.denyPolicyExplanation.denyAccessState = 'DENY_ACCESS_STATE_UNKNOWN_INFO'; },
      ({ data }) => { data.denyPolicyExplanation.denyAccessState = 'DENY_ACCESS_STATE_UNKNOWN_CONDITIONAL'; },
      ({ data }) => { data.allowPolicyExplanation.allowAccessState = 'ALLOW_ACCESS_STATE_UNKNOWN_INFO'; },
      ({ row }) => { row.rolePermission = 'ROLE_PERMISSION_UNKNOWN_INFO'; },
      ({ row }) => { row.memberships[`serviceAccount:${reader}`].membership = 'MEMBERSHIP_UNKNOWN_INFO'; },
      ({ row }) => { row.combinedMembership.membership = 'MEMBERSHIP_UNKNOWN_INFO'; },
      ({ row }) => { row.combinedMembership.membership = 'MEMBERSHIP_NOT_MATCHED'; },
      ({ data }) => { data.overallAccessState = 'CAN_ACCESS'; },
      ({ data }) => { data.allowPolicyExplanation.explainedPolicies[1].allowAccessState = 'ALLOW_ACCESS_STATE_GRANTED'; },
      ({ row }) => { row.allowAccessState = 'ALLOW_ACCESS_STATE_NOT_GRANTED'; }
    ];
    for (const change of changes) { const setup = storageProof(); change(setup); expect(() => assertReaderSnapshotStorageIsolation(setup.data, setup.options)).toThrow(); }
  });

  it('rejects any status error, including the actual v1 deny-generation error instead of whitelisting it', () => {
    for (const change of [
      data => { data.errors = [{ code: 13, message: 'Failed to generate IAM deny explanation' }]; },
      data => { data.allowPolicyExplanation.errors = [{ code: 13 }]; },
      data => { data.denyPolicyExplanation.errors = [{ code: 13 }]; },
      data => { data.allowPolicyExplanation.explainedPolicies[0].bindingExplanations[0].conditionExplanation.errors = [{ code: 3 }]; }
    ]) {
      const { data, options } = storageProof(); change(data);
      expect(() => assertReaderSnapshotStorageIsolation(data, options)).toThrow(/Storage isolation/);
    }
  });

  it('requires complete matching Storage IAM/allow-policy/explanation matrices, including every member', () => {
    const changes = [
      ({ options }) => { options.bucketPolicy.etag = ''; },
      ({ options }) => { options.bucketPolicy.bindings = []; },
      ({ data }) => { data.allowPolicyExplanation.explainedPolicies[0].bindingExplanations = []; },
      ({ data }) => { data.allowPolicyExplanation.explainedPolicies[0].policy.bindings = []; },
      ({ data }) => { data.allowPolicyExplanation.explainedPolicies.push(structuredClone(data.allowPolicyExplanation.explainedPolicies[0])); },
      ({ data }) => { data.allowPolicyExplanation.explainedPolicies.pop(); },
      ({ row }) => { row.memberships['user:other@example.test'] = { membership: 'MEMBERSHIP_NOT_MATCHED' }; },
      ({ row }) => { row.role = 'roles/storage.objectViewer'; }
    ];
    for (const change of changes) { const setup = storageProof(); change(setup); expect(() => assertReaderSnapshotStorageIsolation(setup.data, setup.options)).toThrow(); }
  });

  it('requires an active exact same-project role containing only storage.objects.get', () => {
    for (const change of [
      role => { role.name = role.name.replace(project, 'other-project'); },
      role => { role.stage = 'DISABLED'; }, role => { role.stage = 'BETA'; }, role => { role.deleted = true; },
      role => { role.includedPermissions.push('storage.objects.list'); }, role => { role.includedPermissions = []; }
    ]) { const { data, options } = storageProof(); change(options.roleDefinition); expect(() => assertReaderSnapshotStorageIsolation(data, options)).toThrow(); }
  });
});
