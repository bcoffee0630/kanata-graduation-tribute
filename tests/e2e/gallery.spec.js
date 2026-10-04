const { test, expect } = require('@playwright/test');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { startXEmbedFixture } = require('../helpers/x-oembed-fixture.cjs');

const projectId = 'demo-kanata-governance';
let stopEmbedFixture;
let db;
const idAt = index => String(1990000000000000000n + BigInt(index));

const widgetFixture = `
window.__xWidgetCalls = [];
window.twttr = { widgets: { createTweet: async (id, target, options) => {
    window.__xWidgetCalls.push({ id, options });
    if (id.endsWith('404')) return undefined;
    const post = document.createElement('div');
    post.className = 'twitter-tweet';
    post.dataset.testEmbed = id;
    post.dataset.embedLang = options.lang;
    post.style.cssText = 'width:100%;max-width:550px;margin:10px auto;border:1px solid #dce6ef;border-radius:12px;padding:16px;background:white;box-sizing:border-box';
    const author = document.createElement('p');
    author.textContent = '@original_artist · X';
    const copy = document.createElement('p');
    copy.textContent = 'A memory of Kanata #かなたーと';
    const artwork = document.createElement('div');
    artwork.setAttribute('role', 'img');
    artwork.setAttribute('aria-label', 'Mock fan artwork');
    artwork.style.cssText = 'margin:12px 0;border-radius:8px;background:linear-gradient(135deg,#a5cfff,#dcecff,#a6b5d8);height:' + (Number(id.slice(-1)) % 2 ? 440 : 220) + 'px';
    post.append(author, copy, artwork);
    target.append(post);
    return post;
} } };
`;

async function seedGallery() {
    const old = await db.collection('fanart').where('sourceType', '==', 'x').get();
    await Promise.all(old.docs.map(doc => doc.ref.delete()));
    const created = Date.now();
    await Promise.all(Array.from({ length: 21 }, (_, index) => {
        const postId = idAt(index + 1);
        return db.collection('fanart').doc(`x_${postId}`).set({
            sourceType: 'x', postId, postUrl: `https://x.com/artist/status/${postId}`,
            caption: `Gallery fixture ${index + 1}`, artist: 'Website submitter', artistId: 'fixture-submitter',
            submitter: { uid: 'fixture-submitter', displayName: 'Website submitter' },
            createdAt: Timestamp.fromMillis(created - index * 1000), hidden: false, deleted: false,
            reportCount: 0, moderation: { status: 'visible' }
        });
    }));
    await Promise.all([
        db.collection('fanart').doc('fixture-gallery-hidden').set({
            sourceType: 'x', postId: idAt(90), postUrl: `https://x.com/artist/status/${idAt(90)}`,
            caption: 'Hidden fixture', hidden: true, deleted: false, createdAt: Timestamp.now()
        }),
        db.collection('fanart').doc('fixture-gallery-deleted').set({
            sourceType: 'x', postId: idAt(91), postUrl: `https://x.com/artist/status/${idAt(91)}`,
            caption: 'Deleted fixture', hidden: false, deleted: true, createdAt: Timestamp.now()
        }),
        db.collection('fanart').doc('fixture-gallery-legacy').set({
            caption: 'Legacy image fixture', imageUrl: 'https://attacker.example/legacy-image.png',
            artist: 'Legacy artist', hidden: false, deleted: false, createdAt: Timestamp.now()
        })
    ]);
}

async function signIn(page, testInfo) {
    await page.waitForFunction(() => window.FirebaseApp?.getAuth());
    await page.evaluate(async (name) => {
        const token = JSON.stringify({ sub: name, email: `${name}@example.test`, email_verified: true, name: 'Gallery contributor' });
        await window.FirebaseApp.getAuth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
    }, `gallery-${testInfo.project.name}-${Date.now()}`);
    await expect(page.locator('#submit-fanart-btn')).toBeVisible();
}

async function checkConfirmations(page) {
    for (const checkbox of await page.locator('#fanart-modal .confirm-checkbox').all()) await checkbox.check();
}

const displayOption = (page, size) => page.locator(`input[name="gallery-display-size"][value="${size}"]`);

async function selectDisplaySize(page, size) {
    const option = displayOption(page, size);
    await option.locator('..').click();
    await expect(option).toBeChecked();
}

async function expectGalleryLayout(page, columns) {
    await expect.poll(() => page.locator('#gallery-grid').evaluate((grid, expectedColumns) => {
        const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
        const outer = grid.getBoundingClientRect();
        const cards = [...grid.querySelectorAll('.gallery-card')].map(card => card.getBoundingClientRect());
        const overlaps = cards.some((card, index) => cards.slice(index + 1).some(other =>
            Math.min(card.right, other.right) - Math.max(card.left, other.left) > 1 &&
            Math.min(card.bottom, other.bottom) - Math.max(card.top, other.top) > 1));
        const outside = cards.some(card => card.left < outer.left - 1 || card.right > outer.right + 1);
        const centered = Math.abs(outer.left - (document.documentElement.clientWidth - outer.right)) < 1;
        return tracks.length === expectedColumns && !overlaps && !outside && centered &&
            document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    }, columns)).toBe(true);
}

test.beforeAll(async () => {
    process.env.GCLOUD_PROJECT = projectId;
    process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8180';
    if (!getApps().length) initializeApp({ projectId });
    db = getFirestore();
    stopEmbedFixture = await startXEmbedFixture();
});

test.afterAll(async () => { await stopEmbedFixture?.(); });

test.beforeEach(async ({ page }) => {
    await seedGallery();
    await page.addInitScript(() => localStorage.setItem('preferred-language', 'zh-TW'));
    await page.route('https://platform.x.com/widgets.js', route => route.fulfill({ contentType: 'application/javascript', body: widgetFixture }));
});

test('X gallery paginates visible posts and adapts naturally to desktop and mobile', async ({ page }, testInfo) => {
    const errors = [];
    const unwanted = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://attacker.example/')) unwanted.push(request.url()); });
    await page.goto('/#gallery-section');
    await expect(page).toHaveTitle(/^天音彼方 畢業紀念(?: - Day \d+)?$/);
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    await expect(page.locator('#gallery-grid .x-embed').first()).toHaveAttribute('data-embed-state', 'ready');
    await expect(page.getByText('投稿者 · Website submitter').first()).toBeVisible();
    await expect(page.getByText('Hidden fixture', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Deleted fixture', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Legacy image fixture', { exact: true })).toHaveCount(0);
    expect(unwanted).toEqual([]);
    await expect(page.locator('#lightbox')).toHaveCount(0);
    const cards = page.locator('.gallery-card');
    await expect.poll(async () => (await cards.first().boundingBox())?.height).toBeGreaterThan(440);
    if (testInfo.project.name === 'mobile') {
        await expect.poll(async () => {
            const first = await cards.nth(0).boundingBox();
            const second = await cards.nth(1).boundingBox();
            return second.y - first.y - first.height;
        }).toBeGreaterThan(30);
    }
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (testInfo.project.name === 'desktop') {
        expect(second.x - first.x - first.width).toBeCloseTo(32, 0);
        await expect.poll(async () => Math.abs((await cards.nth(0).boundingBox()).y - (await cards.nth(1).boundingBox()).y))
            .toBeLessThan(1);
        expect((await page.locator('#gallery-grid').boundingBox()).width).toBeLessThanOrEqual(1040);
    } else {
        expect(second.x).toBeCloseTo(first.x, 0);
        expect(second.y).toBeGreaterThan(first.y + first.height + 30);
    }
    // ResizeObserver must move downstream cards when an embed expands later.
    await page.locator('.gallery-card').first().evaluate(card => { card.querySelector('[role="img"]').style.height = '600px'; });
    await expect.poll(async () => (await cards.first().boundingBox())?.height).toBeGreaterThan(600);
    if (testInfo.project.name === 'mobile') {
        await expect.poll(async () => (await cards.nth(1).boundingBox())?.y - (await cards.first().boundingBox())?.y)
            .toBeGreaterThan(630);
    }
    await page.getByRole('button', { name: '載入更多', exact: true }).click();
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(21);
    await expect(page.getByRole('button', { name: '載入更多', exact: true })).toBeHidden();
    const options = await page.evaluate(() => window.__xWidgetCalls[0].options);
    expect(options).toMatchObject({ theme: 'light', conversation: 'none', dnt: true, lang: 'zh-tw' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(errors).toEqual([]);
});

test('link tutorial, preview, translated labels and keyboard focus work without changing navigation', async ({ page }, testInfo) => {
    await page.goto('/#gallery-section');
    await signIn(page, testInfo);
    await page.locator('#submit-fanart-btn').click();
    const modal = page.locator('#fanart-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#fanart-post-url')).toBeFocused();
    await expect(modal.locator('.fanart-tutorial li')).toHaveCount(3);
    await expect(modal.locator('input[type="file"]')).toHaveCount(0);
    await page.locator('#fanart-post-url').fill('https://x.com/artist');
    await checkConfirmations(page);
    await expect(modal.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.locator('#fanart-url-error')).toBeVisible();
    await page.locator('#fanart-post-url').fill(`https://twitter.com/artist/status/${idAt(1)}?s=20`);
    await expect(modal.locator('button[type="submit"]')).toBeEnabled();
    await page.getByRole('button', { name: '預覽（選填）' }).click();
    await expect(page.locator('#fanart-preview')).toHaveAttribute('data-embed-state', 'ready');
    expect(await page.locator('script#x-widgets-script').count()).toBe(1);
    for (const [lang, title, tutorial] of [
        ['en', 'Share an X post', 'How to share an X post'],
        ['ja', 'Xの投稿を共有', 'Xの投稿を共有するには'],
        ['zh-TW', '分享 X 貼文', '如何分享 X 貼文']
    ]) {
        await page.evaluate(lang => window.i18n.switchLanguage(lang), lang);
        await expect(modal.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(modal.getByRole('heading', { name: tutorial, exact: true })).toBeVisible();
    }
    const submit = modal.locator('button[type="submit"]');
    await submit.focus();
    await page.keyboard.press('Tab');
    await expect(modal.locator('.modal-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(submit).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#submit-fanart-btn')).toBeFocused();
    await expect(page.locator('.site-nav a[href="#gallery-section"]')).toHaveCount(1);
});

test('official-width X embeds stay centered at 691px and across gallery and preview resizes', async ({ page }, testInfo) => {
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    await expect(page.locator('#gallery-grid .x-embed').first()).toHaveAttribute('data-embed-state', 'ready');
    async function expectCentered(container) {
        await expect.poll(() => container.evaluate(element => {
            const post = element.querySelector('.twitter-tweet');
            if (!post) return Infinity;
            const outer = element.getBoundingClientRect();
            const inner = post.getBoundingClientRect();
            return Math.abs((inner.left - outer.left) - (outer.right - inner.right));
        })).toBeLessThan(1);
        const bounds = await container.evaluate(element => {
            const post = element.querySelector('.twitter-tweet');
            return { width: post.getBoundingClientRect().width, maximum: getComputedStyle(post).maxWidth,
                available: element.getBoundingClientRect().width };
        });
        expect(bounds.maximum).toBe('550px');
        expect(bounds.width).toBeLessThanOrEqual(550);
        expect(bounds.width).toBeLessThanOrEqual(bounds.available);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    }
    const card = page.locator('#gallery-grid .gallery-card').first();
    await expectCentered(card);
    for (const width of [691, 1440, 390, 691]) {
        await page.setViewportSize({ width, height: 827 });
        await expectCentered(card);
        if (width === 691) {
            await expect.poll(() => card.locator('.twitter-tweet').evaluate(post => post.getBoundingClientRect().width))
                .toBe(550);
        }
    }
    await signIn(page, testInfo);
    await page.locator('#submit-fanart-btn').click();
    await page.locator('#fanart-post-url').fill(`https://x.com/artist/status/${idAt(2)}`);
    await page.getByRole('button', { name: '預覽（選填）' }).click();
    const preview = page.locator('#fanart-preview');
    await expect(preview).toHaveAttribute('data-embed-state', 'ready');
    await expectCentered(preview);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectCentered(preview);
});

test('a language change while pagination waits updates every existing card and embed', async ({ page }) => {
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    // Delay only the cursor query; its eventual result still comes from Firestore.
    await page.evaluate(() => {
        const query = window.Gallery.query;
        const gate = new Promise(resolve => { window.releaseGalleryRead = resolve; });
        window.Gallery.query = function() {
            const base = query.call(this);
            return {
                startAfter(cursor) {
                    return { limit(count) {
                        const page = base.startAfter(cursor).limit(count);
                        return { async get() { await gate; return page.get(); } };
                    } };
                }
            };
        };
    });
    await page.getByRole('button', { name: '載入更多', exact: true }).click();
    await expect(page.locator('#load-more-btn')).toBeDisabled();
    await page.evaluate(() => window.i18n.switchLanguage('en'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.evaluate(() => window.releaseGalleryRead());
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(21);
    await expect.poll(() => page.locator('.gallery-submitter').allTextContents())
        .toEqual(Array(21).fill('Submitted by · Website submitter'));
    await page.locator('#gallery-grid .gallery-item').first().scrollIntoViewIfNeeded();
    await expect(page.locator('#gallery-grid [data-test-embed]').first()).toHaveAttribute('data-embed-lang', 'en');
    const displayedDate = await page.locator('.gallery-meta time').first().evaluate(time => ({
        actual: time.textContent, expected: new Date(time.dateTime).toLocaleDateString('en')
    }));
    expect(displayedDate.actual).toBe(displayedDate.expected);
});

test('blocked scripts and unavailable posts show safe original links and allow retry', async ({ page }, testInfo) => {
    await page.unroute('https://platform.x.com/widgets.js');
    await page.route('https://platform.x.com/widgets.js', route => route.abort());
    await page.goto('/#gallery-section');
    const embed = page.locator('#gallery-grid .x-embed').first();
    await expect(embed).toHaveAttribute('data-embed-state', 'error');
    await expect(embed.getByRole('link', { name: '開啟原始貼文' })).toHaveAttribute('href', `https://x.com/artist/status/${idAt(1)}`);
    await page.unroute('https://platform.x.com/widgets.js');
    await page.route('https://platform.x.com/widgets.js', route => route.fulfill({ contentType: 'application/javascript', body: widgetFixture }));
    await embed.getByRole('button', { name: '重新載入' }).click();
    await expect(embed).toHaveAttribute('data-embed-state', 'ready');
    await signIn(page, testInfo);
    await page.locator('#submit-fanart-btn').click();
    await page.locator('#fanart-post-url').fill('https://x.com/artist/status/1900000000000000404');
    await page.getByRole('button', { name: '預覽（選填）' }).click();
    await expect(page.locator('#fanart-preview')).toHaveAttribute('data-embed-state', 'error');
    await expect(page.locator('#fanart-preview').getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.locator('#fanart-preview').getByRole('button', { name: '重新載入' })).toBeVisible();
});

test('actual callable failures preserve inputs, then successful links refresh the gallery and enforce two per day', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/#gallery-section');
    await signIn(page, testInfo);
    await page.locator('#submit-fanart-btn').click();
    const modal = page.locator('#fanart-modal');
    const input = page.locator('#fanart-post-url');
    const caption = page.locator('#fanart-caption');
    const submit = modal.locator('button[type="submit"]');
    await input.fill(`https://x.com/artist/status/${idAt(1)}`);
    await caption.fill('Preserve my description');
    await checkConfirmations(page);
    await submit.click();
    await expect(page.locator('#fanart-submit-error')).toContainText('這則貼文已經有人分享過了');
    await expect(caption).toHaveValue('Preserve my description');
    await expect(submit).toBeEnabled();
    await input.fill('https://x.com/artist/status/1900000000000000503');
    await submit.click();
    await expect(page.locator('#fanart-submit-error')).toContainText('本次未使用投稿額度');
    await expect(input).toHaveValue('https://x.com/artist/status/1900000000000000503');
    await expect(submit).toBeEnabled();

    for (let count = 0; count < 2; count++) {
        if (count) { await page.locator('#submit-fanart-btn').click(); await checkConfirmations(page); }
        const postId = testInfo.project.name === 'desktop' ? idAt(101 + count) : idAt(201 + count);
        await input.fill(`https://twitter.com/artist/status/${postId}/photo/1?s=20`);
        await caption.fill(`Submitted UI fixture ${count + 1}`);
        await submit.click();
        await expect(modal).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator(`#gallery-grid [data-post-id="${postId}"]`)).toBeVisible();
        const saved = (await db.collection('fanart').doc(`x_${postId}`).get()).data();
        expect(saved.postUrl).toBe(`https://x.com/artist/status/${postId}`);
        expect(saved.submitter.displayName).toBe('Gallery contributor');
    }
    await page.locator('#submit-fanart-btn').click();
    await input.fill(`https://x.com/artist/status/${idAt(303)}`);
    await checkConfirmations(page);
    await submit.click();
    await expect(page.locator('#fanart-submit-error')).toContainText('今日已達投稿上限');
    await expect(submit).toBeEnabled();
});

test('display size switches preserve posts, pagination, reports and existing responsive embeds', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    await expect(displayOption(page, 'standard')).toBeChecked();
    for (const embed of await page.locator('#gallery-grid .x-embed').all().then(embeds => embeds.slice(0, 3))) {
        await embed.scrollIntoViewIfNeeded();
        await expect(embed).toHaveAttribute('data-embed-state', 'ready');
    }
    await page.getByRole('button', { name: '載入更多', exact: true }).click();
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(21);
    await page.evaluate(() => {
        const gallery = window.Gallery;
        const query = gallery.query;
        window.__displaySnapshot = {
            data: gallery.data, cursor: gallery.lastDoc, version: gallery.requestVersion,
            items: [...document.querySelectorAll('#gallery-grid .gallery-item')],
            calls: window.__xWidgetCalls.filter(call => window.Gallery.data.slice(0, 3).some(item => item.postId === call.id))
        };
        window.__displayQueries = 0;
        gallery.query = function() { window.__displayQueries++; return query.call(this); };
    });
    await expectGalleryLayout(page, 2);
    for (const size of ['compact', 'standard', 'compact', 'standard']) {
        await selectDisplaySize(page, size);
        await expect(page.locator('#gallery-grid')).toHaveAttribute('data-display-size', size);
        await expectGalleryLayout(page, size === 'compact' ? 3 : 2);
        expect(await page.evaluate(() => {
            const saved = window.__displaySnapshot;
            const items = [...document.querySelectorAll('#gallery-grid .gallery-item')];
            return window.Gallery.data === saved.data && window.Gallery.lastDoc === saved.cursor &&
                window.Gallery.requestVersion === saved.version && window.__displayQueries === 0 &&
                items.every((item, index) => item === saved.items[index]);
        })).toBe(true);
        await expect(page.locator('#gallery-grid .report-btn')).toHaveCount(21);
        await expect(page.locator('#load-more-btn')).toBeHidden();
    }
    const calls = await page.evaluate(() => window.__xWidgetCalls.filter(call =>
        window.Gallery.data.slice(0, 3).some(item => item.postId === call.id)));
    expect(calls).toEqual(await page.evaluate(() => window.__displaySnapshot.calls));
    expect(await page.locator('script#x-widgets-script').count()).toBe(1);
});

test('display modes use the agreed responsive boundaries without stale masonry columns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One pass covers desktop and mobile widths in the same browser.');
    test.setTimeout(60_000);
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    for (const size of ['standard', 'compact', 'standard']) {
        await selectDisplaySize(page, size);
        for (const width of [1440, 1024, 1023, 768, 767, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await expectGalleryLayout(page, width < 768 ? 1 : size === 'compact' && width >= 1024 ? 3 : 2);
            const hint = page.locator('#gallery-size-hint');
            if (size === 'compact' && width < 1024) await expect(hint).toBeVisible();
            else await expect(hint).toBeHidden();
            const embed = page.locator('#gallery-grid .x-embed').first();
            await embed.scrollIntoViewIfNeeded();
            await expect(embed).toHaveAttribute('data-embed-state', 'ready');
            await expect.poll(() => embed.evaluate(element => {
                const post = element.querySelector('.twitter-tweet').getBoundingClientRect();
                const frame = element.getBoundingClientRect();
                return Math.abs((post.left - frame.left) - (frame.right - post.right));
            })).toBeLessThan(1);
        }
    }
});

test('display preference persists through reload, translations, keyboard input and pagination', async ({ page }) => {
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    const standard = displayOption(page, 'standard');
    const compact = displayOption(page, 'compact');
    await standard.focus();
    await page.keyboard.press('ArrowRight');
    await expect(compact).toBeChecked();
    await expect(compact).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(standard).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('gallery-display-size'))).toBe('compact');
    await page.reload();
    await expect(compact).toBeChecked();
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    for (const [lang, group, standardLabel, compactLabel] of [
        ['en', 'Display size', 'Standard', 'Smaller'],
        ['ja', '表示サイズ', '標準', '小さめ'],
        ['zh-TW', '顯示大小', '標準', '較小']
    ]) {
        await page.evaluate(lang => window.i18n.switchLanguage(lang), lang);
        await expect(page.getByRole('group', { name: group, exact: true })).toBeVisible();
        await expect(page.getByRole('radio', { name: standardLabel, exact: true })).not.toBeChecked();
        await expect(page.getByRole('radio', { name: compactLabel, exact: true })).toBeChecked();
        await expect(page.locator('#gallery-grid')).toHaveAttribute('data-display-size', 'compact');
    }
    await page.getByRole('button', { name: '載入更多', exact: true }).click();
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(21);
    await expect(compact).toBeChecked();
    await expect(page.locator('#load-more-btn')).toBeHidden();
});

test('invalid display preferences fall back to the original size', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('gallery-display-size', 'enormous'));
    await page.goto('/#gallery-section');
    await expect(displayOption(page, 'standard')).toBeChecked();
    await expect(page.locator('#gallery-grid')).toHaveAttribute('data-display-size', 'standard');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
});

test('unavailable preference storage still permits switching for the current visit', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
            if (key === 'gallery-display-size') throw new DOMException('Storage blocked', 'SecurityError');
            return getItem.call(this, key);
        };
        Storage.prototype.setItem = function(key, value) {
            if (key === 'gallery-display-size') throw new DOMException('Storage blocked', 'SecurityError');
            return setItem.call(this, key, value);
        };
    });
    await page.goto('/#gallery-section');
    await expect(displayOption(page, 'standard')).toBeChecked();
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(20);
    await selectDisplaySize(page, 'compact');
    await expect(displayOption(page, 'compact')).toBeChecked();
    await expect(page.locator('#gallery-grid')).toHaveAttribute('data-display-size', 'compact');
    await page.reload();
    await expect(displayOption(page, 'standard')).toBeChecked();
    expect(errors).toEqual([]);
});
