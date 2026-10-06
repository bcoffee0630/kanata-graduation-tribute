// Firestore grants, including per-database conditions, are attached to the project hierarchy.
// Troubleshooter does not accept a Firestore database as its policy target. Inspect every
// binding so a database condition cannot hide a potential grant when checking the project.
export const IAM_TROUBLESHOOTER_URL = 'https://policytroubleshooter.googleapis.com/v1/iam:troubleshoot';
export const STORAGE_IAM_TROUBLESHOOTER_URL = 'https://policytroubleshooter.googleapis.com/v3/iam:troubleshoot';
const FIRESTORE_PERMISSIONS = ['datastore.entities.get', 'datastore.entities.list'];
const PERMISSIONS = new Set(['ROLE_PERMISSION_INCLUDED', 'ROLE_PERMISSION_NOT_INCLUDED']);
const MEMBERSHIPS = new Set(['MEMBERSHIP_INCLUDED', 'MEMBERSHIP_NOT_INCLUDED']);
const V3_MEMBERSHIPS = new Set(['MEMBERSHIP_MATCHED', 'MEMBERSHIP_NOT_MATCHED']);
const V3_ACCESS = new Set(['ALLOW_ACCESS_STATE_GRANTED', 'ALLOW_ACCESS_STATE_NOT_GRANTED', 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL']);
const FAILURE = 'Reader Firestore NOT_GRANTED could not be proven from complete inherited IAM bindings; do not release the public reader.';

export class PublicDeliveryIamVerificationError extends Error {}
const fail = () => { throw new PublicDeliveryIamVerificationError(FAILURE); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function arrayOrEmpty(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail();
  return value;
}

function conditionExpression(value) {
  if (value === undefined) return null;
  if (!record(value) || typeof value.expression !== 'string' || !value.expression) fail();
  return value.expression;
}

function bindingKey(role, condition, members) {
  if (typeof role !== 'string' || !role || !Array.isArray(members) || !members.length
    || members.some(member => typeof member !== 'string' || !member)
    || new Set(members).size !== members.length) fail();
  return JSON.stringify([role, conditionExpression(condition), [...members].sort()]);
}

/** Rejects potential grants even when an overall enum or a condition currently says denied. */
export function assertReaderFirestoreDenied(result, { project }) {
  if (!record(result) || result.access !== 'NOT_GRANTED' || arrayOrEmpty(result.errors).length) fail();
  const policies = arrayOrEmpty(result.explainedPolicies);
  const projectResource = `//cloudresourcemanager.googleapis.com/projects/${project}`;
  if (!policies.length || !policies.some(policy => policy?.fullResourceName === projectResource)) fail();
  const resourceNames = new Set();
  for (const explanation of policies) {
    if (!record(explanation) || explanation.access !== 'NOT_GRANTED'
      || typeof explanation.fullResourceName !== 'string'
      || explanation.fullResourceName !== projectResource
        && !/^\/\/cloudresourcemanager\.googleapis\.com\/(?:folders|organizations)\/\d+$/.test(explanation.fullResourceName)
      || resourceNames.has(explanation.fullResourceName) || !record(explanation.policy)
      || typeof explanation.policy.etag !== 'string' || !explanation.policy.etag
      || arrayOrEmpty(explanation.errors).length) fail();
    resourceNames.add(explanation.fullResourceName);
    // Protobuf JSON omits empty repeated fields. A visible, etagged empty policy is
    // complete only when its explanation is empty too.
    const bindings = arrayOrEmpty(explanation.policy.bindings);
    const rows = arrayOrEmpty(explanation.bindingExplanations);
    if (bindings.length !== rows.length) fail();
    const expected = new Set(bindings.map(binding => {
      if (!record(binding)) fail();
      return bindingKey(binding.role, binding.condition, binding.members);
    }));
    if (expected.size !== bindings.length) fail();
    for (const row of rows) {
      if (!record(row) || row.access !== 'NOT_GRANTED' || !PERMISSIONS.has(row.rolePermission)
        || !record(row.memberships) || arrayOrEmpty(row.errors).length) fail();
      const members = Object.keys(row.memberships);
      const key = bindingKey(row.role, row.condition, members);
      if (!expected.delete(key)) fail();
      const memberships = Object.values(row.memberships);
      if (memberships.some(member => !record(member) || !MEMBERSHIPS.has(member.membership)
        || arrayOrEmpty(member.errors).length)) fail();
      if (row.rolePermission === 'ROLE_PERMISSION_INCLUDED'
        && memberships.some(member => member.membership === 'MEMBERSHIP_INCLUDED')) fail();
    }
    if (expected.size) fail();
  }
  return true;
}

/** The API adapter has the fetch-style (url, options) signature used by release verifiers. */
export async function verifyReaderFirestoreIsolation({ project, reader, api }) {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(project || '')
    || reader !== `public-feed-reader@${project}.iam.gserviceaccount.com` || typeof api !== 'function') fail();
  const results = await Promise.allSettled(FIRESTORE_PERMISSIONS.map(permission => api(IAM_TROUBLESHOOTER_URL, {
    method: 'POST', body: JSON.stringify({ accessTuple: {
      principal: reader, fullResourceName: `//cloudresourcemanager.googleapis.com/projects/${project}`, permission
    } })
  })));
  for (const result of results) {
    if (result.status !== 'fulfilled') throw result.reason;
    assertReaderFirestoreDenied(result.value, { project });
  }
  return { access: 'NOT_GRANTED', scope: 'project-hierarchy', permissions: [...FIRESTORE_PERMISSIONS] };
}

const STORAGE_FAILURE = 'Reader Storage isolation could not be proven from complete inherited allow policies and the fixed get-only prefix role; do not release the public reader.';
const failStorage = () => { throw new PublicDeliveryIamVerificationError(STORAGE_FAILURE); };
const combinedAllowAccess = states => states.includes('ALLOW_ACCESS_STATE_GRANTED') ? 'ALLOW_ACCESS_STATE_GRANTED'
  : states.includes('ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL') ? 'ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL' : 'ALLOW_ACCESS_STATE_NOT_GRANTED';

function noStatusErrors(value) {
  if (Array.isArray(value)) { value.forEach(noStatusErrors); return; }
  if (!record(value)) return;
  if (Object.hasOwn(value, 'error') && value.error !== undefined && value.error !== null
    || Object.hasOwn(value, 'errors') && (!Array.isArray(value.errors) || value.errors.length)) failStorage();
  Object.values(value).forEach(noStatusErrors);
}

function policyKeys(bindings) {
  try {
    if (!Array.isArray(bindings)) failStorage();
    const keys = bindings.map(binding => {
      if (!record(binding)) failStorage();
      return bindingKey(binding.role, binding.condition, binding.members);
    });
    if (new Set(keys).size !== keys.length) failStorage();
    return keys.sort();
  } catch (error) {
    if (error instanceof PublicDeliveryIamVerificationError) failStorage();
    throw error;
  }
}

/** This proves the absence of an outside-prefix allow grant, not effective inside-prefix access. */
export function assertReaderSnapshotStorageIsolation(result, { project, reader, bucketName, bucketPolicy, roleDefinition }) {
  const bucketResource = `//storage.googleapis.com/projects/_/buckets/${bucketName}`;
  const projectResource = `//cloudresourcemanager.googleapis.com/projects/${project}`;
  const role = `projects/${project}/roles/publicFeedSnapshotReader`;
  const expectedMember = `serviceAccount:${reader}`;
  const expression = `resource.name.startsWith('projects/_/buckets/${bucketName}/objects/public-snapshots/')`;
  if (!record(result) || !['CAN_ACCESS', 'UNKNOWN_CONDITIONAL', 'CANNOT_ACCESS'].includes(result.overallAccessState)
    || !record(result.allowPolicyExplanation) || !V3_ACCESS.has(result.allowPolicyExplanation.allowAccessState)
    || result.denyPolicyExplanation?.denyAccessState !== 'DENY_ACCESS_STATE_NOT_DENIED'
    || !record(bucketPolicy) || typeof bucketPolicy.etag !== 'string' || !bucketPolicy.etag || bucketPolicy.version !== 3
    || !record(roleDefinition) || roleDefinition.name !== role || roleDefinition.deleted === true
    || roleDefinition.stage !== 'GA' || !Array.isArray(roleDefinition.includedPermissions)
    || roleDefinition.includedPermissions.length !== 1 || roleDefinition.includedPermissions[0] !== 'storage.objects.get') failStorage();
  noStatusErrors(result);
  const policies = result.allowPolicyExplanation.explainedPolicies;
  if (!Array.isArray(policies) || !policies.length) failStorage();
  const names = new Set(); const policyStates = []; let matchedGrants = 0;
  for (const explanation of policies) {
    const isBucket = explanation?.fullResourceName === bucketResource;
    if (!record(explanation) || typeof explanation.fullResourceName !== 'string'
      || !isBucket && explanation.fullResourceName !== projectResource
        && !/^\/\/cloudresourcemanager\.googleapis\.com\/(?:folders|organizations)\/\d+$/.test(explanation.fullResourceName)
      || names.has(explanation.fullResourceName) || !V3_ACCESS.has(explanation.allowAccessState)
      || !record(explanation.policy) || !isBucket && (typeof explanation.policy.etag !== 'string' || !explanation.policy.etag)) failStorage();
    names.add(explanation.fullResourceName);
    policyStates.push(explanation.allowAccessState);
    const bindings = explanation.policy.bindings ?? [];
    const rows = explanation.bindingExplanations ?? [];
    if (!Array.isArray(bindings) || !Array.isArray(rows) || bindings.length !== rows.length
      || isBucket && explanation.policy.version !== 3) failStorage();
    const expectedKeys = policyKeys(bindings);
    if (isBucket && JSON.stringify(expectedKeys) !== JSON.stringify(policyKeys(bucketPolicy.bindings))) failStorage();
    const unmatched = new Set(expectedKeys);
    for (const row of rows) {
      if (!record(row) || !V3_ACCESS.has(row.allowAccessState) || !PERMISSIONS.has(row.rolePermission)
        || !record(row.memberships) || !record(row.combinedMembership)
        || !V3_MEMBERSHIPS.has(row.combinedMembership.membership)) failStorage();
      const memberNames = Object.keys(row.memberships);
      const memberships = Object.values(row.memberships);
      if (memberships.some(member => !record(member) || !V3_MEMBERSHIPS.has(member.membership))) failStorage();
      let key;
      try { key = bindingKey(row.role, row.condition, memberNames); } catch { failStorage(); }
      if (!unmatched.delete(key)) failStorage();
      const matchedMembers = memberNames.filter(member => row.memberships[member].membership === 'MEMBERSHIP_MATCHED');
      if ((row.combinedMembership.membership === 'MEMBERSHIP_MATCHED') !== (matchedMembers.length > 0)) failStorage();
      if (!matchedMembers.length && row.allowAccessState !== 'ALLOW_ACCESS_STATE_NOT_GRANTED') failStorage();
      if (matchedMembers.length) {
        // Reject every additional matching binding, even if its role excludes object reads:
        // otherwise a create/delete-only role could evade a read-permission-only check.
        if (!isBucket || row.rolePermission !== 'ROLE_PERMISSION_INCLUDED' || row.role !== role
          || conditionExpression(row.condition) !== expression || matchedMembers.length !== 1
          || matchedMembers[0] !== expectedMember || memberNames.length !== 1) failStorage();
        matchedGrants++;
      }
    }
    if (unmatched.size || combinedAllowAccess(rows.map(row => row.allowAccessState)) !== explanation.allowAccessState) failStorage();
  }
  const expectedOverall = { ALLOW_ACCESS_STATE_GRANTED: 'CAN_ACCESS', ALLOW_ACCESS_STATE_NOT_GRANTED: 'CANNOT_ACCESS',
    ALLOW_ACCESS_STATE_UNKNOWN_CONDITIONAL: 'UNKNOWN_CONDITIONAL' }[result.allowPolicyExplanation.allowAccessState];
  if (!names.has(bucketResource) || !names.has(projectResource) || matchedGrants !== 1
    || combinedAllowAccess(policyStates) !== result.allowPolicyExplanation.allowAccessState || result.overallAccessState !== expectedOverall) failStorage();
  return { method: 'complete-v3-allow-matrix-and-fixed-literal-get-only-prefix',
    outsidePrefix: 'NO_ALLOW_GRANT', otherStoragePermissions: 'NO_ALLOW_GRANT',
    insidePrefixRead: 'REQUIRES_ACTUAL_READER_FEED_200', denyEvaluation: 'NOT_DENIED' };
}

export async function verifyReaderSnapshotStorageIsolation({ project, reader, bucketName, bucketPolicy, api }) {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(project || '')
    || reader !== `public-feed-reader@${project}.iam.gserviceaccount.com`
    || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucketName || '') || typeof api !== 'function') failStorage();
  const bucketResource = `//storage.googleapis.com/projects/_/buckets/${bucketName}`;
  const role = `projects/${project}/roles/publicFeedSnapshotReader`;
  const results = await Promise.allSettled([
    api(STORAGE_IAM_TROUBLESHOOTER_URL, { method: 'POST', body: JSON.stringify({ accessTuple: {
      principal: reader, fullResourceName: bucketResource, permission: 'storage.objects.get',
      conditionContext: { resource: { service: 'storage.googleapis.com', type: 'storage.googleapis.com/Object',
        name: `projects/_/buckets/${bucketName}/objects/public-snapshots/current.json` } }
    } }) }),
    api(`https://iam.googleapis.com/v1/${role}`)
  ]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return assertReaderSnapshotStorageIsolation(results[0].value, {
    project, reader, bucketName, bucketPolicy, roleDefinition: results[1].value
  });
}
