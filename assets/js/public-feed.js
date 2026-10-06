/** One small version check shared by the two visible public feeds. */
const PublicFeedWatcher = {
    subscribers: new Map(),
    states: new Map(),
    visible: new Set(),
    failures: 0,
    nextCheckAt: 0,
    loading: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        const sections = { messages: 'danmaku-section', gallery: 'gallery-section' };
        if ('IntersectionObserver' in window) {
            this.observer = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    const kind = entry.target.id === sections.messages ? 'messages' : 'gallery';
                    if (entry.isIntersecting) this.visible.add(kind);
                    else this.visible.delete(kind);
                }
                this.schedule();
            });
            Object.values(sections).forEach(id => {
                const element = document.getElementById(id);
                if (element) this.observer.observe(element);
            });
        } else Object.keys(sections).forEach(kind => this.visible.add(kind));
        this.visibilityHandler = () => this.schedule();
        document.addEventListener('visibilitychange', this.visibilityHandler);
        this.schedule();
    },

    subscribe(kind, callback) {
        if (!['messages', 'gallery'].includes(kind)) throw new Error('Unknown feed');
        if (!this.subscribers.has(kind)) this.subscribers.set(kind, new Set());
        this.subscribers.get(kind).add(callback);
        const state = this.states.get(kind);
        if (state) callback(state);
        return () => this.subscribers.get(kind)?.delete(callback);
    },

    getState(kind) { return this.states.get(kind) || null; },
    isVisible(kind) { return !document.hidden && this.visible.has(kind); },

    schedule() {
        clearTimeout(this.timer);
        if (this.destroyed || document.hidden || !this.visible.size || this.loading) return;
        this.timer = setTimeout(() => this.check(), Math.max(0, this.nextCheckAt - Date.now()));
    },

    async check() {
        if (this.destroyed || this.loading || document.hidden || !this.visible.size) return;
        this.loading = true;
        const controller = new AbortController();
        this.controller = controller;
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const response = await fetch('/api/feed/version', {
                credentials: 'omit', signal: controller.signal
            });
            const text = await response.text();
            if (!response.ok || text.length > 8192) throw new Error('Feed version unavailable');
            const body = JSON.parse(text);
            const now = Date.now();
            for (const kind of ['messages', 'gallery']) {
                const state = body[kind];
                if (!state || typeof state.version !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(state.version) ||
                    !Number.isSafeInteger(Number(state.version)) ||
                    !Number.isFinite(state.generatedAt) || state.generatedAt > now + 60_000 ||
                    !Number.isFinite(state.confirmedAt) || state.confirmedAt > now + 60_000 ||
                    state.generatedAt > state.confirmedAt || !Number.isFinite(state.validUntil) ||
                    state.validUntil <= state.confirmedAt || state.validUntil - state.confirmedAt > 5 * 60_000 ||
                    state.validUntil <= now || state.validUntil > now + 5 * 60_000) {
                    throw new Error('Invalid feed version');
                }
            }
            this.failures = 0;
            this.nextCheckAt = Date.now() + 2000;
            for (const kind of ['messages', 'gallery']) {
                const state = body[kind];
                const previous = this.states.get(kind);
                if (previous && (Number(state.version) < Number(previous.version) ||
                    (state.version === previous.version && state.confirmedAt <= previous.confirmedAt))) continue;
                this.states.set(kind, state);
                // An unchanged content version can carry a server-confirmed renewed lease.
                for (const callback of this.subscribers.get(kind) || []) {
                    try { callback(state); } catch (error) { console.error('Feed update failed:', error); }
                }
            }
        } catch {
            this.failures += 1;
            this.nextCheckAt = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(this.failures, 5));
        } finally {
            clearTimeout(timeout);
            this.loading = false;
            this.schedule();
        }
    },

    destroy() {
        this.destroyed = true;
        clearTimeout(this.timer);
        this.controller?.abort();
        this.observer?.disconnect();
        document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
};
window.PublicFeedWatcher = PublicFeedWatcher;
document.addEventListener('DOMContentLoaded', () => PublicFeedWatcher.init());
