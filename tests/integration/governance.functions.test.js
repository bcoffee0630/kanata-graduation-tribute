import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { deleteApp, initializeApp as initializeClientApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInWithEmailAndPassword
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from 'firebase/functions';
import {
  connectStorageEmulator,
  getStorage as getClientStorage,
  ref,
  uploadBytes
} from 'firebase/storage';
import { deleteApp as deleteAdminApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = 'demo-kanata-governance';
const migrationProjectId = 'demo-kanata-migration';
const password = 'GovernanceTest!234';
const clientApps = [];
const users = {
  author: { uid: 'integration-author', email: 'author@example.test', displayName: 'Author' },
  reporter1: { uid: 'integration-reporter-1', email: 'reporter1@example.test', displayName: 'Reporter 1' },
  reporter2: { uid: 'integration-reporter-2', email: 'reporter2@example.test', displayName: 'Reporter 2' },
  reporter3: { uid: 'integration-reporter-3', email: 'reporter3@example.test', displayName: 'Reporter 3' },
  restricted: { uid: 'integration-restricted', email: 'restricted@example.test', displayName: 'Restricted' },
  passwordOnly: { uid: 'integration-password-only', email: 'password-only@example.test', displayName: 'Password Only' },
  owner: { uid: 'integration-owner', email: 'owner@example.test', displayName: 'Owner' },
  ownerPeer: { uid: 'integration-owner-peer', email: 'owner-peer@example.test', displayName: 'Owner Peer' },
  moderator: { uid: 'integration-moderator', email: 'moderator@example.test', displayName: 'Moderator' }
};

let adminAuth;
let adminStorage;
let db;
let clients;
let reportedMessageId;
let uploadedFanartId;
let uploadedFanartPath;
let migrationAdminApp;

async function createClient(spec, role = null, provider = role ? 'password' : 'google.com') {
  const existing = await adminAuth.getUserByEmail(spec.email).catch(() => null);
  if (existing) await adminAuth.deleteUser(existing.uid);
  if (provider === 'password') {
    await adminAuth.createUser({ ...spec, password });
  }
  if (role && provider === 'password') {
    await adminAuth.setCustomUserClaims(spec.uid, {
      adminRole: role,
      adminSessionVersion: 1
    });
    await db.collection('adminAccounts').doc(spec.uid).set({
      uid: spec.uid,
      email: spec.email,
      displayName: spec.displayName,
      role,
      sessionVersion: 1,
      disabled: false,
      status: 'active',
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  const app = initializeClientApp({
    projectId,
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    storageBucket: `${projectId}.appspot.com`
  }, `client-${spec.uid}`);
  clientApps.push(app);

  const auth = getClientAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  if (provider === 'password') {
    await signInWithEmailAndPassword(auth, spec.email, password);
  } else {
    const mockIdToken = JSON.stringify({
      sub: spec.uid,
      email: spec.email,
      email_verified: true,
      name: spec.displayName
    });
    await signInWithCredential(auth, GoogleAuthProvider.credential(mockIdToken));
    spec.uid = auth.currentUser.uid;
  }
  const functions = getFunctions(app, 'asia-east1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const storage = getClientStorage(app);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  return { app, auth, functions, storage };
}

async function createGoogleSessionForExistingUser(spec, passwordClient) {
  const mockIdToken = JSON.stringify({
    sub: spec.uid,
    email: spec.email,
    email_verified: true,
    name: spec.displayName
  });
  const credential = GoogleAuthProvider.credential(mockIdToken);
  await linkWithCredential(passwordClient.auth.currentUser, credential);
  await passwordClient.auth.signOut();
  await signInWithEmailAndPassword(passwordClient.auth, spec.email, password);

  const app = initializeClientApp({
    projectId,
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`
  }, `client-${spec.uid}-google`);
  clientApps.push(app);
  const auth = getClientAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInWithCredential(auth, credential);
  const functions = getFunctions(app, 'asia-east1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return { app, auth, functions };
}

function call(client, name, data = {}) {
  return httpsCallable(client.functions, name)(data);
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8180';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  if (!getApps().length) initializeApp({
    projectId,
    storageBucket: `${projectId}.appspot.com`
  });
  adminAuth = getAuth();
  adminStorage = getStorage();
  db = getFirestore();

  clients = {
    author: await createClient(users.author),
    reporter1: await createClient(users.reporter1),
    reporter2: await createClient(users.reporter2),
    reporter3: await createClient(users.reporter3),
    restricted: await createClient(users.restricted),
    passwordOnly: await createClient(users.passwordOnly, null, 'password'),
    owner: await createClient(users.owner, 'owner'),
    ownerPeer: await createClient(users.ownerPeer, 'owner'),
    moderator: await createClient(users.moderator, 'moderator')
  };
  clients.ownerGoogle = await createGoogleSessionForExistingUser(users.owner, clients.owner);
}, 30_000);

afterAll(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  if (migrationAdminApp) await deleteAdminApp(migrationAdminApp);
});

describe.sequential('governance callable APIs', () => {
  it('binds submissions to the authenticated UID and enforces server quotas', async () => {
    await expect(call(clients.passwordOnly, 'submitMessage', {
      content: 'Password-only contribution attempt'
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });

    const first = await call(clients.author, 'submitMessage', {
      content: 'A server-owned identity message',
      authorId: 'spoofed-user'
    });
    reportedMessageId = first.data.id;
    const message = (await db.collection('messages').doc(reportedMessageId).get()).data();
    expect(message.authorId).toBe(users.author.uid);
    expect(message.submitter.uid).toBe(users.author.uid);
    expect(message.submitter.providerId).toBe('google.com');
    expect(message.hidden).toBe(false);

    await call(clients.author, 'submitMessage', { content: 'Second quota message' });
    await call(clients.author, 'submitMessage', { content: 'Third quota message' });
    await expect(call(clients.author, 'submitMessage', { content: 'Fourth quota message' }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted' });
  });

  it('blocks every public mutation while the production maintenance lock is enabled', async () => {
    const pendingTicket = await call(clients.reporter1, 'beginFanartUpload', {
      contentType: 'image/png',
      size: 8
    });
    const maintenanceRef = db.collection('system').doc('maintenance');
    await maintenanceRef.set({ enabled: true });
    try {
      await expect(call(clients.reporter1, 'submitMessage', { content: 'Maintenance write' }))
        .rejects.toMatchObject({ code: 'functions/unavailable' });
      await expect(call(clients.reporter1, 'beginFanartUpload', {
        contentType: 'image/png', size: 8
      })).rejects.toMatchObject({ code: 'functions/unavailable' });
      await expect(call(clients.reporter1, 'finalizeFanartUpload', {
        ticketId: pendingTicket.data.ticketId
      })).rejects.toMatchObject({ code: 'functions/unavailable' });
      await expect(call(clients.reporter1, 'submitReport', {
        contentType: 'message', contentId: reportedMessageId, reason: 'spam',
        details: 'Maintenance report attempt'
      })).rejects.toMatchObject({ code: 'functions/unavailable' });
    } finally {
      await maintenanceRef.delete();
    }
  });

  it('blocks self and duplicate reports and auto-hides at three unique reporters', async () => {
    const report = (client) => call(client, 'submitReport', {
      contentType: 'message',
      contentId: reportedMessageId,
      reason: 'spam',
      details: 'Repeated promotional content'
    });

    await expect(report(clients.author))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });
    await report(clients.reporter1);
    await expect(report(clients.reporter1))
      .rejects.toMatchObject({ code: 'functions/already-exists' });
    await report(clients.reporter2);
    const threshold = await report(clients.reporter3);
    expect(threshold.data).toMatchObject({ reportCount: 3, autoHidden: true });

    const message = (await db.collection('messages').doc(reportedMessageId).get()).data();
    const reportCase = (await db.collection('reportCases').doc(`message_${reportedMessageId}`).get()).data();
    const reporters = await db.collection('reportCases').doc(`message_${reportedMessageId}`)
      .collection('reports').get();
    expect(message.hidden).toBe(true);
    expect(reportCase.status).toBe('open');
    expect(reporters.size).toBe(3);
  });

  it('prevents concurrent report-case decisions from overwriting each other', async () => {
    const caseId = 'message_integration-concurrent-report';
    await db.collection('reportCases').doc(caseId).set({
      contentType: 'message',
      contentId: 'integration-concurrent-report',
      status: 'open',
      reportCount: 1,
      latestAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    const competingDecisions = await Promise.allSettled([
      call(clients.moderator, 'resolveReportCase', {
        caseId,
        status: 'resolved',
        note: 'Concurrent resolution decision'
      }),
      call(clients.owner, 'resolveReportCase', {
        caseId,
        status: 'dismissed',
        note: 'Concurrent dismissal decision'
      })
    ]);

    expect(competingDecisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competingDecisions.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const reportCase = (await db.collection('reportCases').doc(caseId).get()).data();
    expect(['resolved', 'dismissed']).toContain(reportCase.status);
    const audits = await db.collection('adminAuditLogs').where('targetId', '==', caseId).get();
    expect(audits.size).toBe(1);
  });

  it('uses upload tickets and records a trusted fan art submitter', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ticket = await call(clients.author, 'beginFanartUpload', {
      contentType: 'image/png',
      size: bytes.byteLength
    });
    await uploadBytes(ref(clients.author.storage, ticket.data.path), bytes, {
      contentType: 'image/png'
    });
    const [uploadedMetadata] = await adminStorage.bucket().file(ticket.data.path).getMetadata();
    const uploadToken = uploadedMetadata.metadata?.firebaseStorageDownloadTokens;
    expect(uploadToken).toBeTruthy();
    const finalized = await call(clients.author, 'finalizeFanartUpload', {
      ticketId: ticket.data.ticketId,
      caption: 'Ticket-backed fan art',
      artistLink: 'https://example.com/artist'
    });
    uploadedFanartId = finalized.data.id;
    uploadedFanartPath = ticket.data.path;
    const fanart = (await db.collection('fanart').doc(finalized.data.id).get()).data();
    expect(fanart.artistId).toBe(users.author.uid);
    expect(fanart.submitter.uid).toBe(users.author.uid);
    expect(fanart.submitter.providerId).toBe('google.com');
    expect(fanart.imagePath).toBe(ticket.data.path);
    expect(fanart.imageUrl).toBe(`/api/fanart-media?fanartId=${finalized.data.id}`);
    const [storedMetadata] = await adminStorage.bucket().file(ticket.data.path).getMetadata();
    expect(storedMetadata.metadata?.firebaseStorageDownloadTokens).toBeFalsy();
    const leakedUploadUrl = `http://127.0.0.1:9199/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(ticket.data.path)}?alt=media&token=${encodeURIComponent(uploadToken)}`;
    expect((await fetch(leakedUploadUrl)).status).not.toBe(200);
    const media = await fetch(
      `http://127.0.0.1:5001/${projectId}/asia-east1/fanartMedia?fanartId=${finalized.data.id}`
    );
    expect(media.status).toBe(200);
    expect((await media.arrayBuffer()).byteLength).toBe(bytes.byteLength);
  });

  it('honors mute expiry and disables banned Auth accounts', async () => {
    const restriction = db.collection('userRestrictions').doc(users.restricted.uid);
    await restriction.set({
      uid: users.restricted.uid,
      state: 'muted',
      mutedUntil: Timestamp.fromMillis(Date.now() + 60_000)
    });
    await expect(call(clients.restricted, 'submitMessage', { content: 'Muted message attempt' }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });

    await restriction.update({ mutedUntil: Timestamp.fromMillis(Date.now() - 1_000) });
    await call(clients.restricted, 'submitMessage', { content: 'Mute has expired' });
    await call(clients.owner, 'setUserRestriction', {
      uid: users.restricted.uid,
      action: 'ban',
      reason: 'Repeated abuse',
      hideExisting: false
    });
    expect((await adminAuth.getUser(users.restricted.uid)).disabled).toBe(true);
    expect((await restriction.get()).data().state).toBe('banned');

    await call(clients.owner, 'setUserRestriction', {
      uid: users.restricted.uid,
      action: 'clear'
    });
    expect((await adminAuth.getUser(users.restricted.uid)).disabled).toBe(false);
    const clearedRestriction = (await restriction.get()).data();
    expect(clearedRestriction.state).toBe('active');
    expect(clearedRestriction).not.toHaveProperty('authEnablePending');
    expect(clearedRestriction).not.toHaveProperty('authWasDisabledBeforeBan');

    const preDisabledUid = 'integration-pre-disabled';
    await adminAuth.deleteUser(preDisabledUid).catch(() => {});
    await adminAuth.createUser({
      uid: preDisabledUid,
      email: 'pre-disabled@example.test',
      disabled: true
    });
    await call(clients.owner, 'setUserRestriction', {
      uid: preDisabledUid,
      action: 'ban',
      reason: 'Preserve an existing Auth disable',
      hideExisting: false
    });
    await call(clients.owner, 'setUserRestriction', {
      uid: preDisabledUid,
      action: 'clear'
    });
    expect((await adminAuth.getUser(preDisabledUid)).disabled).toBe(true);
    const preDisabledRestriction = (await db.collection('userRestrictions').doc(preDisabledUid).get()).data();
    expect(preDisabledRestriction.state).toBe('active');
    expect(preDisabledRestriction).not.toHaveProperty('authWasDisabledBeforeBan');

    const concurrentUid = 'integration-concurrent-restriction';
    await adminAuth.deleteUser(concurrentUid).catch(() => {});
    await adminAuth.createUser({
      uid: concurrentUid,
      email: 'concurrent-restriction@example.test'
    });
    const competingRestrictions = await Promise.allSettled([
      call(clients.owner, 'setUserRestriction', {
        uid: concurrentUid,
        action: 'ban',
        reason: 'Concurrent restriction test',
        hideExisting: false
      }),
      call(clients.owner, 'setUserRestriction', {
        uid: concurrentUid,
        action: 'clear'
      })
    ]);
    expect(competingRestrictions.filter((result) => result.status === 'fulfilled').length)
      .toBeGreaterThanOrEqual(1);
    const concurrentUser = await adminAuth.getUser(concurrentUid);
    const concurrentRestriction = (await db.collection('userRestrictions').doc(concurrentUid).get()).data();
    expect(concurrentUser.disabled).toBe(concurrentRestriction.state === 'banned');
    expect(concurrentRestriction).not.toHaveProperty('authDisablePending');
    expect(concurrentRestriction).not.toHaveProperty('authEnablePending');
  });

  it('enforces Moderator and Owner content boundaries and records audits', async () => {
    await expect(call(clients.ownerGoogle, 'getDashboard'))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });

    const targetId = 'integration-moderated-message';
    await db.collection('messages').doc(targetId).set({
      author: 'Target',
      authorId: users.reporter1.uid,
      content: 'Moderated content',
      hidden: false,
      deleted: false,
      createdAt: Timestamp.now()
    });
    await call(clients.moderator, 'moderateContent', {
      contentType: 'message', contentId: targetId, action: 'hide', reason: 'Needs review'
    });
    await expect(call(clients.moderator, 'moderateContent', {
      contentType: 'message', contentId: targetId, action: 'remove', reason: 'Permanent removal'
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await call(clients.owner, 'moderateContent', {
      contentType: 'message', contentId: targetId, action: 'remove', reason: 'Confirmed violation'
    });
    await call(clients.owner, 'moderateContent', {
      contentType: 'message', contentId: reportedMessageId, action: 'remove', reason: 'Reported violation'
    });
    await call(clients.moderator, 'moderateContent', {
      contentType: 'fanart', contentId: uploadedFanartId, action: 'hide', reason: 'Image review'
    });
    const hiddenMediaUrl = `http://127.0.0.1:5001/${projectId}/asia-east1/fanartMedia?fanartId=${uploadedFanartId}`;
    expect((await fetch(hiddenMediaUrl)).status).toBe(404);
    const moderatorToken = await clients.moderator.auth.currentUser.getIdToken();
    expect((await fetch(hiddenMediaUrl, {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })).status).toBe(200);
    await call(clients.owner, 'moderateContent', {
      contentType: 'fanart', contentId: uploadedFanartId, action: 'remove', reason: 'Confirmed image violation'
    });

    const target = (await db.collection('messages').doc(targetId).get()).data();
    const removedCase = (await db.collection('reportCases')
      .doc(`message_${reportedMessageId}`).get()).data();
    const audits = await db.collection('adminAuditLogs').where('targetId', '==', targetId).get();
    const [imageExists] = await adminStorage.bucket().file(uploadedFanartPath).exists();
    const removedMedia = await fetch(
      `http://127.0.0.1:5001/${projectId}/asia-east1/fanartMedia?fanartId=${uploadedFanartId}`
    );
    expect(target).toMatchObject({ hidden: true, deleted: true, content: '' });
    expect(removedCase).toMatchObject({ targetPreview: '', targetImageUrl: '', targetRemoved: true });
    expect(audits.size).toBe(2);
    expect(imageExists).toBe(false);
    expect(removedMedia.status).toBe(404);

    const concurrentContentId = 'integration-concurrent-content';
    await db.collection('messages').doc(concurrentContentId).set({
      author: 'Concurrent Target',
      authorId: users.reporter2.uid,
      content: 'Concurrent moderation content',
      hidden: false,
      deleted: false,
      createdAt: Timestamp.now()
    });
    const competingModeration = await Promise.allSettled([
      call(clients.moderator, 'moderateContent', {
        contentType: 'message', contentId: concurrentContentId,
        action: 'restore', reason: 'Concurrent restore'
      }),
      call(clients.owner, 'moderateContent', {
        contentType: 'message', contentId: concurrentContentId,
        action: 'remove', reason: 'Concurrent removal'
      })
    ]);
    expect(competingModeration.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competingModeration.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const concurrentContent = (await db.collection('messages').doc(concurrentContentId).get()).data();
    expect(concurrentContent.deleted === true && concurrentContent.hidden === false).toBe(false);
    const concurrentAudits = await db.collection('adminAuditLogs')
      .where('targetId', '==', concurrentContentId).get();
    expect(concurrentAudits.size).toBe(1);
  });

  it('protects the Owner and invalidates revoked administrator sessions', async () => {
    const competingDemotions = await Promise.allSettled([
      call(clients.owner, 'updateAdminAccount', {
        uid: users.ownerPeer.uid,
        role: 'moderator'
      }),
      call(clients.ownerPeer, 'updateAdminAccount', {
        uid: users.owner.uid,
        role: 'moderator'
      })
    ]);
    expect(competingDemotions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competingDemotions.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const activeOwners = await db.collection('adminAccounts')
      .where('role', '==', 'owner')
      .where('disabled', '==', false)
      .get();
    expect(activeOwners.size).toBe(1);
    const remainingOwnerUid = activeOwners.docs[0].id;
    const remainingOwnerClient = remainingOwnerUid === users.owner.uid
      ? clients.owner
      : clients.ownerPeer;

    await expect(call(remainingOwnerClient, 'updateAdminAccount', {
      uid: remainingOwnerUid,
      role: 'moderator'
    })).rejects.toMatchObject({ code: 'functions/failed-precondition' });

    await call(remainingOwnerClient, 'updateAdminAccount', {
      uid: remainingOwnerUid,
      revokeSessions: true
    });
    await expect(call(remainingOwnerClient, 'getDashboard'))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
  }, 15_000);

  it('migrates legacy reports atomically and remains idempotent', async () => {
    migrationAdminApp = initializeApp({
      projectId: migrationProjectId,
      storageBucket: `${migrationProjectId}.appspot.com`
    }, 'migration-integration');
    const migrationDb = getFirestore(migrationAdminApp);
    const messageRef = migrationDb.collection('messages').doc('legacy-message');
    await messageRef.set({
      author: 'Legacy Author',
      authorId: 'legacy-author',
      content: 'Legacy reported content',
      reportCount: 2,
      reportedBy: ['legacy-reporter-1', 'legacy-reporter-2'],
      createdAt: Timestamp.now()
    });

    const runMigration = () => spawnSync(process.execPath, [
      'functions/lib/migrate-governance.js',
      '--project', migrationProjectId,
      '--storage-bucket', `${migrationProjectId}.appspot.com`,
      '--apply'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        GCLOUD_PROJECT: migrationProjectId,
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
        FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199'
      },
      timeout: 15_000
    });

    const firstRun = runMigration();
    expect(firstRun.status, firstRun.stderr).toBe(0);
    const caseRef = migrationDb.collection('reportCases').doc('message_legacy-message');
    expect((await messageRef.get()).data()).toMatchObject({ hidden: false, reportCount: 2 });
    expect((await messageRef.get()).data()).not.toHaveProperty('reportedBy');
    expect((await caseRef.collection('reports').get()).size).toBe(2);

    await caseRef.update({ status: 'resolved' });
    const secondRun = runMigration();
    expect(secondRun.status, secondRun.stderr).toBe(0);
    expect((await caseRef.get()).data().status).toBe('resolved');
    expect((await caseRef.collection('reports').get()).size).toBe(2);
    expect((await migrationDb.collection('userStats').doc('legacy-author').get()).data())
      .toMatchObject({ messageCount: 1, fanartCount: 0 });
  }, 30_000);
});
