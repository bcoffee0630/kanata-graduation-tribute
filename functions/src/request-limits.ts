import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './core.js';

const WINDOW_MS = 60_000;
const LIMITS = { submitMessage: 5, submitFanartLink: 5, submitReport: 5, getMyContributionLimits: 20 } as const;
export type PublicEndpoint = keyof typeof LIMITS;

export function endpointWindow(attempts: unknown, endpoint: PublicEndpoint, now: number) {
  if (!Number.isSafeInteger(now) || now < 0 || (attempts !== undefined && (!Array.isArray(attempts)
    || attempts.length > 20 || attempts.some(value => !Number.isSafeInteger(value) || value < 0)))) {
    throw new HttpsError('unavailable', 'The request limit is temporarily unavailable.');
  }
  const recent = ((attempts ?? []) as number[]).filter(value => value > now - WINDOW_MS).sort((a, b) => a - b);
  if (recent.length >= LIMITS[endpoint]) {
    return { allowed: false, attempts: recent,
      retryAfterSeconds: Math.max(1, Math.ceil((recent[recent.length - LIMITS[endpoint]]! + WINDOW_MS - now) / 1000)) };
  }
  return { allowed: true, attempts: [...recent, now], retryAfterSeconds: 0 };
}

/** Authenticated attempts count before payload validation or costly external work, including failures. */
export async function assertPublicEndpointRateLimit(uid: string, endpoint: PublicEndpoint): Promise<void> {
  const id = `${endpoint}_${createHash('sha256').update(uid).digest('hex')}`;
  const ref = db.collection('publicEndpointLimits').doc(id);
  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const decision = endpointWindow(snapshot.data()?.attempts, endpoint, now);
    if (decision.allowed) transaction.set(ref, { uid, endpoint, attempts: decision.attempts,
      updatedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000) });
    return decision;
  });
  if (!result.allowed) throw new HttpsError('resource-exhausted', 'Please wait before trying this request again.', {
    reason: 'burst_limit', retryAfterSeconds: result.retryAfterSeconds
  });
}
