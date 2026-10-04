import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken, type UserRecord } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
  type Transaction
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth();
export const storage = getStorage();

export const REGION = 'asia-east1';
export const TIME_ZONE = 'Asia/Taipei';
export const CALLABLE_OPTIONS = {
  region: REGION,
  cors: true,
  invoker: 'public',
  maxInstances: 10,
  enforceAppCheck: false
} as const;

export const MESSAGE_DAILY_LIMIT = 3;
export const FANART_DAILY_LIMIT = 2;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const REPORT_AUTO_HIDE_THRESHOLD = 3;

export type AdminRole = 'owner' | 'moderator';
export type ContentType = 'message' | 'fanart';
export type RestrictionState = 'active' | 'muted' | 'banned';

export interface AdminActor {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  sessionVersion: number;
}

export interface SubmitterSnapshot {
  uid: string;
  displayName: string;
  avatarUrl: string;
  providerId: string;
  profileLink: string;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'A data object is required.');
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new HttpsError(
      'invalid-argument',
      `${field} must contain ${minLength}-${maxLength} characters.`
    );
  }
  return normalized;
}

export function optionalString(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} is too long.`);
  }
  return normalized;
}

export function optionalHttpsUrl(value: unknown, field: string): string {
  const normalized = optionalString(value, field, 500);
  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:') throw new Error('invalid protocol');
    return url.toString();
  } catch {
    throw new HttpsError('invalid-argument', `${field} must be a valid HTTPS URL.`);
  }
}

export function safeHttpsUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function requiredEmail(value: unknown): string {
  const email = requiredString(value, 'email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }
  return email;
}

export function requireAuth<T>(request: CallableRequest<T>): NonNullable<typeof request.auth> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in is required.');
  return request.auth;
}

export function requireContributorAuth<T>(
  request: CallableRequest<T>
): NonNullable<typeof request.auth> {
  const requestAuth = requireAuth(request);
  const provider = requestAuth.token.firebase?.sign_in_provider;
  if (provider !== 'google.com' && provider !== 'github.com') {
    throw new HttpsError(
      'permission-denied',
      'Contributions require Google or GitHub sign-in.'
    );
  }
  return requestAuth;
}

export function parseAdminRole(value: unknown): AdminRole | null {
  return value === 'owner' || value === 'moderator' ? value : null;
}

export function isPasswordSignIn(token: Pick<DecodedIdToken, 'firebase'>): boolean {
  return token.firebase?.sign_in_provider === 'password';
}

export async function requireAdmin<T>(request: CallableRequest<T>): Promise<AdminActor> {
  const requestAuth = requireAuth(request);
  return validateAdminIdentity(requestAuth.uid, requestAuth.token);
}

export async function validateAdminIdentity(
  uid: string,
  token: DecodedIdToken
): Promise<AdminActor> {
  if (!isPasswordSignIn(token)) {
    throw new HttpsError('permission-denied', 'Administrator password sign-in is required.');
  }

  const tokenRole = parseAdminRole(token.adminRole);
  const tokenSessionVersion = Number(token.adminSessionVersion);
  if (!tokenRole || !Number.isSafeInteger(tokenSessionVersion) || tokenSessionVersion < 1) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }

  const [user, accountSnapshot] = await Promise.all([
    auth.getUser(uid).catch(() => null),
    db.collection('adminAccounts').doc(uid).get()
  ]);
  const account = accountSnapshot.data() || {};
  const currentRole = parseAdminRole(user?.customClaims?.adminRole);
  const accountRole = parseAdminRole(account.role);
  const currentSessionVersion = Number(user?.customClaims?.adminSessionVersion);
  const accountSessionVersion = Number(account.sessionVersion);
  const tokenAuthTime = Number(token.auth_time || 0);
  const validAfterSeconds = user?.tokensValidAfterTime
    ? Math.floor(Date.parse(user.tokensValidAfterTime) / 1000)
    : 0;

  if (
    !user ||
    user.disabled ||
    !accountSnapshot.exists ||
    account.disabled === true ||
    currentRole !== tokenRole ||
    accountRole !== tokenRole ||
    currentSessionVersion !== tokenSessionVersion ||
    accountSessionVersion !== tokenSessionVersion ||
    validAfterSeconds > tokenAuthTime
  ) {
    throw new HttpsError('permission-denied', 'Administrator session is no longer valid.');
  }

  return {
    uid,
    email: user.email || '',
    displayName: user.displayName || '',
    role: tokenRole,
    sessionVersion: tokenSessionVersion
  };
}

export async function requireOwner<T>(request: CallableRequest<T>): Promise<AdminActor> {
  const actor = await requireAdmin(request);
  if (actor.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner access is required.');
  }
  return actor;
}

export function contentCollection(type: ContentType): 'messages' | 'fanart' {
  return type === 'message' ? 'messages' : 'fanart';
}

export function contentAuthorId(type: ContentType, data: DocumentData): string {
  const value = type === 'message' ? data.authorId : data.artistId;
  return typeof value === 'string' ? value : '';
}

export function validatedFanartStoragePath(
  fanartId: string,
  artistIdValue: unknown,
  pathValue: unknown
): string {
  const artistId = typeof artistIdValue === 'string' ? artistIdValue : '';
  const path = typeof pathValue === 'string' ? pathValue : '';
  if (!fanartId || fanartId.includes('/') || !artistId || artistId.includes('/')) return '';

  const prefix = `fanart/${artistId}/${fanartId}/`;
  if (!path.startsWith(prefix)) return '';
  const fileName = path.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(fileName) ? path : '';
}

export function parseContentType(value: unknown): ContentType {
  if (value === 'message' || value === 'fanart') return value;
  throw new HttpsError('invalid-argument', 'Unsupported content type.');
}

export function todayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function githubProfileLink(provider: UserRecord['providerData'][number] | undefined): string {
  if (provider?.providerId !== 'github.com') return '';
  const handle = provider?.displayName?.trim() || '';
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle)) {
    return `https://github.com/${handle}`;
  }
  return '';
}

export async function buildSubmitter(uid: string, signInProvider = ''): Promise<{
  user: UserRecord;
  publicSnapshot: SubmitterSnapshot;
}> {
  const user = await auth.getUser(uid);
  const provider = user.providerData.find((item) => item.providerId === signInProvider)
    || user.providerData.find((item) => ['google.com', 'github.com'].includes(item.providerId))
    || user.providerData[0];
  const providerId = signInProvider || provider?.providerId || '';
  return {
    user,
    publicSnapshot: {
      uid: user.uid,
      displayName: user.displayName?.trim() || provider?.displayName?.trim() || 'Anonymous',
      avatarUrl: safeHttpsUrl(user.photoURL || provider?.photoURL),
      providerId,
      profileLink: providerId === 'github.com' ? githubProfileLink(provider) : ''
    }
  };
}

export async function syncUserDirectory(user: UserRecord): Promise<void> {
  await db.collection('userDirectory').doc(user.uid).set({
    uid: user.uid,
    email: user.email || '',
    emailVerified: user.emailVerified,
    displayName: user.displayName || '',
    avatarUrl: user.photoURL || '',
    disabled: user.disabled,
    providers: user.providerData.map((provider) => ({
      providerId: provider.providerId,
      providerUid: provider.uid,
      email: provider.email || '',
      displayName: provider.displayName || '',
      photoURL: provider.photoURL || ''
    })),
    authCreatedAt: user.metadata.creationTime || '',
    authLastSignInAt: user.metadata.lastSignInTime || '',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

export async function assertCanContribute(uid: string, transaction?: Transaction): Promise<void> {
  const restrictionRef = db.collection('userRestrictions').doc(uid);
  const restriction = transaction ? await transaction.get(restrictionRef) : await restrictionRef.get();
  if (!restriction.exists) return;

  const data = restriction.data() || {};
  const state = data.state as RestrictionState | undefined;
  if (state === 'banned') {
    throw new HttpsError('permission-denied', 'This account is blocked.');
  }
  if (state !== 'muted') return;

  const mutedUntil = data.mutedUntil;
  if (!(mutedUntil instanceof Timestamp) || mutedUntil.toMillis() > Date.now()) {
    throw new HttpsError('permission-denied', 'This account is muted.');
  }
}

export async function assertSiteWritable(): Promise<void> {
  const maintenance = await db.collection('system').doc('maintenance').get();
  if (maintenance.data()?.enabled === true) {
    throw new HttpsError('unavailable', 'The site is temporarily read-only for maintenance.');
  }
}

export function auditData(
  actor: AdminActor,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  details: Record<string, unknown> = {}
): DocumentData {
  return {
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorDisplayName: actor.displayName,
    actorRole: actor.role,
    action,
    targetType,
    targetId,
    reason,
    details,
    createdAt: FieldValue.serverTimestamp()
  };
}

export function serializeValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, serializeValue(entry)])
    );
  }
  return value;
}

export function serializeUser(user: UserRecord, restriction?: DocumentData): Record<string, unknown> {
  return {
    uid: user.uid,
    email: user.email || '',
    emailVerified: user.emailVerified,
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    disabled: user.disabled,
    adminRole: parseAdminRole(user.customClaims?.adminRole),
    providers: user.providerData.map((provider) => ({
      providerId: provider.providerId,
      uid: provider.uid,
      email: provider.email || '',
      displayName: provider.displayName || ''
    })),
    createdAt: user.metadata.creationTime || '',
    lastSignInAt: user.metadata.lastSignInTime || '',
    restriction: restriction ? serializeValue(restriction) : null
  };
}
