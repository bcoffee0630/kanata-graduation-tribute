const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const envelope = (items = [], extra = {}) => {
    const generatedAt = Date.now();
    return { version: '1', generatedAt, confirmedAt: generatedAt, validUntil: generatedAt + 300000, items, ...extra };
};
const messages = count => Array.from({ length: count }, (_, i) => ({ id: `message-${i}`, author: `Author ${i}`, content: `Thank you Kanata ${i}`, authorLink: '', authorAvatar: '' }));

test.beforeEach(async ({ context, baseURL }) => {
    await context.addInitScript(() => localStorage.setItem('preferred-language', 'zh-TW'));
    await context.route(`${new URL(baseURL).origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/feed/version') { const state = envelope(); return route.fulfill({ json: { messages: state, gallery: state } }); }
        if (pathname === '/api/messages') return route.fulfill({ json: envelope(messages(100)) });
        if (pathname.startsWith('/api/gallery/')) return route.fulfill({ json: envelope() });
        const filename = path.resolve(__dirname, '../..', pathname === '/' ? 'index.html' : pathname.slice(1));
        if (!fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
        let body = fs.readFileSync(filename);
        if (pathname === '/') body = body.toString()
            .replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^\"]+"><\/script>/g, '')
            .replace(/<script src="assets\/js\/firebase-init\.js(?:\?[^\"]*)?"><\/script>/g, '');
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
        return route.fulfill({ body, contentType: types[path.extname(filename)] || 'application/octet-stream' });
    });
});

async function openMessages(page) {
    await page.goto('/#danmaku-section');
    await expect.poll(() => page.evaluate(() => Danmaku.isLoading)).toBe(false);
    await expect(page.locator('#danmaku-section')).toBeInViewport();
}

test('visitors read a bounded shared message snapshot without a Firestore subscription', async ({ page }) => {
    const sourceReads = [], errors = [], requests = [];
    page.on('request', request => {
        if (/firestore\.googleapis\.com/.test(request.url())) sourceReads.push(request.url());
        if (request.url().includes('/api/messages')) requests.push(request.url());
    });
    page.on('pageerror', error => errors.push(error.message));
    await openMessages(page);
    expect(await page.evaluate(() => Danmaku.data.messages.length)).toBe(100);
    await expect(page.locator('.danmaku-message').first()).toContainText('Thank you Kanata');
    expect(requests).toHaveLength(1);
    expect(sourceReads).toEqual([]);
    expect(errors).toEqual([]);
});

test('expired cache stops new playback while an opened message stays readable', async ({ page }) => {
    await openMessages(page);
    await page.evaluate(() => {
        const element = document.querySelector('.danmaku-message');
        Danmaku.selectMessage(element.dataset.messageId, element);
        window.readingMessage = element;
        Danmaku.validUntil = Date.now() - 1;
        Danmaku.spawnMessage();
    });
    // Expiry stops new spawning without removing opened content.
    expect(await page.evaluate(() => window.readingMessage.isConnected && window.readingMessage.classList.contains('selected'))).toBe(true);
    const before = await page.locator('.danmaku-message').count();
    await page.evaluate(() => { Danmaku.start(); Danmaku.spawnMessage(); });
    expect(await page.locator('.danmaku-message').count()).toBe(before);
});

test('new snapshots prioritize new messages while retaining active animations', async ({ page }) => {
    await openMessages(page);
    await page.evaluate(() => { window.openAnimation = document.querySelector('.danmaku-message'); });
    await page.route('**/api/messages*', route => route.fulfill({ json: envelope([
        ...messages(100).slice(0, 99), { id: 'new', author: 'Fan', content: 'A new memory' }
    ], { version: '2' }) }));
    await page.evaluate(() => Danmaku.loadSnapshot('2'));
    expect(await page.evaluate(() => window.openAnimation.isConnected)).toBe(true);
    await expect(page.locator('.danmaku-message[data-message-id="new"]')).toBeVisible();
});

test('own messages remain queued while paused and survive an older snapshot', async ({ page }) => {
    await openMessages(page);
    await page.locator('.danmaku-play-pause').click();
    await page.evaluate(() => {
        Danmaku.onSubmission({ id: 'own', author: 'Me', content: 'My memory' });
        Danmaku.applyMessages(Danmaku.data.messages.filter(item => item.id !== 'own'));
    });
    expect(await page.evaluate(() => Danmaku.isPaused)).toBe(true);
    expect(await page.evaluate(() => Danmaku.priorityQueue.some(item => item.id === 'own'))).toBe(true);
    await page.locator('.danmaku-play-pause').click();
    await expect(page.locator('.danmaku-message[data-message-id="own"]')).toBeVisible();
});

test('failed responses and repeated viewport events do not trigger rapid polling', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/messages', route => { requests++; return route.fulfill({ status: 503, json: { reason: 'snapshot_unavailable', items: [] } }); });
    await openMessages(page);
    for (let i = 0; i < 6; i++) await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); return Danmaku.loadSnapshot(); });
    expect(requests).toBe(1);
    await expect(page.locator('.danmaku-status')).toBeVisible();
    expect(await page.evaluate(() => Danmaku.animationInterval)).toBeNull();
});

test('oversized snapshots are rejected and new empty snapshots discard the playback queue', async ({ page }) => {
    await page.route('**/api/messages', route => route.fulfill({ json: envelope(messages(101)) }));
    await openMessages(page);
    expect(await page.evaluate(() => Danmaku.data)).toBeNull();
    await page.route('**/api/messages', route => route.fulfill({ json: envelope([], { version: '2' }) }));
    await page.evaluate(() => { Danmaku.nextRetryAt = 0; return Danmaku.loadSnapshot(); });
    expect(await page.evaluate(() => Danmaku.data.messages)).toEqual([]);
    expect(await page.evaluate(() => Danmaku.messageQueue)).toEqual([]);
});
