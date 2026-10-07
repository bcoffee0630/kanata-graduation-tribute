import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const item = id => ({
  id: `x_${id}`, postId: String(id), postUrl: `https://x.com/artist/status/${id}`,
  caption: '', submitter: 'Fixture contributor', createdAt: '2026-10-05T00:00:00.000Z',
});
const items = (...ids) => ids.map(item);
const envelope = (values, extra = {}) => ({
  version: '1', revision: 0, generatedAt: Date.now() - 600_000, confirmedAt: Date.now(),
  validUntil: Date.now() + 240_000, latestIds: values.slice(0, 2).map(value => value.postId),
  items: values, ...extra,
});
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

function floatingRefresh(withTooltip = true) {
  const icon = { tagName: 'svg' };
  const tooltip = { tagName: 'span', id: 'gallery-refresh-tooltip', textContent: '' };
  const attributes = new Map();
  const button = {
    children: withTooltip ? [icon, tooltip] : [icon],
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    querySelector(selector) {
      return this.children.find(child => selector === `#${child.id}` || selector === child.tagName) || null;
    },
    set textContent(value) { this.children = [{ textContent: value }]; },
  };
  return { button, icon, tooltip };
}

function runtime(storage = new Map()) {
  const fetch = vi.fn();
  const listeners = new Map();
  const window = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    XPost: { parseUrl(value) {
      const match = typeof value === 'string' && value.match(/^https:\/\/x\.com\/(?:artist|i\/web)\/status\/([1-9]\d*)$/);
      return match ? { postId: match[1], postUrl: value } : null;
    } },
  };
  runInNewContext(readFileSync('assets/js/gallery.js', 'utf8'), {
    window, document: { addEventListener() {}, querySelector: () => null }, navigator: {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch, AbortController, Date, setTimeout, clearTimeout,
  });
  const gallery = window.Gallery;
  // Contract/state tests never mount widgets or imitate the browser's layout engine.
  gallery.container = {};
  gallery.render = vi.fn();
  gallery.navigationEpoch = 0;
  gallery.data = items(1, 2, 3, 4, 5, 6).map(value => gallery.parseItem(value));
  gallery.poolVersion = '1';
  gallery.generatedAt = Date.now() - 600_000;
  gallery.confirmedAt = Date.now() - 1000;
  gallery.validUntil = Date.now() + 240_000;
  gallery.latestPostIds = ['1', '2'];
  return { gallery, fetch, storage, window, dispatch: type => listeners.get(type)?.() };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => vi.useRealTimers());

describe('gallery public response and refresh contract', () => {
  it('preserves the floating icon and tooltip while loading, retranslating and rejecting duplicate refresh clicks', async () => {
    const { gallery, fetch, window, dispatch } = runtime();
    const { button, icon, tooltip } = floatingRefresh();
    gallery.refreshButton = button;
    gallery.updateLabels();
    expect(button.getAttribute('aria-label')).toBe('ほかの投稿を見る');
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(tooltip.textContent).toBe('ほかの投稿を見る');
    let release;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = gallery.refresh({ initial: true });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(tooltip.textContent).toBe('投稿を読み込み中…');
    await gallery.refresh({ manual: true });
    window.i18n = { currentLang: 'en', t: key => ({
      'gallery.refresh': 'Refresh posts', 'gallery.refreshing': 'Loading posts…',
    }[key] || key) };
    dispatch('languageChanged');
    expect(button.getAttribute('aria-label')).toBe('Loading posts…');
    expect(tooltip.textContent).toBe('Loading posts…');
    expect(button.children).toEqual([icon, tooltip]);
    release(response(envelope(items(1, 2, 3, 4, 5, 6))));
    await pending;
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Refresh posts');
    expect(tooltip.textContent).toBe('Refresh posts');
    expect(button.children[0]).toBe(icon);
    expect(button.children[1]).toBe(tooltip);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps the floating icon if its tooltip has not been attached', () => {
    const { gallery } = runtime();
    const { button, icon } = floatingRefresh(false);
    gallery.refreshButton = button;
    gallery.updateLabels();
    expect(button.children).toEqual([icon]);
    expect(button.getAttribute('aria-label')).toBe('ほかの投稿を見る');
  });

  it('retranslates a status received before locale loading without fetching or replacing retained cards', async () => {
    const { gallery, fetch, window, dispatch } = runtime();
    gallery.status = { textContent: '' };
    gallery.scrollToFirst = vi.fn();
    const before = gallery.data;
    const retained = { article: {}, embed: {} };
    gallery.cards.set('1', retained);
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => '{}' });
    await gallery.refresh({ initial: true });
    expect(gallery.status.textContent).toBe('投稿を読み込めませんでした。');
    const requestVersion = gallery.requestVersion;
    window.i18n = { currentLang: 'en', t: key => ({ 'gallery.load_error': 'Posts could not be loaded.' }[key] || key) };
    dispatch('languageChanged');
    expect(gallery.status.textContent).toBe('Posts could not be loaded.');
    window.i18n = { currentLang: 'zh-TW', t: key => ({ 'gallery.load_error': '貼文目前無法載入。' }[key] || key) };
    dispatch('languageChanged');
    expect(gallery.status.textContent).toBe('貼文目前無法載入。');
    expect(gallery.data).toBe(before);
    expect(gallery.cards.get('1')).toBe(retained);
    expect(gallery.requestVersion).toBe(requestVersion);
    expect(fetch).toHaveBeenCalledOnce();
    expect(gallery.scrollToFirst).not.toHaveBeenCalled();
  });

  it('retains conflict bookkeeping without an inline update notice after a 409 or locale change', async () => {
    const { gallery, fetch, window, dispatch } = runtime();
    gallery.status = { textContent: 'Previous feedback' };
    gallery.refreshHint = { hidden: false, textContent: 'Previous update hint' };
    gallery.scrollToFirst = vi.fn();
    const before = gallery.data;
    const retained = { article: {}, embed: {} };
    gallery.cards.set('1', retained);
    fetch.mockResolvedValue({ ok: false, status: 409, text: async () => '{}' });
    await gallery.refresh({ manual: true });
    expect(gallery.refreshConflict).toBe(true);
    expect(gallery.hasNewPosts).toBe(true);
    expect(gallery.statusKey).toBe('');
    expect(gallery.status.textContent).toBe('');
    expect(gallery.refreshHint.hidden).toBe(true);
    expect(gallery.refreshHint.textContent).toBe('');
    window.i18n = { currentLang: 'en', t: key => key };
    dispatch('languageChanged');
    expect(gallery.status.textContent).toBe('');
    expect(gallery.refreshHint.hidden).toBe(true);
    expect(gallery.data).toBe(before);
    expect(gallery.cards.get('1')).toBe(retained);
    expect(gallery.isLoading).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(gallery.scrollToFirst).not.toHaveBeenCalled();
  });

  it('keeps cache, unchanged and unavailable feedback visible while suppressing the two removed notices', () => {
    const { gallery, fetch } = runtime();
    gallery.status = { textContent: '' };
    for (const key of ['cached_notice', 'unchanged_notice', 'unavailable']) {
      gallery.setStatus(key);
      expect(gallery.status.textContent).toBe(gallery.t(key));
      expect(gallery.statusKey).toBe(key);
    }
    for (const key of ['submission_notice', 'updated_hint']) {
      gallery.setStatus(key);
      expect(gallery.status.textContent).toBe('');
      expect(gallery.statusKey).toBe('');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ values: [] }, { values: items(1, 2, 3, 4, 5, 6) }])('keeps an initial unchanged batch quiet and reports repetition only after manual refresh ($values.length posts)', async ({ values }) => {
    const { gallery, fetch } = runtime();
    gallery.status = { textContent: '' };
    gallery.data = values.map(value => gallery.parseItem(value));
    gallery.scrollToFirst = vi.fn();
    fetch.mockResolvedValue(response(envelope(values)));
    await gallery.refresh({ initial: true });
    expect(gallery.data).toHaveLength(values.length);
    expect(gallery.status.textContent).toBe('');
    await gallery.refresh({ manual: true });
    expect(gallery.status.textContent).toBe('現在表示できる投稿はこの組み合わせです。');
  });

  it('preserves scroll position after a successful manual empty refresh without measuring a nonexistent post', async () => {
    const { gallery, fetch, window } = runtime();
    gallery.data = [];
    window.scrollTo = vi.fn();
    fetch.mockResolvedValue(response(envelope([])));
    // Keep the actual scrollToFirst method; this state harness has no layout measurements.
    await gallery.refresh({ manual: true });
    expect(gallery.data).toEqual([]);
    expect(gallery.loadFailed).toBe(false);
    expect(gallery.isLoading).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { context: 'messages with the wall heading still visible', hidden: true, sectionTop: 600 },
    { context: 'the active gallery', hidden: false, sectionTop: -100 },
  ])('scrolls a waiting manual refresh only if the wall remains active: $context', async ({ hidden, sectionTop }) => {
    const { gallery, fetch, window } = runtime();
    const { button } = floatingRefresh();
    button.hidden = false;
    gallery.refreshButton = button;
    // Supply browser-reported bounds; exercise the actual scrollToFirst method without a layout simulation.
    gallery.section = { getBoundingClientRect: () => ({ top: sectionTop, bottom: 1600 }) };
    gallery.container.getBoundingClientRect = () => ({ top: 88 });
    window.innerHeight = 720;
    window.scrollY = 892.5;
    window.matchMedia = () => ({ matches: true });
    window.scrollTo = vi.fn();
    let release;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = gallery.refresh({ manual: true });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    expect(gallery.isLoading).toBe(true);
    // Native anchor navigation need not change navigationEpoch; the contextual controller owns this visibility.
    button.hidden = hidden;
    expect(gallery.navigationEpoch).toBe(0);
    release(response(envelope(items(11, 12, 13, 14, 15, 16))));
    await pending;
    expect(gallery.data.map(value => value.postId)).toEqual(['11', '12', '13', '14', '15', '16']);
    expect(gallery.isLoading).toBe(false);
    if (hidden) expect(window.scrollTo).not.toHaveBeenCalled();
    else expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 968.5, behavior: 'auto' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('accepts six posts with a server-confirmed lease for an older unchanged generation', () => {
    const { gallery } = runtime();
    const parsed = gallery.parseBatch(envelope(items(1, 2, 3, 4, 5, 6)));
    expect(parsed.items).toHaveLength(6);
    expect(parsed.revision).toBe(0);
    expect(parsed.latestIds).toEqual(['1', '2']);
    expect(parsed.items[0].createdAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('rejects a seventh post instead of silently showing more than the cap', () => {
    const { gallery } = runtime();
    expect(() => gallery.parseBatch(envelope(items(1, 2, 3, 4, 5, 6, 7)))).toThrow();
  });

  it('rejects invalid version paths and latest IDs outside the returned posts', () => {
    const { gallery } = runtime();
    expect(() => gallery.parseBatch(envelope(items(1), { version: '../private' }))).toThrow();
    expect(() => gallery.parseBatch(envelope(items(1), { version: '1'.repeat(31) }))).toThrow();
    expect(() => gallery.parseBatch(envelope(items(1), { latestIds: ['2'] }))).toThrow();
  });

  it('rejects expired or excessive leases even when confirmedAt is omitted', () => {
    const { gallery } = runtime();
    expect(() => gallery.parseBatch(envelope(items(1), { validUntil: Date.now() - 1 }))).toThrow();
    expect(() => gallery.parseBatch(envelope(items(1), { confirmedAt: undefined, validUntil: Date.now() + 600_000 }))).toThrow();
  });

  it('rejects alias document IDs that would display the same X post twice', () => {
    const { gallery } = runtime();
    expect(() => gallery.parseBatch(envelope([item(1), { ...item(1), id: 'legacy-alias' }]))).toThrow();
  });

  it('rejects malformed source revisions but accepts older envelopes without one', () => {
    const { gallery } = runtime();
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
      expect(() => gallery.parseBatch(envelope([], { revision }))).toThrow();
    }
    expect(gallery.parseBatch(envelope([], { revision: undefined })).revision).toBeUndefined();
  });

  it('invalidates rotated samples at revision zero without a hint or changing the reading surface', async () => {
    const { gallery, fetch } = runtime();
    gallery.refreshHint = { hidden: false, textContent: '' };
    fetch.mockResolvedValue(response(envelope(items(1, 2, 3, 4, 5, 6))));
    await gallery.refresh({ initial: true });
    expect(gallery.poolRevision).toBe(0);
    gallery.onSubmission(item(99));
    const before = gallery.data;
    const retained = { article: {}, embed: {} };
    gallery.cards.set('1', retained);
    gallery.render.mockClear();
    gallery.onFeedState({ version: '2', revision: 0, generatedAt: Date.now(), confirmedAt: Date.now(), validUntil: Date.now() + 240_000 });
    expect(gallery.pool.size).toBe(0);
    expect(gallery.ownItems.size).toBe(0);
    expect(gallery.validUntil).toBe(0);
    expect(gallery.latestPostIds).toEqual([]);
    expect(gallery.data).toBe(before);
    expect(gallery.cards.get('1')).toBe(retained);
    expect(gallery.render).not.toHaveBeenCalled();
    expect(gallery.hasNewPosts).toBe(false);
    expect(gallery.refreshHint.hidden).toBe(true);
    expect(gallery.refreshHint.textContent).toBe('');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps empty rotation and source revision changes visually quiet while retaining update bookkeeping', async () => {
    const { gallery, fetch } = runtime();
    gallery.data = [];
    gallery.refreshHint = { hidden: false, textContent: '' };
    fetch.mockResolvedValue(response(envelope([])));
    await gallery.refresh({ initial: true });
    const state = { version: '2', revision: 0, generatedAt: Date.now(), confirmedAt: Date.now(), validUntil: Date.now() + 240_000 };
    gallery.onFeedState(state);
    expect(gallery.refreshHint.hidden).toBe(true);
    gallery.onFeedState({ ...state, version: '3', revision: 1 });
    expect(gallery.refreshHint.hidden).toBe(true);
    expect(gallery.refreshHint.textContent).toBe('');
    expect(gallery.hasNewPosts).toBe(true);
    expect(gallery.data).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValue(response(envelope([], { version: '3', revision: 1 })));
    gallery.scrollToFirst = vi.fn();
    await gallery.refresh({ manual: true });
    expect(gallery.poolRevision).toBe(1);
    expect(gallery.refreshHint.hidden).toBe(true);
    gallery.onFeedState({ ...state, version: '4', revision: 1 });
    expect(gallery.refreshHint.hidden).toBe(true);
    expect(gallery.hasNewPosts).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains version-based hints if either the loaded batch or old manifest has no revision', () => {
    const { gallery } = runtime();
    gallery.onFeedState({ version: '2', revision: 0 });
    expect(gallery.hasNewPosts).toBe(true);
    gallery.poolRevision = 0;
    gallery.onFeedState({ version: '2' });
    expect(gallery.hasNewPosts).toBe(true);
  });

  it('discards an older in-flight sample after rotation without manufacturing a content update notice', async () => {
    const { gallery, fetch } = runtime();
    gallery.poolRevision = 0;
    gallery.status = { textContent: '' };
    let release;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const before = gallery.data;
    const pending = gallery.refresh({ initial: true });
    gallery.onFeedState({ version: '2', revision: 0, generatedAt: Date.now(), confirmedAt: Date.now(), validUntil: Date.now() + 240_000 });
    release(response(envelope(items(11, 12, 13, 14, 15, 16))));
    await pending;
    expect(gallery.data).toBe(before);
    expect(gallery.pool.size).toBe(0);
    expect(gallery.status.textContent).toBe('');
    expect(gallery.hasNewPosts).toBe(false);
  });

  it('prepends an accepted post without a success notice, removes the tail and performs no content request', () => {
    const { gallery, fetch, window, dispatch } = runtime();
    gallery.status = { textContent: 'Previous feedback' };
    expect(gallery.onSubmission(item(99))).toBe(true);
    expect(gallery.data.map(value => value.postId)).toEqual(['99', '1', '2', '3', '4', '5']);
    expect(gallery.render).toHaveBeenCalledWith({ prepend: '99' });
    expect(gallery.status.textContent).toBe('');
    window.i18n = { currentLang: 'en', t: key => key };
    dispatch('languageChanged');
    expect(gallery.status.textContent).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('promotes an accepted alias while keeping each X post unique', () => {
    const { gallery } = runtime();
    expect(gallery.onSubmission({ ...item(4), id: 'accepted-alias' })).toBe(true);
    expect(gallery.data[0].id).toBe('accepted-alias');
    expect(gallery.data).toHaveLength(6);
    expect(new Set(gallery.data.map(value => value.postId)).size).toBe(6);
  });

  it('cancels the pending sample and restores the refresh button state on acceptance', () => {
    const { gallery } = runtime();
    const abort = vi.fn();
    gallery.requestController = { abort };
    gallery.isLoading = true;
    gallery.onSubmission(item(99));
    expect(abort).toHaveBeenCalledOnce();
    expect(gallery.isLoading).toBe(false);
    expect(gallery.requestVersion).toBe(1);
  });

  it('leaves existing content alone when an old server returns no accepted item', () => {
    const { gallery, fetch } = runtime();
    const before = gallery.data;
    expect(gallery.onSubmission(undefined)).toBe(false);
    expect(gallery.data).toBe(before);
    expect(gallery.render).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invalidates candidates and the own overlay on a newer version while keeping the reading surface', () => {
    const { gallery, fetch } = runtime();
    gallery.onSubmission(item(99));
    gallery.pool.set('x_1', gallery.parseItem(item(1)));
    const before = gallery.data;
    gallery.onFeedState({ version: '2', generatedAt: Date.now(), confirmedAt: Date.now(), validUntil: Date.now() + 240_000 });
    expect(gallery.pool.size).toBe(0);
    expect(gallery.ownItems.size).toBe(0);
    expect(gallery.data).toBe(before);
    expect(gallery.hasNewPosts).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a newer confirmed lease for the same version but ignores old confirmations', () => {
    const { gallery } = runtime();
    const state = { version: '1', generatedAt: Date.now() - 600_000, confirmedAt: Date.now(), validUntil: Date.now() + 270_000 };
    gallery.onFeedState(state);
    expect(gallery.validUntil).toBe(state.validUntil);
    gallery.onFeedState({ ...state, confirmedAt: state.confirmedAt - 5000, validUntil: Date.now() + 1000 });
    expect(gallery.validUntil).toBe(state.validUntil);
  });

  it('keeps the latest two and changes other cached posts without extending the lease', () => {
    const { gallery } = runtime();
    gallery.data = items(1, 2, 11, 12, 13, 14).map(value => gallery.parseItem(value));
    for (const value of items(1, 2, 3, 4, 5, 6, 11, 12, 13, 14)) gallery.pool.set(value.id, gallery.parseItem(value));
    const deadline = gallery.validUntil;
    expect(gallery.shuffleCached()).toBe(true);
    expect(gallery.data.slice(0, 2).map(value => value.postId)).toEqual(['1', '2']);
    expect(new Set(gallery.data.map(value => value.postId))).toEqual(new Set(['1', '2', '3', '4', '5', '6']));
    expect(gallery.validUntil).toBe(deadline);
  });

  it('does not replace the reading surface when the cache contains no other candidate', () => {
    const { gallery } = runtime();
    for (const value of gallery.data) gallery.pool.set(value.id, value);
    const before = gallery.data;
    expect(gallery.shuffleCached()).toBe(false);
    expect(gallery.data).toBe(before);
    expect(gallery.render).not.toHaveBeenCalled();
  });

  it('shares five rolling refresh reservations across clients and releases them after sixty seconds', async () => {
    const storage = new Map();
    const first = runtime(storage).gallery;
    const second = runtime(storage).gallery;
    let permitted = 0;
    for (let index = 0; index < 8; index++) if (await (index % 2 ? first : second).reserveRefresh()) permitted++;
    expect(permitted).toBe(5);
    expect(JSON.parse(storage.get(first.REFRESH_STORAGE_KEY))).toHaveLength(5);
    vi.advanceTimersByTime(60_001);
    expect(await first.reserveRefresh()).toBe(true);
  });

  it('discards a late old batch even if its fetch implementation ignores cancellation', async () => {
    const { gallery, fetch } = runtime();
    let release;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = gallery.refresh({ initial: true });
    expect(fetch).toHaveBeenCalledOnce();
    gallery.onSubmission(item(99));
    release(response(envelope(items(11, 12, 13, 14, 15, 16))));
    await pending;
    expect(gallery.data[0].postId).toBe('99');
    expect(gallery.pool.size).toBe(0);
    expect(gallery.isLoading).toBe(false);
  });

  it('returns to the shared latest/random sample after a successful manual refresh', async () => {
    const { gallery, fetch } = runtime();
    gallery.onSubmission(item(99));
    gallery.scrollToFirst = vi.fn();
    fetch.mockResolvedValue(response(envelope(items(1, 2, 11, 12, 13, 14))));
    await gallery.refresh({ manual: true });
    expect(gallery.ownItems.size).toBe(0);
    expect(gallery.data.map(value => value.postId)).toEqual(['1', '2', '11', '12', '13', '14']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(gallery.scrollToFirst).toHaveBeenCalledOnce();
  });

  it('does not refill old candidates after a newer manifest arrives while content is downloading', async () => {
    const { gallery, fetch } = runtime();
    let release;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const before = gallery.data;
    const pending = gallery.refresh({ initial: true });
    gallery.onFeedState({ version: '2', generatedAt: Date.now(), confirmedAt: Date.now(), validUntil: Date.now() + 240_000 });
    release(response(envelope(items(11, 12, 13, 14, 15, 16))));
    await pending;
    expect(gallery.data).toBe(before);
    expect(gallery.pool.size).toBe(0);
    expect(gallery.hasNewPosts).toBe(true);
    expect(gallery.isLoading).toBe(false);
  });
});
