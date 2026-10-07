import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('assets/js/scroll-top.js', 'utf8');

// Geometry is supplied by each scenario; this VM does not imitate browser layout.
function runtime({ navBottom = 100, boundary = 800, scrollY = 600, reducedMotion = false } = {}) {
  const listeners = () => {
    const events = new Map();
    return {
      addEventListener(type, callback) {
        if (!events.has(type)) events.set(type, []);
        events.get(type).push(callback);
      },
      dispatch(type, detail = {}) {
        events.get(type)?.forEach(callback => callback({ type, ...detail }));
      },
    };
  };
  const document = { activeElement: null };
  const element = (id, rect) => {
    const classes = new Set();
    const attributes = new Map();
    const node = {
      ...listeners(), id, hidden: true, textContent: '', rect,
      classList: {
        add: (...values) => values.forEach(value => classes.add(value)),
        remove: (...values) => values.forEach(value => classes.delete(value)),
        contains: value => classes.has(value),
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name),
      getBoundingClientRect: vi.fn(() => ({ ...node.rect })),
      focus() { document.activeElement = node; node.dispatch('focus'); },
      blur: vi.fn(() => {
        if (document.activeElement === node) document.activeElement = null;
        node.dispatch('blur');
      }),
    };
    return node;
  };
  const nodes = Object.fromEntries([
    'back-to-top', 'back-to-top-tooltip', 'gallery-refresh', 'danmaku-play-pause',
    'danmaku-section', 'gallery-section', 'site-nav', 'modal',
  ].map(id => [id, element(id)]));
  const top = nodes['back-to-top'], gallery = nodes['gallery-refresh'], messages = nodes['danmaku-play-pause'];
  const messageSection = nodes['danmaku-section'], gallerySection = nodes['gallery-section'];
  const nav = nodes['site-nav'], modal = nodes.modal;
  nav.rect = { top: 0, bottom: navBottom };
  messageSection.rect = { top: 100, bottom: boundary };
  gallerySection.rect = { top: boundary, bottom: 2200 };
  Object.assign(document, {
    getElementById: id => nodes[id] || null,
    querySelector: selector => selector === '.site-nav' ? nav
      : selector === '.modal.active' && modal.classList.contains('active') ? modal : null,
    querySelectorAll: selector => selector === '.modal' ? [modal] : [],
  });
  const frames = new Map();
  let nextFrameId = 0;
  const requestAnimationFrame = vi.fn(callback => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target, options) { this.targets.add(target); this.options = options; }
  }
  class MutationObserver extends Observer {}
  class ResizeObserver extends Observer {}
  const window = {
    ...listeners(), innerHeight: 1000, scrollY, scrollTo: vi.fn(),
    matchMedia: vi.fn(() => ({ matches: reducedMotion })),
  };
  runInNewContext(source, {
    document, window, requestAnimationFrame, MutationObserver, ResizeObserver, setTimeout, clearTimeout,
  });
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback());
  };
  const notify = (kind, target) => {
    const Constructor = kind === 'resize' ? ResizeObserver : MutationObserver;
    observers.filter(observer => observer instanceof Constructor && observer.targets.has(target))
      .forEach(observer => observer.callback([{ target }]));
  };
  const moveBoundary = value => {
    messageSection.rect.bottom = value;
    gallerySection.rect.top = value;
  };
  const visible = () => [gallery, messages, top].filter(button => !button.hidden).map(button => button.id);
  return { window, document, nodes, top, gallery, messages, messageSection, gallerySection,
    nav, modal, frames, requestAnimationFrame, flush, notify, moveBoundary, visible };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('contextual floating controls', () => {
  it('uses the readable midpoint below the visible navbar rather than half the entire viewport', () => {
    const app = runtime({ boundary: 525 });
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
    app.flush();
    app.nav.rect.bottom = -50;
    app.notify('resize', app.nav);
    app.flush();
    // Without the navbar, the reading midpoint is 500 and is past the 24px exit buffer.
    expect(app.visible()).toEqual(['danmaku-play-pause', 'back-to-top']);
  });

  it('holds the existing action through the 24px boundary buffer in both scroll directions', () => {
    const app = runtime({ boundary: 600 });
    app.flush();
    for (const boundary of [560, 540, 527]) {
      app.moveBoundary(boundary);
      app.window.dispatch('scroll');
      app.flush();
      expect(app.visible()).toEqual(['danmaku-play-pause', 'back-to-top']);
    }
    app.moveBoundary(525);
    app.window.dispatch('scroll');
    app.flush();
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
    app.moveBoundary(570);
    app.window.dispatch('scroll');
    app.flush();
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
    app.moveBoundary(575);
    app.window.dispatch('scroll');
    app.flush();
    expect(app.visible()).toEqual(['danmaku-play-pause', 'back-to-top']);
  });

  it.each(['resize', 'transitionend'])('uses fresh section bounds after an asynchronous %s without scrolling', trigger => {
    const app = runtime();
    app.flush();
    app.moveBoundary(400);
    if (trigger === 'resize') app.notify('resize', app.messageSection);
    else app.gallerySection.dispatch('transitionend');
    app.flush();
    expect(app.window.scrollY).toBe(600);
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
  });

  it.each(['resize', 'mutation', 'transitionend'])('recalculates the readable midpoint after navbar %s', trigger => {
    const app = runtime({ navBottom: 0, boundary: 510 });
    app.flush();
    expect(app.messages.hidden).toBe(false);
    app.nav.rect.bottom = 100;
    if (trigger === 'transitionend') app.nav.dispatch(trigger);
    else app.notify(trigger, app.nav);
    app.flush();
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
  });

  it.each([0, 300, 301])('preserves the back-to-top threshold at scrollY %i', scrollY => {
    const app = runtime({ scrollY });
    expect(app.top.hidden).toBe(scrollY <= 300);
    expect(app.visible().length).toBeLessThanOrEqual(2);
  });

  it('hides upper actions in other sections and the footer, even when a section remains partly visible', () => {
    const app = runtime();
    app.flush();
    app.messageSection.rect = { top: 650, bottom: 850 };
    app.gallerySection.rect = { top: 850, bottom: 2000 };
    app.window.dispatch('scroll');
    app.flush();
    expect(app.visible()).toEqual(['back-to-top']);
    app.messageSection.rect = { top: -1200, bottom: -1000 };
    app.gallerySection.rect = { top: -1000, bottom: 450 };
    app.notify('resize', app.gallerySection);
    app.flush();
    expect(app.visible()).toEqual(['back-to-top']);
  });

  it('changes mutually exclusive visibility without overwriting a loading refresh label or state', () => {
    const app = runtime({ boundary: 400 });
    app.flush();
    app.gallery.setAttribute('aria-label', 'Loading posts…');
    app.gallery.setAttribute('aria-disabled', 'true');
    app.messages.setAttribute('aria-label', 'Resume messages');
    app.messages.setAttribute('aria-pressed', 'true');
    app.moveBoundary(800);
    app.window.dispatch('scroll');
    app.flush();
    expect(app.visible()).toEqual(['danmaku-play-pause', 'back-to-top']);
    expect(app.messages.getAttribute('aria-label')).toBe('Resume messages');
    expect(app.messages.getAttribute('aria-pressed')).toBe('true');
    expect(app.gallery.getAttribute('aria-label')).toBe('Loading posts…');
    expect(app.gallery.getAttribute('aria-disabled')).toBe('true');
    app.moveBoundary(400);
    app.window.dispatch('scroll');
    app.flush();
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
    expect(app.gallery.getAttribute('aria-disabled')).toBe('true');
  });

  it('hides all controls, releases button focus and clears touch timers while a modal is open', () => {
    const app = runtime();
    app.flush();
    app.messages.focus();
    app.messages.dispatch('pointerdown', { pointerType: 'touch' });
    app.messages.dispatch('click');
    expect(vi.getTimerCount()).toBe(1);
    app.modal.classList.add('active');
    app.notify('mutation', app.modal);
    app.flush();
    expect(app.visible()).toEqual([]);
    expect(app.document.activeElement).toBeNull();
    expect(app.messages.blur).toHaveBeenCalledOnce();
    expect(app.messages.classList.contains('tooltip-visible')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    app.moveBoundary(400);
    app.modal.classList.remove('active');
    app.notify('mutation', app.modal);
    app.flush();
    expect(app.visible()).toEqual(['gallery-refresh', 'back-to-top']);
    expect(app.gallery.classList.contains('tooltip-visible')).toBe(false);
  });

  it('cleans a focused touch tooltip when its section leaves the reading midpoint', () => {
    const app = runtime();
    app.flush();
    app.messages.focus();
    app.messages.dispatch('pointerdown', { pointerType: 'touch' });
    app.messages.dispatch('click');
    app.moveBoundary(400);
    app.window.dispatch('scroll');
    app.flush();
    expect(app.messages.hidden).toBe(true);
    expect(app.document.activeElement).toBeNull();
    expect(app.messages.classList.contains('tooltip-visible')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    app.messages.dispatch('click', { pointerType: 'touch' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows touch feedback for 1.8 seconds and lets Escape dismiss it until a fresh focus or pointer entry', () => {
    const app = runtime();
    app.flush();
    app.messages.dispatch('pointerdown', { pointerType: 'touch' });
    app.messages.dispatch('click');
    vi.advanceTimersByTime(1799);
    expect(app.messages.classList.contains('tooltip-visible')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(app.messages.classList.contains('tooltip-visible')).toBe(false);
    app.messages.dispatch('click', { pointerType: 'touch' });
    app.window.dispatch('keydown', { key: 'Escape' });
    expect(vi.getTimerCount()).toBe(0);
    for (const button of [app.gallery, app.messages, app.top]) {
      expect(button.classList.contains('tooltip-visible')).toBe(false);
      expect(button.classList.contains('tooltip-dismissed')).toBe(true);
    }
    app.messages.dispatch('pointerenter');
    expect(app.messages.classList.contains('tooltip-dismissed')).toBe(false);
    app.window.dispatch('keydown', { key: 'Escape' });
    app.messages.focus();
    expect(app.messages.classList.contains('tooltip-dismissed')).toBe(false);
    app.window.dispatch('keydown', { key: 'Escape' });
    app.messages.dispatch('pointerdown', { pointerType: 'mouse' });
    app.messages.dispatch('click');
    expect(app.messages.classList.contains('tooltip-dismissed')).toBe(false);
    expect(app.messages.classList.contains('tooltip-visible')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('uses the requested motion preference for back-to-top (%s)', reducedMotion => {
    const app = runtime({ reducedMotion });
    app.top.dispatch('click');
    expect(app.window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  });

  it('translates the back-to-top label and tooltip without altering another action', () => {
    const app = runtime();
    app.flush();
    app.messages.setAttribute('aria-label', 'Resume messages');
    for (const lang of ['zh-TW', 'ja', 'en']) {
      const label = JSON.parse(readFileSync(`assets/locales/${lang}.json`, 'utf8')).gallery.back_to_top;
      app.window.i18n = { t: key => key === 'gallery.back_to_top' ? label : key };
      app.window.dispatch('languageChanged');
      app.flush();
      expect(app.top.getAttribute('aria-label')).toBe(label);
      expect(app.nodes['back-to-top-tooltip'].textContent).toBe(label);
      expect(app.messages.getAttribute('aria-label')).toBe('Resume messages');
    }
    app.window.i18n = { t: key => key };
    app.window.dispatch('languageChanged');
    expect(app.top.getAttribute('aria-label')).toBe('Back to top');
  });

  it('coalesces initialization and repeated geometry events into one frame, including RAF id zero', () => {
    const app = runtime();
    expect(app.messages.hidden).toBe(false);
    expect([...app.frames.keys()]).toEqual([0]);
    app.window.dispatch('scroll');
    app.window.dispatch('resize');
    app.notify('resize', app.gallerySection);
    app.nav.dispatch('transitionend');
    expect(app.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(app.frames.size).toBe(1);
    app.flush();
    app.window.dispatch('scroll');
    app.window.dispatch('scroll');
    app.notify('mutation', app.nav);
    expect([...app.frames.keys()]).toEqual([1]);
    expect(app.requestAnimationFrame).toHaveBeenCalledTimes(2);
    app.flush();
    expect(app.frames.size).toBe(0);
  });
});

describe('floating control markup and design contracts', () => {
  it('keeps independent icon/tooltip buttons outside the content sections and preserves submission entrypoints', () => {
    const html = readFileSync('index.html', 'utf8');
    const floating = html.match(/<div id="floating-controls"[\s\S]*?<\/div>/)[0];
    const messages = html.match(/<section id="danmaku-section"[\s\S]*?<\/section>/)[0];
    const gallery = html.match(/<section id="gallery-section"[\s\S]*?<\/section>/)[0];
    expect(messages).toContain('id="submit-message-btn"');
    expect(gallery).toContain('id="submit-fanart-btn"');
    expect(messages).toMatch(/<div id="danmaku-controls">\s*<\/div>/);
    expect(messages).not.toContain('danmaku-play-pause');
    expect(gallery).not.toContain('gallery-refresh');
    expect(html).not.toContain('id="gallery-refresh-hint"');
    for (const id of ['gallery-refresh', 'danmaku-play-pause', 'back-to-top']) {
      expect([...html.matchAll(new RegExp(`id="${id}"`, 'g'))]).toHaveLength(1);
      const button = floating.match(new RegExp(`<button\\b[^>]*id="${id}"[\\s\\S]*?<\\/button>`))[0];
      expect(button).toContain('class="floating-control');
      expect(button).toContain(`aria-describedby="${id}-tooltip"`);
      expect(button).toMatch(/<svg\b[^>]*aria-hidden="true"/);
      expect(button).toContain('role="tooltip"');
      expect(button).not.toContain('data-i18n=');
    }
    expect(floating.indexOf('id="gallery-refresh"')).toBeLessThan(floating.indexOf('id="back-to-top"'));
    expect(floating.indexOf('id="danmaku-play-pause"')).toBeLessThan(floating.indexOf('id="back-to-top"'));
  });

  it('retains shared circular touch targets, safe-area offsets and hover/focus tooltip support', () => {
    const css = readFileSync('assets/css/style.css', 'utf8');
    const control = css.match(/\.floating-control\s*\{([^}]+)\}/)[1];
    expect(control).toMatch(/width:\s*50px/);
    expect(control).toMatch(/height:\s*50px/);
    expect(control).toMatch(/min-width:\s*44px/);
    expect(control).toMatch(/min-height:\s*44px/);
    expect(control).toMatch(/border-radius:\s*50%/);
    expect(css).toMatch(/\.floating-control\s*\{\s*width:\s*44px;\s*height:\s*44px/);
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('env(safe-area-inset-right');
    expect(css).toContain('.floating-control:focus-visible .floating-tooltip');
    expect(css).toContain('.floating-control:hover .floating-tooltip');
    expect(css).toMatch(/\.floating-tooltip\s*\{[^}]*right:\s*calc\(100% \+ 12px\)/);
    const reportControls = readFileSync('assets/css/danmaku.css', 'utf8').match(/#danmaku-controls\s*\{([^}]+)\}/)[1];
    expect(reportControls).toMatch(/margin-top:\s*0\s*;/);
  });
});
