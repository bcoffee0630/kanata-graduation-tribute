import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const item = id => ({
  id: `x_${id}`, postId: String(id), postUrl: `https://x.com/artist/status/${id}`,
  caption: '', submitter: 'Fixture contributor', createdAt: '2026-10-05T00:00:00.000Z',
});
const items = (...ids) => ids.map(item);
const envelope = (values, extra = {}) => ({
  version: '1', generatedAt: Date.now() - 600_000, confirmedAt: Date.now(),
  validUntil: Date.now() + 240_000, latestIds: values.slice(0, 2).map(value => value.postId),
  items: values, ...extra,
});
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

function runtime(storage = new Map()) {
  const fetch = vi.fn();
  const window = {
    addEventListener() {},
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
  return { gallery, fetch, storage };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => vi.useRealTimers());

describe('gallery public response and refresh contract', () => {
  it('accepts six posts with a server-confirmed lease for an older unchanged generation', () => {
    const { gallery } = runtime();
    const parsed = gallery.parseBatch(envelope(items(1, 2, 3, 4, 5, 6)));
    expect(parsed.items).toHaveLength(6);
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

  it('prepends an accepted post, removes the tail and performs no content request', () => {
    const { gallery, fetch } = runtime();
    expect(gallery.onSubmission(item(99))).toBe(true);
    expect(gallery.data.map(value => value.postId)).toEqual(['99', '1', '2', '3', '4', '5']);
    expect(gallery.render).toHaveBeenCalledWith({ prepend: '99' });
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
