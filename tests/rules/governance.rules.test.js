import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-kanata-governance';
let environment;

function adminClaims(role, sessionVersion = 1, provider = 'password') {
  return {
    adminRole: role,
    adminSessionVersion: sessionVersion,
    firebase: { sign_in_provider: provider }
  };
}

function contributorClaims(provider = 'google.com') {
  return { firebase: { sign_in_provider: provider } };
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8180 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 }
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
});

afterAll(async () => environment.cleanup());

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'messages', 'visible-message'), {
      authorId: 'author-1', content: 'visible', hidden: false, deleted: false, createdAt: Timestamp.now()
    });
    await setDoc(doc(firestore, 'messages', 'hidden-message'), {
      authorId: 'author-1', content: 'hidden', hidden: true, deleted: false, createdAt: Timestamp.now()
    });
    await setDoc(doc(firestore, 'messages', 'removed-message'), {
      authorId: 'author-1', content: '', hidden: false, deleted: true, createdAt: Timestamp.now()
    });
    await setDoc(doc(firestore, 'fanart', 'visible-fanart'), {
      sourceType: 'x', hidden: false, deleted: false, createdAt: Timestamp.now()
    });
    await setDoc(doc(firestore, 'reportCases', 'message_hidden-message'), {
      status: 'open', targetId: 'hidden-message', latestAt: Timestamp.now()
    });
    await setDoc(doc(firestore, 'adminAccounts', 'owner-1'), {
      role: 'owner', disabled: false, sessionVersion: 1
    });
    await setDoc(doc(firestore, 'adminAccounts', 'moderator-1'), {
      role: 'moderator', disabled: false, sessionVersion: 1
    });
  });
}

describe('Firestore governance rules', () => {
  it('denies raw content reads for anonymous visitors and contributors', async () => {
    await seed();
    for (const context of [environment.unauthenticatedContext(),
      environment.authenticatedContext('author-1', contributorClaims())]) {
      const publicDb = context.firestore();
      for (const id of ['visible-message', 'hidden-message', 'removed-message']) {
        await assertFails(getDoc(doc(publicDb, 'messages', id)));
      }
      await assertFails(getDoc(doc(publicDb, 'fanart', 'visible-fanart')));
    }
  });

  it('denies public queries even with all visibility constraints', async () => {
    await seed();
    const publicDb = environment.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(publicDb, 'messages')));
    await assertFails(getDocs(query(
      collection(publicDb, 'messages'),
      where('hidden', '==', false)
    )));
    const visibleQuery = query(
      collection(publicDb, 'messages'),
      where('hidden', '==', false),
      where('deleted', '==', false)
    );
    await assertFails(getDocs(visibleQuery));
    await assertFails(getDocs(query(collection(publicDb, 'fanart'),
      where('hidden', '==', false), where('deleted', '==', false))));
  });

  it('denies direct content writes from regular users', async () => {
    const userDb = environment.authenticatedContext('user-1').firestore();
    await assertFails(setDoc(doc(userDb, 'messages', 'spoofed'), {
      authorId: 'user-1', content: 'write attempt', hidden: false
    }));
  });

  it('keeps the backend maintenance lock private and server-owned', async () => {
    const userDb = environment.authenticatedContext('user-1').firestore();
    await assertFails(getDoc(doc(userDb, 'system', 'maintenance')));
    await assertFails(setDoc(doc(userDb, 'system', 'maintenance'), { enabled: false }));
  });

  it('allows moderators to read hidden content and reports', async () => {
    await seed();
    const adminDb = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator')
    ).firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'messages', 'hidden-message')));
    await assertSucceeds(getDoc(doc(adminDb, 'messages', 'visible-message')));
    await assertSucceeds(getDoc(doc(adminDb, 'fanart', 'visible-fanart')));
    await assertSucceeds(getDoc(doc(adminDb, 'reportCases', 'message_hidden-message')));
  });

  it('rejects stale or disabled administrator sessions', async () => {
    await seed();
    const staleDb = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator', 0)
    ).firestore();
    await assertFails(getDoc(doc(staleDb, 'messages', 'hidden-message')));

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'adminAccounts', 'moderator-1'), {
        role: 'moderator', disabled: true, sessionVersion: 1
      });
    });
    const disabledDb = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator')
    ).firestore();
    await assertFails(getDoc(doc(disabledDb, 'messages', 'hidden-message')));
  });

  it('rejects administrator claims issued to a Google session', async () => {
    await seed();
    const googleOwnerDb = environment.authenticatedContext(
      'owner-1', adminClaims('owner', 1, 'google.com')
    ).firestore();
    await assertFails(getDoc(doc(googleOwnerDb, 'messages', 'hidden-message')));
    await assertFails(getDoc(doc(googleOwnerDb, 'adminAccounts', 'owner-1')));
  });

  it('limits administrator account records to Owners', async () => {
    await seed();
    const moderatorDb = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator')
    ).firestore();
    const ownerDb = environment.authenticatedContext('owner-1', adminClaims('owner')).firestore();
    await assertFails(getDoc(doc(moderatorDb, 'adminAccounts', 'owner-1')));
    await assertSucceeds(getDoc(doc(ownerDb, 'adminAccounts', 'owner-1')));
  });

  it('keeps contribution settings server-only for contributors and administrators', async () => {
    await seed();
    await environment.withSecurityRulesDisabled(async context => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'system', 'contributionLimits'), { messageDailyLimit: 3, fanartDailyLimit: 2 });
      await setDoc(doc(firestore, 'userContributionLimits', 'author-1'), { messageDailyLimit: null, revision: 1 });
    });
    const contexts = [environment.unauthenticatedContext(),
      environment.authenticatedContext('author-1', contributorClaims()),
      environment.authenticatedContext('moderator-1', adminClaims('moderator')),
      environment.authenticatedContext('owner-1', adminClaims('owner'))];
    for (const context of contexts) {
      for (const [collectionName, id] of [['system', 'contributionLimits'], ['userContributionLimits', 'author-1']]) {
        const reference = doc(context.firestore(), collectionName, id);
        await assertFails(getDoc(reference));
        await assertFails(setDoc(reference, { messageDailyLimit: null }));
      }
    }
  });
});

describe('legacy Storage media', () => {
  it('keeps snapshot objects inaccessible to every client SDK', async () => {
    await seed();
    const path = 'public-snapshots/control.json';
    await environment.withSecurityRulesDisabled(async context => {
      await uploadBytes(ref(context.storage(), path), new TextEncoder().encode('{}'));
    });
    for (const context of [environment.unauthenticatedContext(),
      environment.authenticatedContext('author-1', contributorClaims()),
      environment.authenticatedContext('owner-1', adminClaims('owner'))]) {
      await assertFails(getBytes(ref(context.storage(), path)));
      await assertFails(uploadBytes(ref(context.storage(), path), new Uint8Array([1])));
    }
  });
  it('rejects image uploads even with an unexpired matching ticket', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'uploadTickets', 'fanart-1'), {
        uid: 'user-1', status: 'pending', fileName: 'original.png', contentType: 'image/png',
        size: bytes.length, expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
      });
    });
    const ownerStorage = environment.authenticatedContext('user-1', contributorClaims()).storage();
    const otherStorage = environment.authenticatedContext('user-2', contributorClaims()).storage();
    const path = 'fanart/user-1/fanart-1/original.png';
    await assertFails(uploadBytes(ref(otherStorage, path), bytes, { contentType: 'image/png' }));
    const passwordStorage = environment.authenticatedContext(
      'user-1', contributorClaims('password')
    ).storage();
    await assertFails(uploadBytes(ref(passwordStorage, path), bytes, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(ownerStorage, path), bytes, { contentType: 'image/png' }));
  });

  it('keeps Storage private while allowing administrator review', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'uploadTickets', 'fanart-2'), {
        uid: 'user-1', status: 'pending', fileName: 'original.png', contentType: 'image/png',
        size: bytes.length, expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
      });
      await setDoc(doc(firestore, 'adminAccounts', 'moderator-1'), {
        role: 'moderator', disabled: false, sessionVersion: 1
      });
    });
    const path = 'fanart/user-1/fanart-2/original.png';
    await environment.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), path), bytes, { contentType: 'image/png' });
    });
    const publicStorage = environment.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(publicStorage, path)));
    const adminStorage = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator')
    ).storage();
    await assertSucceeds(getBytes(ref(adminStorage, path)));

    const googleAdminStorage = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator', 1, 'google.com')
    ).storage();
    await assertFails(getBytes(ref(googleAdminStorage, path)));

    const staleAdminStorage = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator', 0)
    ).storage();
    await assertFails(getBytes(ref(staleAdminStorage, path)));

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'adminAccounts', 'moderator-1'), {
        role: 'moderator', disabled: true, sessionVersion: 1
      });
    });
    const disabledAdminStorage = environment.authenticatedContext(
      'moderator-1', adminClaims('moderator')
    ).storage();
    await assertFails(getBytes(ref(disabledAdminStorage, path)));

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'fanart', 'fanart-2'), {
        artistId: 'user-1', hidden: false, deleted: false
      });
    });
    await assertFails(getBytes(ref(publicStorage, path)));
  });
});
