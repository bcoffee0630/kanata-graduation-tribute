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
  await db.collection('fanart').doc('x-admin-preview').set({
    sourceType: 'x', postId: '1900000000000000006',
    postUrl: 'https://x.com/example/status/1900000000000000006',
    artist: 'Website contributor', artistId: 'contributor-1', caption: 'X link moderation preview',
    hidden: true, deleted: false, reportCount: 0,
    createdAt: Timestamp.fromMillis(Date.now() - 1000), moderation: { status: 'admin_hidden' }
  });
  await db.collection('fanart').doc('x-invalid-admin-preview').set({
    sourceType: 'x', postId: '1900000000000000007',
    postUrl: 'https://attacker.example/collect-admin-token',
    artist: 'Website contributor', artistId: 'contributor-1', caption: 'Untrusted X link moderation preview',
    hidden: true, deleted: false, reportCount: 0,
    createdAt: Timestamp.fromMillis(Date.now() - 2000), moderation: { status: 'admin_hidden' }
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

test('X moderation uses safe original links without loading embeds or sending administrator tokens', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop moderation workflow');
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/admin/');
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(owner.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
  await page.getByRole('button', { name: '投稿管理' }).click();
  await page.getByRole('button', { name: '創作', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'X link moderation preview' })
    .filter({ hasNotText: 'Untrusted' }).getByRole('button', { name: '查看' }).click();
  const original = page.getByRole('link', { name: '前往 X 查看原貼文' });
  await expect(original).toHaveAttribute('href', 'https://x.com/example/status/1900000000000000006');
  await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
  await page.locator('#drawer-close').click();
  await page.getByRole('row').filter({ hasText: 'Untrusted X link moderation preview' })
    .getByRole('button', { name: '查看' }).click();
  await expect(page.getByRole('heading', { name: '投稿詳情' })).toBeVisible();
  await expect(original).toHaveCount(0);
  expect(requests.some((url) => /platform\.(?:x|twitter)\.com|attacker\.example/.test(url))).toBe(false);
  expect(requests.some((url) => url.includes('fanartId=x-admin-preview'))).toBe(false);
});

test('sidebar collapse respects mobile drawers and keeps desktop controls accessible', async ({ page }, testInfo) => {
  await page.goto('/admin/');
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
  const sidebar = page.locator('#admin-sidebar');
  const collapse = page.locator('#sidebar-collapse');
  const mobileMenu = page.locator('#mobile-menu');
  if (testInfo.project.name === 'desktop') {
    await collapse.click();
    await expect(collapse).toHaveAccessibleName('展開選單');
    await expect(collapse).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: '投稿管理', exact: true })).toBeVisible();
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(68);
    await page.locator('#admin-app [data-language-select]').selectOption('en');
    await expect(collapse).toHaveAccessibleName('Expand navigation');
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expect(collapse).toHaveAccessibleName('Collapse navigation');
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.click();
    await page.setViewportSize({ width: 691, height: 827 });
  } else {
    await page.setViewportSize({ width: 691, height: 827 });
  }
  await expect(mobileMenu).toHaveAttribute('aria-expanded', 'false');
  await mobileMenu.click();
  await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(224);
  await expect(sidebar.locator('.nav-item[data-view="content"] span')).toBeVisible();
  await expect(collapse).toHaveAccessibleName(testInfo.project.name === 'desktop' ? 'Close navigation' : '關閉選單');
  await collapse.click();
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  expect(await sidebar.evaluate(element => element.inert)).toBe(true);
  await expect(mobileMenu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sidebar.locator('[data-view="dashboard"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  await expect(mobileMenu).toBeFocused();
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(collapse).toHaveAccessibleName('Expand navigation');
    await expect(collapse).toBeFocused();
    await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
    expect(await sidebar.evaluate(element => element.inert)).toBe(false);
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(68);
  }
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

test('initial Owner must restore Google before bootstrap is offered', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop bootstrap workflow assertion');
  await getAuth().updateUser(owner.uid, { password: owner.password });
  await getAuth().setCustomUserClaims(owner.uid, {});
  await getFirestore().collection('adminAccounts').doc(owner.uid).delete();

  await page.goto('/admin/?bootstrap=1');
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(owner.password);
  await page.getByRole('button', { name: '登入' }).click();

  await expect(page.getByRole('button', { name: '重新連結 Google 帳號' })).toBeVisible();
  await expect(page.getByRole('button', { name: '啟用第一位 Owner' })).toBeHidden();

  await getAuth().updateUser(owner.uid, {
    providerToLink: { providerId: 'google.com', uid: 'owner-google-e2e', email: owner.email }
  });
  await page.getByRole('button', { name: '登出' }).click();
  await page.getByLabel('電子郵件').fill(owner.email);
  await page.getByLabel('密碼').fill(owner.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('button', { name: '重新連結 Google 帳號' })).toBeHidden();
  await expect(page.getByRole('button', { name: '啟用第一位 Owner' })).toBeVisible();
});
