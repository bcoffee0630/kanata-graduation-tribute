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
  await page.getByRole('button', { name: '畫廊投稿', exact: true }).click();
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
  await page.getByRole('button', { name: '畫廊投稿', exact: true }).click();
  const trustedRow = page.getByRole('row').filter({ hasText: 'X link moderation preview' })
    .filter({ hasNotText: 'Untrusted' });
  const rowLink = trustedRow.getByRole('link', { name: '前往 X 查看原貼文' });
  await expect(rowLink).toHaveAttribute('href', 'https://x.com/example/status/1900000000000000006');
  await expect(rowLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(trustedRow).toContainText('@example · 1900000000000000006');
  await expect(page.getByRole('row').filter({ hasText: 'Untrusted X link moderation preview' }).getByRole('link')).toHaveCount(0);
  await trustedRow.getByRole('button', { name: '查看' }).click();
  const original = page.locator('#drawer-content').getByRole('link', { name: '前往 X 查看原貼文' });
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

const quotaUser = {
  uid: 'quota-user-e2e', email: 'quota.user.e2e@example.com', password: 'PreviewQuota!234'
};
const quotaModerator = {
  uid: 'quota-moderator-e2e', email: 'quota.moderator.e2e@example.com', password: 'PreviewModerator!234'
};

async function signInQuotaAdmin(page, account = owner) {
  await page.goto('/admin/');
  await page.getByLabel('電子郵件').fill(account.email);
  await page.getByLabel('密碼').fill(account.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
}

async function openQuotaView(page, view) {
  if (await page.locator('#mobile-menu').isVisible()) await page.locator('#mobile-menu').click();
  const navigation = page.locator(`.admin-nav [data-view="${view}"]`);
  await navigation.focus();
  await page.keyboard.press('Enter');
}

async function openQuotaUser(page) {
  await openQuotaView(page, 'users');
  await page.getByPlaceholder('輸入完整 UID 或 Email').fill(quotaUser.uid);
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: quotaUser.email })
    .getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.locator('#user-contribution-limits')).toBeVisible();
}

async function adminQuotaCall(page, name, data = {}) {
  return page.evaluate(({ name, data }) => window.AdminApp.call(name, data), { name, data });
}

test.describe('contribution limits administration', () => {
  test.beforeEach(async () => {
    const auth = getAuth();
    const db = getFirestore();
    // Quota fixtures are scoped to these cases and never carry into gallery tests.
    await db.collection('system').doc('contributionLimits').delete();
    await db.collection('userContributionLimits').doc(quotaUser.uid).delete();
    await auth.updateUser(owner.uid, { password: owner.password });
    await auth.setCustomUserClaims(owner.uid, { adminRole: 'owner', adminSessionVersion: 1 });
    await db.collection('adminAccounts').doc(owner.uid).set({
      uid: owner.uid, email: owner.email, displayName: 'Preview Owner', role: 'owner',
      disabled: false, status: 'active', sessionVersion: 1, updatedAt: FieldValue.serverTimestamp()
    });
    for (const user of [quotaUser, quotaModerator]) {
      await auth.deleteUser(user.uid).catch(() => {});
      await auth.createUser({ ...user, displayName: user.uid });
    }
    await auth.setCustomUserClaims(quotaModerator.uid, { adminRole: 'moderator', adminSessionVersion: 1 });
    await db.collection('adminAccounts').doc(quotaModerator.uid).set({
      uid: quotaModerator.uid, email: quotaModerator.email, displayName: 'Preview Moderator', role: 'moderator',
      disabled: false, status: 'active', sessionVersion: 1, updatedAt: FieldValue.serverTimestamp()
    });
    const dayKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    await db.collection('userStats').doc(quotaUser.uid).set({
      dailyKey: dayKey, dailyMessageCount: 2, dailyFanartCount: 1
    });
  });

  test.afterEach(async () => {
    const db = getFirestore();
    await db.collection('system').doc('contributionLimits').delete();
    await db.collection('userContributionLimits').doc(quotaUser.uid).delete();
    await db.collection('userStats').doc(quotaUser.uid).delete();
    await db.collection('adminAccounts').doc(quotaModerator.uid).delete();
    for (const user of [quotaUser, quotaModerator]) await getAuth().deleteUser(user.uid).catch(() => {});
  });

  test('Owner edits independent contribution defaults, including zero, with a required reason', async ({ page }) => {
    await signInQuotaAdmin(page);
    await openQuotaView(page, 'contributionLimits');
    await expect(page.getByRole('heading', { name: '投稿上限', exact: true }).last()).toBeVisible();
    await expect(page.getByLabel('留言每日預設上限')).toHaveValue('3');
    await expect(page.getByLabel('畫廊投稿每日預設上限')).toHaveValue('2');
    const form = page.locator('#contribution-defaults-form');
    await expect(form.locator('input[type="number"]')).toHaveCount(2);
    await expect(form.getByRole('option')).toHaveCount(0);
    await page.getByLabel('留言每日預設上限').fill('1.5');
    await page.getByLabel('畫廊投稿每日預設上限').fill('4');
    await page.getByLabel('設定原因').fill('檢查小數不應可以儲存');
    await form.getByRole('button', { name: '儲存', exact: true }).click();
    expect(await page.getByLabel('留言每日預設上限').evaluate((input) => input.validationMessage))
      .toBe('請輸入 0 或以上的安全整數。');
    expect((await adminQuotaCall(page, 'getContributionDefaults')).revision).toBe(0);
    await page.getByLabel('留言每日預設上限').fill('0');
    await page.getByLabel('設定原因').fill('');
    await form.getByRole('button', { name: '儲存', exact: true }).click();
    expect((await adminQuotaCall(page, 'getContributionDefaults')).revision).toBe(0);
    await page.getByLabel('設定原因').fill('暫停留言並增加畫廊額度');
    await form.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(page.locator('#admin-toast')).toContainText('投稿上限已更新');
    await expect(page.getByLabel('留言每日預設上限')).toHaveValue('0');
    await expect(page.getByLabel('畫廊投稿每日預設上限')).toHaveValue('4');
    expect(await adminQuotaCall(page, 'getContributionDefaults')).toMatchObject({
      defaults: { messageDailyLimit: 0, fanartDailyLimit: 4 }, revision: 1
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });

  test('Owner sets unlimited and zero user contributions, then inherits current defaults without resetting usage', async ({ page }) => {
    await signInQuotaAdmin(page);
    await openQuotaUser(page);
    const section = page.locator('#user-contribution-limits');
    await expect(section).toContainText('相同 UID 使用社群登入');
    await expect(section.locator('[data-contribution-kind="message"] .quota-usage')).toHaveText('今日已用：2');
    await expect(section.locator('[data-contribution-kind="fanart"] .quota-usage')).toHaveText('今日已用：1');
    await page.getByLabel('留言額度方式').selectOption('unlimited');
    await page.getByLabel('畫廊投稿額度方式').selectOption('limited');
    await page.getByLabel('畫廊投稿自訂每日上限').fill('0');
    await section.getByLabel('設定原因').fill('允許留言不限量並暫停畫廊投稿');
    await section.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(section.locator('[data-contribution-kind="message"] .quota-effective')).toHaveText('生效上限：無上限');
    await expect(page.getByLabel('畫廊投稿自訂每日上限')).toHaveValue('0');
    let data = await adminQuotaCall(page, 'getUser', { uid: quotaUser.uid });
    expect(data.contributionLimits).toMatchObject({
      effective: { message: { limit: null, source: 'override' }, fanart: { limit: 0, source: 'override' } },
      usage: { message: 2, fanart: 1 }, revision: 1
    });
    await adminQuotaCall(page, 'setContributionDefaults', {
      messageDailyLimit: 9, fanartDailyLimit: 5, expectedRevision: 0, reason: '更新全站參考預設額度'
    });
    await page.getByLabel('留言額度方式').selectOption('inherit');
    await section.getByLabel('設定原因').fill('留言恢復繼承全站預設');
    await section.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(section.locator('[data-contribution-kind="message"] .quota-source')).toHaveText('設定來源：全站預設');
    data = await adminQuotaCall(page, 'getUser', { uid: quotaUser.uid });
    expect(data.contributionLimits).toMatchObject({
      overrides: { message: { mode: 'inherit' }, fanart: { mode: 'limited', value: 0 } },
      effective: { message: { limit: 9 }, fanart: { limit: 0 } }, usage: { message: 2, fanart: 1 }, revision: 2
    });
    await page.getByLabel('畫廊投稿額度方式').selectOption('inherit');
    await section.getByLabel('設定原因').fill('兩種投稿都使用全站預設');
    await section.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(page.getByLabel('畫廊投稿額度方式')).toHaveValue('inherit');
    // The selected mode is already the draft value; wait for the saved summary.
    await expect(section.locator('[data-contribution-kind="fanart"] .quota-source')).toHaveText('設定來源：全站預設');
    await expect(section.locator('[data-contribution-kind="fanart"] .quota-effective')).toHaveText('生效上限：每日 5');
    data = await adminQuotaCall(page, 'getUser', { uid: quotaUser.uid });
    expect(data.contributionLimits).toMatchObject({
      overrides: { message: { mode: 'inherit' }, fanart: { mode: 'inherit' } },
      effective: { message: { limit: 9 }, fanart: { limit: 5 } }, usage: { message: 2, fanart: 1 }, revision: 3
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });

  test('contribution default conflicts retain the draft and require an explicit reload', async ({ page }) => {
    await signInQuotaAdmin(page);
    await openQuotaView(page, 'contributionLimits');
    await expect(page.getByLabel('留言每日預設上限')).toHaveValue('3');
    await adminQuotaCall(page, 'setContributionDefaults', {
      messageDailyLimit: 8, fanartDailyLimit: 5, expectedRevision: 0, reason: '另一工作階段更新設定'
    });
    await page.getByLabel('留言每日預設上限').fill('7');
    await page.getByLabel('設定原因').fill('此工作階段仍使用舊版本');
    await page.locator('#contribution-defaults-form').getByRole('button', { name: '儲存', exact: true }).click();
    await expect(page.locator('#contribution-defaults-form [role="alert"]')).toContainText('設定已由其他操作更新');
    await expect(page.getByLabel('留言每日預設上限')).toHaveValue('7');
    await page.getByRole('button', { name: '重新載入設定', exact: true }).click();
    await expect(page.getByLabel('留言每日預設上限')).toHaveValue('8');
    await expect(page.getByLabel('畫廊投稿每日預設上限')).toHaveValue('5');
    await expect(page.getByLabel('設定原因')).toHaveValue('');
    expect((await adminQuotaCall(page, 'getContributionDefaults')).revision).toBe(1);
  });

  test('user contribution conflicts retain the draft and reload the latest override', async ({ page }) => {
    await signInQuotaAdmin(page);
    await openQuotaUser(page);
    await adminQuotaCall(page, 'setUserContributionLimits', {
      uid: quotaUser.uid, message: { mode: 'limited', value: 6 }, fanart: { mode: 'inherit' },
      expectedRevision: 0, reason: '另一工作階段更新用戶額度'
    });
    await page.getByLabel('留言額度方式').selectOption('unlimited');
    await page.locator('#user-contribution-limits').getByLabel('設定原因').fill('此工作階段仍使用舊設定');
    await page.locator('#user-contribution-limits').getByRole('button', { name: '儲存', exact: true }).click();
    await expect(page.locator('#user-contribution-limits [role="alert"]')).toContainText('設定已由其他操作更新');
    await expect(page.getByLabel('留言額度方式')).toHaveValue('unlimited');
    await page.getByRole('button', { name: '重新載入設定', exact: true }).click();
    await expect(page.getByLabel('留言額度方式')).toHaveValue('limited');
    await expect(page.getByLabel('留言自訂每日上限')).toHaveValue('6');
    await expect(page.locator('#user-contribution-limits').getByLabel('設定原因')).toHaveValue('');
  });

  test('Moderator can read contribution defaults and user overrides without edit controls', async ({ page }) => {
    await getFirestore().collection('userContributionLimits').doc(quotaUser.uid).set({
      messageDailyLimit: null, fanartDailyLimit: 0, revision: 1
    });
    await signInQuotaAdmin(page, quotaModerator);
    await openQuotaView(page, 'contributionLimits');
    const main = page.locator('#admin-main');
    await expect(main).toContainText('只有 Owner 可以修改設定');
    await expect(main.locator('input, textarea, select')).toHaveCount(0);
    await expect(main.getByRole('button', { name: '儲存', exact: true })).toHaveCount(0);
    await openQuotaUser(page);
    const section = page.locator('#user-contribution-limits');
    await expect(section).toContainText('只有 Owner 可以修改設定');
    await expect(section.locator('input, textarea, select')).toHaveCount(0);
    await expect(section.getByRole('button', { name: '儲存', exact: true })).toHaveCount(0);
    const denied = await page.evaluate(async () => {
      try {
        await window.AdminApp.call('setContributionDefaults', {
          messageDailyLimit: 99, fanartDailyLimit: 99, expectedRevision: 0, reason: '不應授權給 Moderator 的設定'
        });
        return false;
      } catch (error) {
        return String(error.code).includes('permission-denied');
      }
    });
    expect(denied).toBe(true);
    expect((await getFirestore().collection('system').doc('contributionLimits').get()).exists).toBe(false);
  });

  test('contribution settings translate in three languages and remain keyboard operable', async ({ page }) => {
    await signInQuotaAdmin(page);
    await openQuotaUser(page);
    const language = page.locator('#admin-app [data-language-select]');
    const keyboard = await page.context().newCDPSession(page);
    for (const [lang, heading, modeLabel, modeOptions] of [
      ['en', 'Contribution allowance', 'Message limit mode', ['Use default', 'Custom amount', 'Unlimited']],
      ['ja', '投稿枠', 'メッセージの上限設定', ['既定値を使用', '個別の数値', '無制限']],
      ['zh-TW', '投稿額度', '留言額度方式', ['使用預設', '自訂數量', '無上限']]
    ]) {
      await language.selectOption(lang);
      await expect(page.locator('#user-contribution-limits').getByRole('heading', { name: heading, exact: true })).toBeVisible();
      const mode = page.getByLabel(modeLabel, { exact: true });
      await expect(mode.locator('option')).toHaveText(modeOptions);
      await mode.focus();
      await expect(mode).toBeFocused();
      // macOS headless native popups do not receive arrow-key selection.
      // Native type-ahead needs key events; keyboard.type inserts CJK text without them.
      const key = modeOptions[1][0];
      await keyboard.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key, unmodifiedText: key });
      await keyboard.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
      await expect(mode).toHaveValue('limited');
      await expect(page.locator('#user-message-limit')).toBeEnabled();
      await page.keyboard.press('Tab');
      await expect(page.locator('#user-message-limit')).toBeFocused();
      await expect(page.locator('#user-message-limit')).toHaveAttribute('min', '0');
      await expect(page.locator('#user-message-limit')).toHaveAttribute('step', '1');
    }
    await page.locator('#drawer-close').click();
    await openQuotaView(page, 'contributionLimits');
    await page.getByLabel('留言每日預設上限').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('畫廊投稿每日預設上限')).toBeFocused();
    await language.selectOption('en');
    await expect(page.getByLabel('Default daily message limit')).toHaveValue('3');
    await language.selectOption('ja');
    await expect(page.getByLabel('メッセージの1日の既定上限')).toHaveValue('3');
    await keyboard.detach();
  });

  test('delayed contribution user reads keep the latest target when responses arrive out of order', async ({ page }) => {
    await signInQuotaAdmin(page);
    await page.evaluate(async ({ first, second }) => {
      const original = window.AdminApp.call.bind(window.AdminApp);
      const [firstData, secondData] = await Promise.all([
        original('getUser', { uid: first }), original('getUser', { uid: second })
      ]);
      window.quotaUserDeferred = {};
      window.AdminApp.call = (name, data) => {
        if (name !== 'getUser') return original(name, data);
        return new Promise((resolve, reject) => {
          window.quotaUserDeferred[data.uid] = {
            resolve, reject, data: data.uid === first ? firstData : secondData
          };
        });
      };
      window.quotaUserReads = [window.AdminApp.openUser(first), window.AdminApp.openUser(second)];
    }, { first: quotaUser.uid, second: quotaModerator.uid });
    await page.evaluate(async (uid) => {
      const deferred = window.quotaUserDeferred[uid];
      deferred.resolve(deferred.data);
      await window.quotaUserReads[1];
    }, quotaModerator.uid);
    await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#drawer-content')).toContainText(quotaModerator.email);
    await page.evaluate(async (uid) => {
      const deferred = window.quotaUserDeferred[uid];
      deferred.resolve(deferred.data);
      await window.quotaUserReads[0];
    }, quotaUser.uid);
    await expect(page.locator('#drawer-content')).toContainText(quotaModerator.email);
    await expect(page.locator('#drawer-content')).not.toContainText(quotaUser.email);
    expect(await page.evaluate(() => window.AdminApp.state.detailUserUid)).toBe(quotaModerator.uid);
  });

  test('delayed contribution user responses stay closed and are ignored after an account switch', async ({ page }) => {
    await signInQuotaAdmin(page);
    await page.evaluate(async (uid) => {
      const original = window.AdminApp.call.bind(window.AdminApp);
      const userData = await original('getUser', { uid });
      window.quotaUserDeferred = [];
      window.AdminApp.call = (name, data) => {
        if (name !== 'getUser') return original(name, data);
        return new Promise((resolve, reject) => window.quotaUserDeferred.push({ resolve, reject, data: userData }));
      };
      window.quotaPendingUser = window.AdminApp.openUser(uid);
      window.AdminApp.closeDrawer();
    }, quotaUser.uid);
    await page.evaluate(async () => {
      window.quotaUserDeferred[0].resolve(window.quotaUserDeferred[0].data);
      await window.quotaPendingUser;
    });
    await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'true');
    expect(await page.evaluate(() => window.AdminApp.state.detailUserUid)).toBeNull();
    await page.evaluate((uid) => {
      window.quotaPendingUser = window.AdminApp.openUser(uid);
      return window.AdminApp.auth.signOut();
    }, quotaUser.uid);
    await expect(page.locator('#auth-view')).toBeVisible();
    await page.getByLabel('電子郵件').fill(quotaModerator.email);
    await page.getByLabel('密碼').fill(quotaModerator.password);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
    await page.evaluate(async () => {
      window.quotaUserDeferred[1].resolve(window.quotaUserDeferred[1].data);
      await window.quotaPendingUser;
    });
    await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#drawer-content')).toBeEmpty();
    expect(await page.evaluate(() => window.AdminApp.state.detailUserUid)).toBeNull();
    const toastBefore = await page.locator('#admin-toast').textContent();
    await page.evaluate(async (uid) => {
      window.quotaPendingUser = window.AdminApp.openUser(uid);
      window.AdminApp.closeDrawer();
      window.quotaUserDeferred[2].reject({ code: 'functions/permission-denied', message: 'Delayed old response' });
      await window.quotaPendingUser;
    }, quotaUser.uid);
    await expect(page.locator('#admin-toast')).toHaveText(toastBefore);
  });

  test('delayed contribution defaults never replace a different view, including failed reads', async ({ page }) => {
    await signInQuotaAdmin(page);
    await page.evaluate(() => {
      const original = window.AdminApp.call.bind(window.AdminApp);
      window.quotaDefaultsDeferred = [];
      window.AdminApp.call = (name, data) => {
        if (name !== 'getContributionDefaults') return original(name, data);
        return new Promise((resolve, reject) => window.quotaDefaultsDeferred.push({ resolve, reject }));
      };
    });
    for (const failed of [false, true]) {
      await openQuotaView(page, 'contributionLimits');
      await expect(page.locator('#admin-main .loading-state')).toBeVisible();
      await openQuotaView(page, 'dashboard');
      await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
      await page.evaluate(async (failed) => {
        const deferred = window.quotaDefaultsDeferred.at(-1);
        if (failed) deferred.reject({ code: 'functions/internal', message: 'Delayed defaults failure' });
        else deferred.resolve({ defaults: { messageDailyLimit: 3, fanartDailyLimit: 2 }, revision: 0 });
        await new Promise(requestAnimationFrame);
      }, failed);
      await expect(page.getByRole('heading', { name: '治理總覽' })).toBeVisible();
      await expect(page.locator('#contribution-defaults-form, #admin-main .error-state')).toHaveCount(0);
      expect(await page.evaluate(() => window.AdminApp.state.view)).toBe('dashboard');
    }
  });
});
