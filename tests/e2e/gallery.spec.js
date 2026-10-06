const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const idAt = index => String(1990000000000000000n + BigInt(index));
const itemsAt = (start, count = 6) => Array.from({ length: count }, (_, index) => ({
    id: `x_${idAt(start + index)}`, postId: idAt(start + index),
    postUrl: `https://x.com/artist/status/${idAt(start + index)}`,
    caption: `Gallery fixture ${start + index}`, submitter: 'Website submitter',
    createdAt: '2026-10-05T00:00:00.000Z'
}));
const batch = (items, extra = {}) => {
    const generatedAt = Date.now();
    return { version: '1', generatedAt, confirmedAt: generatedAt, validUntil: generatedAt + 300000,
        latestIds: items.slice(0, 2).map(item => item.postId), items, ...extra };
};
const widgetFixture = `
window.__xWidgetCalls = [];
window.twttr = { widgets: { createTweet: async (id, target, options) => {
    window.__xWidgetCalls.push({ id, options });
    const post = document.createElement('div');
    post.className = 'twitter-tweet';
    post.style.cssText = 'width:100%;max-width:550px;margin:10px auto;padding:16px;background:white;box-sizing:border-box';
    const author = document.createElement('p');
    author.textContent = '@original_artist · X';
    const copy = document.createElement('p');
    copy.textContent = 'A memory of Kanata #かなたーと';
    const artwork = document.createElement('div');
    artwork.setAttribute('role', 'img');
    artwork.setAttribute('aria-label', 'Mock fan artwork');
    artwork.style.cssText = 'height:' + (Number(id.slice(-1)) % 2 ? 640 : 440) + 'px;background:linear-gradient(135deg,#a5cfff,#dcecff,#a6b5d8);border-radius:12px;display:grid;place-items:center;color:#456b95';
    artwork.textContent = 'Fan artwork preview';
    post.append(author, copy, artwork); target.append(post); return post;
} } };
`;

// Route the actual public files, with Firebase removed, so gallery QA never reads a paid database.
test.beforeEach(async ({ context, baseURL }) => {
    await context.addInitScript(() => localStorage.setItem('preferred-language', 'zh-TW'));
    await context.route(`${new URL(baseURL).origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/api/gallery/batches/')) {
            return route.fulfill({ json: batch(itemsAt(1)) });
        }
        if (pathname === '/api/feed/version') {
            const { version, generatedAt, confirmedAt, validUntil } = batch([]);
            const state = { version, generatedAt, confirmedAt, validUntil };
            return route.fulfill({ json: { messages: state, gallery: state } });
        }
        const filename = path.resolve(__dirname, '../..', pathname === '/' ? 'index.html' : pathname.slice(1));
        if (!fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
        let body = fs.readFileSync(filename);
        if (pathname === '/') body = body.toString()
            .replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^\"]+"><\/script>/g, '')
            .replace(/<script src="assets\/js\/firebase-init\.js(?:\?[^\"]*)?"><\/script>/g, '');
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
        await route.fulfill({ body, contentType: types[path.extname(filename)] || 'application/octet-stream' });
    });
    await context.route('https://platform.x.com/widgets.js', route => route.fulfill({ body: widgetFixture, contentType: 'application/javascript' }));
});

async function openGallery(page) {
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
    await expect(page.locator('#gallery-refresh')).toBeAttached();
    await expect(page.locator('#gallery-grid .x-embed').first()).toHaveAttribute('data-embed-state', 'ready');
}
async function layout(page, columns) {
    await expect.poll(() => page.locator('#gallery-grid').evaluate((grid, expected) => {
        const cards = [...grid.querySelectorAll('.gallery-card')].map(card => card.getBoundingClientRect());
        const overlap = cards.some((card, index) => cards.slice(index + 1).some(other =>
            Math.min(card.right, other.right) - Math.max(card.left, other.left) > 1 &&
            Math.min(card.bottom, other.bottom) - Math.max(card.top, other.top) > 1));
        return getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length === expected && !overlap &&
            document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    }, columns)).toBe(true);
}

test('six compact posts use shared batch URLs and retain accessible share, refresh and report actions', async ({ page }) => {
    const requests = [];
    page.on('request', request => { if (request.url().includes('/api/gallery/')) requests.push(request.url()); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openGallery(page);
    await expect(page.locator('#gallery-grid .report-btn')).toHaveCount(6);
    await expect(page.locator('#load-more-btn, #gallery-display-controls, #gallery-size-toggle, #gallery-shuffle')).toHaveCount(0);
    await expect(page.locator('.gallery-contribute')).toHaveCount(1);
    await expect(page.locator('.gallery-actions #submit-fanart-btn')).toBeAttached();
    await expect(page.locator('.gallery-actions #gallery-refresh')).toBeVisible();
    await expect(page.locator('#submit-fanart-btn')).toBeHidden();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/\/api\/gallery\/batches\/[0-7](?:\?version=[^&]+)?$/);
    await layout(page, page.viewportSize().width >= 1024 ? 3 : page.viewportSize().width >= 608 ? 2 : 1);
    expect(errors).toEqual([]);
});

test('height-only resize and repeated masonry measurements preserve the reading position', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openGallery(page);
    for (const embed of await page.locator('#gallery-grid .x-embed').all()) {
        await embed.scrollIntoViewIfNeeded();
        await expect(embed).toHaveAttribute('data-embed-state', 'ready');
    }
    await page.locator('#gallery-grid .gallery-item').nth(2).scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => Gallery.scheduleLayout());
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
    await page.setViewportSize({ width: 393, height: 780 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
    await layout(page, 1);
});

test('native iframe height growth preserves mobile scroll position without an extra anchor jump', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('https://platform.x.com/widgets.js', route => route.fulfill({
        contentType: 'application/javascript',
        body: `window.twttr = { widgets: { createTweet: async (id, target) => {
            const iframe = document.createElement('iframe');
            iframe.title = 'X fixture ' + id;
            iframe.style.cssText = 'display:block;width:100%;border:0;height:' + (Number(id.slice(-1)) % 2 ? 640 : 440) + 'px';
            iframe.srcdoc = '<!doctype html><html><body><p>A memory of Kanata</p></body></html>';
            target.append(iframe);
            return iframe;
        } } };`,
    }));
    await openGallery(page);
    for (const embed of await page.locator('#gallery-grid .x-embed').all()) {
        await embed.scrollIntoViewIfNeeded();
        await expect(embed).toHaveAttribute('data-embed-state', 'ready');
    }
    await expect(page.locator('#gallery-grid iframe')).toHaveCount(6);
    await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Grow embeds';
        button.style.cssText = 'position:fixed;left:11px;top:112px;width:84px;min-height:44px;z-index:2147483647';
        button.addEventListener('click', () => {
            document.querySelectorAll('#gallery-grid iframe').forEach(frame => {
                frame.style.height = `${parseFloat(frame.style.height) + 80}px`;
            });
        });
        document.body.append(button);
        const third = document.querySelectorAll('#gallery-grid .gallery-item')[2];
        window.scrollTo(0, window.scrollY + third.getBoundingClientRect().top - 105);
    });
    const snapshot = () => page.evaluate(() => ({
        scrollY: window.scrollY,
        cardTop: document.querySelectorAll('#gallery-grid .gallery-item')[2].getBoundingClientRect().top,
        gridHeight: document.querySelector('#gallery-grid').getBoundingClientRect().height,
    }));
    for (let iteration = 0; iteration < 3; iteration++) {
        const before = await snapshot();
        // A viewport-coordinate click avoids locator scrolling masking the original defect.
        await page.mouse.click(54, 134);
        await expect.poll(async () => (await snapshot()).gridHeight - before.gridHeight).toBe(480);
        const after = await snapshot();
        expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.cardTop - before.cardTop - 160)).toBeLessThanOrEqual(1);
    }
    await layout(page, 1);
});

test('old size preferences have no effect and language changes preserve widget identity', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('gallery-display-size', 'standard'));
    await openGallery(page);
    await page.evaluate(() => { window.savedCards = [...document.querySelectorAll('.gallery-item')]; window.savedCalls = window.__xWidgetCalls.length; });
    await page.evaluate(() => i18n.switchLanguage('en'));
    expect(await page.evaluate(() => [...document.querySelectorAll('.gallery-item')].every((item, i) => item === window.savedCards[i]))).toBe(true);
    expect(await page.evaluate(() => window.__xWidgetCalls.length)).toBe(await page.evaluate(() => window.savedCalls));
    await page.reload();
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
    expect(await page.evaluate(() => typeof Gallery.setDisplaySize)).toBe('undefined');
});

test('the compact layout retains its width and column boundaries', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.endsWith('mobile'));
    await openGallery(page);
    for (const width of [1440, 1024, 1023, 768, 767, 608, 607, 393]) {
        await page.setViewportSize({ width, height: 900 });
        await layout(page, width >= 1024 ? 3 : width >= 608 ? 2 : 1);
    }
});

test('five failed refresh attempts count toward a rolling quota and keep the six cards', async ({ page }) => {
    await openGallery(page);
    const validUntil = await page.evaluate(() => {
        PublicFeedWatcher.visible.clear();
        PublicFeedWatcher.destroy();
        return Gallery.validUntil;
    });
    let requests = 0;
    await page.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ status: 503, json: { mode: 'normal', reason: 'fixture', items: [] } }); });
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) await Gallery.refresh(); });
    expect(requests).toBe(5);
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
    expect(await page.evaluate(() => Gallery.validUntil)).toBe(validUntil);
    await page.reload();
    expect(requests).toBe(6); // Initial load is separate; manual attempts survive reload.
    await page.evaluate(() => Gallery.refresh());
    expect(requests).toBe(6);
});

test('quota is shared across tabs and permits requests after the rolling window expires', async ({ page, context }) => {
    await openGallery(page);
    const other = await context.newPage();
    await openGallery(other);
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await Gallery.refresh(); });
    await other.evaluate(async () => { for (let i = 0; i < 3; i++) await Gallery.refresh(); });
    expect(await other.evaluate(() => JSON.parse(localStorage.getItem(Gallery.REFRESH_STORAGE_KEY)).length)).toBe(5);
    await page.evaluate(() => localStorage.setItem(Gallery.REFRESH_STORAGE_KEY, JSON.stringify([Date.now() - 61000])));
    await page.evaluate(() => { Gallery.refreshAttempts = []; });
    let requests = 0;
    await page.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ json: batch(itemsAt(5)) }); });
    await page.evaluate(() => Gallery.refresh());
    expect(requests).toBe(1);
});

test('new versions discard previous candidates and cache shuffles do not renew validity', async ({ page }) => {
    await openGallery(page);
    const deadline = Date.now() + 240000;
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch(itemsAt(11), { version: '2', validUntil: deadline }) }));
    await page.evaluate(() => Gallery.refresh());
    expect(await page.evaluate(() => [...Gallery.pool.keys()])).toEqual(itemsAt(11).map(item => item.id));
    await page.evaluate(() => Gallery.shuffleCached());
    expect(await page.evaluate(() => Gallery.validUntil)).toBe(deadline);
    await page.evaluate(() => { Gallery.validUntil = Date.now() - 1; Gallery.shuffleCached(); });
    expect(await page.evaluate(() => Gallery.pool.size)).toBe(0);
    await expect(page.locator('#gallery-status')).toContainText('目前無法讀取新投稿');
});

test('same IDs and overlapping batches retain existing embeds without moving their slots', async ({ page }) => {
    await openGallery(page);
    await page.evaluate(() => { window.savedArticle = document.querySelector('.gallery-item'); window.savedEmbed = window.savedArticle.querySelector('.x-embed'); });
    await page.evaluate(() => Gallery.refresh());
    expect(await page.evaluate(() => document.querySelector('.gallery-item') === window.savedArticle)).toBe(true);
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch([itemsAt(1, 1)[0], ...itemsAt(7, 5)]) }));
    await page.evaluate(() => Gallery.refresh());
    expect(await page.evaluate(() => document.querySelector('.gallery-item') === window.savedArticle && document.querySelector('.gallery-item .x-embed') === window.savedEmbed)).toBe(true);
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
});

test('local samples deduplicate an X post stored under different document IDs across batches', async ({ page }) => {
    await openGallery(page);
    await page.evaluate(() => {
        window.savedAliasCard = document.querySelector('.gallery-item');
        window.savedAliasEmbed = window.savedAliasCard.querySelector('.x-embed');
    });
    const duplicate = { ...itemsAt(1, 1)[0], id: 'legacy-duplicate' };
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch([duplicate, ...itemsAt(7, 5)]) }));
    await page.evaluate(() => Gallery.refresh());
    expect(await page.evaluate(() => document.querySelector('.gallery-item') === window.savedAliasCard &&
        document.querySelector('.gallery-item .x-embed') === window.savedAliasEmbed)).toBe(true);
    await expect(page.locator('#gallery-grid .gallery-item').first()).toHaveAttribute('data-id', 'legacy-duplicate');
    await expect(page.locator('#gallery-grid .report-btn').first()).toHaveAttribute('data-content-id', 'legacy-duplicate');
    expect(await page.evaluate(() => Gallery.pool.size)).toBe(11);
    await page.evaluate(() => {
        for (let i = 0; i < 20; i++) {
            Gallery.shuffleCached();
            if (new Set(Gallery.data.map(item => item.postId)).size !== Gallery.data.length) {
                throw new Error('Duplicate X post in local sample');
            }
        }
    });
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
});

test('manual refresh scrolls to the first card but a waiting response cannot pull users back', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openGallery(page);
    await page.locator('#gallery-grid .gallery-item').nth(2).scrollIntoViewIfNeeded();
    await page.locator('#gallery-refresh').click();
    await expect.poll(() => page.locator('#gallery-grid').evaluate(grid => Math.abs(grid.getBoundingClientRect().top - document.querySelector('.site-nav').getBoundingClientRect().height - 12))).toBeLessThan(2);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/gallery/batches/*', async route => { await gate; await route.fulfill({ json: batch(itemsAt(5)) }); });
    await page.locator('#gallery-refresh').click();
    await page.evaluate(() => { document.querySelector('#fanart-modal').classList.add('active'); });
    const before = await page.evaluate(() => window.scrollY);
    release();
    await expect.poll(() => page.evaluate(() => Gallery.isLoading)).toBe(false);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('accepted posts prepend immediately, evict only the tail and keep the other embeds', async ({ page }) => {
    await openGallery(page);
    const accepted = itemsAt(99, 1)[0];
    let requests = 0;
    page.on('request', request => { if (request.url().includes('/api/gallery/batches/')) requests++; });
    await page.evaluate(item => {
        window.savedCards = [...document.querySelectorAll('.gallery-item')];
        window.savedEmbeds = window.savedCards.map(card => card.querySelector('.x-embed'));
        if (!Gallery.onSubmission(item)) throw new Error('Accepted item rejected');
    }, accepted);
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
    await expect(page.locator('#gallery-grid .gallery-item').first()).toHaveAttribute('data-post-id', accepted.postId);
    await expect(page.locator('#gallery-grid .report-btn').first()).toHaveAttribute('data-content-id', accepted.id);
    expect(await page.evaluate(() => Gallery.data[0].postId)).toBe(accepted.postId);
    expect(await page.evaluate(() => window.savedCards.slice(0, 5).every((card, index) =>
        card.isConnected && card.querySelector('.x-embed') === window.savedEmbeds[index]) && !window.savedCards[5].isConnected)).toBe(true);
    expect(requests).toBe(0);
    await page.evaluate(() => Gallery.refresh({ manual: true }));
    expect(await page.evaluate(() => Gallery.ownItems.size)).toBe(0);
    await expect(page.locator(`#gallery-grid [data-post-id="${accepted.postId}"]`)).toHaveCount(0);
});

test('an accepted post already in a later slot becomes visually first without moving its embed', async ({ page }) => {
    await openGallery(page);
    const accepted = { ...itemsAt(4, 1)[0], id: 'accepted-alias' };
    await page.evaluate(item => {
        window.acceptedCard = document.querySelector(`[data-post-id="${item.postId}"]`);
        window.acceptedEmbed = window.acceptedCard.querySelector('.x-embed');
        Gallery.onSubmission(item);
    }, accepted);
    expect(await page.evaluate(() => Gallery.data[0].id)).toBe('accepted-alias');
    expect(await page.evaluate(() => window.acceptedCard.isConnected && window.acceptedCard.querySelector('.x-embed') === window.acceptedEmbed)).toBe(true);
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
    await expect.poll(() => page.evaluate(() => Math.abs(window.acceptedCard.getBoundingClientRect().top -
        document.querySelector('#gallery-grid').getBoundingClientRect().top))).toBeLessThan(2);
    await expect(page.locator('[data-post-id="' + accepted.postId + '"] .report-btn')).toHaveAttribute('data-content-id', accepted.id);
});

test('an accepted response cancels a pending old batch and leaves refresh usable', async ({ page }) => {
    await openGallery(page);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/gallery/batches/*', async route => {
        await gate;
        try { await route.fulfill({ json: batch(itemsAt(11)) }); } catch {}
    });
    const requested = page.waitForRequest('**/api/gallery/batches/*');
    await page.evaluate(() => { window.pendingRefresh = Gallery.refresh(); });
    await requested;
    const accepted = itemsAt(99, 1)[0];
    await page.evaluate(item => Gallery.onSubmission(item), accepted);
    release();
    await page.evaluate(() => window.pendingRefresh);
    expect(await page.evaluate(() => Gallery.data[0].postId)).toBe(accepted.postId);
    expect(await page.evaluate(() => Gallery.isLoading)).toBe(false);
    await expect(page.locator('#gallery-refresh')).toHaveAttribute('aria-disabled', 'false');
    await page.unroute('**/api/gallery/batches/*');
    await page.evaluate(() => Gallery.refresh({ manual: true }));
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
});

test('a missing accepted item preserves the successful submission surface', async ({ page }) => {
    await openGallery(page);
    expect(await page.evaluate(() => {
        const before = [...document.querySelectorAll('.gallery-item')];
        return Gallery.onSubmission(undefined) === false && before.every((card, index) => card === document.querySelectorAll('.gallery-item')[index]);
    })).toBe(true);
});

test('changed versions show a refresh hint and clear candidates without replacing what is being read', async ({ page }) => {
    await openGallery(page);
    await expect.poll(() => page.evaluate(() => PublicFeedWatcher.getState('gallery')?.version)).toBe('1');
    await page.evaluate(item => Gallery.onSubmission(item), itemsAt(99, 1)[0]);
    const updated = batch(itemsAt(11), { version: '2' });
    const { version, generatedAt, confirmedAt, validUntil } = updated;
    await page.route('**/api/feed/version', route => route.fulfill({ json: {
        messages: { version, generatedAt, confirmedAt, validUntil }, gallery: { version, generatedAt, confirmedAt, validUntil }
    } }));
    await page.evaluate(() => {
        window.savedCards = [...document.querySelectorAll('.gallery-item')];
        window.savedPosition = window.scrollY;
        PublicFeedWatcher.nextCheckAt = 0;
    });
    let requests = 0;
    await page.route('**/api/gallery/batches/*', route => {
        requests++;
        expect(new URL(route.request().url()).searchParams.get('version')).toBe('2');
        return route.fulfill({ json: updated });
    });
    await page.evaluate(() => PublicFeedWatcher.check());
    await expect(page.locator('#gallery-refresh-hint')).toBeVisible();
    expect(requests).toBe(0);
    expect(await page.evaluate(() => Gallery.pool.size)).toBe(0);
    expect(await page.evaluate(() => Gallery.ownItems.size)).toBe(0);
    expect(await page.evaluate(() => [...document.querySelectorAll('.gallery-item')].every((card, index) => card === window.savedCards[index]) && window.scrollY === window.savedPosition)).toBe(true);
    await page.locator('#gallery-refresh').click();
    expect(requests).toBe(1);
    await expect(page.locator('#gallery-refresh-hint')).toBeHidden();
});

test('version conflicts preserve cards and offer a refresh hint without an extra request', async ({ page }) => {
    await openGallery(page);
    let requests = 0;
    await page.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ status: 409, json: { reason: 'version_changed', items: [] } }); });
    await page.evaluate(() => { window.savedCards = [...document.querySelectorAll('.gallery-item')]; });
    await page.evaluate(() => Gallery.refresh({ manual: true }));
    expect(requests).toBe(1);
    expect(await page.evaluate(() => [...document.querySelectorAll('.gallery-item')].every((card, index) => card === window.savedCards[index]))).toBe(true);
    await expect(page.locator('#gallery-refresh-hint')).toBeVisible();
});

test('local rate-limit fallback keeps the latest pair and changes the other cached candidates', async ({ page }) => {
    await openGallery(page);
    const latest = itemsAt(1, 2);
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch([...latest, ...itemsAt(11, 4)]) }));
    await page.evaluate(() => Gallery.refresh());
    await page.evaluate(() => localStorage.setItem(Gallery.REFRESH_STORAGE_KEY, JSON.stringify(Array(5).fill(Date.now()))));
    await page.evaluate(() => Gallery.refresh({ manual: true }));
    const shown = await page.evaluate(() => Gallery.data.map(item => item.postId));
    expect(shown.slice(0, 2)).toEqual(latest.map(item => item.postId));
    expect(shown).toContain(idAt(3));
    expect(new Set(shown).size).toBe(6);
    await expect(page.locator('#gallery-status')).toContainText('暫時使用已取得的投稿');
});

test('server-confirmed leases can renew unchanged content and local shuffles cannot', async ({ page }) => {
    await openGallery(page);
    const generation = Date.now() - 600000;
    const confirmedAt = Date.now();
    const deadline = confirmedAt + 240000;
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch(itemsAt(1), {
        generatedAt: generation, confirmedAt, validUntil: deadline
    }) }));
    await page.evaluate(() => { PublicFeedWatcher.visible.clear(); PublicFeedWatcher.destroy(); Gallery.confirmedAt = 0; });
    await page.evaluate(() => Gallery.refresh());
    expect(await page.evaluate(() => Gallery.validUntil)).toBe(deadline);
    await page.evaluate(() => Gallery.shuffleCached());
    expect(await page.evaluate(() => Gallery.validUntil)).toBe(deadline);
    const renewedAt = Date.now();
    const renewedDeadline = renewedAt + 270000;
    await page.evaluate(state => Gallery.onFeedState(state), { version: '1', generatedAt: generation, confirmedAt: renewedAt, validUntil: renewedDeadline });
    expect(await page.evaluate(() => Gallery.validUntil)).toBe(renewedDeadline);
});

test('the retained back-to-top tooltip localizes, closes on Escape and hides in a modal', async ({ page }) => {
    await openGallery(page);
    const top = page.locator('#back-to-top');
    await top.focus();
    await expect(page.locator('#back-to-top-tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#back-to-top-tooltip')).toBeHidden();
    await page.evaluate(() => i18n.switchLanguage('en'));
    await expect(top).toHaveAttribute('aria-label', 'Back to top');
    await expect(page.locator('#gallery-refresh')).toHaveAttribute('aria-label', 'Refresh posts');
    await page.evaluate(() => document.querySelector('#fanart-modal').classList.add('active'));
    await expect(top).toBeHidden();
    await page.evaluate(() => { document.querySelector('#fanart-modal').classList.remove('active'); window.scrollTo(0, 0); });
    await expect(top).toBeHidden();
});

test('empty and invalid public responses display a retry without any database fallback', async ({ page }) => {
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch([]) }));
    await page.goto('/#gallery-section');
    await expect(page.locator('#gallery-grid .no-content')).toContainText('目前還沒有投稿');
    await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch(itemsAt(1), { validUntil: Date.now() - 1 }) }));
    await page.evaluate(() => Gallery.refresh());
    await expect(page.locator('#gallery-grid .x-embed-retry')).toBeVisible();
    expect(await page.evaluate(() => typeof Gallery.query)).toBe('undefined');
});

test('unavailable quota storage still permits fixed-size rendering and bounded refresh', async ({ page }) => {
    await page.addInitScript(() => {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) { if (key.startsWith('gallery-')) throw new DOMException('Blocked', 'SecurityError'); return get.call(this, key); };
        Storage.prototype.setItem = function(key, value) { if (key.startsWith('gallery-')) throw new DOMException('Blocked', 'SecurityError'); return set.call(this, key, value); };
    });
    await openGallery(page);
    await expect(page.locator('#gallery-size-toggle')).toHaveCount(0);
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) await Gallery.refresh(); });
    expect(await page.evaluate(() => Gallery.refreshAttempts.length)).toBe(5);
});

test('blocked widget scripts preserve safe original links and allow a shared-script retry', async ({ page }) => {
    await page.route('https://platform.x.com/widgets.js', route => route.abort());
    await page.goto('/#gallery-section');
    const embed = page.locator('#gallery-grid .x-embed').first();
    await expect(embed).toHaveAttribute('data-embed-state', 'error');
    await expect(embed.getByRole('link')).toHaveAttribute('href', `https://x.com/artist/status/${idAt(1)}`);
    await expect(embed.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    await page.unroute('https://platform.x.com/widgets.js');
    await embed.getByRole('button', { name: '重新載入' }).click();
    await expect(embed).toHaveAttribute('data-embed-state', 'ready');
    await expect(page.locator('#x-widgets-script')).toHaveCount(1);
});

test('submission tutorial, canonical preview and keyboard focus still use the shared widget', async ({ page }) => {
    await openGallery(page);
    await page.evaluate(() => {
        Auth.currentUser = { uid: 'fixture-preview', displayName: 'Gallery contributor' };
        Auth.updateSubmitButtons();
        Submit.setupModals();
        Submit.setupEventListeners();
        document.querySelector('#submit-fanart-btn').focus();
        Submit.openModal(Submit.fanartModal);
    });
    const modal = page.locator('#fanart-modal');
    await expect(page.locator('#fanart-post-url')).toBeFocused();
    await expect(modal.locator('.fanart-tutorial li')).toHaveCount(3);
    await expect(modal.locator('input[type="file"]')).toHaveCount(0);
    await page.locator('#fanart-post-url').fill(`https://twitter.com/artist/status/${idAt(2)}/photo/1?s=20`);
    await page.locator('#fanart-preview-btn').click();
    await expect(page.locator('#fanart-preview')).toHaveAttribute('data-embed-state', 'ready');
    await expect(page.locator('#x-widgets-script')).toHaveCount(1);
    expect(await page.evaluate(() => XPost.parseUrl(document.querySelector('#fanart-post-url').value).postUrl)).toBe(`https://x.com/artist/status/${idAt(2)}`);
    for (const [lang, title] of [['en', 'How to share an X post'], ['ja', 'Xの投稿を共有するには'], ['zh-TW', '如何分享 X 貼文']]) {
        await page.evaluate(lang => i18n.switchLanguage(lang), lang);
        await expect(modal.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await page.locator('#fanart-post-url').focus();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#submit-fanart-btn')).toBeFocused();
});

test('simultaneous tabs serialize their last refresh slot without Web Locks', async ({ page, context }) => {
    await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await openGallery(page);
    const other = await context.newPage();
    await openGallery(other);
    await page.evaluate(() => localStorage.setItem(Gallery.REFRESH_STORAGE_KEY, JSON.stringify(Array(4).fill(Date.now()))));
    let requests = 0;
    await context.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ json: batch(itemsAt(5)) }); });
    await Promise.all([page.evaluate(() => Gallery.refresh()), other.evaluate(() => Gallery.refresh())]);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(Gallery.REFRESH_STORAGE_KEY)).length)).toBe(5);
});

test('legacy protection events do not gate gallery refresh', async ({ page }) => {
    await openGallery(page);
    let requests = 0;
    await page.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ json: batch(itemsAt(5)) }); });
    await page.evaluate(async () => {
        for (const mode of ['warning', 'blocked', 'normal']) {
            window.dispatchEvent(new CustomEvent('publicDeliveryMode', { detail: { mode } }));
        }
        await Gallery.refresh({ manual: true });
    });
    expect(requests).toBe(1);
    expect(await page.evaluate(() => typeof Gallery.mode)).toBe('undefined');
    await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(6);
});

test('touch actions briefly display the remaining tooltip and modals hide back-to-top', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'webkit-mobile', 'The WebKit mobile project provides real touch events.');
    await openGallery(page);
    // Keep the button visible while exercising its touch tooltip independently of scrolling.
    await page.evaluate(() => { window.scrollTo = () => {}; });
    await page.locator('#back-to-top').tap();
    await expect(page.locator('#back-to-top-tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#back-to-top-tooltip')).toBeHidden();
    await page.evaluate(() => document.querySelector('#fanart-modal').classList.add('active'));
    await expect(page.locator('#back-to-top')).toBeHidden();
});

for (const withoutLocks of [false, true]) {
    test(`blocked localStorage shares the last refresh slot across simultaneous tabs${withoutLocks ? ' without Web Locks' : ''}`, async ({ page, context }) => {
        await context.addInitScript(withoutLocks => {
            if (withoutLocks) Object.defineProperty(navigator, 'locks', { value: undefined });
            const get = Storage.prototype.getItem;
            const set = Storage.prototype.setItem;
            Storage.prototype.getItem = function(key) {
                if (key === 'gallery-refresh-attempts') throw new DOMException('Blocked', 'SecurityError');
                return get.call(this, key);
            };
            Storage.prototype.setItem = function(key, value) {
                if (key === 'gallery-refresh-attempts') throw new DOMException('Blocked', 'SecurityError');
                return set.call(this, key, value);
            };
        }, withoutLocks);
        await openGallery(page);
        const other = await context.newPage();
        await openGallery(other);
        let requests = 0;
        await context.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ json: batch(itemsAt(5)) }); });
        await page.evaluate(async () => { for (let i = 0; i < 4; i++) await Gallery.refresh(); });
        expect(requests).toBe(4);
        await Promise.all([page.evaluate(() => Gallery.refresh()), other.evaluate(() => Gallery.refresh())]);
        expect(requests).toBe(5);
        await other.reload();
        expect(requests).toBe(6); // Initial load remains separate; persisted manual history survives reload.
        await other.evaluate(() => Gallery.refresh());
        expect(requests).toBe(6);
    });
}

test('a cache refresh with no new candidate preserves content and reading position', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openGallery(page);
    await page.locator('#gallery-refresh').scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => {
        window.savedArticles = [...document.querySelectorAll('.gallery-item')];
        localStorage.setItem(Gallery.REFRESH_STORAGE_KEY, JSON.stringify(Array(5).fill(Date.now())));
        return window.scrollY;
    });
    await page.locator('#gallery-refresh').click();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await page.evaluate(() => [...document.querySelectorAll('.gallery-item')].every((article, i) => article === window.savedArticles[i]))).toBe(true);
    await expect(page.locator('#gallery-status')).toContainText('目前可顯示的投稿是這一組');
});

for (const count of [0, 1, 2, 6, 7]) {
    test(`a catalog of ${count} posts renders at most six and retains unique cards`, async ({ page }) => {
        const catalog = itemsAt(1, count);
        let request = 0;
        await page.route('**/api/gallery/batches/*', route => route.fulfill({ json: batch(request++ ? catalog.slice(-6) : catalog.slice(0, 6)) }));
        await page.goto('/#gallery-section');
        await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(Math.min(count, 6));
        if (!count) await expect(page.locator('#gallery-grid .no-content')).toContainText('目前還沒有投稿');
        await page.evaluate(() => Gallery.refresh());
        await expect(page.locator('#gallery-grid .gallery-item')).toHaveCount(Math.min(count, 6));
        const ids = await page.locator('#gallery-grid .gallery-item').evaluateAll(cards => cards.map(card => card.dataset.id));
        expect(new Set(ids).size).toBe(ids.length);
        if (count === 7) expect(ids).toContain(catalog[6].id);
    });
}

test('readable but unwritable localStorage cannot reset the shared database quota', async ({ page, context }) => {
    await context.addInitScript(() => {
        const set = Storage.prototype.setItem;
        window.setQuotaFixture = values => set.call(localStorage, 'gallery-refresh-attempts', JSON.stringify(values));
        Storage.prototype.setItem = function(key, value) {
            if (key === 'gallery-refresh-attempts') throw new DOMException('Full', 'QuotaExceededError');
            return set.call(this, key, value);
        };
    });
    await openGallery(page);
    const other = await context.newPage();
    await openGallery(other);
    await page.evaluate(() => window.setQuotaFixture(Array(4).fill(Date.now())));
    let requests = 0;
    await context.route('**/api/gallery/batches/*', route => { requests++; return route.fulfill({ json: batch(itemsAt(5)) }); });
    await Promise.all([page.evaluate(() => Gallery.refresh()), other.evaluate(() => Gallery.refresh())]);
    expect(requests).toBe(1);
    await other.evaluate(() => Gallery.refresh());
    expect(requests).toBe(1);
});
