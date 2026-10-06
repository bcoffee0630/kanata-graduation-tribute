import { FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertPublicEndpointRateLimit } from './request-limits.js';
import {
  CALLABLE_OPTIONS,
  FANART_DAILY_LIMIT,
  MESSAGE_DAILY_LIMIT,
  asRecord,
  auditData,
  auth,
  db,
  requiredString,
  requireAdmin,
  requireContributorAuth,
  requireOwner,
  todayKey,
  type AdminActor,
  type ContentType
} from './core.js';

export interface ContributionDefaults {
  messageDailyLimit: number;
  fanartDailyLimit: number;
}

export type ContributionOverride =
  | { mode: 'inherit' }
  | { mode: 'limited'; value: number }
  | { mode: 'unlimited' };

export interface ContributionLimitSnapshot {
  defaults: ContributionDefaults;
  overrides: { message: ContributionOverride; fanart: ContributionOverride };
  effective: {
    message: { limit: number | null; source: 'default' | 'override' };
    fanart: { limit: number | null; source: 'default' | 'override' };
  };
  usage: { message: number; fanart: number };
  dayKey: string;
  revision: number;
}

export function isValidContributionLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function requiredContributionLimit(value: unknown, field: string): number {
  if (!isValidContributionLimit(value)) {
    throw new HttpsError('invalid-argument', `${field} must be a non-negative safe integer.`);
  }
  return value;
}

export function contributionRevision(data: DocumentData = {}): number {
  return isValidContributionLimit(data.revision) ? data.revision : 0;
}

export function parseContributionDefaults(data: DocumentData = {}): ContributionDefaults {
  return {
    messageDailyLimit: isValidContributionLimit(data.messageDailyLimit)
      ? data.messageDailyLimit : MESSAGE_DAILY_LIMIT,
    fanartDailyLimit: isValidContributionLimit(data.fanartDailyLimit)
      ? data.fanartDailyLimit : FANART_DAILY_LIMIT
  };
}

export function parseStoredContributionOverride(value: unknown): ContributionOverride {
  // Only an explicitly stored null grants unlimited contributions.
  if (value === null) return { mode: 'unlimited' };
  if (isValidContributionLimit(value)) return { mode: 'limited', value };
  return { mode: 'inherit' };
}

export function parseContributionOverride(value: unknown, field: string): ContributionOverride {
  const data = asRecord(value);
  if (data.mode === 'limited') {
    return { mode: 'limited', value: requiredContributionLimit(data.value, `${field}.value`) };
  }
  if (data.mode === 'inherit' || data.mode === 'unlimited') {
    if (data.value !== undefined) {
      throw new HttpsError('invalid-argument', `${field}.value is only accepted for limited mode.`);
    }
    return { mode: data.mode };
  }
  throw new HttpsError('invalid-argument', `${field}.mode is unsupported.`);
}

export function requiredContributionUid(value: unknown): string {
  const uid = requiredString(value, 'uid', 1, 128);
  if (uid.includes('/')) throw new HttpsError('invalid-argument', 'uid must not contain a slash.');
  return uid;
}

export function currentContributionUsage(data: DocumentData, dayKey: string) {
  const sameDay = data.dailyKey === dayKey;
  return {
    message: sameDay && isValidContributionLimit(data.dailyMessageCount) ? data.dailyMessageCount : 0,
    fanart: sameDay && isValidContributionLimit(data.dailyFanartCount) ? data.dailyFanartCount : 0,
    pending: sameDay && isValidContributionLimit(data.pendingFanartCount) ? data.pendingFanartCount : 0
  };
}

function effectiveLimit(override: ContributionOverride, defaultLimit: number) {
  return override.mode === 'inherit'
    ? { limit: defaultLimit, source: 'default' as const }
    : { limit: override.mode === 'unlimited' ? null : override.value, source: 'override' as const };
}

export function buildContributionLimitSnapshot(
  defaultData: DocumentData = {},
  overrideData: DocumentData = {},
  statsData: DocumentData = {},
  dayKey = todayKey()
): ContributionLimitSnapshot {
  const defaults = parseContributionDefaults(defaultData);
  const message = parseStoredContributionOverride(overrideData.messageDailyLimit);
  const fanart = parseStoredContributionOverride(overrideData.fanartDailyLimit);
  const usage = currentContributionUsage(statsData, dayKey);
  return {
    defaults,
    overrides: { message, fanart },
    effective: {
      message: effectiveLimit(message, defaults.messageDailyLimit),
      fanart: effectiveLimit(fanart, defaults.fanartDailyLimit)
    },
    usage: { message: usage.message, fanart: usage.fanart },
    dayKey,
    revision: contributionRevision(overrideData)
  };
}

export function assertContributionAvailable(
  snapshot: ContributionLimitSnapshot,
  contentType: ContentType
): void {
  const limit = snapshot.effective[contentType].limit;
  const used = snapshot.usage[contentType];
  if (limit !== null && used >= limit) {
    throw new HttpsError('resource-exhausted', `Daily ${contentType} limit reached.`, {
      reason: 'daily_limit', contentType, limit, used, dayKey: snapshot.dayKey
    });
  }
}

export async function readContributionLimitSnapshot(
  uid: string,
  transaction?: Transaction,
  dayKey = todayKey()
): Promise<ContributionLimitSnapshot> {
  if (!transaction) {
    return db.runTransaction((current) => readContributionLimitSnapshot(uid, current, dayKey));
  }
  const [defaults, overrides, stats] = await transaction.getAll(
    db.collection('system').doc('contributionLimits'),
    db.collection('userContributionLimits').doc(uid),
    db.collection('userStats').doc(uid)
  );
  return buildContributionLimitSnapshot(defaults?.data(), overrides?.data(), stats?.data(), dayKey);
}

function assertMatchingRevision(data: DocumentData, expectedRevision: number): number {
  const revision = contributionRevision(data);
  if (revision !== expectedRevision) {
    throw new HttpsError('aborted', 'Contribution limits changed. Reload before saving.', {
      reason: 'revision_conflict', revision
    });
  }
  if (revision === Number.MAX_SAFE_INTEGER) {
    throw new HttpsError('failed-precondition', 'Contribution limit revision requires repair.');
  }
  return revision + 1;
}

async function assertOwnerAuthority(transaction: Transaction, actor: AdminActor): Promise<void> {
  const snapshot = await transaction.get(db.collection('adminAccounts').doc(actor.uid));
  const account = snapshot.data() || {};
  if (
    !snapshot.exists || account.role !== 'owner' || account.disabled === true ||
    account.sessionVersion !== actor.sessionVersion
  ) {
    throw new HttpsError('permission-denied', 'Owner authority changed during the request.');
  }
}

function storedOverride(override: ContributionOverride): number | null | FieldValue {
  if (override.mode === 'inherit') return FieldValue.delete();
  return override.mode === 'unlimited' ? null : override.value;
}

export const getContributionDefaults = onCall(CALLABLE_OPTIONS, async (request) => {
  await requireAdmin(request);
  const snapshot = await db.collection('system').doc('contributionLimits').get();
  return { defaults: parseContributionDefaults(snapshot.data()), revision: contributionRevision(snapshot.data()) };
});

export const setContributionDefaults = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireOwner(request);
  const data = asRecord(request.data);
  const defaults = {
    messageDailyLimit: requiredContributionLimit(data.messageDailyLimit, 'messageDailyLimit'),
    fanartDailyLimit: requiredContributionLimit(data.fanartDailyLimit, 'fanartDailyLimit')
  };
  const expectedRevision = requiredContributionLimit(data.expectedRevision, 'expectedRevision');
  const reason = requiredString(data.reason, 'reason', 3, 500);
  const ref = db.collection('system').doc('contributionLimits');
  const auditRef = db.collection('adminAuditLogs').doc();
  return db.runTransaction(async (transaction) => {
    const [existing] = await Promise.all([transaction.get(ref), assertOwnerAuthority(transaction, actor)]);
    const beforeData = existing.data() || {};
    const revision = assertMatchingRevision(beforeData, expectedRevision);
    transaction.set(ref, {
      ...defaults, revision, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid
    }, { merge: true });
    transaction.create(auditRef, auditData(actor, 'contribution.defaults.update', 'contributionLimits', 'defaults', reason, {
      before: { defaults: parseContributionDefaults(beforeData), revision: contributionRevision(beforeData) },
      after: { defaults, revision }
    }));
    return { defaults, revision };
  });
});

export const setUserContributionLimits = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireOwner(request);
  const data = asRecord(request.data);
  const uid = requiredContributionUid(data.uid);
  const message = parseContributionOverride(data.message, 'message');
  const fanart = parseContributionOverride(data.fanart, 'fanart');
  const expectedRevision = requiredContributionLimit(data.expectedRevision, 'expectedRevision');
  const reason = requiredString(data.reason, 'reason', 3, 500);
  await auth.getUser(uid).catch((error) => {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'User not found.');
    }
    throw error;
  });
  const ref = db.collection('userContributionLimits').doc(uid);
  const auditRef = db.collection('adminAuditLogs').doc();
  return db.runTransaction(async (transaction) => {
    const [defaults, existing, stats] = await Promise.all([
      transaction.get(db.collection('system').doc('contributionLimits')),
      transaction.get(ref),
      transaction.get(db.collection('userStats').doc(uid)),
      assertOwnerAuthority(transaction, actor)
    ]);
    const beforeData = existing.data() || {};
    const revision = assertMatchingRevision(beforeData, expectedRevision);
    const dayKey = todayKey();
    const afterData = {
      ...(message.mode === 'inherit' ? {} : { messageDailyLimit: message.mode === 'unlimited' ? null : message.value }),
      ...(fanart.mode === 'inherit' ? {} : { fanartDailyLimit: fanart.mode === 'unlimited' ? null : fanart.value }),
      revision
    };
    const contributionLimits = buildContributionLimitSnapshot(defaults.data(), afterData, stats.data(), dayKey);
    transaction.set(ref, {
      uid,
      messageDailyLimit: storedOverride(message),
      fanartDailyLimit: storedOverride(fanart),
      revision,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid
    }, { merge: true });
    transaction.create(auditRef, auditData(actor, 'contribution.user.update', 'user', uid, reason, {
      before: { overrides: buildContributionLimitSnapshot(defaults.data(), beforeData, stats.data(), dayKey).overrides,
        revision: contributionRevision(beforeData) },
      after: { overrides: contributionLimits.overrides, revision }
    }));
    return { contributionLimits };
  });
});

export const getMyContributionLimits = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestAuth = requireContributorAuth(request);
  await assertPublicEndpointRateLimit(requestAuth.uid, 'getMyContributionLimits');
  const snapshot = await readContributionLimitSnapshot(requestAuth.uid);
  const typeLimit = (type: ContentType) => {
    const limit = snapshot.effective[type].limit;
    const used = snapshot.usage[type];
    return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used) };
  };
  return { dayKey: snapshot.dayKey, message: typeLimit('message'), fanart: typeLimit('fanart') };
});
