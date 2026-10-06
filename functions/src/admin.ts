import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  CALLABLE_OPTIONS,
  REGION,
  TIME_ZONE,
  asRecord,
  auditData,
  auth,
  contentAuthorId,
  contentCollection,
  db,
  markPublicContentChanged,
  optionalString,
  parseAdminRole,
  isPasswordSignIn,
  parseContentType,
  requiredEmail,
  requiredString,
  requireAdmin,
  requireAuth,
  requireOwner,
  serializeUser,
  serializeValue,
  storage,
  validatedFanartStoragePath,
  type AdminActor,
  type AdminRole,
  type ContentType
} from './core.js';
import { readContributionLimitSnapshot, requiredContributionUid } from './contribution-limits.js';

const bootstrapOwnerUid = defineString('BOOTSTRAP_OWNER_UID', { default: '' });

function serializeDoc(snapshot: QueryDocumentSnapshot): Record<string, unknown> {
  return { id: snapshot.id, ...(serializeValue(snapshot.data()) as Record<string, unknown>) };
}

async function findAuthUser(query: string) {
  try {
    return query.includes('@') ? await auth.getUserByEmail(query.toLowerCase()) : await auth.getUser(query);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function countQuery(query: FirebaseFirestore.Query): Promise<number> {
  const result = await query.count().get();
  return result.data().count;
}

async function hideExistingContent(uid: string, actor: AdminActor, reason: string): Promise<number> {
  const [messages, fanart] = await Promise.all([
    db.collection('messages').where('authorId', '==', uid).get(),
    db.collection('fanart').where('artistId', '==', uid).get()
  ]);
  const documents = [...messages.docs, ...fanart.docs];

  for (let start = 0; start < documents.length; start += 200) {
    const batch = db.batch();
    const changed = new Set<string>();
    for (const document of documents.slice(start, start + 200)) {
      const type = document.ref.parent.id === 'messages' ? 'message' : 'fanart';
      changed.add(type === 'message' ? 'messagesRevision' : 'fanartRevision');
      batch.update(document.ref, {
        hidden: true,
        moderation: {
          status: 'admin_hidden',
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          reason
        }
      });
      batch.create(db.collection('adminAuditLogs').doc(), auditData(
        actor,
        'content.hide_restricted',
        type,
        document.id,
        reason,
        { restrictedUserUid: uid }
      ));
    }
    batch.set(db.doc('system/publicContentRevision'), {
      ...Object.fromEntries([...changed].map(field => [field, FieldValue.increment(1)])),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();
  }
  return documents.length;
}

export const getDashboard = onCall(CALLABLE_OPTIONS, async (request) => {
  await requireAdmin(request);

  const [
    openReports,
    hiddenMessages,
    hiddenFanart,
    mutedUsers,
    bannedUsers,
    recentCases,
    recentAudit
  ] = await Promise.all([
    countQuery(db.collection('reportCases').where('status', 'in', ['open', 'reviewing'])),
    countQuery(db.collection('messages').where('hidden', '==', true)),
    countQuery(db.collection('fanart').where('hidden', '==', true)),
    countQuery(db.collection('userRestrictions').where('state', '==', 'muted')),
    countQuery(db.collection('userRestrictions').where('state', '==', 'banned')),
    db.collection('reportCases').orderBy('latestAt', 'desc').limit(8).get(),
    db.collection('adminAuditLogs').orderBy('createdAt', 'desc').limit(8).get()
  ]);

  return {
    metrics: {
      openReports,
      hiddenContent: hiddenMessages + hiddenFanart,
      mutedUsers,
      bannedUsers
    },
    recentCases: recentCases.docs.map(serializeDoc),
    recentAudit: recentAudit.docs.map(serializeDoc)
  };
});

export const listUsers = onCall(CALLABLE_OPTIONS, async (request) => {
  await requireAdmin(request);
  const data = asRecord(request.data || {});
  const query = optionalString(data.query, 'query', 254);
  const requestedPageSize = typeof data.pageSize === 'number' ? data.pageSize : 25;
  const pageSize = Math.max(1, Math.min(50, Math.floor(requestedPageSize)));

  if (query) {
    const user = await findAuthUser(query);
    if (!user) return { users: [], pageToken: null };
    const restriction = await db.collection('userRestrictions').doc(user.uid).get();
    return {
      users: [serializeUser(user, restriction.data())],
      pageToken: null
    };
  }

  const pageToken = typeof data.pageToken === 'string' ? data.pageToken : undefined;
  const result = await auth.listUsers(pageSize, pageToken);
  const restrictions = result.users.length
    ? await db.getAll(
      ...result.users.map((user) => db.collection('userRestrictions').doc(user.uid))
    )
    : [];
  return {
    users: result.users.map((user, index) => serializeUser(user, restrictions[index]?.data())),
    pageToken: result.pageToken || null
  };
});

export const getUser = onCall(CALLABLE_OPTIONS, async (request) => {
  await requireAdmin(request);
  const data = asRecord(request.data);
  const uid = requiredContributionUid(data.uid);
  const user = await auth.getUser(uid).catch((error) => {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'User not found.');
    }
    throw error;
  });

  const [restriction, messages, fanart, contributionLimits] = await Promise.all([
    db.collection('userRestrictions').doc(uid).get(),
    db.collection('messages').where('authorId', '==', uid).orderBy('createdAt', 'desc').limit(20).get(),
    db.collection('fanart').where('artistId', '==', uid).orderBy('createdAt', 'desc').limit(20).get(),
    readContributionLimitSnapshot(uid)
  ]);

  return {
    user: serializeUser(user, restriction.data()),
    messages: messages.docs.map(serializeDoc),
    fanart: fanart.docs.map(serializeDoc),
    contributionLimits
  };
});

export const moderateContent = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireAdmin(request);
  const data = asRecord(request.data);
  const type = parseContentType(data.contentType);
  const contentId = requiredString(data.contentId, 'contentId', 1, 128);
  const action = requiredString(data.action, 'action', 4, 20);
  const reason = requiredString(data.reason, 'reason', 3, 500);
  if (!['hide', 'restore', 'remove'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported moderation action.');
  }
  if (action === 'remove' && actor.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only an Owner can permanently remove content.');
  }

  const collection = contentCollection(type);
  const targetRef = db.collection(collection).doc(contentId);
  const reportCaseRef = db.collection('reportCases').doc(`${type}_${contentId}`);
  const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) throw new HttpsError('not-found', 'Content not found.');
  const target = targetSnapshot.data() || {};
  if (target.deleted === true && action !== 'remove') {
    throw new HttpsError('failed-precondition', 'Content was permanently removed.');
  }
  if (action === 'restore' && target.hidden !== true) {
    throw new HttpsError('failed-precondition', 'Content is already visible.');
  }
  if (
    action === 'hide' &&
    target.hidden === true &&
    target.moderation?.status === 'admin_hidden'
  ) {
    throw new HttpsError('failed-precondition', 'Content is already hidden by an administrator.');
  }

  const storedImagePath = target.imagePath || target.removedImagePath;
  const imagePathToDelete = action === 'remove' && type === 'fanart'
    ? validatedFanartStoragePath(contentId, target.artistId, storedImagePath)
    : '';
  if (action === 'remove' && type === 'fanart' && storedImagePath && !imagePathToDelete) {
    throw new HttpsError('failed-precondition', 'Fan art Storage ownership could not be verified.');
  }

  const update: Record<string, unknown> = {
    hidden: action !== 'restore',
    moderation: {
      status: action === 'restore' ? 'visible' : action === 'remove' ? 'removed' : 'admin_hidden',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      reason
    }
  };

  if (action === 'remove') {
    update.deleted = true;
    if (type === 'message') update.content = '';
    if (type === 'fanart') {
      update.caption = '';
      update.removedImagePath = imagePathToDelete;
      update.imagePath = '';
      update.imageUrl = '';
      update.postUrl = '';
      update.postId = '';
      update.curation = FieldValue.delete();
    }
  }

  const auditRef = db.collection('adminAuditLogs').doc();
  await db.runTransaction(async (transaction) => {
    const latestTarget = await transaction.get(targetRef);
    const sameVersion = latestTarget.exists === targetSnapshot.exists && Boolean(
      latestTarget.updateTime &&
      targetSnapshot.updateTime &&
      latestTarget.updateTime.isEqual(targetSnapshot.updateTime)
    );
    if (!sameVersion) {
      throw new HttpsError('aborted', 'Content changed during the moderation request.');
    }

    const latestReportCase = action === 'remove'
      ? await transaction.get(reportCaseRef)
      : null;
    transaction.update(targetRef, update);
    markPublicContentChanged(transaction, type);
    if (latestReportCase?.exists) {
      transaction.update(reportCaseRef, {
        targetPreview: '',
        targetImageUrl: '',
        targetPostUrl: '',
        targetRemoved: true,
        targetRemovedAt: FieldValue.serverTimestamp()
      });
    }
    transaction.create(auditRef, auditData(actor, `content.${action}`, type, contentId, reason, {
      authorUid: contentAuthorId(type, target)
    }));
  });

  if (imagePathToDelete) {
    await storage.bucket().file(imagePathToDelete).delete({ ignoreNotFound: true });
    await targetRef.update({
      removedImagePath: '',
      storageRemovedAt: FieldValue.serverTimestamp()
    });
  }
  return { id: contentId, action };
});

export const resolveReportCase = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireAdmin(request);
  const data = asRecord(request.data);
  const caseId = requiredString(data.caseId, 'caseId', 1, 260);
  const status = requiredString(data.status, 'status', 4, 20);
  const note = optionalString(data.note, 'note', 1000);
  if (!['reviewing', 'resolved', 'dismissed'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Unsupported case status.');
  }

  const caseRef = db.collection('reportCases').doc(caseId);
  const snapshot = await caseRef.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Report case not found.');
  const currentStatus = String(snapshot.data()?.status || 'open');
  if (currentStatus === 'resolved' || currentStatus === 'dismissed') {
    throw new HttpsError('failed-precondition', 'The report case is already closed.');
  }
  if (status === 'reviewing' && currentStatus !== 'open') {
    throw new HttpsError('failed-precondition', 'The report case is already under review.');
  }

  const auditRef = db.collection('adminAuditLogs').doc();
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(caseRef);
    const sameVersion = latest.exists === snapshot.exists && Boolean(
      latest.updateTime && snapshot.updateTime && latest.updateTime.isEqual(snapshot.updateTime)
    );
    if (!sameVersion) {
      throw new HttpsError('aborted', 'Report case changed during the request.');
    }
    transaction.update(caseRef, {
      status,
      resolutionNote: note,
      assignedTo: status === 'reviewing' ? actor.uid : '',
      resolvedAt: status === 'resolved' || status === 'dismissed'
        ? FieldValue.serverTimestamp()
        : null,
      resolvedBy: status === 'resolved' || status === 'dismissed' ? actor.uid : '',
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(auditRef, auditData(actor, `report.${status}`, 'reportCase', caseId, note));
  });
  return { caseId, status };
});

export const setUserRestriction = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireAdmin(request);
  const data = asRecord(request.data);
  const uid = requiredString(data.uid, 'uid', 1, 128);
  const action = requiredString(data.action, 'action', 3, 20);
  const reason = optionalString(data.reason, 'reason', 500);
  const hideExisting = data.hideExisting === true;
  if (!['mute', 'ban', 'clear'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported restriction action.');
  }
  if (action !== 'clear' && reason.length < 3) {
    throw new HttpsError('invalid-argument', 'A restriction reason is required.');
  }

  const restrictionRef = db.collection('userRestrictions').doc(uid);
  const [targetUser, restrictionSnapshot] = await Promise.all([
    auth.getUser(uid).catch((error) => {
      if ((error as { code?: string }).code === 'auth/user-not-found') {
        throw new HttpsError('not-found', 'User not found.');
      }
      throw error;
    }),
    restrictionRef.get()
  ]);
  if (parseAdminRole(targetUser.customClaims?.adminRole)) {
    throw new HttpsError('failed-precondition', 'Administrators must be managed as administrators.');
  }
  const existingRestriction = restrictionSnapshot.data() || {};
  if (
    action === 'mute' &&
    (existingRestriction.state === 'banned' || existingRestriction.authEnablePending === true)
  ) {
    throw new HttpsError('failed-precondition', 'Clear the existing ban before applying a mute.');
  }
  if (action === 'mute' && targetUser.disabled) {
    throw new HttpsError('failed-precondition', 'A disabled Auth account cannot be muted.');
  }
  if (action === 'ban' && existingRestriction.authEnablePending === true) {
    throw new HttpsError('failed-precondition', 'The previous Auth enable operation is still pending.');
  }
  if (action === 'clear' && existingRestriction.authDisablePending === true) {
    throw new HttpsError('failed-precondition', 'Retry the pending ban before clearing it.');
  }
  if (
    action === 'clear' &&
    (!restrictionSnapshot.exists || (
      existingRestriction.state !== 'muted' &&
      existingRestriction.state !== 'banned' &&
      existingRestriction.authEnablePending !== true &&
      existingRestriction.authWasDisabledBeforeBan === undefined
    ))
  ) {
    throw new HttpsError('failed-precondition', 'The user has no active governance restriction.');
  }

  let mutedUntil: Timestamp | null = null;
  if (action === 'mute') {
    const expiresAt = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : Number(data.expiresAt);
    const maximum = Date.now() + 366 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > maximum) {
      throw new HttpsError('invalid-argument', 'Mute expiry must be within the next year.');
    }
    mutedUntil = Timestamp.fromMillis(expiresAt);
  }

  const previouslyDisabled = existingRestriction.state === 'banned' ||
    existingRestriction.authEnablePending === true
    ? existingRestriction.authWasDisabledBeforeBan === true
    : targetUser.disabled;
  const governanceDisabled = existingRestriction.authEnablePending === true ||
    (existingRestriction.state === 'banned' &&
      existingRestriction.authWasDisabledBeforeBan !== true);
  const shouldDisableAuth = action === 'ban' && !targetUser.disabled;
  const shouldEnableAuth = action === 'clear' && targetUser.disabled && governanceDisabled;
  const shouldRevokeAuth = action === 'clear' && governanceDisabled;
  const auditRef = db.collection('adminAuditLogs').doc();
  const restrictionUpdate = action === 'clear'
    ? {
      uid,
      state: 'active',
      mutedUntil: null,
      reason: '',
      authEnablePending: shouldRevokeAuth,
      clearedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid
    }
    : {
      uid,
      state: action === 'ban' ? 'banned' : 'muted',
      mutedUntil,
      reason,
      ...(action === 'ban' ? {
        authWasDisabledBeforeBan: previouslyDisabled,
        authDisablePending: shouldDisableAuth
      } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid
    };

  await db.runTransaction(async (transaction) => {
    const latestRestriction = await transaction.get(restrictionRef);
    const sameVersion = latestRestriction.exists === restrictionSnapshot.exists &&
      (!latestRestriction.exists || Boolean(
        latestRestriction.updateTime &&
        restrictionSnapshot.updateTime &&
        latestRestriction.updateTime.isEqual(restrictionSnapshot.updateTime)
      ));
    if (!sameVersion) {
      throw new HttpsError('aborted', 'The user restriction changed during the request.');
    }

    if (action === 'clear') {
      transaction.set(restrictionRef, restrictionUpdate, { merge: true });
    } else {
      transaction.set(restrictionRef, restrictionUpdate);
    }
    transaction.create(auditRef, auditData(actor, `user.${action}`, 'user', uid, reason, {
      mutedUntil: mutedUntil?.toDate().toISOString() || null,
      hideExisting,
      authWasDisabledBeforeBan: action === 'ban' ? previouslyDisabled : null,
      authDisableRequested: action === 'ban' ? shouldDisableAuth : null,
      authEnableRequested: action === 'clear' ? shouldEnableAuth : null,
      authRevokeRequested: action === 'clear' ? shouldRevokeAuth : null
    }));
  });

  if (action === 'ban') {
    if (shouldDisableAuth) await auth.updateUser(uid, { disabled: true });
    await auth.revokeRefreshTokens(uid);
    await restrictionRef.update({
      authDisablePending: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
  } else if (action === 'clear') {
    if (shouldEnableAuth) {
      await auth.updateUser(uid, { disabled: false });
    }
    if (shouldRevokeAuth) {
      await auth.revokeRefreshTokens(uid);
    }
    await restrictionRef.update({
      authEnablePending: FieldValue.delete(),
      authWasDisabledBeforeBan: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  const hiddenCount = hideExisting && action !== 'clear'
    ? await hideExistingContent(uid, actor, reason)
    : 0;
  return { uid, action, hiddenCount };
});

export const expireMutedRestrictions = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: TIME_ZONE,
  region: REGION,
  maxInstances: 1
}, async () => {
  const snapshot = await db.collection('userRestrictions')
    .where('state', '==', 'muted')
    .where('mutedUntil', '<=', Timestamp.now())
    .limit(200)
    .get();
  if (snapshot.empty) return;

  for (const restriction of snapshot.docs) {
    await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(restriction.ref);
      const data = latest.data();
      if (
        !latest.exists ||
        data?.state !== 'muted' ||
        !(data.mutedUntil instanceof Timestamp) ||
        data.mutedUntil.toMillis() > Date.now()
      ) return;

      transaction.update(restriction.ref, {
        state: 'active',
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'system'
      });
      transaction.create(db.collection('adminAuditLogs').doc(), {
        actorUid: 'system',
        actorEmail: '',
        actorDisplayName: 'System',
        actorRole: 'system',
        action: 'user.mute_expired',
        targetType: 'user',
        targetId: restriction.id,
        reason: 'Mute expired',
        details: {},
        createdAt: FieldValue.serverTimestamp()
      });
    });
  }
});

export const inviteAdmin = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireOwner(request);
  const data = asRecord(request.data);
  const email = requiredEmail(data.email);
  const displayName = requiredString(data.displayName, 'displayName', 1, 100);
  const role = parseAdminRole(data.role);
  if (!role) throw new HttpsError('invalid-argument', 'Unsupported administrator role.');

  let user = await findAuthUser(email);
  let created = false;
  if (!user) {
    user = await auth.createUser({
      email,
      displayName,
      password: `Aa1!${randomBytes(32).toString('base64url')}`,
      disabled: false
    });
    created = true;
  } else {
    const [existingAccount, existingRestriction] = await Promise.all([
      db.collection('adminAccounts').doc(user.uid).get(),
      db.collection('userRestrictions').doc(user.uid).get()
    ]);
    if (existingAccount.exists) {
      throw new HttpsError('already-exists', 'Use administrator management for an existing administrator.');
    }
    if (
      user.disabled ||
      ['muted', 'banned'].includes(String(existingRestriction.data()?.state || ''))
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Clear the existing user restriction before inviting this administrator.'
      );
    }
    user = await auth.updateUser(user.uid, {
      displayName,
      password: `Aa1!${randomBytes(32).toString('base64url')}`
    });
  }

  const accountRef = db.collection('adminAccounts').doc(user.uid);
  const sessionVersion = (Number(user.customClaims?.adminSessionVersion) || 0) + 1;

  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    adminRole: role,
    adminSessionVersion: sessionVersion
  });
  await auth.revokeRefreshTokens(user.uid);

  const auditRef = db.collection('adminAuditLogs').doc();
  const batch = db.batch();
  batch.set(accountRef, {
    uid: user.uid,
    email,
    displayName,
    role,
    sessionVersion,
    disabled: false,
    status: created ? 'invited' : 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  }, { merge: true });
  batch.create(auditRef, auditData(actor, 'admin.invite', 'admin', user.uid, '', {
    email,
    role,
    created
  }));
  await batch.commit();
  return { uid: user.uid, email, created };
});

export const updateAdminAccount = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireOwner(request);
  const data = asRecord(request.data);
  const uid = requiredString(data.uid, 'uid', 1, 128);
  const role = data.role === undefined ? null : parseAdminRole(data.role);
  const disabled = data.disabled === undefined ? null : data.disabled;
  const revokeSessions = data.revokeSessions === true;
  if (data.role !== undefined && !role) {
    throw new HttpsError('invalid-argument', 'Unsupported administrator role.');
  }
  if (disabled !== null && typeof disabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'disabled must be a boolean.');
  }
  if (role === null && disabled === null && !revokeSessions) {
    throw new HttpsError('invalid-argument', 'No administrator change was requested.');
  }
  if (uid === actor.uid && (disabled === true || role === 'moderator')) {
    throw new HttpsError('failed-precondition', 'You cannot disable or demote your own account.');
  }

  const [user, accountSnapshot] = await Promise.all([
    auth.getUser(uid),
    db.collection('adminAccounts').doc(uid).get()
  ]);
  if (!accountSnapshot.exists) throw new HttpsError('not-found', 'Administrator not found.');
  const account = accountSnapshot.data() || {};
  const accountRole = parseAdminRole(account.role);
  const claimRole = parseAdminRole(user.customClaims?.adminRole);
  const accountSessionVersion = Number(account.sessionVersion);
  const claimSessionVersion = Number(user.customClaims?.adminSessionVersion);
  if (
    !accountRole ||
    accountRole !== claimRole ||
    !Number.isSafeInteger(accountSessionVersion) ||
    accountSessionVersion < 1 ||
    accountSessionVersion !== claimSessionVersion ||
    (account.disabled === true) !== user.disabled
  ) {
    throw new HttpsError('failed-precondition', 'Administrator authority data requires repair.');
  }

  const nextRole: AdminRole = role || accountRole;
  const nextDisabled = disabled === null ? user.disabled : disabled;
  const nextSessionVersion = accountSessionVersion + 1;
  const isPrivilegeElevation =
    (accountRole === 'moderator' && nextRole === 'owner') ||
    (user.disabled && !nextDisabled);
  const accountRef = db.collection('adminAccounts').doc(uid);
  const auditRef = db.collection('adminAuditLogs').doc();
  const applyAccountAuthority = () => db.runTransaction(async (transaction) => {
    const latestAccountSnapshot = await transaction.get(accountRef);
    const latestActorSnapshot = actor.uid === uid
      ? latestAccountSnapshot
      : await transaction.get(db.collection('adminAccounts').doc(actor.uid));
    const latestActor = latestActorSnapshot.data() || {};
    if (
      !latestActorSnapshot.exists ||
      latestActor.role !== 'owner' ||
      latestActor.disabled === true ||
      Number(latestActor.sessionVersion) !== actor.sessionVersion
    ) {
      throw new HttpsError('permission-denied', 'Owner authority changed during the request.');
    }
    if (!latestAccountSnapshot.exists) {
      throw new HttpsError('not-found', 'Administrator not found.');
    }
    const latestAccount = latestAccountSnapshot.data() || {};
    if (
      latestAccount.role !== accountRole ||
      (latestAccount.disabled === true) !== user.disabled ||
      Number(latestAccount.sessionVersion) !== accountSessionVersion
    ) {
      throw new HttpsError('aborted', 'Administrator account changed during the request.');
    }

    if (accountRole === 'owner' && (nextRole === 'moderator' || nextDisabled)) {
      const owners = await transaction.get(
        db.collection('adminAccounts')
          .where('role', '==', 'owner')
          .where('disabled', '==', false)
      );
      if (owners.size <= 1) {
        throw new HttpsError('failed-precondition', 'The final Owner cannot be disabled or demoted.');
      }
    }

    transaction.set(accountRef, {
      role: nextRole,
      sessionVersion: nextSessionVersion,
      disabled: nextDisabled,
      status: nextDisabled ? 'disabled' : 'active',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid
    }, { merge: true });
    transaction.create(auditRef, auditData(actor, 'admin.update', 'admin', uid, '', {
      role: nextRole,
      disabled: nextDisabled,
      revokeSessions
    }));
  });

  const applyAuthAuthority = async () => {
    await auth.updateUser(uid, { disabled: nextDisabled });
    await auth.setCustomUserClaims(uid, {
      ...(user.customClaims || {}),
      adminRole: nextRole,
      adminSessionVersion: nextSessionVersion
    });
    await auth.revokeRefreshTokens(uid);
  };

  if (isPrivilegeElevation) {
    await applyAuthAuthority();
    await applyAccountAuthority();
  } else {
    await applyAccountAuthority();
    await applyAuthAuthority();
  }
  return { uid, role: nextRole, disabled: nextDisabled };
});

export const bootstrapOwner = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestAuth = requireAuth(request);
  const expectedUid = bootstrapOwnerUid.value().trim();
  if (!expectedUid || requestAuth.uid !== expectedUid) {
    throw new HttpsError('permission-denied', 'This account is not authorized for bootstrap.');
  }
  if (!isPasswordSignIn(requestAuth.token)) {
    throw new HttpsError('failed-precondition', 'Bootstrap requires an email/password account.');
  }

  const user = await auth.getUser(requestAuth.uid);
  const googleProvider = user.providerData.find((provider) => provider.providerId === 'google.com');
  if (
    !user.email ||
    !googleProvider?.email ||
    googleProvider.email.toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Bootstrap requires the matching Google account to remain linked.'
    );
  }

  const lockRef = db.collection('system').doc('bootstrap');
  const lock = await lockRef.get();
  if (lock.exists) throw new HttpsError('already-exists', 'Owner bootstrap is already complete.');
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    adminRole: 'owner',
    adminSessionVersion: 1
  });

  const actor: AdminActor = {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    role: 'owner',
    sessionVersion: 1
  };
  const accountRef = db.collection('adminAccounts').doc(user.uid);
  const auditRef = db.collection('adminAuditLogs').doc();
  const batch = db.batch();
  batch.create(lockRef, {
    ownerUid: user.uid,
    completedAt: FieldValue.serverTimestamp()
  });
  batch.set(accountRef, {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    role: 'owner',
    sessionVersion: 1,
    disabled: false,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid
  });
  batch.create(auditRef, auditData(actor, 'admin.bootstrap', 'admin', user.uid, 'Initial Owner'));
  await batch.commit();
  return { uid: user.uid, role: 'owner', refreshToken: true };
});

export const recordAdminLogin = onCall(CALLABLE_OPTIONS, async (request) => {
  const actor = await requireAdmin(request);
  await db.collection('adminAccounts').doc(actor.uid).set({
    lastLoginAt: FieldValue.serverTimestamp(),
    status: 'active',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { recorded: true };
});
