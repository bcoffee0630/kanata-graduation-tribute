/**
 * Submission Module
 * 投稿模組 - 處理留言和繪圖投稿
 */

const Submit = {
    messageModal: null,
    fanartModal: null,
    preview: null,
    isFanartSubmitting: false,
    returnFocus: null,
    previousOverflow: '',
    quota: null,
    quotaState: 'idle',
    quotaUid: null,
    quotaRequest: 0,

    // Form validation; daily quotas are enforced by the backend.
    limits: {
        messageMaxLength: 500,
        messageMinLength: 5
    },

    init() {
        const setup = () => {
            if (this.initialized) return;
            this.initialized = true;
            this.setupModals();
            this.setupEventListeners();
        };
        window.addEventListener('firebaseReady', setup);
        if (window.FirebaseApp?.getDb()) setup();
    },

    setupModals() {
        this.messageModal = document.getElementById('message-modal');
        this.fanartModal = document.getElementById('fanart-modal');
    },

    setupEventListeners() {
        // Message submit button
        const messageSubmitBtn = document.getElementById('submit-message-btn');
        if (messageSubmitBtn) {
            messageSubmitBtn.addEventListener('click', () => this.openMessageModal());
        }

        // Fanart submit button
        const fanartSubmitBtn = document.getElementById('submit-fanart-btn');
        if (fanartSubmitBtn) {
            fanartSubmitBtn.addEventListener('click', () => this.openFanartModal());
        }

        const submissionModals = [this.messageModal, this.fanartModal].filter(Boolean);
        submissionModals.forEach(modal => {
            modal.querySelectorAll('.modal-close').forEach(btn => {
                btn.addEventListener('click', () => this.closeAllModals());
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeAllModals();
                }
            });
        });

        // Message form submission
        const messageForm = document.getElementById('message-form');
        if (messageForm) {
            messageForm.addEventListener('submit', (e) => this.handleMessageSubmit(e));
        }

        // Fanart form submission
        const fanartForm = document.getElementById('fanart-form');
        if (fanartForm) {
            fanartForm.addEventListener('submit', (e) => this.handleFanartSubmit(e));
        }

        // Character counter for message
        const messageInput = document.getElementById('message-content');
        if (messageInput) {
            messageInput.addEventListener('input', () => this.updateCharCount());
        }

        document.getElementById('fanart-post-url')?.addEventListener('input', () => {
            this.clearPreview();
            this.clearFanartError();
            this.updateFanartSubmitState();
        });
        document.getElementById('fanart-caption')?.addEventListener('input', () => {
            this.clearFanartError();
            this.updateCaptionCount();
            this.updateFanartSubmitState();
        });
        document.getElementById('fanart-preview-btn')?.addEventListener('click', () => this.previewPost());
        document.addEventListener('keydown', (event) => this.handleModalKey(event));
        window.addEventListener('languageChanged', () => {
            this.renderQuota();
            this.updateFanartSubmitState();
            if (this.preview) this.previewPost();
            const close = this.fanartModal?.querySelector('.modal-close');
            close?.setAttribute('aria-label', window.i18n?.t('modal.close') || 'Close');
        });
        window.addEventListener('authStateChanged', (event) => {
            const uid = event.detail?.user?.uid || null;
            if (uid === this.quotaUid) return;
            this.quotaUid = uid;
            this.quotaRequest += 1;
            this.quota = null;
            this.quotaState = 'idle';
            this.renderQuota();
            if (uid && [this.messageModal, this.fanartModal].some(modal => modal?.classList.contains('active'))) {
                this.refreshQuota();
            }
        });

        // Confirmation checkbox validation
        this.setupConfirmationCheckboxes();
        this.fanartModal?.querySelector('.modal-close')?.setAttribute('aria-label', window.i18n?.t('modal.close') || 'Close');
    },

    setupConfirmationCheckboxes() {
        // Message modal
        const messageModal = document.getElementById('message-modal');
        if (messageModal) {
            const checkboxes = messageModal.querySelectorAll('.confirm-checkbox');
            const submitBtn = messageModal.querySelector('.submit-form-btn');
            const messageInput = document.getElementById('message-content');

            if (checkboxes.length > 0 && submitBtn) {
                const updateSubmitState = () => {
                    const allChecked = [...checkboxes].every(cb => cb.checked);
                    const contentLength = messageInput ? messageInput.value.trim().length : 0;
                    const hasEnoughContent = contentLength >= this.limits.messageMinLength;

                    // Determine why button is disabled and set tooltip
                    let tooltip = '';
                    if (contentLength === 0) {
                        tooltip = this.getValidationTooltip('message_empty');
                    } else if (!hasEnoughContent) {
                        tooltip = this.getValidationTooltip('message_too_short', this.limits.messageMinLength);
                    } else if (!allChecked) {
                        tooltip = this.getValidationTooltip('checkboxes_required');
                    }

                    submitBtn.disabled = !(allChecked && hasEnoughContent);
                    submitBtn.title = submitBtn.disabled ? tooltip : '';
                };

                checkboxes.forEach(cb => cb.addEventListener('change', updateSubmitState));
                if (messageInput) {
                    messageInput.addEventListener('input', updateSubmitState);
                }

                // Reset when modal opens
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach(mutation => {
                        if (mutation.attributeName === 'class' && messageModal.classList.contains('active')) {
                            checkboxes.forEach(cb => cb.checked = false);
                            submitBtn.disabled = true;
                            submitBtn.title = this.getValidationTooltip('message_empty');
                        }
                    });
                });
                observer.observe(messageModal, { attributes: true });
            }
        }

        this.fanartModal?.querySelectorAll('.confirm-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => this.updateFanartSubmitState());
        });
        this.updateFanartSubmitState();
    },

    updateFanartSubmitState() {
        const form = document.getElementById('fanart-form');
        const input = document.getElementById('fanart-post-url');
        if (!form || !input) return;
        const post = window.XPost.parseUrl(input.value);
        const error = document.getElementById('fanart-url-error');
        const valid = Boolean(post);
        const checked = [...form.querySelectorAll('.confirm-checkbox')].every(checkbox => checkbox.checked);
        const captionValid = (document.getElementById('fanart-caption')?.value || '').length <= 300;
        const message = this.getTranslation('invalid_post_url');
        input.setCustomValidity(input.value && !valid ? message : '');
        input.setAttribute('aria-invalid', input.value && !valid ? 'true' : 'false');
        error.textContent = input.value && !valid ? message : '';
        error.hidden = !input.value || valid;
        const button = form.querySelector('.submit-form-btn');
        button.disabled = this.isFanartSubmitting || !valid || !checked || !captionValid;
        button.title = !valid ? message : !checked ? this.getValidationTooltip('checkboxes_required') : '';
        document.getElementById('fanart-preview-btn').disabled = this.isFanartSubmitting || !valid;
    },

    updateCaptionCount() {
        const input = document.getElementById('fanart-caption');
        const count = document.getElementById('fanart-caption-count');
        if (input && count) count.textContent = `${input.value.length}/300`;
    },

    clearFanartError() {
        const error = document.getElementById('fanart-submit-error');
        if (error) { error.hidden = true; error.textContent = ''; }
    },

    getValidationTooltip(key, param) {
        const tooltips = {
            'ja': {
                message_empty: 'メッセージを入力してください',
                message_too_short: `最低${param}文字以上入力してください`,
                checkboxes_required: 'すべての確認項目にチェックしてください'
            },
            'zh-TW': {
                message_empty: '請輸入留言內容',
                message_too_short: `請輸入至少 ${param} 個字元`,
                checkboxes_required: '請勾選所有確認項目'
            },
            'en': {
                message_empty: 'Please enter a message',
                message_too_short: `Please enter at least ${param} characters`,
                checkboxes_required: 'Please check all confirmation items'
            }
        };

        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'ja';
        return tooltips[lang]?.[key] || tooltips['en'][key] || '';
    },

    openMessageModal() {
        if (!window.Auth.isLoggedIn()) { Toast.warning(this.getTranslation('login_required')); return; }
        this.openModal(this.messageModal);
        this.refreshQuota();
    },

    openFanartModal() {
        if (!window.Auth.isLoggedIn()) { Toast.warning(this.getTranslation('login_required')); return; }
        this.fanartModal?.querySelectorAll('.confirm-checkbox').forEach(checkbox => { checkbox.checked = false; });
        this.clearFanartError();
        this.updateFanartSubmitState();
        this.updateCaptionCount();
        this.openModal(this.fanartModal);
        this.refreshQuota();
    },

    async refreshQuota() {
        const uid = window.Auth.currentUser?.uid || null;
        const request = ++this.quotaRequest;
        this.quotaUid = uid;
        this.quota = null;
        this.quotaState = uid ? 'loading' : 'idle';
        this.renderQuota();
        if (!uid) return;
        try {
            const functions = window.FirebaseApp.getFunctions();
            if (!functions) throw new Error('Quota service unavailable');
            const { data } = await functions.httpsCallable('getMyContributionLimits')({});
            const valid = ['message', 'fanart'].every(type => {
                const value = data?.[type];
                return value && (value.limit === null || (Number.isSafeInteger(value.limit) && value.limit >= 0)) &&
                    Number.isSafeInteger(value.used) && value.used >= 0;
            });
            if (!valid || typeof data.dayKey !== 'string') throw new Error('Invalid quota response');
            if (request !== this.quotaRequest || uid !== window.Auth.currentUser?.uid) return;
            this.quota = data;
            this.quotaState = 'ready';
        } catch {
            if (request !== this.quotaRequest || uid !== window.Auth.currentUser?.uid) return;
            this.quotaState = 'error';
        }
        this.renderQuota();
    },

    renderQuota() {
        for (const type of ['message', 'fanart']) {
            const note = document.getElementById(`${type}-quota-note`);
            if (!note) continue;
            let key = this.quotaState === 'error' ? 'quota_unavailable' : 'quota_loading';
            let params = {};
            if (!window.Auth.currentUser?.uid) key = 'login_required';
            else if (this.quotaState === 'ready' && this.quotaUid === window.Auth.currentUser.uid) {
                const { limit, used } = this.quota[type];
                key = `quota_${type}_${limit === null ? 'unlimited' : limit === 0 ? 'closed' : 'limited'}`;
                params = { limit, used };
            }
            note.textContent = this.getTranslation(key, params);
        }
    },

    getQuotaError(error, contentType) {
        const details = error.details;
        if (details?.reason === 'daily_limit' && details.contentType === contentType &&
            Number.isSafeInteger(details.limit) && details.limit >= 0 &&
            Number.isSafeInteger(details.used) && details.used >= 0) {
            return this.getTranslation(`rate_limit_${contentType}_details`, details);
        }
        return this.getTranslation(`rate_limit_${contentType}`);
    },

    openModal(modal) {
        if (!modal) return;
        this.returnFocus = document.activeElement;
        this.previousOverflow = document.body.style.overflow;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        const initialFocus = modal.querySelector('input:not([type="checkbox"]), textarea') || modal.querySelector('.modal-close');
        // Opening visibility is immediate; flush it before moving keyboard focus.
        modal.getBoundingClientRect();
        initialFocus?.focus();
    },

    handleModalKey(event) {
        const modal = [this.messageModal, this.fanartModal].find(item => item?.classList.contains('active'));
        if (!modal) return;
        if (event.key === 'Escape') { event.preventDefault(); this.closeAllModals(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], iframe')]
            .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
            event.preventDefault(); first?.focus();
        }
    },

    closeAllModals() {
        const active = [this.messageModal, this.fanartModal].filter(modal => modal?.classList.contains('active'));
        if (!active.length) return;
        active.forEach(modal => { modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); });
        this.clearPreview();
        document.body.style.overflow = this.previousOverflow;
        this.returnFocus?.focus();
        this.returnFocus = null;
    },

    updateCharCount() {
        const input = document.getElementById('message-content');
        const counter = document.getElementById('char-count');
        if (input && counter) {
            const count = input.value.length;
            counter.textContent = `${count}/${this.limits.messageMaxLength}`;
            counter.classList.toggle('limit-warning', count > this.limits.messageMaxLength * 0.9);
            counter.classList.toggle('limit-exceeded', count > this.limits.messageMaxLength);
        }
    },

    previewPost() {
        const post = window.XPost.parseUrl(document.getElementById('fanart-post-url')?.value);
        if (!post) return;
        this.clearPreview();
        const container = document.getElementById('fanart-preview');
        container.hidden = false;
        this.preview = window.XPost.mount(container, post.postUrl);
    },

    clearPreview() {
        this.preview?.destroy();
        this.preview = null;
        const container = document.getElementById('fanart-preview');
        if (container) { container.hidden = true; container.replaceChildren(); }
    },

    async handleMessageSubmit(e) {
        e.preventDefault();

        if (!window.Auth.isLoggedIn()) {
            Toast.warning(this.getTranslation('login_required'));
            return;
        }

        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;

        try {
            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
            submitBtn.textContent = this.getTranslation('submitting');

            const content = document.getElementById('message-content').value.trim();

            // Validate
            if (!content) {
                throw new Error(this.getTranslation('empty_message'));
            }
            if (content.length < this.limits.messageMinLength) {
                throw new Error(this.getTranslation('message_too_short'));
            }
            if (content.length > this.limits.messageMaxLength) {
                throw new Error(this.getTranslation('message_too_long'));
            }

            const functions = window.FirebaseApp.getFunctions();
            if (!functions) throw new Error(this.getTranslation('submit_error'));
            const submitMessage = functions.httpsCallable('submitMessage');
            const result = await submitMessage({ content });
            try { window.Danmaku?.onSubmission?.(result.data?.item); } catch { /* The shared feed will retry rendering. */ }

            // Success
            Toast.success(this.getTranslation('message_submitted'));
            form.reset();
            this.closeAllModals();
            this.refreshQuota();

        } catch (error) {
            console.error('Message submission error:', error);
            const code = String(error.code || '');
            const message = error.details?.reason === 'burst_limit'
                ? this.getTranslation('burst_limit')
                : code.includes('unavailable')
                ? this.getTranslation('site_maintenance')
                : code.includes('resource-exhausted')
                ? this.getQuotaError(error, 'message')
                : code.includes('permission-denied')
                    ? this.getTranslation('account_restricted')
                    : error.message || this.getTranslation('submit_error');
            Toast.error(message);
        } finally {
            submitBtn.disabled = true; // Keep disabled until checkboxes are checked again
            submitBtn.classList.remove('loading');
            submitBtn.textContent = originalText;
        }
    },

    async handleFanartSubmit(e) {
        e.preventDefault();
        if (this.isFanartSubmitting) return;
        if (!window.Auth.isLoggedIn()) { Toast.warning(this.getTranslation('login_required')); return; }
        const form = e.target;
        const post = window.XPost.parseUrl(document.getElementById('fanart-post-url').value);
        const caption = document.getElementById('fanart-caption').value.trim();
        const checked = [...form.querySelectorAll('.confirm-checkbox')].every(checkbox => checkbox.checked);
        this.updateFanartSubmitState();
        if (!post || caption.length > 300 || !checked || !form.reportValidity()) return;
        const button = form.querySelector('button[type="submit"]');
        this.isFanartSubmitting = true;
        this.clearFanartError();
        this.updateFanartSubmitState();
        button.classList.add('loading');
        button.textContent = this.getTranslation('submitting');
        try {
            const functions = window.FirebaseApp.getFunctions();
            if (!functions) throw new Error(this.getTranslation('submit_error'));
            const result = await functions.httpsCallable('submitFanartLink')({ postUrl: post.postUrl, caption });
            Toast.success(this.getTranslation('fanart_submitted'));
            form.reset();
            this.updateCaptionCount();
            this.closeAllModals();
            this.refreshQuota();
            try { window.Gallery?.onSubmission?.(result.data?.item); } catch { /* The accepted post remains in the shared feed. */ }
            window.dispatchEvent(new CustomEvent('fanartSubmitted', { detail: { id: result.data.id } }));
        } catch (error) {
            const code = String(error.code || '');
            const reasons = {
                invalid_post_url: 'invalid_post_url', post_unavailable: 'post_unavailable',
                x_service_unavailable: 'x_service_unavailable', duplicate_post: 'duplicate_post'
            };
            const key = reasons[error.details?.reason] || (
                code.includes('already-exists') ? 'duplicate_post' :
                code.includes('unavailable') ? 'site_maintenance' :
                code.includes('resource-exhausted') ? 'rate_limit_fanart' :
                code.includes('permission-denied') ? 'account_restricted' :
                code.includes('unauthenticated') ? 'login_required' : 'submit_error'
            );
            const message = error.details?.reason === 'burst_limit'
                ? this.getTranslation('burst_limit')
                : code.includes('resource-exhausted')
                ? this.getQuotaError(error, 'fanart') : this.getTranslation(key);
            const alert = document.getElementById('fanart-submit-error');
            alert.textContent = message;
            alert.hidden = false;
            Toast.error(message);
        } finally {
            this.isFanartSubmitting = false;
            button.classList.remove('loading');
            button.textContent = window.i18n?.t('modal.submit') || 'Submit';
            this.updateFanartSubmitState();
        }
    },

    getTranslation(key, params = {}) {
        const localized = window.i18n?.t(`submit.${key}`, params);
        if (localized && localized !== `submit.${key}`) return localized;
        const translations = {
            'ja': {
                login_required: 'ログインが必要です',
                submitting: '送信中...',
                empty_message: 'メッセージを入力してください',
                message_too_short: `最低${this.limits.messageMinLength}文字以上入力してください`,
                message_too_long: 'メッセージが長すぎます',
                message_submitted: 'メッセージを投稿しました！',
                fanart_submitted: 'イラストを投稿しました！',
                submit_error: '投稿に失敗しました。もう一度お試しください。',
                site_maintenance: 'メンテナンス中のため、現在は投稿できません。',
                account_restricted: 'このアカウントは現在投稿できません。',
                rate_limit_message: '本日のメッセージ投稿上限に達しました。',
                rate_limit_fanart: '本日の投稿上限に達しました。'
            },
            'zh-TW': {
                login_required: '請先登入',
                submitting: '送出中...',
                empty_message: '請輸入留言內容',
                message_too_short: `請輸入至少 ${this.limits.messageMinLength} 個字元`,
                message_too_long: '留言內容過長',
                message_submitted: '留言已送出！',
                fanart_submitted: '繪圖已送出！',
                submit_error: '送出失敗，請再試一次。',
                site_maintenance: '網站維護中，目前無法投稿。',
                account_restricted: '此帳號目前無法投稿。',
                rate_limit_message: '今日已達留言上限。',
                rate_limit_fanart: '今日已達投稿上限。'
            },
            'en': {
                login_required: 'Please log in first',
                submitting: 'Submitting...',
                empty_message: 'Please enter a message',
                message_too_short: `Please enter at least ${this.limits.messageMinLength} characters`,
                message_too_long: 'Message is too long',
                message_submitted: 'Message submitted!',
                fanart_submitted: 'Fan art submitted!',
                submit_error: 'Submission failed. Please try again.',
                site_maintenance: 'The site is under maintenance and is temporarily read-only.',
                account_restricted: 'This account cannot submit content right now.',
                rate_limit_message: 'Today’s message limit has been reached.',
                rate_limit_fanart: 'Today’s post limit has been reached.',
                quota_loading: 'Checking today’s submission allowance…',
                quota_unavailable: 'Today’s allowance is temporarily unavailable. It will be checked when you submit.',
                quota_message_limited: 'Up to {{limit}} messages per day; {{used}} used today.',
                quota_message_unlimited: 'No daily message limit; {{used}} used today.',
                quota_message_closed: 'New messages are currently disabled; {{used}} used today.',
                quota_fanart_limited: 'Up to {{limit}} posts per day; {{used}} used today.',
                quota_fanart_unlimited: 'No daily post limit; {{used}} used today.',
                quota_fanart_closed: 'New posts are currently disabled; {{used}} used today.',
                rate_limit_message_details: 'Today’s message limit has been reached ({{limit}} per day; {{used}} used).',
                rate_limit_fanart_details: 'Today’s post limit has been reached ({{limit}} per day; {{used}} used).'
            }
        };

        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'ja';
        const template = translations[lang]?.[key] || translations['en'][key] || key;
        return template.replace(/\{\{(\w+)\}\}/g, (match, name) => params[name] ?? match);
    }
};

// Initialize
Submit.init();

// Export
window.Submit = Submit;
