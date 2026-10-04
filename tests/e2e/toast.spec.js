const { test, expect } = require('@playwright/test');

async function pauseClock(page) {
    await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));
}

const closeProgress = toast => toast.locator('.toast-close').evaluate(button =>
    parseFloat(getComputedStyle(button).getPropertyValue('--toast-close-progress')));

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('preferred-language', 'zh-TW'));
    await page.route('https://platform.x.com/widgets.js', route => route.fulfill({
        contentType: 'application/javascript',
        body: 'window.twttr={widgets:{createTweet:async()=>undefined}};'
    }));
    await page.goto('/');
    await expect(page).toHaveTitle(/^天音彼方 畢業紀念(?: - Day \d+)?$/);
    await expect(page.locator('.site-nav')).toBeVisible();
});

test('public notification types share the light gallery style with distinct accessible controls', async ({ page }) => {
    await page.evaluate(() => {
        for (const type of ['success', 'info', 'warning', 'error']) Toast[type](`${type} notification`, 0);
    });
    const toasts = page.locator('.toast');
    await expect(toasts).toHaveCount(4);
    const icons = [];
    const accents = {};
    for (const type of ['success', 'info', 'warning', 'error']) {
        const toast = page.locator(`.toast.${type}`);
        await expect(toast).toHaveClass(/\bshow\b/);
        await expect(toast).toContainText(`${type} notification`);
        const styles = await toast.evaluate(element => {
            const style = getComputedStyle(element);
            const close = element.querySelector('.toast-close').getBoundingClientRect();
            return { radius: style.borderRadius, image: style.backgroundImage, color: style.color,
                borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                borderColors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
                closeWidth: close.width, closeHeight: close.height,
                iconColor: getComputedStyle(element.querySelector('.toast-icon')).color,
                icon: element.querySelector('.toast-icon svg').innerHTML };
        });
        expect(styles.radius).toBe('16px');
        expect(styles.image).toContain('linear-gradient');
        expect(styles.color.match(/\d+/g).slice(0, 3).map(Number).every(channel => channel < 110)).toBe(true);
        expect(styles.closeWidth).toBeGreaterThanOrEqual(44);
        expect(styles.closeHeight).toBeGreaterThanOrEqual(44);
        expect(styles.borderWidths).toEqual(['1px', '1px', '1px', '1px']);
        expect(new Set(styles.borderColors).size).toBe(1);
        await expect(toast.locator('.toast-progress')).toHaveCount(0);
        await expect(toast.locator('.toast-close [aria-hidden="true"]')).toHaveCount(2);
        await expect(toast.getByRole('button', { name: '關閉', exact: true })).toBeVisible();
        icons.push(styles.icon);
        accents[type] = styles.iconColor;
    }
    expect(new Set(icons).size).toBe(4);
    expect(accents.success).toBe(accents.info);
    expect(accents.warning).not.toBe(accents.info);
    expect(accents.error).not.toBe(accents.info);
    expect(accents.error).not.toBe(accents.warning);
});

test('toast text wraps safely on phones and reduced motion avoids sliding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const message = 'X 貼文已分享！'.repeat(5) + ' https://example.test/' + 'long-text-'.repeat(15) + '<img src=x onerror=alert(1)>';
    await page.evaluate(message => Toast.success(message, 0), message);
    const toast = page.locator('.toast.success');
    await expect(toast).toHaveClass(/\bshow\b/);
    await expect(toast.locator('.toast-content')).toHaveText(message);
    await expect(toast.locator('img')).toHaveCount(0);
    const bounds = await toast.boundingBox();
    expect(bounds.x).toBeCloseTo(16, 0);
    expect(390 - bounds.x - bounds.width).toBeCloseTo(16, 0);
    expect(await toast.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const transform = await toast.evaluate(element => getComputedStyle(element).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
    await expect(toast.getByRole('button', { name: '關閉' })).toBeVisible();
});

test('default timeout and persistent notifications keep countdowns scoped to their close buttons', async ({ page }) => {
    await pauseClock(page);
    await page.evaluate(() => {
        Toast.success('Timed notification');
        Toast.info('Persistent notification', 0);
    });
    await page.clock.runFor(20);
    const timed = page.locator('.toast.success');
    const persistent = page.locator('.toast.info');
    await expect(timed).toHaveClass(/\bshow\b/);
    await expect(page.locator('.toast-progress')).toHaveCount(0);
    expect(await closeProgress(persistent)).toBe(0);
    await page.clock.runFor(2880);
    await expect(timed).toHaveClass(/\bshow\b/);
    await page.clock.runFor(150);
    await expect(timed).toHaveClass(/\bhide\b/);
    expect(await closeProgress(timed)).toBe(100);
    await page.clock.runFor(400);
    await expect(timed).toHaveCount(0);
    await page.clock.fastForward(10000);
    await expect(persistent).toHaveClass(/\bshow\b/);
    expect(await closeProgress(persistent)).toBe(0);
    const close = persistent.getByRole('button', { name: '關閉' });
    await close.focus();
    await expect(close).toBeFocused();
    const focusStyle = await close.evaluate(element => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    });
    expect(focusStyle).toBe(true);
    await page.keyboard.press('Enter');
    await expect(persistent).toHaveClass(/\bhide\b/);
    await page.clock.fastForward(400);
    await expect(persistent).toHaveCount(0);
});

test('bottom-up fill clips the inverse background and cross together at zero, half and full time', async ({ page }) => {
    await pauseClock(page);
    await page.evaluate(() => Toast.error('A close-button countdown', 1000));
    const toast = page.locator('.toast.error');
    expect(await closeProgress(toast)).toBe(0);
    const buttonStyle = await toast.locator('.toast-close').evaluate(button => {
        const fill = button.querySelector('.toast-close-fill');
        const glyph = button.querySelector('.toast-close-glyph');
        const base = getComputedStyle(button);
        const inverse = getComputedStyle(fill);
        const outer = button.getBoundingClientRect();
        const inner = fill.getBoundingClientRect();
        return { baseBackground: base.backgroundColor, baseColor: getComputedStyle(glyph).color,
            inverseBackground: inverse.backgroundColor, inverseColor: inverse.color,
            radius: base.borderRadius, overflow: base.overflow, clip: inverse.clipPath,
            scoped: fill.offsetParent === button,
            sameBounds: ['left', 'right', 'top', 'bottom'].every(edge => Math.abs(outer[edge] - inner[edge]) < 1) };
    });
    expect(buttonStyle).toEqual({ baseBackground: 'rgb(237, 246, 255)', baseColor: 'rgb(26, 111, 204)',
        inverseBackground: 'rgb(26, 111, 204)', inverseColor: 'rgb(237, 246, 255)',
        radius: '12px', overflow: 'hidden', clip: 'inset(100% 0px 0px)', scoped: true, sameBounds: true });
    await page.clock.runFor(500);
    expect(await closeProgress(toast)).toBeGreaterThanOrEqual(48);
    expect(await closeProgress(toast)).toBeLessThanOrEqual(50);
    const halfClip = await toast.locator('.toast-close-fill').evaluate(fill => getComputedStyle(fill).clipPath);
    const topInset = parseFloat(halfClip.match(/^inset\(([\d.]+)%/)[1]);
    expect(topInset).toBeGreaterThanOrEqual(50);
    expect(topInset).toBeLessThanOrEqual(52);
    await expect(toast).toHaveClass(/\bshow\b/);
    await page.clock.runFor(500);
    expect(await closeProgress(toast)).toBe(100);
    await expect(toast.locator('.toast-close-fill')).toHaveCSS('clip-path', 'inset(0% 0px 0px)');
    await page.clock.runFor(50);
    await expect(toast).toHaveClass(/\bhide\b/);
});

test('manual dismissal cancels the countdown instead of completing its button fill', async ({ page }) => {
    await pauseClock(page);
    await page.evaluate(() => { window.__dismissedToast = Toast.warning('Dismiss early', 1000); });
    const toast = page.locator('.toast.warning');
    await page.clock.runFor(400);
    const before = await closeProgress(toast);
    await toast.getByRole('button', { name: '關閉' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast).toHaveClass(/\bhide\b/);
    expect(await closeProgress(toast)).toBe(before);
    await page.clock.runFor(2000);
    await expect(toast).toHaveCount(0);
    expect(await page.evaluate(() => parseFloat(window.__dismissedToast.querySelector('.toast-close')
        .style.getPropertyValue('--toast-close-progress')))).toBe(before);
});

test('foreground return catches up to the original monotonic deadline without restarting it', async ({ page }) => {
    await pauseClock(page);
    await page.evaluate(() => {
        const now = performance.now.bind(performance);
        window.__clockOffset = 0;
        window.__documentHidden = false;
        Object.defineProperty(performance, 'now', { configurable: true, value: () => now() + window.__clockOffset });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__documentHidden });
        Toast.info('Return from the background', 3000);
    });
    const toast = page.locator('.toast.info');
    await page.clock.runFor(500);
    await page.evaluate(() => {
        window.__documentHidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        window.__clockOffset += 2000;
        window.__documentHidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await closeProgress(toast)).toBeCloseTo(2500 / 3000 * 100, 0);
    await expect(toast).toHaveClass(/\bshow\b/);
    await page.evaluate(() => {
        window.__clockOffset += 1000;
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await closeProgress(toast)).toBe(100);
    await page.clock.runFor(50);
    await expect(toast).toHaveClass(/\bhide\b/);
    await page.clock.runFor(400);
    await expect(toast).toHaveCount(0);
});

test('reduced motion keeps a static close button and the original automatic timeout', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await pauseClock(page);
    await page.evaluate(() => Toast.success('A static countdown', 1000));
    const toast = page.locator('.toast.success');
    await page.clock.runFor(500);
    await expect(toast).toHaveClass(/\bshow\b/);
    expect(await closeProgress(toast)).toBe(0);
    await expect(toast.locator('.toast-close-fill')).toHaveCSS('visibility', 'hidden');
    await page.clock.runFor(500);
    await expect(toast).toHaveClass(/\bhide\b/);
    expect(await closeProgress(toast)).toBe(0);
    await page.clock.runFor(400);
    await expect(toast).toHaveCount(0);
});

test('close button names follow the active public language', async ({ page }) => {
    await page.evaluate(() => Toast.warning('A translated close control', 0));
    const toast = page.locator('.toast.warning');
    for (const [lang, closeLabel] of [['en', 'Close'], ['ja', '閉じる'], ['zh-TW', '關閉']]) {
        await page.evaluate(lang => window.i18n.switchLanguage(lang), lang);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        const close = toast.getByRole('button', { name: closeLabel, exact: true });
        await expect(close).toBeVisible();
    }
    await toast.getByRole('button', { name: '關閉', exact: true }).click();
    await expect(toast).toHaveCount(0);
});

test('report success and failure use site notifications when Toast is a lexical global', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async dialog => {
        dialogs.push({ type: dialog.type(), message: dialog.message() });
        await dialog.dismiss();
    });
    await page.waitForFunction(() => window.FirebaseApp?.getAuth() && window.Report);
    expect(await page.evaluate(() => typeof Toast === 'object' && window.Toast === undefined)).toBe(true);
    await page.evaluate(() => {
        window.__reportRequests = [];
        window.__reportFailure = false;
        // Isolate the notification flow: no authenticated callable or database write is made.
        window.FirebaseApp.getAuth = () => ({ currentUser: { uid: 'toast-report-fixture-user' } });
        window.FirebaseApp.getFunctions = () => ({ httpsCallable(name) {
            return async payload => {
                window.__reportRequests.push({ name, payload });
                if (window.__reportFailure) throw { code: 'functions/already-exists', message: 'Fixture duplicate' };
                return { data: { autoHidden: false } };
            };
        } });
        document.querySelector('.gallery-contribute').insertAdjacentHTML('beforeend',
            Report.createReportButton('toast-report-fixture', 'fanart'));
    });
    const report = page.locator('.report-btn[data-content-id="toast-report-fixture"]');
    const modal = page.locator('#report-modal');
    await report.click();
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#report-reason')).toBeFocused();
    await page.locator('#report-reason').selectOption('spam');
    await page.locator('#report-details').fill('  Please review this post  ');
    await page.locator('#report-submit').click();
    await expect(page.locator('.toast.success .toast-content')).toHaveText('已收到您的檢舉。');
    await expect(modal).toHaveAttribute('aria-hidden', 'true');

    await page.evaluate(() => { window.__reportFailure = true; });
    await report.click();
    await page.locator('#report-reason').selectOption('copyright');
    await page.locator('#report-details').fill('Keep this explanation after the failure');
    await page.locator('#report-submit').click();
    await expect(page.locator('.toast.error .toast-content')).toHaveText('您已檢舉過此內容。');
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#report-details')).toHaveValue('Keep this explanation after the failure');
    await expect(page.locator('#report-submit')).toBeEnabled();
    expect(await page.evaluate(() => window.__reportRequests)).toEqual([
        { name: 'submitReport', payload: { contentId: 'toast-report-fixture', contentType: 'fanart', reason: 'spam', details: 'Please review this post' } },
        { name: 'submitReport', payload: { contentId: 'toast-report-fixture', contentType: 'fanart', reason: 'copyright', details: 'Keep this explanation after the failure' } }
    ]);
    expect(dialogs).toEqual([]);
});
