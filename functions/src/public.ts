import { pipeline } from 'node:stream/promises';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  CALLABLE_OPTIONS,
  FANART_DAILY_LIMIT,
  MAX_IMAGE_BYTES,
  MESSAGE_DAILY_LIMIT,
  REGION,
  REPORT_AUTO_HIDE_THRESHOLD,
  TIME_ZONE,
  asRecord,
  assertCanContribute,
  assertSiteWritable,
  auth,
  buildSubmitter,
  contentAuthorId,
  contentCollection,
  db,
  optionalHttpsUrl,
  optionalString,
  parseContentType,
  requiredString,
  requireContributorAuth,
  storage,
  syncUserDirectory,
  todayKey,
  validateAdminIdentity,
  validatedFanartStoragePath
} from './core.js';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const REPORT_REASONS = new Set([
  'inappropriate',
  'spam',
  'copyright',
  'harassment',
  'other'
]);

function currentStats(data: Record<string, unknown>, key: string) {
  const sameDay = data.dailyKey === key;
  return {
    message: sameDay && typeof data.dailyMessageCount === 'number' ? data.dailyMessageCount : 0,
    fanart: sameDay && typeof data.dailyFanartCount === 'number' ? data.dailyFanartCount : 0,
    pending: sameDay && typeof data.pendingFanartCount === 'number' ? data.pendingFanartCount : 0
  };
}

async function assertTransactionWritable(transaction: Transaction): Promise<void> {
  const maintenance = await transaction.get(db.collection('system').doc('maintenance'));
  if (maintenance.data()?.enabled === true) {
    throw new HttpsError('unavailable', 'The site is temporarily read-only for maintenance.');
  }
}

export const submitMessage = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestAuth = requireContributorAuth(request);
  await assertSiteWritable();
  await assertCanContribute(requestAuth.uid);

  const data = asRecord(request.data);
  const content = requiredString(data.content, 'content', 5, 500);
  const { user, publicSnapshot } = await buildSubmitter(
    requestAuth.uid,
    requestAuth.token.firebase?.sign_in_provider
  );
  const messageRef = db.collection('messages').doc();
  const statsRef = db.collection('userStats').doc(requestAuth.uid);
  const key = todayKey();

  await db.runTransaction(async (transaction) => {
    const [statsSnapshot] = await Promise.all([
      transaction.get(statsRef),
      assertTransactionWritable(transaction)
    ]);
    const statsData = (statsSnapshot.data() || {}) as Record<string, unknown>;
    const counts = currentStats(statsData, key);
    if (counts.message >= MESSAGE_DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Daily message limit reached.');
    }

    transaction.create(messageRef, {
      author: publicSnapshot.displayName,
      authorId: publicSnapshot.uid,
      authorLink: publicSnapshot.profileLink,
      authorAvatar: publicSnapshot.avatarUrl,
      authorProvider: publicSnapshot.providerId,
      submitter: publicSnapshot,
      content,
      createdAt: FieldValue.serverTimestamp(),
      hidden: false,
      deleted: false,
      reportCount: 0,
      moderation: {
        status: 'visible',
        updatedAt: null,
        updatedBy: '',
        reason: ''
      }
    });

    transaction.set(statsRef, {
      uid: requestAuth.uid,
      dailyKey: key,
      dailyMessageCount: counts.message + 1,
      dailyFanartCount: counts.fanart,
      pendingFanartCount: counts.pending,
      messageCount: FieldValue.increment(1),
      lastMessageAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await syncUserDirectory(user).catch((error) => console.error('User directory sync failed', error));
  return { id: messageRef.id };
});

export const beginFanartUpload = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestAuth = requireContributorAuth(request);
  await assertSiteWritable();
  await assertCanContribute(requestAuth.uid);

  const data = asRecord(request.data);
  const contentType = requiredString(data.contentType, 'contentType', 3, 100);
  const extension = IMAGE_TYPES[contentType];
  if (!extension) throw new HttpsError('invalid-argument', 'Unsupported image type.');

  const size = data.size;
  if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > MAX_IMAGE_BYTES) {
    throw new HttpsError('invalid-argument', 'Image size is invalid.');
  }

  const ticketRef = db.collection('uploadTickets').doc();
  const statsRef = db.collection('userStats').doc(requestAuth.uid);
  const key = todayKey();
  const fileName = `original.${extension}`;
  const path = `fanart/${requestAuth.uid}/${ticketRef.id}/${fileName}`;
  const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);

  await db.runTransaction(async (transaction) => {
    const [statsSnapshot] = await Promise.all([
      transaction.get(statsRef),
      assertTransactionWritable(transaction)
    ]);
    const statsData = (statsSnapshot.data() || {}) as Record<string, unknown>;
    const counts = currentStats(statsData, key);
    if (counts.fanart + counts.pending >= FANART_DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Daily fan art limit reached.');
    }

    transaction.create(ticketRef, {
      uid: requestAuth.uid,
      status: 'pending',
      path,
      fileName,
      contentType,
      size,
      dailyKey: key,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt
    });

    transaction.set(statsRef, {
      uid: requestAuth.uid,
      dailyKey: key,
      dailyMessageCount: counts.message,
      dailyFanartCount: counts.fanart,
      pendingFanartCount: counts.pending + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return {
    ticketId: ticketRef.id,
    path,
    expiresAt: expiresAt.toDate().toISOString()
  };
});

export const finalizeFanartUpload = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestAuth = requireContributorAuth(request);
  await assertSiteWritable();
  await assertCanContribute(requestAuth.uid);

  const data = asRecord(request.data);
  const ticketId = requiredString(data.ticketId, 'ticketId', 1, 128);
  const caption = optionalString(data.caption, 'caption', 300);
  const artistLink = optionalHttpsUrl(data.artistLink, 'artistLink');
  const ticketRef = db.collection('uploadTickets').doc(ticketId);
  const initialTicket = await ticketRef.get();
  const ticket = initialTicket.data();

  if (!initialTicket.exists || !ticket || ticket.uid !== requestAuth.uid || ticket.status !== 'pending') {
    throw new HttpsError('not-found', 'Upload ticket not found.');
  }
  if (!(ticket.expiresAt instanceof Timestamp) || ticket.expiresAt.toMillis() <= Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Upload ticket expired.');
  }

  const bucket = storage.bucket();
  const file = bucket.file(ticket.path as string);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('failed-precondition', 'Uploaded image was not found.');

  const [metadata] = await file.getMetadata();
  const actualSize = Number(metadata.size || 0);
  if (
    metadata.contentType !== ticket.contentType ||
    actualSize <= 0 ||
    actualSize > MAX_IMAGE_BYTES ||
    actualSize !== ticket.size
  ) {
    await file.delete({ ignoreNotFound: true });
    throw new HttpsError('invalid-argument', 'Uploaded image does not match its ticket.');
  }

  const [imageBytes] = await file.download();
  const safeMetadata = { ...(metadata.metadata || {}) };
  delete safeMetadata.firebaseStorageDownloadTokens;
  await file.save(imageBytes, {
    resumable: false,
    validation: 'crc32c',
    metadata: {
      contentType: ticket.contentType,
      cacheControl: 'no-store',
      metadata: safeMetadata
    }
  });
  const imageUrl = `/api/fanart-media?fanartId=${encodeURIComponent(ticketId)}`;
  const { user, publicSnapshot } = await buildSubmitter(
    requestAuth.uid,
    requestAuth.token.firebase?.sign_in_provider
  );
  const fanartRef = db.collection('fanart').doc(ticketId);
  const statsRef = db.collection('userStats').doc(requestAuth.uid);
  const key = todayKey();

  await db.runTransaction(async (transaction) => {
    const [latestTicket, statsSnapshot] = await Promise.all([
      transaction.get(ticketRef),
      transaction.get(statsRef),
      assertTransactionWritable(transaction)
    ]);
    const latestData = latestTicket.data();
    if (!latestTicket.exists || latestData?.uid !== requestAuth.uid || latestData.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Upload ticket is no longer available.');
    }
    if (!(latestData.expiresAt instanceof Timestamp) || latestData.expiresAt.toMillis() <= Date.now()) {
      throw new HttpsError('deadline-exceeded', 'Upload ticket expired.');
    }

    const statsData = (statsSnapshot.data() || {}) as Record<string, unknown>;
    const counts = currentStats(statsData, key);
    if (counts.fanart >= FANART_DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Daily fan art limit reached.');
    }

    transaction.create(fanartRef, {
      artist: publicSnapshot.displayName,
      artistId: publicSnapshot.uid,
      artistLink: artistLink || publicSnapshot.profileLink,
      artistAvatar: publicSnapshot.avatarUrl,
      artistProvider: publicSnapshot.providerId,
      submitter: publicSnapshot,
      imagePath: ticket.path,
      imageUrl,
      caption,
      createdAt: FieldValue.serverTimestamp(),
      hidden: false,
      deleted: false,
      reportCount: 0,
      moderation: {
        status: 'visible',
        updatedAt: null,
        updatedBy: '',
        reason: ''
      }
    });

    transaction.update(ticketRef, {
      status: 'finalized',
      finalizedAt: FieldValue.serverTimestamp()
    });

    transaction.set(statsRef, {
      uid: requestAuth.uid,
      dailyKey: key,
      dailyMessageCount: counts.message,
      dailyFanartCount: counts.fanart + 1,
      pendingFanartCount: latestData.dailyKey === key
        ? Math.max(0, counts.pending - 1)
        : counts.pending,
      fanartCount: FieldValue.increment(1),
      lastFanartAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await syncUserDirectory(user).catch((error) => console.error('User directory sync failed', error));
  return { id: fanartRef.id, imageUrl };
});

export const submitReport = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestAuth = requireContributorAuth(request);
  await assertSiteWritable();
  await assertCanContribute(requestAuth.uid);

  const data = asRecord(request.data);
  const type = parseContentType(data.contentType);
  const contentId = requiredString(data.contentId, 'contentId', 1, 128);
  const reason = requiredString(data.reason, 'reason', 2, 40);
  if (!REPORT_REASONS.has(reason)) {
    throw new HttpsError('invalid-argument', 'Unsupported report reason.');
  }
  const details = requiredString(data.details, 'details', 10, 1000);
  const { user, publicSnapshot } = await buildSubmitter(
    requestAuth.uid,
    requestAuth.token.firebase?.sign_in_provider
  );
  const collection = contentCollection(type);
  const targetRef = db.collection(collection).doc(contentId);
  const caseId = `${type}_${contentId}`;
  const caseRef = db.collection('reportCases').doc(caseId);
  const reportRef = caseRef.collection('reports').doc(requestAuth.uid);
  let autoHidden = false;
  let reportCount = 0;

  await db.runTransaction(async (transaction) => {
    const [targetSnapshot, reportSnapshot, caseSnapshot] = await Promise.all([
      transaction.get(targetRef),
      transaction.get(reportRef),
      transaction.get(caseRef),
      assertTransactionWritable(transaction)
    ]);
    if (!targetSnapshot.exists) throw new HttpsError('not-found', 'Content not found.');
    if (reportSnapshot.exists) throw new HttpsError('already-exists', 'Content already reported.');

    const target = targetSnapshot.data() || {};
    if (target.deleted === true) throw new HttpsError('failed-precondition', 'Content was removed.');
    const authorUid = contentAuthorId(type, target);
    if (authorUid === requestAuth.uid) {
      throw new HttpsError('failed-precondition', 'You cannot report your own content.');
    }

    const caseData = caseSnapshot.data() || {};
    reportCount = Math.max(
      typeof caseData.reportCount === 'number' ? caseData.reportCount : 0,
      typeof target.reportCount === 'number' ? target.reportCount : 0
    ) + 1;
    autoHidden = reportCount >= REPORT_AUTO_HIDE_THRESHOLD;

    transaction.create(reportRef, {
      reporterUid: requestAuth.uid,
      reporter: publicSnapshot,
      reason,
      details,
      source: 'site',
      createdAt: FieldValue.serverTimestamp()
    });

    transaction.set(caseRef, {
      caseId,
      targetType: type,
      targetId: contentId,
      targetAuthorUid: authorUid,
      targetPreview: type === 'message'
        ? String(target.content || '').slice(0, 200)
        : String(target.caption || '').slice(0, 200),
      targetImageUrl: type === 'fanart' ? String(target.imageUrl || '') : '',
      status: caseData.status === 'reviewing' ? 'reviewing' : 'open',
      reportCount,
      latestReason: reason,
      latestAt: FieldValue.serverTimestamp(),
      createdAt: caseSnapshot.exists ? caseData.createdAt : FieldValue.serverTimestamp(),
      autoHidden
    }, { merge: true });

    const targetUpdate: Record<string, unknown> = { reportCount };
    if (autoHidden) {
      targetUpdate.hidden = true;
      targetUpdate.moderation = {
        status: 'auto_hidden',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'system',
        reason: `Auto-hidden after ${reportCount} reports`
      };
    }
    transaction.update(targetRef, targetUpdate);
  });

  await syncUserDirectory(user).catch((error) => console.error('User directory sync failed', error));
  return { caseId, reportCount, autoHidden };
});

export const fanartMedia = onRequest({
  region: REGION,
  cors: true,
  invoker: 'public',
  maxInstances: 10
}, async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.set('Allow', 'GET, HEAD').status(405).end();
    return;
  }

  const fanartId = typeof request.query.fanartId === 'string'
    ? request.query.fanartId.trim()
    : '';
  if (!fanartId || fanartId.length > 128 || fanartId.includes('/')) {
    response.status(400).end();
    return;
  }

  const snapshot = await db.collection('fanart').doc(fanartId).get();
  const fanart = snapshot.data() || {};
  let allowed = snapshot.exists && fanart.hidden === false && fanart.deleted !== true;

  if (!allowed) {
    const authorization = request.get('authorization') || '';
    if (authorization.startsWith('Bearer ')) {
      try {
        const decoded = await auth.verifyIdToken(authorization.slice(7), true);
        await validateAdminIdentity(decoded.uid, decoded);
        allowed = snapshot.exists;
      } catch {
        allowed = false;
      }
    }
  }

  const imagePath = validatedFanartStoragePath(fanartId, fanart.artistId, fanart.imagePath);
  if (!allowed || !imagePath) {
    response.status(404).end();
    return;
  }

  const file = storage.bucket().file(imagePath);
  try {
    const [metadata] = await file.getMetadata();
    const contentType = String(metadata.contentType || '');
    const contentLength = Number(metadata.size || 0);
    if (!IMAGE_TYPES[contentType] || !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 || contentLength > MAX_IMAGE_BYTES) {
      response.status(415).end();
      return;
    }

    response.set({
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff'
    });
    response.set('Content-Length', String(contentLength));
    if (request.method === 'HEAD') {
      response.status(200).end();
      return;
    }

    response.status(200);
    await pipeline(file.createReadStream(), response);
  } catch (error) {
    console.error('Fan art media delivery failed', error);
    if (!response.headersSent) response.status(404).end();
    else response.destroy();
  }
});

export const cleanupExpiredUploads = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: TIME_ZONE,
  region: REGION,
  maxInstances: 1
}, async () => {
  const snapshot = await db.collection('uploadTickets')
    .where('status', 'in', ['pending', 'cleanup_pending'])
    .where('expiresAt', '<=', Timestamp.now())
    .limit(100)
    .get();

  for (const ticketSnapshot of snapshot.docs) {
    let claimedPath = '';
    await db.runTransaction(async (transaction) => {
      claimedPath = '';
      const latest = await transaction.get(ticketSnapshot.ref);
      const latestData = latest.data();
      if (
        !latest.exists ||
        !latestData ||
        !['pending', 'cleanup_pending'].includes(String(latestData.status || ''))
      ) return;
      if (!(latestData.expiresAt instanceof Timestamp) || latestData.expiresAt.toMillis() > Date.now()) {
        return;
      }

      const statsRef = latestData.status === 'pending' && typeof latestData.uid === 'string'
        ? db.collection('userStats').doc(latestData.uid)
        : null;
      const statsSnapshot = statsRef ? await transaction.get(statsRef) : null;

      transaction.update(ticketSnapshot.ref, {
        status: 'cleanup_pending',
        cleanupStartedAt: FieldValue.serverTimestamp()
      });
      claimedPath = typeof latestData.path === 'string' ? latestData.path : '';

      if (
        statsRef &&
        statsSnapshot &&
        latestData.dailyKey === statsSnapshot.data()?.dailyKey
      ) {
        const pending = Number(statsSnapshot.data()?.pendingFanartCount || 0);
        transaction.set(statsRef, {
          pendingFanartCount: Math.max(0, pending - 1),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });

    if (claimedPath) {
      try {
        await storage.bucket().file(claimedPath).delete({ ignoreNotFound: true });
        await ticketSnapshot.ref.update({
          status: 'expired',
          expiredAt: FieldValue.serverTimestamp(),
          storageDeletedAt: FieldValue.serverTimestamp()
        });
      } catch (error) {
        console.error('Expired upload cleanup failed', error);
      }
    }
  }
});
