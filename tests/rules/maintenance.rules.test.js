import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-kanata-maintenance';
let environment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.maintenance.rules', 'utf8'), host: '127.0.0.1', port: 8180
    },
    storage: {
      rules: readFileSync('storage.maintenance.rules', 'utf8'), host: '127.0.0.1', port: 9199
    }
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
});

afterAll(async () => environment.cleanup());

describe('maintenance lock rules', () => {
  it('preserves visible legacy reads without exposing hidden or removed content', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'messages', 'existing'), { content: 'existing' });
      await setDoc(doc(context.firestore(), 'messages', 'hidden'), {
        content: 'hidden', hidden: true, deleted: false
      });
      await setDoc(doc(context.firestore(), 'messages', 'removed'), {
        content: '', hidden: true, deleted: true
      });
    });
    const publicDb = environment.unauthenticatedContext().firestore();
    const userDb = environment.authenticatedContext('user-1').firestore();
    await assertSucceeds(getDoc(doc(publicDb, 'messages', 'existing')));
    await assertFails(getDoc(doc(publicDb, 'messages', 'hidden')));
    await assertFails(getDoc(doc(publicDb, 'messages', 'removed')));
    await assertFails(setDoc(doc(userDb, 'messages', 'new'), { authorId: 'user-1', content: 'new' }));
    await assertFails(setDoc(doc(userDb, 'system', 'maintenance'), { enabled: false }));
  });

  it('keeps original fanart private for administrators and rejects uploads', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const path = 'fanart/user-1/existing/image.png';
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'adminAccounts', 'moderator-1'), {
        role: 'moderator', disabled: false, sessionVersion: 1
      });
      await uploadBytes(ref(context.storage(), path), bytes, { contentType: 'image/png' });
    });
    await assertFails(getBytes(ref(environment.unauthenticatedContext().storage(), path)));
    const adminStorage = environment.authenticatedContext('moderator-1', {
      adminRole: 'moderator',
      adminSessionVersion: 1,
      firebase: { sign_in_provider: 'password' }
    }).storage();
    await assertSucceeds(getBytes(ref(adminStorage, path)));

    const googleAdminStorage = environment.authenticatedContext('moderator-1', {
      adminRole: 'moderator',
      adminSessionVersion: 1,
      firebase: { sign_in_provider: 'google.com' }
    }).storage();
    await assertFails(getBytes(ref(googleAdminStorage, path)));

    const staleAdminStorage = environment.authenticatedContext('moderator-1', {
      adminRole: 'moderator',
      adminSessionVersion: 0,
      firebase: { sign_in_provider: 'password' }
    }).storage();
    await assertFails(getBytes(ref(staleAdminStorage, path)));

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'adminAccounts', 'moderator-1'), {
        role: 'moderator', disabled: true, sessionVersion: 1
      });
    });
    await assertFails(getBytes(ref(adminStorage, path)));

    await assertFails(uploadBytes(
      ref(environment.authenticatedContext('user-1').storage(), 'fanart/user-1/new/image.png'),
      bytes,
      { contentType: 'image/png' }
    ));
  });
});
