const { test, expect } = require('@playwright/test');

async function signIn(page, uid) {
    await page.waitForFunction(() => window.FirebaseApp?.getAuth());
    const actualUid = await page.evaluate(async name => {
        const token = JSON.stringify({ sub: name, email: `${name}@example.test`, email_verified: true, name: 'Quota contributor' });
        const credential = await window.FirebaseApp.getAuth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
        return credential.user.uid;
    }, uid);
    await expect.poll(() => page.evaluate(() => window.Auth.currentUser?.uid)).toBe(actualUid);
    await expect(page.locator('#submit-message-btn')).toBeVisible();
}

async function openModal(page, type) {
    // Exercise native keyboard activation while unrelated lazy X cards can reflow.
    // Pointer activation is covered by the gallery suite.
    await page.locator(`#submit-${type}-btn`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`#${type}-modal`)).toHaveClass(/active/);
}

async function closeModal(page, type) {
    // The close control can sit above the scrollable body on short mobile screens.
    await page.keyboard.press('Escape');
    await expect(page.locator(`#${type}-modal`)).not.toHaveClass(/active/);
}

async function fillSubmission(page, type) {
    if (type === 'message') await page.locator('#message-content').fill('A message to remember Kanata');
    else await page.locator('#fanart-post-url').fill('https://x.com/artist/status/1990000000000000901');
    for (const checkbox of await page.locator(`#${type}-modal .confirm-checkbox`).all()) await checkbox.check();
    await expect(page.locator(`#${type}-form button[type="submit"]`)).toBeEnabled();
}

test.beforeEach(async ({ page, browserName }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('preferred-language', 'zh-TW'));
    if (browserName === 'webkit') {
        await page.addInitScript(() => {
            // Limit this SDK transport workaround to local emulator pages in this test.
            window.addEventListener('firebaseReady', () => {
                if (window.FirebaseApp?.isUsingEmulators()) {
                    window.FirebaseApp.getDb().settings({ merge: true,
                        experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: false });
                }
            }, { once: true });
        });
    }
    await page.route('https://platform.x.com/widgets.js', route => route.fulfill({ contentType: 'application/javascript', body: `
        window.twttr = { widgets: { createTweet: async (id, target) => {
            const card = document.createElement('div');
            card.className = 'twitter-tweet';
            card.style.cssText = 'width:100%;height:240px;background:#edf6ff';
            card.textContent = '@original_artist · #かなたーと';
            target.append(card); return card;
        } } };
    ` }));
    await page.route('**/api/messages', route => {
        const generatedAt = Date.now();
        return route.fulfill({ json: { version: 'ui-fixture', generatedAt, validUntil: generatedAt + 300000, mode: 'normal', items: [] } });
    });
    await page.route('**/api/gallery/batches/*', route => {
        const generatedAt = Date.now();
        return route.fulfill({ json: { version: 'ui-fixture', generatedAt, validUntil: generatedAt + 300000, mode: 'normal', items: [] } });
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await signIn(page, `quota-${testInfo.project.name}-${Date.now()}`);
    await page.evaluate(() => {
        const actualFunctions = window.FirebaseApp.getFunctions.bind(window.FirebaseApp);
        window.__quotaFixture = {
            value: { dayKey: '2026-10-05', message: { limit: 3, used: 1, remaining: 2 }, fanart: { limit: 2, used: 0, remaining: 2 } },
            reads: [], submitted: [], pending: [], defer: false, failure: false, submissionError: null
        };
        window.FirebaseApp.getFunctions = () => {
            const functions = actualFunctions();
            return { httpsCallable(name) {
                if (name === 'getMyContributionLimits') return async () => {
                    const fixture = window.__quotaFixture;
                    const snapshot = JSON.parse(JSON.stringify(fixture.value));
                    const fails = fixture.failure;
                    fixture.reads.push(window.Auth.currentUser?.uid);
                    if (fixture.defer) await new Promise(resolve => fixture.pending.push(resolve));
                    if (fails) throw Object.assign(new Error('Temporary quota read failure'), { code: 'functions/unavailable' });
                    return { data: snapshot };
                };
                if (name === 'submitMessage' || name === 'submitFanartLink') return async data => {
                    const fixture = window.__quotaFixture;
                    if (fixture.submissionError) throw Object.assign(new Error('Daily allowance exhausted'), fixture.submissionError);
                    const type = name === 'submitMessage' ? 'message' : 'fanart';
                    fixture.submitted.push({ name, data });
                    fixture.value[type].used += 1;
                    return { data: { id: `quota-fixture-${fixture.submitted.length}` } };
                };
                return functions.httpsCallable(name);
            } };
        };
    });
});

test('separate default allowances refresh on opening and translate without new reads', async ({ page }) => {
    await page.locator('#submit-message-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#message-modal')).toHaveClass(/active/);
    const messages = page.locator('#message-quota-note');
    await expect(messages).toHaveText('每日最多 3 則留言；今日已使用 1 則。');
    await closeModal(page, 'message');
    await expect(page.locator('#submit-message-btn')).toBeFocused();
    await openModal(page, 'fanart');
    const posts = page.locator('#fanart-quota-note');
    await expect(posts).toHaveText('每日最多 2 件投稿；今日已使用 0 件。');
    const reads = await page.evaluate(() => window.__quotaFixture.reads.length);
    await page.evaluate(() => window.i18n.switchLanguage('ja'));
    await expect(posts).toHaveText('投稿は1日 2 件まで。本日は 0 件投稿済みです。');
    await expect(messages).toHaveText('メッセージは1日 3 件まで。本日は 1 件投稿済みです。');
    await page.evaluate(() => window.i18n.switchLanguage('en'));
    await expect(posts).toHaveText('Up to 2 posts per day; 0 used today.');
    await expect(messages).toHaveText('Up to 3 messages per day; 1 used today.');
    expect(await page.evaluate(() => window.__quotaFixture.reads.length)).toBe(reads);
    await closeModal(page, 'fanart');
    await page.evaluate(() => { window.__quotaFixture.value.message.used = 2; });
    await openModal(page, 'message');
    await expect(messages).toHaveText('Up to 3 messages per day; 2 used today.');
    expect(await page.evaluate(() => window.__quotaFixture.reads.length)).toBe(reads + 1);
});

test('custom, unlimited and zero allowances keep message and post settings independent', async ({ page }) => {
    await page.evaluate(() => {
        window.__quotaFixture.value.message = { limit: 9, used: 4, remaining: 5 };
        window.__quotaFixture.value.fanart = { limit: null, used: 7, remaining: null };
    });
    await openModal(page, 'message');
    await expect(page.locator('#message-quota-note')).toHaveText('每日最多 9 則留言；今日已使用 4 則。');
    await closeModal(page, 'message');
    await openModal(page, 'fanart');
    await expect(page.locator('#fanart-quota-note')).toHaveText('投稿無每日上限；今日已使用 7 件。');
    await closeModal(page, 'fanart');
    await page.evaluate(() => {
        window.__quotaFixture.value.message = { limit: null, used: 14, remaining: null };
        window.__quotaFixture.value.fanart = { limit: 0, used: 7, remaining: 0 };
    });
    await openModal(page, 'fanart');
    await expect(page.locator('#fanart-quota-note')).toHaveText('目前不接受新投稿；今日已使用 7 件。');
    // This display can become stale after an Owner change; the backend remains authoritative.
    await fillSubmission(page, 'fanart');
    await closeModal(page, 'fanart');
    await openModal(page, 'message');
    await expect(page.locator('#message-quota-note')).toHaveText('留言無每日上限；今日已使用 14 則。');
    await closeModal(page, 'message');
    await page.evaluate(() => { window.__quotaFixture.value.message.limit = 0; });
    await openModal(page, 'message');
    await expect(page.locator('#message-quota-note')).toHaveText('目前不接受新留言；今日已使用 14 則。');
});

test('unavailable and invalid responses clear stale values without blocking valid forms', async ({ page }) => {
    await openModal(page, 'fanart');
    await expect(page.locator('#fanart-quota-note')).toContainText('每日最多 2 件');
    await closeModal(page, 'fanart');
    await page.evaluate(() => { window.__quotaFixture.failure = true; });
    await openModal(page, 'message');
    const note = page.locator('#message-quota-note');
    await expect(note).toHaveText('暫時無法取得今日投稿額度，送出時將由系統確認。');
    await expect(page.locator('#fanart-quota-note')).toHaveText('暫時無法取得今日投稿額度，送出時將由系統確認。');
    await fillSubmission(page, 'message');
    await closeModal(page, 'message');
    await page.evaluate(() => { window.__quotaFixture.failure = false; window.__quotaFixture.value.message.limit = -1; });
    await openModal(page, 'fanart');
    await expect(page.locator('#fanart-quota-note')).toHaveText('暫時無法取得今日投稿額度，送出時將由系統確認。');
    await fillSubmission(page, 'fanart');
});

test('account changes and logout discard a delayed previous-account allowance', async ({ page }, testInfo) => {
    await page.evaluate(() => { window.__quotaFixture.defer = true; });
    await openModal(page, 'message');
    const note = page.locator('#message-quota-note');
    await expect(note).toHaveText('正在取得今日投稿額度…');
    await expect.poll(() => page.evaluate(() => window.__quotaFixture.pending.length)).toBe(1);
    await page.evaluate(() => {
        window.__quotaFixture.defer = false;
        window.__quotaFixture.value.message = { limit: 11, used: 8, remaining: 3 };
    });
    await signIn(page, `quota-new-${testInfo.project.name}-${Date.now()}`);
    await expect(note).toHaveText('每日最多 11 則留言；今日已使用 8 則。');
    await page.evaluate(() => { window.__quotaFixture.pending.splice(0).forEach(resolve => resolve()); });
    await expect(note).toHaveText('每日最多 11 則留言；今日已使用 8 則。');
    await page.evaluate(async () => { await window.FirebaseApp.getAuth().signOut(); });
    await expect(note).toHaveText('請先登入');
    await expect(page.locator('#fanart-quota-note')).toHaveText('請先登入');
    expect(await page.evaluate(() => window.Submit.quota)).toBeNull();
});

test('successful submissions refresh usage for both types and preserve their independence', async ({ page }) => {
    await openModal(page, 'message');
    await expect(page.locator('#message-quota-note')).toContainText('已使用 1 則');
    await fillSubmission(page, 'message');
    await page.locator('#message-form button[type="submit"]').click();
    await expect(page.locator('#message-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#message-quota-note')).toHaveText('每日最多 3 則留言；今日已使用 2 則。');
    await expect(page.locator('#fanart-quota-note')).toHaveText('每日最多 2 件投稿；今日已使用 0 件。');
    await openModal(page, 'fanart');
    await fillSubmission(page, 'fanart');
    await page.locator('#fanart-form button[type="submit"]').click();
    await expect(page.locator('#fanart-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#fanart-quota-note')).toHaveText('每日最多 2 件投稿；今日已使用 1 件。');
    await expect(page.locator('#message-quota-note')).toHaveText('每日最多 3 則留言；今日已使用 2 則。');
    expect(await page.evaluate(() => window.__quotaFixture.submitted.map(item => item.name)))
        .toEqual(['submitMessage', 'submitFanartLink']);
    expect(await page.evaluate(() => window.__quotaFixture.reads.length)).toBe(4);
});

test('daily limit failures use actual details and generic fallbacks without fixed defaults', async ({ page }) => {
    await page.evaluate(() => {
        window.__quotaFixture.submissionError = { code: 'functions/resource-exhausted',
            details: { reason: 'daily_limit', contentType: 'message', limit: 8, used: 9, dayKey: '2026-10-05' } };
    });
    await openModal(page, 'message');
    await fillSubmission(page, 'message');
    await page.locator('#message-form button[type="submit"]').click();
    await expect(page.locator('.toast').last()).toContainText('今日已達留言上限（每日 8 則；已使用 9 則）。');
    await expect(page.locator('#message-content')).toHaveValue('A message to remember Kanata');
    await closeModal(page, 'message');
    await page.evaluate(() => {
        window.__quotaFixture.submissionError.details = { reason: 'daily_limit', contentType: 'fanart', limit: 0, used: 7, dayKey: '2026-10-05' };
    });
    await openModal(page, 'fanart');
    await fillSubmission(page, 'fanart');
    await page.locator('#fanart-form button[type="submit"]').click();
    await expect(page.locator('#fanart-submit-error')).toHaveText('今日已達投稿上限（每日 0 件；已使用 7 件）。');
    await page.evaluate(() => { delete window.__quotaFixture.submissionError.details; });
    await page.locator('#fanart-form button[type="submit"]').click();
    await expect(page.locator('#fanart-submit-error')).toHaveText('今日已達投稿上限。');
    await expect(page.locator('#fanart-post-url')).toHaveValue('https://x.com/artist/status/1990000000000000901');
    await page.evaluate(() => window.i18n.switchLanguage('en'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('#fanart-form button[type="submit"]').click();
    await expect(page.locator('#fanart-submit-error')).toHaveText('Today’s post limit has been reached.');
    await page.evaluate(() => window.i18n.switchLanguage('ja'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.locator('#fanart-form button[type="submit"]').click();
    await expect(page.locator('#fanart-submit-error')).toHaveText('本日の投稿上限に達しました。');
});
