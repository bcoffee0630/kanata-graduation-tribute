import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-kanata-governance';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8180';

const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const owner = {
  uid: 'owner-e2e',
  email: 'owner.e2e@example.com',
  password: 'PreviewOwner!234',
  displayName: 'Preview Owner'
};

await auth.deleteUser(owner.uid).catch(() => {});
await auth.createUser(owner);
await auth.setCustomUserClaims(owner.uid, {
  adminRole: 'owner',
  adminSessionVersion: 1
});

await db.collection('adminAccounts').doc(owner.uid).set({
  uid: owner.uid,
  email: owner.email,
  displayName: owner.displayName,
  role: 'owner',
  sessionVersion: 1,
  disabled: false,
  status: 'active',
  updatedAt: FieldValue.serverTimestamp()
});
await db.collection('messages').doc('reported-message').set({
  author: 'Reported User',
  authorId: 'reported-user',
  content: 'A reported preview message for visual review.',
  hidden: false,
  deleted: false,
  reportCount: 2,
  createdAt: Timestamp.now(),
  moderation: { status: 'visible' }
});
await db.collection('messages').doc('hidden-message').set({
  author: 'Hidden User',
  authorId: 'hidden-user',
  content: 'A temporarily hidden message.',
  hidden: true,
  deleted: false,
  reportCount: 3,
  createdAt: Timestamp.fromMillis(Date.now() - 3_600_000),
  moderation: { status: 'auto_hidden' }
});
await db.collection('reportCases').doc('message_reported-message').set({
  caseId: 'message_reported-message',
  targetType: 'message',
  targetId: 'reported-message',
  targetAuthorUid: 'reported-user',
  targetPreview: 'A reported preview message for visual review.',
  status: 'open',
  reportCount: 2,
  latestReason: 'spam',
  latestAt: Timestamp.now(),
  createdAt: Timestamp.now()
});
await db.collection('reportCases').doc('message_reported-message')
  .collection('reports').doc('reporter-1').set({
    reporterUid: 'reporter-1',
    reason: 'spam',
    details: 'Repeated promotional content in a memorial message.',
    createdAt: Timestamp.now()
  });
await db.collection('userRestrictions').doc('muted-user').set({
  uid: 'muted-user',
  state: 'muted',
  mutedUntil: Timestamp.fromMillis(Date.now() + 86_400_000),
  reason: 'Test mute'
});
await db.collection('userRestrictions').doc('banned-user').set({
  uid: 'banned-user',
  state: 'banned',
  mutedUntil: null,
  reason: 'Test block'
});
await db.collection('adminAuditLogs').doc('seed-audit').set({
  actorUid: owner.uid,
  actorEmail: owner.email,
  actorDisplayName: owner.displayName,
  actorRole: 'owner',
  action: 'preview.seed',
  targetType: 'system',
  targetId: projectId,
  reason: 'Local visual QA',
  details: {},
  createdAt: FieldValue.serverTimestamp()
});

console.log(JSON.stringify({ projectId, owner: owner.email }, null, 2));
