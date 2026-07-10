const { test, expect } = require('@playwright/test');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');

const projectId = 'demo-kanata-governance';
const owner = {
  uid: 'owner-e2e',
  email: 'owner.e2e@example.com',
  password: 'PreviewOwner!234'
};

test.beforeAll(async () => {
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8180';
  if (!getApps().length) initializeApp({ projectId });
  const auth = getAuth();
  await auth.deleteUser(owner.uid).catch(() => {});
  await auth.createUser({ uid: owner.uid, email: owner.email, password: owner.password, displayName: 'Preview Owner' });
  await auth.setCustomUserClaims(owner.uid, { adminRole: 'owner', adminSessionVersion: 1 });

  const db = getFirestore();
  await db.collection('adminAccounts').doc(owner.uid).set({
    uid: owner.uid, email: owner.email, displayName: 'Preview Owner', role: 'owner',
    disabled: false, status: 'active', sessionVersion: 1, updatedAt: FieldValue.serverTimestamp()
  });
  await db.collection('messages').doc('reported-message').set({
    author: 'Reported User', authorId: 'reported-user', content: 'A reported preview message',
    hidden: false, deleted: false, reportCount: 2, createdAt: Timestamp.now(),
    moderation: { status: 'visible' }
  });
  await db.collection('fanart').doc('untrusted-image-url').set({
    artist: 'Untrusted Artist', artistId: 'untrusted-artist', caption: 'Untrusted image URL preview',
    imageUrl: 'https://attacker.example/collect-admin-token', imagePath: 'fanart/missing/original.png',
    hidden: false, deleted: false, reportCount: 0, createdAt: Timestamp.now(),
    moderation: { status: 'visible' }
  });
  await db.collection('reportCases').doc('message_reported-message').set({
    targetType: 'message', targetId: 'reported-message', targetAuthorUid: 'reported-user',
    targetPreview: 'A reported preview message', status: 'open', reportCount: 2,
    latestReason: 'spam', latestAt: Timestamp.now(), createdAt: Timestamp.now()
  });
  await db.collection('reportCases').doc('message_reported-message').collection('reports').doc('reporter-1').set({
    reporterUid: 'reporter-1', reason: 'spam', details: 'Repeated promotional content', createdAt: Timestamp.now()
  });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kanata-admin-language', 'zh-TW'));
});

test('administrator signs in, reviews a report, and updates its status', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop workflow assertion');
  await page.goto('/admin/');
  await expect(page).toHaveTitle(/治理中心/);
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(owner.password);
  await page.getByRole('button', { name: '登入' }).click();

  await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
  await expect(page.getByText('待處理案件')).toBeVisible();
  const memorialLink = page.getByRole('link', { name: '前往紀念網站' });
  await expect(memorialLink).toHaveAttribute('href', 'https://eienkanata.com/');
  await expect(memorialLink).toHaveAttribute('target', '_blank');
  await page.getByRole('button', { name: '舉報案件' }).click();
  await expect(page.getByRole('heading', { name: '舉報案件' })).toBeVisible();
  await page.getByRole('button', { name: '查看' }).first().click();
  await expect(page.getByRole('heading', { name: '案件詳情' })).toBeVisible();
  await page.getByRole('button', { name: '開始審查' }).click();
  await page.getByRole('button', { name: '確認' }).click();
  await expect(page.locator('.status-label.status-reviewing').first()).toBeVisible();
});

test('mobile login remains readable without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only assertion');
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: '治理中心' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('fan art preview never sends an administrator token to a stored image URL', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop security workflow assertion');
  const requests = [];
  page.on('request', (request) => requests.push({
    url: request.url(),
    authorization: request.headers().authorization || ''
  }));

  await page.goto('/admin/');
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(owner.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
  await page.getByRole('button', { name: '投稿管理' }).click();
  await page.getByRole('button', { name: '創作', exact: true }).click();
  await expect(page.getByText('Untrusted image URL preview')).toBeVisible();
  await page.getByRole('button', { name: '查看' }).first().click();
  await expect(page.getByRole('heading', { name: '投稿詳情' })).toBeVisible();
  await page.waitForTimeout(100);

  expect(requests.some((request) => request.url.startsWith('https://attacker.example/'))).toBe(false);
  const mediaRequest = requests.find((request) =>
    request.url.includes('/api/fanart-media?fanartId=untrusted-image-url')
  );
  expect(mediaRequest).toBeTruthy();
  expect(mediaRequest?.authorization).toMatch(/^Bearer /);
  expect(new URL(mediaRequest.url).origin).toBe(new URL(page.url()).origin);
});

test('administrator resets a password through the custom action handler', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop password workflow assertion');
  await page.goto('/admin/');
  await page.getByRole('button', { name: '忘記密碼' }).click();
  await page.locator('#admin-modal-form input[name="email"]').fill(owner.email);
  await page.locator('#admin-modal-form button[type="submit"]').click();
  await expect(page.locator('#admin-toast')).toContainText('密碼重設信已寄出');

  const response = await request.get(
    `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`
  );
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const resetCode = payload.oobCodes
    .filter((entry) => entry.requestType === 'PASSWORD_RESET' && entry.email === owner.email)
    .at(-1)?.oobCode;
  expect(resetCode).toBeTruthy();

  await page.goto(`/admin/auth/action/?mode=resetPassword&oobCode=${encodeURIComponent(resetCode)}&lang=zh-TW`);
  await expect(page.getByRole('heading', { name: '設定新密碼' })).toBeVisible();
  await page.getByLabel('Language').selectOption('en');
  await expect(page.locator('#action-description')).toContainText('Set a new sign-in password');
  await page.getByLabel('Language').selectOption('zh-TW');
  await expect(page.locator('#action-description')).toContainText('設定新的登入密碼');
  await page.getByLabel('新密碼', { exact: true }).fill('too-short');
  await page.getByLabel('確認新密碼').fill('too-short');
  await page.getByRole('button', { name: '更新密碼' }).click();
  await expect(page.getByRole('alert')).toContainText('密碼不符合安全要求');

  const newPassword = 'PreviewOwner!5678';
  await page.getByLabel('新密碼', { exact: true }).fill(newPassword);
  await page.getByLabel('確認新密碼').fill(newPassword);
  await page.getByRole('button', { name: '更新密碼' }).click();
  await expect(page.getByRole('status')).toContainText('密碼已更新');

  await page.goto('/admin/');
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(newPassword);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
});
