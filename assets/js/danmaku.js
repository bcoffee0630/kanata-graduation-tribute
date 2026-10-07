/**
 * Danmaku (bullet comments) system for fan messages
 * Reads the bounded public snapshot; visitors never subscribe to Firestore.
 */

const Danmaku = {
    data: null,
    container: null,
    tracks: [],
    trackCount: 5,
    isPaused: false,
    messageQueue: [],
    currentIndex: 0,
    animationInterval: null,
    baseSpeed: 15000, // Base duration in ms for message to cross screen
    usePublicSnapshot: false,
    validUntil: 0,
    isLoading: false,
    selectedMessage: null, // Currently selected message for reporting

    async init() {
        this.container = document.getElementById('danmaku-container');
        if (!this.container) return;
        this.setupTracks();
        this.setupControls();
        this.priorityQueue = [];
        this.pendingOwn = new Map();
        this.seenIds = new Set();
        this.status = document.createElement('p');
        this.status.className = 'danmaku-status';
        this.status.setAttribute('role', 'status');
        this.status.hidden = true;
        document.getElementById('danmaku-controls')?.after(this.status);
        this.visibilityHandler = () => {
            this.updateAnimationPause();
            if (!document.hidden) this.tryPriority();
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
        this.unsubscribe = window.PublicFeedWatcher?.subscribe('messages', state => this.onFeedVersion(state));
        await this.loadSnapshot();
    },

    onFeedVersion(state) {
        if (this.expectedVersion && Number(state.version) < Number(this.expectedVersion)) return;
        this.expectedVersion = state.version;
        if (state.version === this.version) {
            this.validUntil = state.validUntil;
            this.scheduleExpiry();
            this.renderStatus();
        } else {
            // A known newer revision invalidates public replay immediately, including moderation removals.
            this.validUntil = 0;
            this.messageQueue = [];
            this.priorityQueue = (this.priorityQueue || []).filter(item => this.pendingOwn.has(item.id));
            if (window.PublicFeedWatcher?.isVisible('messages')) this.loadSnapshot(state.version);
        }
    },

    validItem(item) {
        return item && typeof item.id === 'string' && item.id.length <= 150 &&
            typeof item.author === 'string' && typeof item.content === 'string' &&
            item.content.length > 0 && item.content.length <= 500;
    },

    async loadSnapshot(version) {
        if (this.isLoading || this.destroyed || Date.now() < (this.nextRetryAt || 0)) return;
        this.isLoading = true;
        this.abortController = new AbortController();
        const timeout = setTimeout(() => this.abortController?.abort(), 10_000);
        try {
            const query = version ? `?version=${encodeURIComponent(version)}` : '';
            const response = await fetch(`/api/messages${query}`, {
                credentials: 'omit', signal: this.abortController.signal
            });
            const body = await response.text();
            if (body.length > 512 * 1024) throw new Error('Message snapshot exceeds its limit');
            const snapshot = JSON.parse(body);
            if (!response.ok || typeof snapshot.version !== 'string' || !/^\d{1,30}$/.test(snapshot.version) ||
                !Number.isFinite(snapshot.generatedAt) || snapshot.generatedAt > Date.now() + 60_000 ||
                !Number.isFinite(snapshot.validUntil) || snapshot.validUntil <= Date.now() ||
                snapshot.validUntil > Date.now() + 5 * 60_000 ||
                !Array.isArray(snapshot.items) || snapshot.items.length > 100) {
                throw new Error('Message snapshot unavailable');
            }
            if (this.expectedVersion && Number(snapshot.version) < Number(this.expectedVersion)) {
                this.pendingVersionLoad = true;
                return;
            }
            const ids = new Set();
            const messages = snapshot.items.filter(item => {
                if (!this.validItem(item) || ids.has(item.id)) return false;
                ids.add(item.id); return true;
            });
            if (this.destroyed) return;
            this.validUntil = snapshot.validUntil;
            this.applyMessages(messages, snapshot);
            this.version = snapshot.version;
            this.expectedVersion = snapshot.version;
            this.usePublicSnapshot = true;
            this.failed = false;
            this.failures = 0;
            this.nextRetryAt = 0;
            this.createReportControl(document.getElementById('danmaku-controls'));
            this.start();
            this.scheduleExpiry();
            this.renderStatus();
        } catch {
            this.failed = true;
            this.failures = (this.failures || 0) + 1;
            this.nextRetryAt = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(this.failures, 5));
            this.renderStatus();
        } finally {
            clearTimeout(timeout);
            this.isLoading = false;
            clearTimeout(this.retryTimer);
            if (this.pendingVersionLoad && !this.destroyed) {
                this.pendingVersionLoad = false;
                this.retryTimer = setTimeout(() => {
                    if (window.PublicFeedWatcher?.isVisible('messages')) this.loadSnapshot(this.expectedVersion);
                }, Math.max(0, (this.nextRetryAt || 0) - Date.now()));
            } else if (this.failed && !this.destroyed) {
                this.retryTimer = setTimeout(() => {
                    if (window.PublicFeedWatcher?.isVisible('messages')) {
                        this.loadSnapshot(window.PublicFeedWatcher.getState('messages')?.version);
                    }
                }, Math.max(0, this.nextRetryAt - Date.now()));
            }
        }
    },

    applyMessages(messages, metadata) {
        const first = !this.data;
        const publicIds = new Set(messages.map(item => item.id));
        this.sourceIds = publicIds;
        for (const [id, own] of this.pendingOwn) {
            if (publicIds.has(id) || own.expiresAt <= Date.now() ||
                (metadata?.generatedAt >= own.acceptedAt && metadata?.version !== own.baseVersion)) {
                this.pendingOwn.delete(id);
            }
        }
        const merged = [...this.pendingOwn.values()].map(own => own.item)
            .concat(messages).slice(0, 100);
        const byId = new Map(merged.map(item => [item.id, item]));
        const added = merged.filter(item => !this.seenIds.has(item.id));
        this.data = { messages: merged };
        if (first) this.messageQueue = this.shuffleArray([...merged]);
        else {
            // Keep the unfinished cycle and active DOM animations when a snapshot changes.
            this.messageQueue = this.messageQueue.filter(item => byId.has(item.id)).map(item => byId.get(item.id));
            this.priorityQueue = this.priorityQueue.filter(item => byId.has(item.id)).map(item => byId.get(item.id));
            const queued = new Set(this.priorityQueue.map(item => item.id));
            added.forEach(item => { if (!queued.has(item.id)) this.priorityQueue.push(item); });
        }
        merged.forEach(item => this.seenIds.add(item.id));
        if (this.seenIds.size > 300) this.seenIds = new Set([...this.seenIds].slice(-200));
        this.tryPriority();
    },

    onSubmission(item) {
        if (!this.validItem(item) || this.destroyed) return;
        this.pendingOwn.set(item.id, { item, acceptedAt: Date.now(), baseVersion: this.expectedVersion || this.version,
            expiresAt: Date.now() + 5 * 60_000 });
        this.data = { messages: [item, ...(this.data?.messages || []).filter(existing => existing.id !== item.id)].slice(0, 100) };
        if (!this.seenIds.has(item.id)) this.priorityQueue.unshift(item);
        this.seenIds.add(item.id);
        this.usePublicSnapshot = true;
        this.createReportControl(document.getElementById('danmaku-controls'));
        this.start();
        this.tryPriority();
    },

    scheduleExpiry() {
        clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(() => this.renderStatus(), Math.max(0, this.validUntil - Date.now()));
    },

    tryPriority() {
        if (!this.isPaused && !document.hidden && this.priorityQueue?.length) this.spawnMessage();
    },

    expireOwnItems() {
        const removed = new Set();
        for (const [id, own] of this.pendingOwn) {
            if (own.expiresAt <= Date.now()) {
                this.pendingOwn.delete(id);
                if (!this.sourceIds?.has(id)) removed.add(id);
            }
        }
        if (!removed.size) return;
        if (this.data) this.data.messages = this.data.messages.filter(item => !removed.has(item.id));
        this.messageQueue = this.messageQueue.filter(item => !removed.has(item.id));
        this.priorityQueue = this.priorityQueue.filter(item => !removed.has(item.id));
    },

    updateAnimationPause() {
        const paused = this.isPaused || document.hidden;
        if (paused && !this.pausedAt) this.pausedAt = Date.now();
        if (!paused && this.pausedAt) {
            const elapsed = Date.now() - this.pausedAt;
            this.tracks = this.tracks.map(time => time + elapsed);
            this.pausedAt = 0;
        }
        this.container?.querySelectorAll('.danmaku-message').forEach(el => {
            el.style.animationPlayState = paused || this.selectedMessage?.element === el ? 'paused' : 'running';
        });
    },

    renderStatus() {
        if (!this.status) return;
        const show = this.failed ||
            (this.validUntil > 0 && this.validUntil <= Date.now());
        const labels = {
            'zh-TW': '留言更新暫時停止，已開啟的內容仍可閱讀。',
            ja: 'メッセージの更新は一時停止中です。開いている内容は引き続き読めます。',
            en: 'Message updates are temporarily paused. Content already opened remains readable.'
        };
        this.status.hidden = !show;
        this.status.textContent = show ? labels[window.i18n?.currentLang] || labels.en : '';
    },

    setupTracks() {
        // Initialize track availability
        this.tracks = Array(this.trackCount).fill(0);

        // Create track container
        const trackContainer = document.createElement('div');
        trackContainer.className = 'danmaku-tracks';
        this.container.appendChild(trackContainer);
    },

    setupControls() {
        const controls = document.getElementById('danmaku-controls');
        const playPauseBtn = document.getElementById('danmaku-play-pause');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => this.togglePause());
        }
        this.renderControlState();

        // Create report button (hidden by default)
        if (this.usePublicSnapshot && window.Report) {
            this.createReportControl(controls);
        }

        // Click outside to deselect
        document.addEventListener('click', (e) => {
            if (this.selectedMessage &&
                !e.target.closest('.danmaku-message') &&
                !e.target.closest('.danmaku-report-btn')) {
                this.deselectMessage();
            }
        });
    },

    createReportControl(controls) {
        if (!controls || !window.Report) return;
        // Check if already exists
        if (controls.querySelector('.danmaku-report-btn')) return;

        const reportBtn = document.createElement('button');
        reportBtn.className = 'danmaku-report-btn';
        reportBtn.style.display = 'none';
        reportBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM8 4a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8 4z"/>
            </svg>
        `;
        reportBtn.title = this.getReportLabel();
        reportBtn.addEventListener('click', () => this.reportSelectedMessage());
        controls.appendChild(reportBtn);
    },

    getReportLabel() {
        const labels = {
            'ja': '報告',
            'zh-TW': '檢舉',
            'en': 'Report'
        };
        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';
        return labels[lang] || labels['en'];
    },

    selectMessage(messageId, element) {
        // Deselect previous
        this.deselectMessage();

        this.selectedMessage = { id: messageId, element };
        element.classList.add('selected');
        element.style.animationPlayState = 'paused';

        // Show report button
        const reportBtn = document.querySelector('.danmaku-report-btn');
        if (reportBtn) {
            reportBtn.style.display = 'flex';
        }
    },

    deselectMessage() {
        if (this.selectedMessage) {
            this.selectedMessage.element.classList.remove('selected');
            if (!this.isPaused && !document.hidden) {
                this.selectedMessage.element.style.animationPlayState = 'running';
            }
            this.selectedMessage = null;
        }

        // Hide report button
        const reportBtn = document.querySelector('.danmaku-report-btn');
        if (reportBtn) {
            reportBtn.style.display = 'none';
        }
    },

    async reportSelectedMessage() {
        if (!this.selectedMessage || !window.Report) return;

        await window.Report.handleReport(this.selectedMessage.id, 'message');
        this.deselectMessage();
    },

    start() {
        if (this.animationInterval || this.destroyed) return;
        this.nextRegularAt = Date.now();
        this.animationInterval = setInterval(() => this.spawnMessage(), 250);
        this.spawnMessage();
    },

    stop() {
        clearInterval(this.animationInterval);
        this.animationInterval = null;
    },

    togglePause() {
        this.isPaused = !this.isPaused;
        this.renderControlState();
        this.updateAnimationPause();
        this.tryPriority();
    },

    renderControlState() {
        const button = document.getElementById('danmaku-play-pause');
        if (!button) return;
        const pauseIcon = button.querySelector('[data-danmaku-icon="pause"]');
        const playIcon = button.querySelector('[data-danmaku-icon="play"]');
        if (pauseIcon) pauseIcon.toggleAttribute('hidden', this.isPaused);
        if (playIcon) playIcon.toggleAttribute('hidden', !this.isPaused);
        const key = this.isPaused ? 'danmaku.play_label' : 'danmaku.pause_label';
        const labels = {
            'zh-TW': this.isPaused ? '繼續留言' : '暫停留言',
            ja: this.isPaused ? 'メッセージを再開' : 'メッセージを一時停止',
            en: this.isPaused ? 'Resume messages' : 'Pause messages'
        };
        const translated = window.i18n?.t?.(key);
        const label = typeof translated === 'string' && translated !== key && translated.trim()
            ? translated : labels[window.i18n?.currentLang] || labels.en;
        button.setAttribute('aria-pressed', String(this.isPaused));
        button.setAttribute('aria-label', label);
        const tooltip = document.getElementById('danmaku-play-pause-tooltip');
        if (tooltip) tooltip.textContent = label;
    },

    spawnMessage() {
        if (this.destroyed || this.isPaused || document.hidden) return;
        this.expireOwnItems();
        const now = Date.now();
        const trackIndex = this.tracks.findIndex(time => time <= now);
        if (trackIndex < 0) return;
        this.priorityQueue = this.priorityQueue.filter(item => this.validUntil > now ||
            (this.pendingOwn.get(item.id)?.expiresAt || 0) > now);
        let message;
        if (this.priorityQueue.length) {
            message = this.priorityQueue.shift();
            this.messageQueue = this.messageQueue.filter(item => item.id !== message.id);
        } else {
            if (this.validUntil <= now || this.nextRegularAt > now) return;
            if (!this.messageQueue.length) this.messageQueue = this.shuffleArray([...(this.data?.messages || [])]);
            message = this.messageQueue.shift();
        }
        if (!message) return;
        const count = this.data?.messages?.length || 0;
        this.nextRegularAt = now + (count <= 3 ? 8000 : count <= 10 ? 5000 : count <= 30 ? 3500 : 2500);

        // Create message element - show all messages regardless of language
        const content = message.content;

        // Skip if no content
        if (!content) return;

        const el = document.createElement('div');
        el.className = 'danmaku-message';
        el.style.setProperty('--track', trackIndex);

        // Store message ID for reporting
        if (message.id) {
            el.dataset.messageId = message.id;
        }

        el.innerHTML = `
            <span class="danmaku-author">${this.escapeHtml(message.author)}:</span>
            <span class="danmaku-text">${this.escapeHtml(content)}</span>
        `;

        if (this.usePublicSnapshot && message.id) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectMessage(message.id, el);
            });
            el.style.cursor = 'pointer';
        }

        // Calculate animation duration based on content length
        const duration = this.baseSpeed + (content.length * 50);
        el.style.animationDuration = `${duration}ms`;

        // Reserve track
        this.tracks[trackIndex] = now + 4000; // 4 second gap between messages on same track

        // Add to container
        const trackContainer = this.container.querySelector('.danmaku-tracks');
        if (trackContainer) {
            trackContainer.appendChild(el);

            // Remove element after animation
            el.addEventListener('animationend', () => {
                // If this is the selected message, deselect it
                if (this.selectedMessage?.element === el) {
                    this.deselectMessage();
                }
                el.remove();
            });
        }
    },

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    // Update messages when language changes
    onLanguageChange() {
        this.renderStatus();
        this.renderControlState();
        const reportButton = document.querySelector('.danmaku-report-btn');
        if (reportButton) reportButton.title = this.getReportLabel();
    },

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Cleanup when leaving page
    destroy() {
        this.destroyed = true;
        this.stop();
        this.abortController?.abort();
        clearTimeout(this.retryTimer);
        clearTimeout(this.expiryTimer);
        this.unsubscribe?.();
        document.removeEventListener('visibilitychange', this.visibilityHandler);

    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Danmaku.init();
});

// Update on language change (i18n dispatches on window)
window.addEventListener('languageChanged', () => {
    Danmaku.onLanguageChange();
});

window.Danmaku = Danmaku;
