import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function runtime(file, fetch = vi.fn()) {
  const nodes = [];
  const node = () => ({
    style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {} },
    setAttribute() {}, addEventListener() {}, remove() {},
    set textContent(value) { this.innerHTML = value; },
  });
  const tracks = { appendChild: element => nodes.push(element) };
  const document = {
    hidden: false, addEventListener() {}, removeEventListener() {}, getElementById: () => null,
    querySelector: () => null, createElement: node,
  };
  const window = { addEventListener() {}, i18n: { currentLang: 'en' } };
  runInNewContext(readFileSync(file, 'utf8'), {
    document, window, fetch, console, AbortController, Date, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  return { window, document, nodes, container: {
    querySelector: () => tracks, querySelectorAll: () => nodes,
  } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => vi.useRealTimers());
const item = id => ({ id, author: 'Fan', content: `Memory ${id}` });

function danmaku(fetch) {
  const app = runtime('assets/js/danmaku.js', fetch);
  const feed = app.window.Danmaku;
  Object.assign(feed, { container: app.container, tracks: [0, 0, 0, 0, 0],
    priorityQueue: [], pendingOwn: new Map(), seenIds: new Set(), validUntil: Date.now() + 300_000,
    nextRegularAt: Date.now() + 10_000 });
  return { ...app, feed };
}

describe('incremental bullet messages', () => {
  it('keeps active animations and unfinished playback while prioritizing new messages', () => {
    const { feed, nodes } = danmaku();
    feed.applyMessages([item('old-1'), item('old-2')]);
    feed.nextRegularAt = 0;
    feed.spawnMessage();
    const active = nodes[0];
    const remaining = feed.messageQueue.map(message => message.id);
    feed.applyMessages([item('new'), item('old-1'), item('old-2')]);
    expect(nodes[0]).toBe(active);
    expect(nodes.at(-1).dataset.messageId).toBe('new');
    expect(feed.messageQueue.map(message => message.id)).toEqual(remaining);
    const count = nodes.length;
    feed.applyMessages([item('new'), item('old-1'), item('old-2')]);
    expect(nodes).toHaveLength(count);
  });

  it('holds new messages while paused and does not lose an accepted message to an older response', () => {
    const { feed, nodes } = danmaku();
    feed.isPaused = true;
    feed.applyMessages([item('old')]);
    feed.onSubmission(item('own'));
    feed.applyMessages([item('old')]);
    expect(nodes).toHaveLength(0);
    expect(feed.priorityQueue.map(message => message.id)).toEqual(['own']);
    expect(feed.data.messages.map(message => message.id)).toContain('own');
    feed.isPaused = false;
    feed.tryPriority();
    expect(nodes[0].dataset.messageId).toBe('own');
    feed.stop();
  });

  it('stops circulating expired content and waits for an available track', () => {
    const { feed, nodes } = danmaku();
    feed.applyMessages([item('old')]);
    feed.validUntil = Date.now();
    feed.spawnMessage();
    expect(nodes).toHaveLength(0);
    feed.validUntil = Date.now() + 1000;
    feed.tracks.fill(Date.now() + 1000);
    feed.onSubmission(item('own'));
    expect(nodes).toHaveLength(0);
    expect(feed.priorityQueue[0].id).toBe('own');
    feed.stop();
  });

  it('keeps selected content and animations through a language change', () => {
    const { feed, nodes } = danmaku();
    feed.applyMessages([item('old')]);
    feed.nextRegularAt = 0;
    feed.spawnMessage();
    feed.selectedMessage = { id: 'old', element: nodes[0] };
    feed.onLanguageChange();
    expect(nodes).toHaveLength(1);
    expect(feed.selectedMessage.element).toBe(nodes[0]);
  });

  it('invalidates old replay on a newer revision and rejects an older in-flight response', async () => {
    let resolveOld;
    const snapshot = version => ({ version, generatedAt: Date.now(), validUntil: Date.now() + 300_000,
      items: version === '1' ? [item('removed')] : [] });
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValue({ ok: true, text: async () => JSON.stringify(snapshot('2')) });
    const { feed, window, nodes } = danmaku(fetch);
    window.PublicFeedWatcher = { isVisible: () => true };
    feed.version = '1'; feed.expectedVersion = '1';
    feed.applyMessages([item('removed')]); feed.nextRegularAt = 0; feed.spawnMessage();
    const opened = nodes[0];
    const loading = feed.loadSnapshot('1');
    feed.onFeedVersion({ version: '2', validUntil: Date.now() + 300_000 });
    expect(feed.messageQueue).toEqual([]); expect(feed.validUntil).toBe(0);
    resolveOld({ ok: true, text: async () => JSON.stringify(snapshot('1')) });
    await loading;
    expect(feed.version).toBe('1'); expect(feed.validUntil).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2); expect(feed.version).toBe('2');
    expect(feed.data.messages).toEqual([]); expect(nodes[0]).toBe(opened);
    feed.stop();
  });

  it('expires unconfirmed own messages even when the unchanged public lease is renewed', () => {
    const { feed } = danmaku();
    feed.isPaused = true;
    feed.applyMessages([item('public')]); feed.version = '1';
    feed.onSubmission(item('own'));
    feed.applyMessages([item('public')], { version: '1', generatedAt: Date.now() - 1000 });
    vi.advanceTimersByTime(300_001);
    feed.validUntil = Date.now() + 300_000;
    feed.isPaused = false; feed.spawnMessage();
    expect(feed.data.messages.map(message => message.id)).not.toContain('own');
    expect(feed.pendingOwn.size).toBe(0);
    feed.stop();
  });

  it('does not revive a missing own message in a newer authoritative empty snapshot', () => {
    const { feed } = danmaku();
    feed.isPaused = true; feed.version = '1'; feed.onSubmission(item('own'));
    feed.applyMessages([], { version: '2', generatedAt: Date.now() + 1 });
    expect(feed.data.messages).toEqual([]); expect(feed.priorityQueue).toEqual([]);
    feed.stop();
  });
});

describe('one shared public feed watcher', () => {
  const version = (value = '1') => ({
    messages: { version: value, generatedAt: Date.now() - 600_000, confirmedAt: Date.now(), validUntil: Date.now() + 300_000 },
    gallery: { version: value, generatedAt: Date.now(), confirmedAt: Date.now(), validUntil: Date.now() + 300_000 },
  });
  const response = body => ({ ok: true, text: async () => JSON.stringify(body) });

  it('checks a single manifest and carries renewed leases without fetching unchanged content', async () => {
    const fetch = vi.fn().mockImplementation(async () => response(version()));
    const { window } = runtime('assets/js/public-feed.js', fetch);
    const watcher = window.PublicFeedWatcher;
    watcher.visible.add('messages'); watcher.visible.add('gallery');
    const messages = vi.fn(); const gallery = vi.fn();
    watcher.subscribe('messages', messages); watcher.subscribe('gallery', gallery);
    await watcher.check();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(messages).toHaveBeenCalledTimes(1); expect(gallery).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(watcher.getState('messages').validUntil).toBe(Date.now() + 300_000);
    watcher.destroy();
  });

  it('does not poll hidden or offscreen feeds and backs off failed requests', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const { window, document } = runtime('assets/js/public-feed.js', fetch);
    const watcher = window.PublicFeedWatcher;
    await watcher.check(); expect(fetch).not.toHaveBeenCalled();
    watcher.visible.add('messages'); document.hidden = true;
    await watcher.check(); expect(fetch).not.toHaveBeenCalled();
    document.hidden = false;
    await watcher.check();
    expect(watcher.nextCheckAt - Date.now()).toBe(4000);
    await vi.advanceTimersByTimeAsync(3999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    expect(watcher.nextCheckAt - Date.now()).toBe(8000);
    watcher.destroy();
  });

  it('keeps newer versions and server-confirmed leases through out-of-order responses', async () => {
    const newest = version('2'); const older = version('1');
    const shortLease = version('2'); shortLease.messages.confirmedAt -= 1000;
    const fetch = vi.fn().mockResolvedValueOnce(response(newest)).mockResolvedValueOnce(response(older))
      .mockResolvedValueOnce(response(shortLease));
    const { window } = runtime('assets/js/public-feed.js', fetch);
    const watcher = window.PublicFeedWatcher; watcher.visible.add('messages');
    const callback = vi.fn(); watcher.subscribe('messages', callback);
    await watcher.check(); await watcher.check(); await watcher.check();
    expect(watcher.getState('messages').version).toBe('2');
    expect(watcher.getState('messages').confirmedAt).toBe(newest.messages.confirmedAt);
    expect(callback).toHaveBeenCalledTimes(1);
    watcher.destroy();
  });
});
