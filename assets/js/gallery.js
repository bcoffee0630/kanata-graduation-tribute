/** Six public X posts from shared, expiring delivery batches. */
const Gallery = {
    data: [],
    cards: new Map(),
    pool: new Map(),
    requestVersion: 0,
    MAX_ITEMS: 6,
    MAX_CACHED_ITEMS: 48,
    ownItems: new Map(),
    REFRESH_STORAGE_KEY: 'gallery-refresh-attempts',
    refreshAttempts: [],

    init() {
        this.container = document.getElementById('gallery-grid');
        this.status = document.getElementById('gallery-status');
        this.refreshButton = document.getElementById('gallery-refresh');
        this.refreshHint = document.getElementById('gallery-refresh-hint');
        this.section = document.getElementById('gallery-section');
        if (!this.container) return;
        this.refreshButton?.addEventListener('click', () => this.refresh({ manual: true }));
        this.unsubscribeFeed = window.PublicFeedWatcher?.subscribe('gallery', state => this.onFeedState(state));
        this.onFeedState(window.PublicFeedWatcher?.getState('gallery'));
        this.updateLabels();
        this.viewportWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            if (this.viewportWidth === window.innerWidth) return;
            this.viewportWidth = window.innerWidth;
            this.scheduleLayout();
        });
        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(entries => {
                const width = this.container.getBoundingClientRect().width;
                if (entries.some(entry => entry.target !== this.container) || width !== this.gridWidth) {
                    this.gridWidth = width;
                    this.scheduleLayout();
                }
            });
            this.resizeObserver.observe(this.container);
        }
        // An explicit touch/wheel/navigation while a response waits cancels its automatic scroll.
        this.navigationEpoch = 0;
        ['wheel', 'touchstart', 'keydown'].forEach(type => window.addEventListener(type, () => {
            this.navigationEpoch++;
        }, { passive: true }));
        this.showSkeleton();
        this.refresh({ initial: true });
    },

    t(key) {
        const translated = window.i18n?.t(`gallery.${key}`);
        return translated && translated !== `gallery.${key}` ? translated : {
            no_content: 'まだ投稿がありません', load_error: '投稿を読み込めませんでした。',
            submitter: '投稿者', anonymous: '匿名', retry: '再読み込み',
            refresh: 'ほかの投稿を見る', refreshing: '投稿を読み込み中…',
            updated_hint: '新しい投稿があります。更新すると表示できます。',
            submission_notice: '共有しました。あなたの投稿を先頭に表示しています。',
            cached_notice: '読み込みを少し休んで、取得済みの投稿を表示しています。',
            unchanged_notice: '現在表示できる投稿はこの組み合わせです。',
            unavailable: '現在、新しい投稿を読み込めません。しばらくしてからお試しください。'
        }[key] || key;
    },

    updateLabels() {
        const label = this.t(this.isLoading ? 'refreshing' : 'refresh');
        this.refreshButton?.setAttribute('aria-label', label);
        this.refreshButton?.setAttribute('aria-disabled', String(!!this.isLoading));
        const copy = this.refreshButton?.querySelector('span');
        if (copy) copy.textContent = label;
        else if (this.refreshButton) this.refreshButton.textContent = label;
        this.updateRefreshHint();
    },

    updateRefreshHint() {
        this.hasNewPosts = this.refreshConflict || this.isNewerVersion(this.feedState?.version, this.poolVersion);
        if (this.refreshHint) {
            this.refreshHint.hidden = !this.hasNewPosts;
            this.refreshHint.textContent = this.hasNewPosts ? this.t('updated_hint') : '';
        }
    },

    isNewerVersion(candidate, version) {
        return typeof candidate === 'string' && /^\d{1,30}$/.test(candidate) &&
            typeof version === 'string' && /^\d{1,30}$/.test(version) && BigInt(candidate) > BigInt(version);
    },

    onFeedState(state) {
        if (!state) return;
        this.feedState = state;
        if (this.isNewerVersion(state.version, this.poolVersion) && state.version !== this.invalidatedVersion) {
            // Keep the current reading surface, but never replay candidates from a superseded snapshot.
            this.pool.clear();
            this.ownItems.clear();
            this.validUntil = 0;
            this.latestPostIds = [];
            this.invalidatedVersion = state.version;
        } else if (state.version === this.poolVersion && Number.isFinite(state.confirmedAt) &&
            state.confirmedAt > (this.confirmedAt || 0) && state.confirmedAt <= Date.now() + 60000 &&
            Number.isFinite(state.validUntil) && state.validUntil > Date.now() &&
            state.validUntil <= Date.now() + 300000 && state.validUntil > state.confirmedAt &&
            state.validUntil - state.confirmedAt <= 300000) {
            this.confirmedAt = state.confirmedAt;
            this.validUntil = state.validUntil;
        }
        this.updateRefreshHint();
    },

    shuffled(values) {
        const copy = [...values];
        for (let index = copy.length - 1; index > 0; index--) {
            const other = Math.floor(Math.random() * (index + 1));
            [copy[index], copy[other]] = [copy[other], copy[index]];
        }
        return copy;
    },

    nextBatch() {
        if (!this.batchBag?.length) this.batchBag = this.shuffled(Array.from({ length: 8 }, (_, index) => index));
        return this.batchBag.pop();
    },

    async reserveRefresh() {
        const reserve = persisted => {
            const now = Date.now();
            const fallback = Array.isArray(persisted) ? persisted : this.refreshAttempts;
            let stored = fallback;
            try {
                const source = localStorage.getItem(this.REFRESH_STORAGE_KEY);
                const parsed = source === null ? null : JSON.parse(source);
                if (Array.isArray(parsed)) stored = parsed;
            } catch {}
            const recent = values => values.filter(time => Number.isFinite(time) && time > now - 60000 && time <= now);
            const base = recent(stored);
            this.refreshAttempts = [...base];
            if (base.length >= 5) return false;
            this.refreshAttempts.push(now);
            try { localStorage.setItem(this.REFRESH_STORAGE_KEY, JSON.stringify(this.refreshAttempts)); }
            catch {
                // Readable but unwritable storage may lag the shared database history.
                const persistedRecent = recent(fallback);
                this.refreshAttempts = persistedRecent.length > base.length ? persistedRecent : [...base];
                if (this.refreshAttempts.length >= 5) return false;
                this.refreshAttempts.push(now);
            }
            return true;
        };
        const persist = () => window.indexedDB ? this.reserveWithDatabase(reserve) : reserve();
        if (navigator.locks?.request) return navigator.locks.request('gallery-refresh-budget', persist);
        return persist();
    },

    reserveWithDatabase(reserve) {
        // Share attempt history even when localStorage is blocked; the transaction serializes tabs.
        return new Promise(resolve => {
            let settled = false;
            let database;
            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                database?.close();
                resolve(result);
            };
            const timeout = setTimeout(() => finish(false), 2000);
            let request;
            try { request = indexedDB.open('gallery-refresh-budget', 1); }
            catch { finish(reserve()); return; }
            request.onupgradeneeded = () => request.result.createObjectStore('reservations');
            request.onerror = () => { if (!settled) finish(reserve()); };
            request.onsuccess = () => {
                database = request.result;
                if (settled) { database.close(); return; }
                const transaction = database.transaction('reservations', 'readwrite');
                const store = transaction.objectStore('reservations');
                let result = false;
                const history = store.get('refresh');
                history.onsuccess = () => {
                    if (settled) return;
                    result = reserve(history.result);
                    store.put([...this.refreshAttempts], 'refresh');
                };
                transaction.oncomplete = () => finish(result);
                transaction.onerror = transaction.onabort = () => finish(false);
            };
        });
    },

    parseItem(item) {
        if (!item || typeof item !== 'object') throw new Error('Invalid public gallery item');
        const post = window.XPost.parseUrl(item.postUrl);
        const createdAt = new Date(item.createdAt);
        if (!post || post.postId !== item.postId || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(item.id) ||
            typeof item.caption !== 'string' || item.caption.length > 300 ||
            typeof item.submitter !== 'string' || item.submitter.length > 160 ||
            typeof item.createdAt !== 'string' || !Number.isFinite(createdAt.getTime())) {
            throw new Error('Invalid public gallery item');
        }
        return { id: item.id, ...post, caption: item.caption, submitter: item.submitter, createdAt };
    },

    parseBatch(body) {
        if (!body || typeof body.version !== 'string' || !/^\d{1,30}$/.test(body.version) ||
            !Number.isFinite(body.generatedAt) || body.generatedAt > Date.now() + 60000 || !Number.isFinite(body.validUntil) ||
            body.validUntil <= Date.now() || body.validUntil > Date.now() + 300000 || body.validUntil <= body.generatedAt ||
            (body.confirmedAt !== undefined && (!Number.isFinite(body.confirmedAt) ||
                body.confirmedAt > Date.now() + 60000 || body.validUntil <= body.confirmedAt ||
                body.validUntil - body.confirmedAt > 300000)) ||
            !Array.isArray(body.items) || body.items.length > this.MAX_ITEMS) {
            throw new Error('Invalid public gallery response');
        }
        const ids = new Set();
        const posts = new Set();
        const items = body.items.map(item => {
            const parsed = this.parseItem(item);
            if (ids.has(parsed.id) || posts.has(parsed.postId)) throw new Error('Duplicate public gallery item');
            ids.add(parsed.id);
            posts.add(parsed.postId);
            return parsed;
        });
        const latestIds = body.latestIds === undefined ? items.slice(0, 2).map(item => item.postId) : body.latestIds;
        if (!Array.isArray(latestIds) || latestIds.length > 2 || new Set(latestIds).size !== latestIds.length ||
            latestIds.some(postId => !posts.has(postId))) throw new Error('Invalid latest gallery items');
        return { ...body, items, latestIds };
    },

    onSubmission(value) {
        let item;
        try { item = this.parseItem(value); } catch { return false; }
        // The accepted response owns this update; an older in-flight sample must not replace it.
        this.requestVersion++;
        this.requestController?.abort();
        this.requestController = null;
        this.isLoading = false;
        this.loadFailed = false;
        this.ownItems.delete(item.postId);
        this.ownItems.set(item.postId, { item, validUntil: Date.now() + 300000 });
        while (this.ownItems.size > this.MAX_ITEMS) this.ownItems.delete(this.ownItems.keys().next().value);
        this.data = [item, ...this.data.filter(old => old.postId !== item.postId)].slice(0, this.MAX_ITEMS);
        this.render({ prepend: item.postId });
        this.setStatus('submission_notice');
        this.updateLabels();
        return true;
    },

    withOwnItems(items) {
        for (const [postId, entry] of this.ownItems) {
            if (Date.now() >= entry.validUntil) this.ownItems.delete(postId);
            else if (items.some(item => item.postId === postId)) {
                entry.item = items.find(item => item.postId === postId);
            }
        }
        const own = [...this.ownItems.values()].reverse().map(entry => entry.item);
        const ownIds = new Set(own.map(item => item.postId));
        return [...own, ...items.filter(item => !ownIds.has(item.postId))].slice(0, this.MAX_ITEMS);
    },

    async refresh({ initial = false, manual = false } = {}) {
        if (!this.container || this.isLoading) return;
        this.isLoading = true;
        this.updateLabels();
        const version = ++this.requestVersion;
        const navigationEpoch = this.navigationEpoch;
        this.setStatus('');
        try {
            const permitted = initial || await this.reserveRefresh();
            if (version !== this.requestVersion) return;
            if (!permitted) {
                if (this.shuffleCached({ clearOwn: manual }) && manual) this.scrollToFirst(navigationEpoch);
                return;
            }
            const controller = new AbortController();
            this.requestController = controller;
            const timeout = setTimeout(() => controller.abort(), 12000);
            let response;
            let body;
            try {
                const knownVersion = this.feedState?.version;
                const query = knownVersion ? `?version=${encodeURIComponent(knownVersion)}` : '';
                response = await fetch(`/api/gallery/batches/${this.nextBatch()}${query}`, { signal: controller.signal, credentials: 'omit' });
                const source = await response.text();
                if (source.length > 65536) throw new Error('Public gallery response too large');
                body = JSON.parse(source);
            } finally { clearTimeout(timeout); }
            if (version !== this.requestVersion) return;
            if (response.status === 409) {
                this.refreshConflict = true;
                if (!this.data.length) this.showError();
                this.setStatus('updated_hint');
                return;
            }
            if (!response.ok) throw new Error('Public gallery unavailable');
            const batch = this.parseBatch(body);
            if (this.isNewerVersion(this.feedState?.version, batch.version)) {
                if (!this.data.length) this.showError();
                this.setStatus('updated_hint');
                return;
            }
            this.refreshConflict = false;
            this.invalidatedVersion = null;
            this.generatedAt = batch.generatedAt;
            this.latestPostIds = batch.latestIds;
            if (batch.version !== this.poolVersion) {
                this.pool.clear();
                this.poolVersion = batch.version;
                this.validUntil = batch.validUntil;
                this.confirmedAt = batch.confirmedAt;
            } else if (Number.isFinite(batch.confirmedAt) && batch.confirmedAt > (this.confirmedAt || 0)) {
                // Only a server-confirmed response can renew an unchanged snapshot's lease.
                this.confirmedAt = batch.confirmedAt;
                this.validUntil = batch.validUntil;
            } else {
                this.validUntil = Math.min(this.validUntil, batch.validUntil);
            }
            for (const item of batch.items) {
                for (const [id, cached] of this.pool) {
                    if (id !== item.id && cached.postId === item.postId) this.pool.delete(id);
                }
                this.pool.set(item.id, item);
            }
            if (!batch.items.length) this.pool.clear();
            while (this.pool.size > this.MAX_CACHED_ITEMS) this.pool.delete(this.pool.keys().next().value);
            if (manual) this.ownItems.clear();
            const items = this.withOwnItems(batch.items);
            const unchanged = this.sameItems(items);
            this.data = items;
            this.loadFailed = false;
            this.render();
            this.setStatus(unchanged && !initial ? 'unchanged_notice' : '');
            if (manual) this.scrollToFirst(navigationEpoch);
        } catch (error) {
            if (version !== this.requestVersion) return;
            this.loadFailed = true;
            if (!this.data.length) this.showError();
            else this.setStatus('load_error');
        } finally {
            if (version === this.requestVersion) {
                this.isLoading = false;
                this.requestController = null;
                this.updateLabels();
            }
        }
    },

    sameItems(items) {
        return items.length === this.data.length && items.every(item => this.data.some(old => old.postId === item.postId));
    },

    shuffleCached({ clearOwn = false } = {}) {
        if (Date.now() >= (this.validUntil || 0)) {
            this.pool.clear();
            this.setStatus('unavailable');
            return false;
        }
        const current = new Set(this.data.map(item => item.postId));
        const latest = (this.latestPostIds || []).map(postId => [...this.pool.values()].find(item => item.postId === postId)).filter(Boolean);
        const latestIds = new Set(latest.map(item => item.postId));
        const others = [...this.pool.values()].filter(item => !latestIds.has(item.postId));
        const fresh = this.shuffled(others.filter(item => !current.has(item.postId)));
        if (!fresh.length) { this.setStatus('unchanged_notice'); return false; }
        const old = this.shuffled(others.filter(item => current.has(item.postId)));
        const candidates = [...latest, ...fresh, ...old].slice(0, this.MAX_ITEMS);
        const items = clearOwn ? candidates : this.withOwnItems(candidates);
        if (this.sameItems(items)) { this.setStatus('unchanged_notice'); return false; }
        if (clearOwn) this.ownItems.clear();
        if (items.length) { this.data = items; this.render(); }
        this.setStatus('cached_notice');
        return items.length > 0;
    },

    scrollToFirst(epoch) {
        if (epoch !== this.navigationEpoch || document.querySelector('.modal.active')) return;
        const section = (this.section || this.container).getBoundingClientRect();
        if (section.bottom <= 0 || section.top >= window.innerHeight) return;
        const bounds = this.container.getBoundingClientRect();
        const navHeight = document.querySelector('.site-nav')?.getBoundingClientRect().height || 0;
        window.scrollTo({ top: window.scrollY + bounds.top - navHeight - 12,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },

    showSkeleton() {
        for (let index = 0; index < this.MAX_ITEMS; index++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'gallery-skeleton';
            skeleton.setAttribute('aria-hidden', 'true');
            this.container.append(skeleton);
        }
        this.container.setAttribute('aria-busy', 'true');
    },

    protectHeight(action) {
        const previous = this.container.style.minHeight;
        this.container.style.minHeight = `${this.container.getBoundingClientRect().height}px`;
        try { action(); this.layout(); }
        finally { this.container.style.minHeight = previous; }
    },

    render({ prepend } = {}) {
        this.protectHeight(() => {
            const desired = new Map(this.data.map(item => [item.postId, item]));
            const pending = this.data.filter(item => !this.cards.has(item.postId));
            if (prepend && !this.cards.has(prepend)) {
                const index = pending.findIndex(item => item.postId === prepend);
                if (index !== -1) this.container.prepend(this.createCard(pending.splice(index, 1)[0]));
            }
            // Keep retained iframes in their original slots; moving an iframe can reload it.
            for (const [id, entry] of this.cards) {
                if (desired.has(id)) { this.updateCard(entry.article, desired.get(id)); continue; }
                entry.embed.destroy();
                this.resizeObserver?.unobserve(entry.article.firstElementChild);
                const next = pending.shift();
                if (next) entry.article.replaceWith(this.createCard(next));
                else entry.article.remove();
                this.cards.delete(id);
            }
            pending.forEach(item => this.container.append(this.createCard(item)));
            this.container.querySelectorAll('.gallery-skeleton, .no-content').forEach(item => item.remove());
            if (!this.data.length) {
                const empty = document.createElement('p');
                empty.className = 'no-content';
                empty.textContent = this.t('no_content');
                this.container.append(empty);
            }
            const ownOrder = [...new Set([...this.ownItems.keys()].reverse().concat(this.latestPostIds || []))];
            this.data.sort((left, right) => {
                const leftRank = ownOrder.indexOf(left.postId);
                const rightRank = ownOrder.indexOf(right.postId);
                return (leftRank === -1 ? ownOrder.length : leftRank) - (rightRank === -1 ? ownOrder.length : rightRank);
            });
            this.container.setAttribute('aria-busy', 'false');
        });
    },

    createCard(item) {
        const article = document.createElement('article');
        article.className = 'gallery-item';
        article.dataset.id = item.id;
        article.dataset.postId = item.postId;
        const card = document.createElement('div');
        card.className = 'gallery-card';
        const embed = document.createElement('div');
        embed.className = 'x-embed';
        const caption = document.createElement('p');
        caption.className = 'gallery-caption';
        const footer = document.createElement('div');
        footer.className = 'gallery-meta';
        const identity = document.createElement('p');
        identity.className = 'gallery-submitter';
        const date = document.createElement('time');
        footer.append(identity, date);
        if (window.Report) footer.insertAdjacentHTML('beforeend', window.Report.createReportButton(item.id, 'fanart'));
        card.append(embed, caption, footer);
        article.append(card);
        this.updateCard(article, item);
        this.cards.set(item.postId, { article, embed: window.XPost.mount(embed, item.postUrl, { lazy: true }) });
        this.resizeObserver?.observe(card);
        return article;
    },

    updateCard(article, item) {
        article.dataset.id = item.id;
        article.dataset.postId = item.postId;
        const report = article.querySelector('.report-btn');
        if (report) report.dataset.contentId = item.id;
        const caption = article.querySelector('.gallery-caption');
        caption.textContent = item.caption;
        caption.hidden = !item.caption;
        article.querySelector('.gallery-submitter').textContent = `${this.t('submitter')} · ${item.submitter || this.t('anonymous')}`;
        const date = article.querySelector('time');
        date.dateTime = item.createdAt.toISOString();
        date.textContent = item.createdAt.toLocaleDateString(window.i18n?.currentLang || 'ja');
    },

    layout() {
        const columns = parseInt(getComputedStyle(this.container).getPropertyValue('--gallery-columns'), 10) || 1;
        const items = [...this.container.querySelectorAll('.gallery-item')];
        const order = this.data.map(item => item.postId);
        // Place accepted/latest posts first without moving retained iframe nodes.
        items.sort((left, right) => {
            return order.indexOf(left.dataset.postId) - order.indexOf(right.dataset.postId);
        });
        // Keep occupied rows while measuring: an intermediate auto-placement can move the browser's scroll anchor.
        // A narrower breakpoint only needs invalid columns clamped so measurements use the new card width.
        items.forEach((item, index) => {
            const column = parseInt(item.style.gridColumn, 10);
            if (!column || column > columns) item.style.gridColumn = String(index % columns + 1);
        });
        const spans = items.map(item => Math.ceil((item.firstElementChild.getBoundingClientRect().height + 32) / 8));
        const rows = Array(columns).fill(1);
        items.forEach((item, index) => {
            const column = rows.indexOf(Math.min(...rows));
            item.style.gridColumn = String(column + 1);
            item.style.gridRow = `${rows[column]} / span ${spans[index]}`;
            rows[column] += spans[index];
        });
    },

    scheduleLayout() {
        if (!this.container || this.layoutFrame) return;
        this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = null;
            this.protectHeight(() => {});
        });
    },

    setStatus(key) {
        // A feed response can arrive before the asynchronous locale has loaded.
        this.statusKey = key;
        if (this.status) this.status.textContent = key ? this.t(key) : '';
    },

    showError() {
        this.container.setAttribute('aria-busy', 'false');
        this.container.querySelectorAll('.gallery-skeleton, .no-content').forEach(item => item.remove());
        const error = document.createElement('div');
        error.className = 'no-content';
        const message = document.createElement('p');
        message.textContent = this.t('load_error');
        const retry = document.createElement('button');
        retry.className = 'x-embed-retry';
        retry.type = 'button';
        retry.textContent = this.t('retry');
        retry.addEventListener('click', () => this.refresh());
        error.append(message, retry);
        this.container.append(error);
    },

    onLanguageChange() {
        if (!this.container) return;
        this.updateLabels();
        this.setStatus(this.statusKey || '');
        if (this.data.length) this.render();
        else if (this.loadFailed) this.showError();
        else if (!this.isLoading) this.render();
    },

    destroy() {
        this.unsubscribeFeed?.();
        this.requestController?.abort();
        this.cards.forEach(entry => entry.embed.destroy());
        this.cards.clear();
        this.resizeObserver?.disconnect();
        cancelAnimationFrame(this.layoutFrame);
    }
};

document.addEventListener('DOMContentLoaded', () => Gallery.init());
window.addEventListener('languageChanged', () => Gallery.onLanguageChange());
window.Gallery = Gallery;
