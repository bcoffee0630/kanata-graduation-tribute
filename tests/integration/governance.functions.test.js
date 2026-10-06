import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
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
import embedFixture from '../helpers/x-oembed-fixture.cjs';
import { taipeiDate } from '../../scripts/import-curated-fanart.mjs';

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
  bootstrapCandidate: { uid: 'owner-e2e', email: 'bootstrap-owner@example.test', displayName: 'Bootstrap Owner' },
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
let stopEmbedFixture;

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
  stopEmbedFixture = await embedFixture.startXEmbedFixture();
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
    bootstrapCandidate: await createClient(users.bootstrapCandidate, null, 'password'),
    owner: await createClient(users.owner, 'owner'),
    ownerPeer: await createClient(users.ownerPeer, 'owner'),
    moderator: await createClient(users.moderator, 'moderator')
  };
  clients.ownerGoogle = await createGoogleSessionForExistingUser(users.owner, clients.owner);
}, 30_000);

// Isolate rolling burst windows while each case retains real transactional enforcement.
beforeEach(async () => {
  const attempts = await db.collection('publicEndpointLimits').get();
  await Promise.all(attempts.docs.map(document => document.ref.delete()));
});

afterAll(async () => {
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  if (migrationAdminApp) await deleteAdminApp(migrationAdminApp);
  if (stopEmbedFixture) await stopEmbedFixture();
});

describe.sequential('configurable contribution limits', () => {
  const specs = {
    owner: { uid: 'quota-owner', email: 'quota-owner@example.test', displayName: 'Quota Owner' },
    moderator: { uid: 'quota-moderator', email: 'quota-moderator@example.test', displayName: 'Quota Moderator' },
    author: { uid: 'quota-author', email: 'quota-author@example.test', displayName: 'Quota Author' },
    peer: { uid: 'quota-peer', email: 'quota-peer@example.test', displayName: 'Quota Peer' },
    password: { uid: 'quota-password', email: 'quota-password@example.test', displayName: 'Quota Password' }
  };
  let quotaClients;
  let postSequence = 0n;
  const inherit = { mode: 'inherit' };
  const unlimited = { mode: 'unlimited' };
  const limited = value => ({ mode: 'limited', value });
  const nextPost = () => `https://x.com/example/status/${1960000000000000000n + ++postSequence}`;
  const mine = async (client = quotaClients.author) => (await call(client, 'getMyContributionLimits')).data;
  const defaults = async () => (await call(quotaClients.owner, 'getContributionDefaults')).data;
  const userLimits = async (spec = specs.author) => (await call(quotaClients.owner, 'getUser', { uid: spec.uid })).data.contributionLimits;
  async function saveDefaults(messageDailyLimit, fanartDailyLimit, revision) {
    return (await call(quotaClients.owner, 'setContributionDefaults', {
      messageDailyLimit, fanartDailyLimit,
      expectedRevision: revision ?? (await defaults()).revision, reason: 'Quota integration validation'
    })).data;
  }
  async function saveUser(message, fanart, spec = specs.author, revision) {
    return (await call(quotaClients.owner, 'setUserContributionLimits', {
      uid: spec.uid, message, fanart,
      expectedRevision: revision ?? (await userLimits(spec)).revision,
      reason: 'User quota integration validation'
    })).data.contributionLimits;
  }
  async function cleanLimits() {
    await db.collection('system').doc('contributionLimits').delete();
    await db.collection('system').doc('maintenance').delete();
    await Promise.all(Object.values(specs).flatMap(spec => [
      db.collection('userContributionLimits').doc(spec.uid).delete(),
      db.collection('userStats').doc(spec.uid).delete(),
      db.collection('userRestrictions').doc(spec.uid).delete()
    ]));
  }

  beforeAll(async () => {
    quotaClients = {
      owner: await createClient(specs.owner, 'owner'),
      moderator: await createClient(specs.moderator, 'moderator'),
      author: await createClient(specs.author),
      peer: await createClient(specs.peer),
      password: await createClient(specs.password, null, 'password')
    };
  }, 30_000);
  beforeEach(cleanLimits);
  afterEach(cleanLimits);
  afterAll(async () => {
    // These fixtures must not change the later last-Owner governance assertions.
    await Promise.all(Object.values(specs).flatMap(spec => [
      db.collection('adminAccounts').doc(spec.uid).delete(),
      db.collection('userDirectory').doc(spec.uid).delete(),
      adminAuth.deleteUser(spec.uid)
    ]));
  });

  it('retains separate 3/2 defaults and exposes only the authenticated contributor usage', async () => {
    expect(await defaults()).toEqual({ defaults: { messageDailyLimit: 3, fanartDailyLimit: 2 }, revision: 0 });
    expect(await mine()).toMatchObject({
      dayKey: taipeiDate(), message: { limit: 3, used: 0, remaining: 3 }, fanart: { limit: 2, used: 0, remaining: 2 }
    });
    await db.collection('userStats').doc(specs.peer.uid).set({ dailyKey: taipeiDate(), dailyMessageCount: 2 });
    expect((await call(quotaClients.author, 'getMyContributionLimits', { uid: specs.peer.uid })).data.message.used).toBe(0);
    expect((await mine()).message.used).toBe(0);
    await expect(call(quotaClients.author, 'getContributionDefaults')).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await expect(call(quotaClients.password, 'getMyContributionLimits')).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect((await call(quotaClients.moderator, 'getContributionDefaults')).data.defaults.messageDailyLimit).toBe(3);
  });

  it('saves defaults atomically with their audit and requires a current Owner', async () => {
    const audit = db.collection('adminAuditLogs').where('actorUid', '==', specs.owner.uid);
    const beforeIds = new Set((await audit.get()).docs.map(doc => doc.id));
    const result = await saveDefaults(0, 7);
    expect(result).toEqual({ defaults: { messageDailyLimit: 0, fanartDailyLimit: 7 }, revision: 1 });
    expect((await mine()).message.limit).toBe(0);
    const entries = (await audit.get()).docs.filter(doc => !beforeIds.has(doc.id)).map(doc => doc.data());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorRole: 'owner', action: 'contribution.defaults.update',
      reason: 'Quota integration validation', details: { before: expect.any(Object), after: expect.any(Object) } });
    await expect(call(quotaClients.moderator, 'setContributionDefaults', {
      messageDailyLimit: 10, fanartDailyLimit: 10, expectedRevision: 1, reason: 'Unauthorized change'
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await adminAuth.setCustomUserClaims(specs.owner.uid, { adminRole: 'moderator', adminSessionVersion: 2 });
    try {
      await expect(saveDefaults(10, 10, 1)).rejects.toMatchObject({ code: 'functions/permission-denied' });
    } finally {
      await adminAuth.setCustomUserClaims(specs.owner.uid, { adminRole: 'owner', adminSessionVersion: 1 });
    }
    expect((await defaults()).revision).toBe(1);
    expect((await audit.get()).size).toBe(beforeIds.size + 1);
  });

  it('applies each override separately and clears fields without resetting its revision', async () => {
    await saveDefaults(5, 6);
    const custom = await saveUser(limited(1), unlimited);
    expect(custom).toMatchObject({ revision: 1, effective: {
      message: { limit: 1, source: 'override' }, fanart: { limit: null, source: 'override' }
    } });
    expect((await mine(quotaClients.peer)).message.limit).toBe(5);
    await saveDefaults(8, 9);
    expect((await mine()).message.limit).toBe(1);
    const cleared = await saveUser(inherit, unlimited);
    expect(cleared.revision).toBe(2);
    expect(cleared.effective.message).toEqual({ limit: 8, source: 'default' });
    const stored = (await db.collection('userContributionLimits').doc(specs.author.uid).get()).data();
    expect(stored).not.toHaveProperty('messageDailyLimit');
    expect(stored.fanartDailyLimit).toBeNull();
    await saveUser(inherit, inherit);
    expect((await userLimits()).revision).toBe(3);
    expect((await mine()).fanart.limit).toBe(9);
  });

  it('supports zero without consuming quota and still permits the other content type', async () => {
    await saveUser(limited(0), limited(1));
    await expect(call(quotaClients.author, 'submitMessage', { content: 'This message is blocked by zero' }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted', details: {
        reason: 'daily_limit', contentType: 'message', limit: 0, used: 0, dayKey: taipeiDate()
      } });
    await call(quotaClients.author, 'submitFanartLink', { postUrl: nextPost() });
    await expect(call(quotaClients.author, 'submitFanartLink', { postUrl: nextPost() }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted', details: { contentType: 'fanart', limit: 1, used: 1 } });
    expect(await mine()).toMatchObject({ message: { used: 0 }, fanart: { used: 1 } });
  });

  it('continues counting unlimited submissions and immediately honors raised, lowered and inherited limits', async () => {
    await saveUser(unlimited, unlimited);
    for (let i = 0; i < 4; i++) await call(quotaClients.author, 'submitMessage', { content: `Unlimited message number ${i}` });
    expect((await mine()).message).toEqual({ limit: null, used: 4, remaining: null });
    await saveUser(limited(3), inherit);
    await expect(call(quotaClients.author, 'submitMessage', { content: 'Already above the lowered quota' }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted', details: { limit: 3, used: 4 } });
    await saveUser(limited(5), inherit);
    // This case tests daily policy changes; burst behavior is covered separately.
    const attempts = await db.collection('publicEndpointLimits').where('uid', '==', specs.author.uid).get();
    await Promise.all(attempts.docs.map(document => document.ref.delete()));
    await call(quotaClients.author, 'submitMessage', { content: 'The increase adds one available message' });
    await saveUser(inherit, inherit);
    expect((await mine()).message).toEqual({ limit: 3, used: 5, remaining: 0 });
    expect((await db.collection('userStats').doc(specs.author.uid).get()).data().messageCount).toBe(5);
  });

  it('does not charge unlimited accounts for duplicates or unavailable X posts', async () => {
    await saveUser(unlimited, unlimited);
    const postUrl = nextPost();
    await call(quotaClients.author, 'submitFanartLink', { postUrl });
    await expect(call(quotaClients.author, 'submitFanartLink', { postUrl })).rejects.toMatchObject({ code: 'functions/already-exists' });
    await expect(call(quotaClients.author, 'submitFanartLink', { postUrl: 'https://x.com/example/status/1960000000000000404' }))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect((await mine()).fanart).toEqual({ limit: null, used: 1, remaining: null });
  });

  it('keeps maintenance, muted/banned accounts and social sign-in requirements for unlimited accounts', async () => {
    await saveUser(unlimited, unlimited);
    await saveUser(unlimited, unlimited, specs.password);
    const message = () => call(quotaClients.author, 'submitMessage', { content: 'Unlimited does not bypass governance' });
    const fanart = () => call(quotaClients.author, 'submitFanartLink', { postUrl: nextPost() });
    await db.collection('system').doc('maintenance').set({ enabled: true });
    for (const submit of [message, fanart]) await expect(submit()).rejects.toMatchObject({ code: 'functions/unavailable' });
    await db.collection('system').doc('maintenance').delete();
    for (const state of ['muted', 'banned']) {
      await db.collection('userRestrictions').doc(specs.author.uid).set({ state, mutedUntil: Timestamp.fromMillis(Date.now() + 60_000) });
      for (const submit of [message, fanart]) await expect(submit()).rejects.toMatchObject({ code: 'functions/permission-denied' });
    }
    await expect(call(quotaClients.password, 'submitMessage', { content: 'Password only cannot contribute' }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
    await expect(call(quotaClients.password, 'submitFanartLink', { postUrl: nextPost() }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect(await mine()).toMatchObject({ message: { used: 0 }, fanart: { used: 0 } });
  });

  it('serializes mixed parallel submissions without overshooting or losing the other counter', async () => {
    await saveUser(limited(2), limited(2));
    const messages = Array.from({ length: 6 }, (_, i) => call(quotaClients.author, 'submitMessage', { content: `Parallel quota message ${i}` }));
    const art = Array.from({ length: 6 }, () => call(quotaClients.author, 'submitFanartLink', { postUrl: nextPost() }));
    const outcomes = await Promise.allSettled([...messages, ...art]);
    expect(outcomes.slice(0, 6).filter(item => item.status === 'fulfilled')).toHaveLength(2);
    expect(outcomes.slice(6).filter(item => item.status === 'fulfilled')).toHaveLength(2);
    expect(await mine()).toMatchObject({ message: { used: 2, remaining: 0 }, fanart: { used: 2, remaining: 0 } });
    const stats = (await db.collection('userStats').doc(specs.author.uid).get()).data();
    expect(stats).toMatchObject({ messageCount: 2, fanartCount: 2, dailyMessageCount: 2, dailyFanartCount: 2 });
  }, 30_000);

  it('rejects stale concurrent editors and writes one audit per committed setting', async () => {
    const audit = db.collection('adminAuditLogs').where('actorUid', '==', specs.owner.uid);
    const before = (await audit.get()).size;
    const globalResults = await Promise.allSettled([saveDefaults(4, 5, 0), saveDefaults(6, 7, 0)]);
    expect(globalResults.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(globalResults.find(item => item.status === 'rejected').reason.code).toBe('functions/aborted');
    const userResults = await Promise.allSettled([
      saveUser(limited(1), unlimited, specs.author, 0), saveUser(unlimited, limited(1), specs.author, 0)
    ]);
    expect(userResults.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(userResults.find(item => item.status === 'rejected').reason.code).toBe('functions/aborted');
    expect((await audit.get()).size).toBe(before + 2);
    expect((await userLimits()).revision).toBe(1);
  });

  it('reads updated settings during concurrent submission transactions', async () => {
    await saveDefaults(2, 2);
    const results = await Promise.allSettled([
      ...Array.from({ length: 8 }, (_, i) => call(quotaClients.author, 'submitMessage', { content: `Changed during submission ${i}` })),
      saveDefaults(4, 2, 1)
    ]);
    expect(results.at(-1).status).toBe('fulfilled');
    const accepted = results.slice(0, 8).filter(item => item.status === 'fulfilled').length;
    expect(accepted).toBeGreaterThanOrEqual(2);
    expect(accepted).toBeLessThanOrEqual(4);
    expect((await mine()).message).toEqual({ limit: 4, used: accepted, remaining: 4 - accepted });
  }, 30_000);

  it('rejects invalid limits and nonexistent targets without writing configuration', async () => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '4', null]) {
      await expect(saveDefaults(value, 2, 0)).rejects.toMatchObject({ code: 'functions/invalid-argument' });
      await expect(saveUser(limited(value), inherit, specs.author, 0)).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    }
    await expect(call(quotaClients.moderator, 'setUserContributionLimits', {
      uid: specs.author.uid, message: unlimited, fanart: unlimited, expectedRevision: 0, reason: 'Not an Owner'
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await expect(saveUser(inherit, inherit, { uid: 'missing-quota-target' }, 0)).rejects.toMatchObject({ code: 'functions/not-found' });
    expect((await defaults()).revision).toBe(0);
    expect((await userLimits()).revision).toBe(0);
  });

  it('rolls over old daily usage while preserving lifetime counts', async () => {
    await db.collection('userStats').doc(specs.author.uid).set({
      dailyKey: '2000-01-01', dailyMessageCount: 9, dailyFanartCount: 8, pendingFanartCount: 1,
      messageCount: 20, fanartCount: 12
    });
    expect(await mine()).toMatchObject({ message: { used: 0 }, fanart: { used: 0 } });
    await call(quotaClients.author, 'submitMessage', { content: 'A fresh Taipei calendar day' });
    expect((await db.collection('userStats').doc(specs.author.uid).get()).data()).toMatchObject({
      dailyKey: taipeiDate(), dailyMessageCount: 1, dailyFanartCount: 0, pendingFanartCount: 0,
      messageCount: 21, fanartCount: 12
    });
  });
});

describe.sequential('governance callable APIs', () => {
  it('imports curated references through the actual Owner CLI without consuming daily quota and reruns without changes', async () => {
    const spec = { uid: 'integration-curated-owner', email: 'curated-owner@example.test', displayName: 'Curated Owner' };
    const ids = ['x_1787157733575479363', 'x_1829450233501413859', 'x_1780135601498701835'];
    try {
      const client = await createClient(spec, 'owner');
      await Promise.all(ids.map((id) => db.collection('fanart').doc(id).delete()));
      const statsRef = db.collection('userStats').doc(spec.uid);
      await statsRef.set({ dailyKey: taipeiDate(), dailyFanartCount: 2, pendingFanartCount: 1, fanartCount: 0 });
      const runImporter = async (apply = false) => {
        const token = apply ? await client.auth.currentUser.getIdToken(true) : '';
        return new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['scripts/import-curated-fanart.mjs',
            '--project', projectId, '--owner-uid', spec.uid,
            ...(apply ? ['--apply', '--confirm-eligibility-date', taipeiDate()] : [])
          ], { cwd: process.cwd(), env: { ...process.env,
            GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId, GCP_PROJECT: projectId,
            FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
            FUNCTIONS_EMULATOR: 'true', X_OEMBED_EMULATOR_URL: 'http://127.0.0.1:9394/oembed'
          }, stdio: ['pipe', 'pipe', 'pipe'] });
          let stdout = '', stderr = '';
          const timer = setTimeout(() => { child.kill(); reject(new Error('Importer fixture timed out.')); }, 20_000);
          child.stdout.on('data', (chunk) => { stdout += chunk; });
          child.stderr.on('data', (chunk) => { stderr += chunk; });
          child.once('error', (error) => { clearTimeout(timer); reject(error); });
          child.once('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
          child.stdin.end(token ? `${token}\n` : '');
        });
      };
      const dryRun = await runImporter();
      expect(dryRun.status, dryRun.stderr).toBe(0);
      expect(JSON.parse(dryRun.stdout)).toMatchObject({ mode: 'dry-run', ownerValidated: true, add: 3, skip: 0 });
      expect((await statsRef.get()).data().fanartCount).toBe(0);
      const first = await runImporter(true);
      expect(first.status, first.stderr).toBe(0);
      expect(JSON.parse(first.stdout).results.map((result) => result.result)).toEqual(['added', 'added', 'added']);
      const before = await Promise.all(ids.map((id) => db.collection('fanart').doc(id).get()));
      before.forEach((snapshot) => {
        expect(snapshot.data()).toMatchObject({ sourceType: 'x', submissionSource: 'curated', artistId: spec.uid });
        expect(snapshot.data().createdAt).toBeInstanceOf(Timestamp);
      });
      const second = await runImporter(true);
      expect(second.status, second.stderr).toBe(0);
      expect(JSON.parse(second.stdout).results.map((result) => result.result)).toEqual(['skipped', 'skipped', 'skipped']);
      const after = await Promise.all(ids.map((id) => db.collection('fanart').doc(id).get()));
      after.forEach((snapshot, index) => expect(snapshot.updateTime.isEqual(before[index].updateTime)).toBe(true));
      expect((await statsRef.get()).data()).toMatchObject({ fanartCount: 3, dailyFanartCount: 2, pendingFanartCount: 1 });
      const audits = await db.collection('adminAuditLogs').where('actorUid', '==', spec.uid).get();
      expect(audits.size).toBe(3);
      expect(audits.docs.every((snapshot) => snapshot.data().action === 'fanart.import_curated')).toBe(true);
    } finally {
      // This additional Owner must not alter the later last-Owner protection fixtures.
      const audits = await db.collection('adminAuditLogs').where('actorUid', '==', spec.uid).get();
      await Promise.all([
        adminAuth.deleteUser(spec.uid).catch((error) => {
          if (error.code !== 'auth/user-not-found') throw error;
        }),
        db.collection('adminAccounts').doc(spec.uid).delete(),
        db.collection('userStats').doc(spec.uid).delete(),
        ...ids.map((id) => db.collection('fanart').doc(id).delete()),
        ...audits.docs.map((snapshot) => snapshot.ref.delete())
      ]);
    }
  }, 60_000);

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
    expect(first.data.item).toEqual({ id: first.data.id, author: message.author, content: message.content,
      authorLink: message.authorLink, authorAvatar: message.authorAvatar });
    expect(first.data.item).not.toHaveProperty('authorId');
    expect(first.data.item).not.toHaveProperty('submitter');
    expect((await db.doc('system/publicContentRevision').get()).data().messagesRevision).toBeGreaterThan(0);

    await call(clients.author, 'submitMessage', { content: 'Second quota message' });
    await call(clients.author, 'submitMessage', { content: 'Third quota message' });
    await expect(call(clients.author, 'submitMessage', { content: 'Fourth quota message' }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted' });
  });

  it('counts failed authenticated attempts and limits endpoints before expensive work', async () => {
    for (const [name, data] of [
      ['submitMessage', { content: '' }],
      ['submitFanartLink', { postUrl: 'https://attacker.example/status/1900000000000000099' }],
      ['submitReport', {}]
    ]) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(call(clients.reporter2, name, data)).rejects.toMatchObject({ code: 'functions/invalid-argument' });
      }
      await expect(call(clients.reporter2, name, data)).rejects.toMatchObject({
        code: 'functions/resource-exhausted', details: { reason: 'burst_limit', retryAfterSeconds: expect.any(Number) }
      });
    }
    // Quota reads have their own independent 20/minute window.
    for (let attempt = 0; attempt < 20; attempt++) await call(clients.reporter2, 'getMyContributionLimits');
    await expect(call(clients.reporter2, 'getMyContributionLimits')).rejects.toMatchObject({
      code: 'functions/resource-exhausted', details: { reason: 'burst_limit', retryAfterSeconds: expect.any(Number) }
    });
    expect((await db.collection('fanart').doc('x_1900000000000000099').get()).exists).toBe(false);
  }, 30_000);

  it('blocks every public mutation while the production maintenance lock is enabled', async () => {
    const maintenanceRef = db.collection('system').doc('maintenance');
    await maintenanceRef.set({ enabled: true });
    try {
      await expect(call(clients.reporter1, 'submitMessage', { content: 'Maintenance write' }))
        .rejects.toMatchObject({ code: 'functions/unavailable' });
      await expect(call(clients.reporter1, 'beginFanartUpload', {
        contentType: 'image/png', size: 8
      })).rejects.toMatchObject({ code: 'functions/failed-precondition', details: { reason: 'image_submission_disabled' } });
      await expect(call(clients.reporter1, 'finalizeFanartUpload', {
        ticketId: 'legacy-pending-ticket'
      })).rejects.toMatchObject({ code: 'functions/failed-precondition', details: { reason: 'image_submission_disabled' } });
      await expect(call(clients.reporter1, 'submitFanartLink', {
        postUrl: 'https://x.com/example/status/1900000000000000001'
      })).rejects.toMatchObject({ code: 'functions/unavailable' });
      await expect(call(clients.reporter1, 'submitReport', {
        contentType: 'message', contentId: reportedMessageId, reason: 'spam',
        details: 'Maintenance report attempt'
      })).rejects.toMatchObject({ code: 'functions/unavailable' });
    } finally {
      await maintenanceRef.delete();
    }
  }, 15_000);

  it('blocks self and duplicate reports and auto-hides at three unique reporters', async () => {
    const beforeRevision = (await db.doc('system/publicContentRevision').get()).data().messagesRevision;
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
    expect((await db.doc('system/publicContentRevision').get()).data().messagesRevision).toBe(beforeRevision + 1);
  }, 15_000);

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

  it('disables both image endpoints while preserving legacy media', async () => {
    for (const name of ['beginFanartUpload', 'finalizeFanartUpload']) {
      await expect(call(clients.author, name, { contentType: 'image/png', size: 8 }))
        .rejects.toMatchObject({ code: 'functions/failed-precondition', details: { reason: 'image_submission_disabled' } });
      await expect(call(clients.passwordOnly, name))
        .rejects.toMatchObject({ code: 'functions/permission-denied' });
    }
    const tickets = await db.collection('uploadTickets').where('uid', '==', users.author.uid).get();
    expect(tickets.empty).toBe(true);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    uploadedFanartId = 'integration-legacy-fanart';
    uploadedFanartPath = `fanart/${users.author.uid}/${uploadedFanartId}/original.png`;
    await adminStorage.bucket().file(uploadedFanartPath).save(bytes, {
      resumable: false, metadata: { contentType: 'image/png' }
    });
    await db.collection('fanart').doc(uploadedFanartId).set({
      artist: 'Legacy artist', artistId: users.author.uid,
      caption: 'Previously uploaded artwork', imagePath: uploadedFanartPath,
      imageUrl: `/api/fanart-media?fanartId=${uploadedFanartId}`,
      hidden: false, deleted: false, reportCount: 0, createdAt: Timestamp.now()
    });
    const media = await fetch(
      `http://127.0.0.1:5001/${projectId}/asia-east1/fanartMedia?fanartId=${uploadedFanartId}`
    );
    expect(media.status).toBe(401);
    const token = await clients.owner.auth.currentUser.getIdToken();
    const authorizedMedia = await fetch(
      `http://127.0.0.1:5001/${projectId}/asia-east1/fanartMedia?fanartId=${uploadedFanartId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(authorizedMedia.status).toBe(200);
    expect((await authorizedMedia.arrayBuffer()).byteLength).toBe(bytes.byteLength);
  });

  it('binds X submissions to the real contributor and rejects duplicates without charging quota', async () => {
    const postUrl = 'https://twitter.com/example/status/1900000000000000001?s=20';
    const first = await call(clients.author, 'submitFanartLink', {
      postUrl, caption: 'A shared memory', artistId: 'spoofed-author'
    });
    expect(first.data.id).toBe('x_1900000000000000001');
    const stored = (await db.collection('fanart').doc(first.data.id).get()).data();
    expect(stored).toMatchObject({
      sourceType: 'x', postId: '1900000000000000001',
      postUrl: 'https://x.com/example/status/1900000000000000001',
      artistId: users.author.uid, submitter: { uid: users.author.uid, providerId: 'google.com' },
      imagePath: '', imageUrl: '', hidden: false, deleted: false
    });
    expect(first.data.item).toEqual({ id: first.data.id, postId: stored.postId,
      postUrl: `https://x.com/i/web/status/${stored.postId}`, caption: stored.caption,
      submitter: stored.submitter.displayName, createdAt: stored.createdAt.toDate().toISOString() });
    expect(first.data.item).not.toHaveProperty('artistId');
    expect(typeof first.data.item.submitter).toBe('string');
    expect(stored.sampleKey).toBeGreaterThanOrEqual(0);
    expect(stored.sampleKey).toBeLessThan(1);
    expect((await db.doc('system/publicContentRevision').get()).data().fanartRevision).toBeGreaterThan(0);
    await expect(call(clients.author, 'submitFanartLink', { postUrl }))
      .rejects.toMatchObject({ code: 'functions/already-exists' });
    expect((await db.collection('userStats').doc(users.author.uid).get()).data().dailyFanartCount).toBe(1);
    await call(clients.author, 'submitFanartLink', { postUrl: 'https://x.com/example/status/1900000000000000002' });
    await expect(call(clients.author, 'submitFanartLink', { postUrl: 'https://x.com/example/status/1900000000000000003' }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted' });
    await expect(call(clients.passwordOnly, 'submitFanartLink', { postUrl }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('handles parallel submissions and rejects unavailable or invalid posts without charging quota', async () => {
    for (const [postUrl, code] of [
      ['https://attacker.example/example/status/1900000000000000004', 'functions/invalid-argument'],
      ['https://x.com/example/status/1900000000000000404', 'functions/failed-precondition'],
      ['https://x.com/example/status/1900000000000000503', 'functions/unavailable']
    ]) {
      await expect(call(clients.reporter1, 'submitFanartLink', { postUrl }))
        .rejects.toMatchObject({ code });
    }
    expect((await db.collection('userStats').doc(users.reporter1.uid).get()).data()?.dailyFanartCount || 0).toBe(0);
    const postUrl = 'https://x.com/example/status/1900000000000000004';
    const results = await Promise.allSettled([
      call(clients.reporter1, 'submitFanartLink', { postUrl }),
      call(clients.reporter1, 'submitFanartLink', { postUrl })
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await db.collection('userStats').doc(users.reporter1.uid).get()).data().dailyFanartCount).toBe(1);
  });

  it('keeps X posts reportable and clears original links on permanent removal', async () => {
    const contentId = 'x_1900000000000000001';
    for (const client of [clients.reporter1, clients.reporter2, clients.reporter3]) {
      await call(client, 'submitReport', {
        contentType: 'fanart', contentId, reason: 'spam', details: 'Review this linked artwork'
      });
    }
    const target = db.collection('fanart').doc(contentId);
    const report = db.collection('reportCases').doc(`fanart_${contentId}`);
    expect((await target.get()).data()).toMatchObject({ hidden: true, reportCount: 3 });
    expect((await report.get()).data().targetPostUrl).toBe('https://x.com/example/status/1900000000000000001');
    await call(clients.moderator, 'moderateContent', {
      contentType: 'fanart', contentId, action: 'restore', reason: 'Review complete'
    });
    expect((await target.get()).data().hidden).toBe(false);
    await target.update({ curation: { description: 'Curated artwork source' } });
    await call(clients.owner, 'moderateContent', {
      contentType: 'fanart', contentId, action: 'remove', reason: 'Confirmed violation'
    });
    expect((await target.get()).data()).toMatchObject({ deleted: true, hidden: true, postUrl: '', postId: '' });
    expect((await target.get()).data()).not.toHaveProperty('curation');
    expect((await report.get()).data()).toMatchObject({ targetPostUrl: '', targetPreview: '', targetRemoved: true });
    await expect(call(clients.reporter2, 'submitFanartLink', {
      postUrl: 'https://x.com/example/status/1900000000000000001'
    })).rejects.toMatchObject({ code: 'functions/already-exists' });
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
    await expect(call(clients.restricted, 'submitFanartLink', { postUrl: 'https://x.com/example/status/1900000000000000005' }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });

    await restriction.update({ mutedUntil: Timestamp.fromMillis(Date.now() - 1_000) });
    await call(clients.restricted, 'submitMessage', { content: 'Mute has expired' });
    await call(clients.owner, 'setUserRestriction', {
      uid: users.restricted.uid,
      action: 'ban',
      reason: 'Repeated abuse',
      hideExisting: true
    });
    expect((await adminAuth.getUser(users.restricted.uid)).disabled).toBe(true);
    expect((await restriction.get()).data().state).toBe('banned');
    const restrictedMessages = await db.collection('messages').where('authorId', '==', users.restricted.uid).get();
    expect(restrictedMessages.docs.every(document => document.data().hidden)).toBe(true);
    expect((await db.doc('system/publicContentRevision').get()).data().messagesRevision).toBeGreaterThan(0);

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
    expect((await fetch(hiddenMediaUrl)).status).toBe(401);
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
      `http://127.0.0.1:5001/${projectId}/asia-east1/fanartMedia?fanartId=${uploadedFanartId}`,
      { headers: { Authorization: `Bearer ${moderatorToken}` } }
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

  it('requires a matching linked Google account before initial Owner bootstrap', async () => {
    await expect(call(clients.bootstrapCandidate, 'bootstrapOwner'))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });

    const googleClient = await createGoogleSessionForExistingUser(
      users.bootstrapCandidate,
      clients.bootstrapCandidate
    );
    clients.bootstrapCandidateGoogle = googleClient;
    const response = await call(clients.bootstrapCandidate, 'bootstrapOwner');
    expect(response.data).toMatchObject({ uid: users.bootstrapCandidate.uid, role: 'owner' });

    const [user, account, lock] = await Promise.all([
      adminAuth.getUser(users.bootstrapCandidate.uid),
      db.collection('adminAccounts').doc(users.bootstrapCandidate.uid).get(),
      db.collection('system').doc('bootstrap').get()
    ]);
    expect(user.providerData.some((provider) =>
      provider.providerId === 'google.com' && provider.email === users.bootstrapCandidate.email
    )).toBe(true);
    expect(user.customClaims).toMatchObject({ adminRole: 'owner', adminSessionVersion: 1 });
    expect(account.data()).toMatchObject({ role: 'owner', disabled: false, sessionVersion: 1 });
    expect(lock.data()).toMatchObject({ ownerUid: users.bootstrapCandidate.uid });
  });

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
