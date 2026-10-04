/** Public X-post gallery with cursor pagination and natural-height masonry. */
const Gallery = {
    PAGE_SIZE: 20,
    data: [],
    lastDoc: null,
    hasMore: false,
    isLoading: false,
    requestVersion: 0,
    embeds: [],
    displaySize: 'standard',
    DISPLAY_STORAGE_KEY: 'gallery-display-size',

    init() {
        this.container = document.getElementById('gallery-grid');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.status = document.getElementById('gallery-status');
        if (!this.container) return;
        this.initDisplayControls();
        this.loadMoreBtn?.addEventListener('click', () => this.loadMore());
        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => this.scheduleLayout());
            this.resizeObserver.observe(this.container);
        }
        window.addEventListener('resize', () => this.scheduleLayout());
        window.addEventListener('firebaseReady', () => this.loadFromFirestore());
        window.addEventListener('firebaseError', () => this.showError());
        this.showSkeleton();
        if (window.FirebaseApp?.getDb()) this.loadFromFirestore();
    },

    initDisplayControls() {
        this.displayControls = document.getElementById('gallery-display-controls');
        let storedSize;
        try { storedSize = localStorage.getItem(this.DISPLAY_STORAGE_KEY); } catch {}
        this.setDisplaySize(storedSize);
        this.displayControls?.addEventListener('change', event => {
            const input = event.target;
            if (input.matches('input[name="gallery-display-size"]') && input.checked) {
                this.setDisplaySize(input.value, { persist: true, notify: true });
            }
        });
    },

    setDisplaySize(size, { persist = false, notify = false } = {}) {
        const nextSize = size === 'compact' ? 'compact' : 'standard';
        const changed = nextSize !== this.displaySize;
        this.displaySize = nextSize;
        this.container.dataset.displaySize = this.displaySize;
        if (this.displayControls) {
            this.displayControls.dataset.displaySize = this.displaySize;
            this.displayControls.querySelectorAll('input[name="gallery-display-size"]').forEach(input => {
                input.checked = input.value === this.displaySize;
            });
        }
        if (persist) {
            try { localStorage.setItem(this.DISPLAY_STORAGE_KEY, this.displaySize); } catch {}
        }
        if (notify && changed && typeof Toast !== 'undefined') {
            if (this.sizeToast) Toast.dismiss(this.sizeToast);
            this.sizeToast = this.displaySize === 'compact' ? Toast.info(this.t('display_compact_notice')) : null;
        }
        this.scheduleLayout();
    },

    t(key) {
        const translated = window.i18n?.t(`gallery.${key}`);
        return translated && translated !== `gallery.${key}` ? translated : {
            no_content: 'まだ投稿がありません', load_error: 'ギャラリーを読み込めませんでした。',
            submitter: '投稿者', anonymous: '匿名', retry: '再読み込み',
            display_compact_notice: '小さめ表示に切り替えました。画面の縦横比によっては、見た目に大きな違いがない場合があります。'
        }[key] || key;
    },

    query() {
        return window.FirebaseApp.getDb().collection('fanart')
            .where('sourceType', '==', 'x')
            .where('hidden', '==', false)
            .where('deleted', '==', false)
            .orderBy('createdAt', 'desc');
    },

    items(snapshot) {
        return snapshot.docs.flatMap(doc => {
            const data = doc.data();
            const post = window.XPost.parseUrl(data.postUrl);
            if (data.sourceType !== 'x' || data.hidden || data.deleted || !post || post.postId !== data.postId) return [];
            return [{ id: doc.id, ...post, caption: data.caption || '',
                submitter: data.submitter?.displayName || data.artist || this.t('anonymous'),
                createdAt: data.createdAt?.toDate?.() }];
        });
    },

    async loadFromFirestore() {
        if (!this.container || !window.FirebaseApp?.getDb()) return;
        const version = ++this.requestVersion;
        this.isLoading = true;
        this.updateLoadMoreButton();
        this.setStatus('');
        try {
            const snapshot = await this.query().limit(this.PAGE_SIZE).get();
            if (version !== this.requestVersion) return;
            this.lastDoc = snapshot.docs.at(-1) || null;
            this.hasMore = snapshot.docs.length === this.PAGE_SIZE;
            this.data = this.items(snapshot);
            this.loadFailed = false;
            this.render();
        } catch (error) {
            if (version !== this.requestVersion) return;
            console.error('Failed to load X gallery:', error);
            this.showError();
        } finally {
            if (version === this.requestVersion) {
                this.isLoading = false;
                this.updateLoadMoreButton();
                this.applyPendingLanguage();
            }
        }
    },

    async loadMore() {
        if (this.isLoading || !this.hasMore || !this.lastDoc) return;
        const version = this.requestVersion;
        this.isLoading = true;
        this.setStatus('');
        this.updateLoadMoreButton();
        try {
            const snapshot = await this.query().startAfter(this.lastDoc).limit(this.PAGE_SIZE).get();
            if (version !== this.requestVersion) return;
            this.lastDoc = snapshot.docs.at(-1) || this.lastDoc;
            this.hasMore = snapshot.docs.length === this.PAGE_SIZE;
            const existing = new Set(this.data.map(item => item.id));
            const items = this.items(snapshot).filter(item => !existing.has(item.id));
            this.data.push(...items);
            this.appendItems(items);
        } catch (error) {
            if (version === this.requestVersion) this.setStatus(this.t('load_error'));
            console.error('Failed to load more X posts:', error);
        } finally {
            if (version === this.requestVersion) {
                this.isLoading = false;
                this.updateLoadMoreButton();
                this.applyPendingLanguage();
            }
        }
    },

    showSkeleton() {
        this.container.replaceChildren();
        for (let index = 0; index < 4; index++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'gallery-skeleton';
            skeleton.setAttribute('aria-hidden', 'true');
            this.container.append(skeleton);
        }
        this.container.setAttribute('aria-busy', 'true');
    },

    render() {
        this.clearEmbeds();
        this.container.replaceChildren();
        this.container.setAttribute('aria-busy', 'false');
        if (this.data.length) this.appendItems(this.data);
        else {
            const empty = document.createElement('p');
            empty.className = 'no-content';
            empty.textContent = this.t('no_content');
            this.container.append(empty);
        }
    },

    appendItems(items) {
        items.forEach(item => {
            const article = document.createElement('article');
            article.className = 'gallery-item';
            article.dataset.postId = item.postId;
            const card = document.createElement('div');
            card.className = 'gallery-card';
            const embed = document.createElement('div');
            embed.className = 'x-embed';
            card.append(embed);
            if (item.caption) {
                const caption = document.createElement('p');
                caption.className = 'gallery-caption';
                caption.textContent = item.caption;
                card.append(caption);
            }
            const footer = document.createElement('div');
            footer.className = 'gallery-meta';
            const identity = document.createElement('p');
            identity.className = 'gallery-submitter';
            identity.textContent = `${this.t('submitter')} · ${item.submitter}`;
            footer.append(identity);
            if (item.createdAt) {
                const date = document.createElement('time');
                date.dateTime = item.createdAt.toISOString();
                date.textContent = item.createdAt.toLocaleDateString(window.i18n?.currentLang || 'ja');
                footer.append(date);
            }
            if (window.Report) footer.insertAdjacentHTML('beforeend', window.Report.createReportButton(item.id, 'fanart'));
            card.append(footer);
            article.append(card);
            this.container.append(article);
            this.resizeObserver?.observe(card);
            this.embeds.push(window.XPost.mount(embed, item.postUrl, { lazy: true }));
        });
        this.scheduleLayout();
    },

    scheduleLayout() {
        if (this.layoutFrame) return;
        this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = null;
            const columns = parseInt(getComputedStyle(this.container).getPropertyValue('--gallery-columns'), 10) || 1;
            const items = [...this.container.querySelectorAll('.gallery-item')];
            // Remove positions from the previous mode before measuring the new column widths.
            items.forEach(item => {
                item.style.removeProperty('grid-column');
                item.style.removeProperty('grid-row');
            });
            const spans = items.map(item => Math.ceil((item.firstElementChild.getBoundingClientRect().height + 32) / 8));
            const rows = Array(columns).fill(1);
            items.forEach((item, index) => {
                const column = rows.indexOf(Math.min(...rows));
                const span = spans[index];
                item.style.gridColumn = String(column + 1);
                item.style.gridRow = `${rows[column]} / span ${span}`;
                rows[column] += span;
            });
        });
    },

    updateLoadMoreButton() {
        if (!this.loadMoreBtn) return;
        this.loadMoreBtn.style.display = this.hasMore ? 'block' : 'none';
        this.loadMoreBtn.disabled = this.isLoading;
        this.loadMoreBtn.classList.toggle('loading', this.isLoading);
    },

    setStatus(message) { if (this.status) this.status.textContent = message; },

    showError() {
        if (!this.container) return;
        this.loadFailed = true;
        this.clearEmbeds();
        this.container.replaceChildren();
        this.container.setAttribute('aria-busy', 'false');
        const error = document.createElement('div');
        error.className = 'no-content';
        const message = document.createElement('p');
        message.textContent = this.t('load_error');
        const retry = document.createElement('button');
        retry.className = 'x-embed-retry';
        retry.textContent = this.t('retry');
        retry.type = 'button';
        retry.addEventListener('click', () => this.loadFromFirestore());
        error.append(message, retry);
        this.container.append(error);
        this.hasMore = false;
        this.updateLoadMoreButton();
    },

    onLanguageChange() {
        if (!this.container) return;
        if (this.isLoading) { this.pendingLanguage = true; return; }
        if (this.loadFailed) this.showError(); else this.render();
    },

    applyPendingLanguage() {
        if (!this.pendingLanguage) return;
        this.pendingLanguage = false;
        this.onLanguageChange();
    },

    clearEmbeds() {
        this.embeds.forEach(embed => embed.destroy());
        this.embeds = [];
        this.container?.querySelectorAll('.gallery-card').forEach(card => this.resizeObserver?.unobserve(card));
    },

    destroy() { this.clearEmbeds(); this.resizeObserver?.disconnect(); cancelAnimationFrame(this.layoutFrame); }
};

document.addEventListener('DOMContentLoaded', () => Gallery.init());
window.addEventListener('languageChanged', () => Gallery.onLanguageChange());
window.Gallery = Gallery;
