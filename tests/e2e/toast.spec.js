const { test, expect } = require('@playwright/test');

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
                closeWidth: close.width, closeHeight: close.height,
                iconColor: getComputedStyle(element.querySelector('.toast-icon')).color,
                icon: element.querySelector('.toast-icon svg').innerHTML };
        });
        expect(styles.radius).toBe('16px');
        expect(styles.image).toContain('linear-gradient');
        expect(styles.color.match(/\d+/g).slice(0, 3).map(Number).every(channel => channel < 110)).toBe(true);
        expect(styles.closeWidth).toBeGreaterThanOrEqual(44);
        expect(styles.closeHeight).toBeGreaterThanOrEqual(44);
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

test('default timeout, persistent notifications and progress remain scoped to each toast', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));
    await page.evaluate(() => {
        Toast.success('Timed notification');
        Toast.info('Persistent notification', 0);
    });
    await page.clock.runFor(20);
    const timed = page.locator('.toast.success');
    const persistent = page.locator('.toast.info');
    await expect(timed).toHaveClass(/\bshow\b/);
    const positioning = await timed.evaluate(element => {
        const progress = element.querySelector('.toast-progress');
        const outer = element.getBoundingClientRect();
        const inner = progress.getBoundingClientRect();
        return { scoped: progress.offsetParent === element,
            inside: inner.left >= outer.left - 1 && inner.right <= outer.right + 1 &&
                inner.top >= outer.top && inner.bottom <= outer.bottom + 1 };
    });
    expect(positioning).toEqual({ scoped: true, inside: true });
    await expect(persistent.locator('.toast-progress')).toHaveCount(0);
    await page.clock.fastForward(2880);
    await expect(timed).toHaveClass(/\bshow\b/);
    await page.clock.fastForward(100);
    await expect(timed).toHaveClass(/\bhide\b/);
    await page.clock.fastForward(400);
    await expect(timed).toHaveCount(0);
    await page.clock.fastForward(10000);
    await expect(persistent).toHaveClass(/\bshow\b/);
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
