/**
 * Submission Module
 * 投稿模組 - 處理留言和繪圖投稿
 */

const Submit = {
    messageModal: null,
    fanartModal: null,

    // Rate limiting
    limits: {
        messagesPerDay: 3,
        fanartPerDay: 2,
        messageMaxLength: 500,
        messageMinLength: 5
    },

    init() {
        window.addEventListener('firebaseReady', () => {
            this.setupModals();
            this.setupEventListeners();
        });
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

        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => this.closeAllModals());
        });

        // Close on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
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

        // Image preview
        const imageInput = document.getElementById('fanart-image');
        if (imageInput) {
            imageInput.addEventListener('change', (e) => this.previewImage(e));
        }

        // Confirmation checkbox validation
        this.setupConfirmationCheckboxes();
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

        // Fanart modal
        const fanartModal = document.getElementById('fanart-modal');
        if (fanartModal) {
            const checkboxes = fanartModal.querySelectorAll('.confirm-checkbox');
            const submitBtn = fanartModal.querySelector('.submit-form-btn');
            const imageInput = document.getElementById('fanart-image');

            if (checkboxes.length > 0 && submitBtn) {
                const updateSubmitState = () => {
                    const allChecked = [...checkboxes].every(cb => cb.checked);
                    const hasImage = imageInput && imageInput.files && imageInput.files.length > 0;

                    // Determine why button is disabled and set tooltip
                    let tooltip = '';
                    if (!hasImage) {
                        tooltip = this.getValidationTooltip('image_required');
                    } else if (!allChecked) {
                        tooltip = this.getValidationTooltip('checkboxes_required');
                    }

                    submitBtn.disabled = !(allChecked && hasImage);
                    submitBtn.title = submitBtn.disabled ? tooltip : '';
                };

                checkboxes.forEach(cb => cb.addEventListener('change', updateSubmitState));
                if (imageInput) {
                    imageInput.addEventListener('change', updateSubmitState);
                }

                // Reset when modal opens
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach(mutation => {
                        if (mutation.attributeName === 'class' && fanartModal.classList.contains('active')) {
                            checkboxes.forEach(cb => cb.checked = false);
                            submitBtn.disabled = true;
                            submitBtn.title = this.getValidationTooltip('image_required');
                        }
                    });
                });
                observer.observe(fanartModal, { attributes: true });
            }
        }
    },

    getValidationTooltip(key, param) {
        const tooltips = {
            'ja': {
                message_empty: 'メッセージを入力してください',
                message_too_short: `最低${param}文字以上入力してください`,
                image_required: '画像を選択してください',
                checkboxes_required: 'すべての確認項目にチェックしてください'
            },
            'zh-TW': {
                message_empty: '請輸入留言內容',
                message_too_short: `請輸入至少 ${param} 個字元`,
                image_required: '請選擇圖片',
                checkboxes_required: '請勾選所有確認項目'
            },
            'en': {
                message_empty: 'Please enter a message',
                message_too_short: `Please enter at least ${param} characters`,
                image_required: 'Please select an image',
                checkboxes_required: 'Please check all confirmation items'
            }
        };

        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'ja';
        return tooltips[lang]?.[key] || tooltips['en'][key] || '';
    },

    openMessageModal() {
        if (!window.Auth.isLoggedIn()) {
            alert(this.getTranslation('login_required'));
            return;
        }
        if (this.messageModal) {
            this.messageModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    },

    openFanartModal() {
        if (!window.Auth.isLoggedIn()) {
            alert(this.getTranslation('login_required'));
            return;
        }
        if (this.fanartModal) {
            this.fanartModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    },

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
        document.body.style.overflow = '';
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

    previewImage(e) {
        const file = e.target.files[0];
        const preview = document.getElementById('image-preview');

        if (file && preview) {
            // Validate file type
            if (!file.type.match(/^image\/(png|jpeg|jpg)$/)) {
                alert(this.getTranslation('invalid_image_type'));
                e.target.value = '';
                return;
            }

            // Validate file size (10MB max)
            if (file.size > 10 * 1024 * 1024) {
                alert(this.getTranslation('image_too_large'));
                e.target.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                preview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    },

    async handleMessageSubmit(e) {
        e.preventDefault();

        if (!window.Auth.isLoggedIn()) {
            alert(this.getTranslation('login_required'));
            return;
        }

        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;

        try {
            submitBtn.disabled = true;
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

            // Check rate limit
            await this.checkMessageRateLimit();

            // Submit to Firestore
            const db = window.FirebaseApp.getDb();
            const user = window.Auth.getUser();

            await db.collection('messages').add({
                author: user.displayName || 'Anonymous',
                authorId: user.uid,
                authorLink: window.Auth.getProfileLink() || '',
                authorAvatar: user.photoURL || '',
                authorProvider: window.Auth.getProviderId() || '',
                content: content,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                reported: false,
                reportCount: 0,
                reportedBy: [],
                hidden: false
            });

            // Update user stats
            await this.updateUserStats('message');

            // Success
            alert(this.getTranslation('message_submitted'));
            form.reset();
            this.closeAllModals();

            // Refresh danmaku
            if (window.Danmaku) {
                window.Danmaku.loadFromFirestore();
            }

        } catch (error) {
            console.error('Message submission error:', error);
            alert(error.message || this.getTranslation('submit_error'));
        } finally {
            submitBtn.disabled = true; // Keep disabled until checkboxes are checked again
            submitBtn.textContent = originalText;
        }
    },

    async handleFanartSubmit(e) {
        e.preventDefault();

        if (!window.Auth.isLoggedIn()) {
            alert(this.getTranslation('login_required'));
            return;
        }

        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = this.getTranslation('uploading');

            const imageInput = document.getElementById('fanart-image');
            const caption = document.getElementById('fanart-caption')?.value.trim() || '';
            const artistLink = document.getElementById('artist-link')?.value.trim() || '';

            if (!imageInput.files[0]) {
                throw new Error(this.getTranslation('no_image'));
            }

            // Check rate limit
            await this.checkFanartRateLimit();

            const file = imageInput.files[0];
            const user = window.Auth.getUser();

            // Upload image to Storage
            const storage = window.FirebaseApp.getStorage();
            const timestamp = Date.now();
            const ext = file.name.split('.').pop();
            const filename = `${timestamp}.${ext}`;
            const path = `fanart/${user.uid}/${filename}`;

            const uploadTask = storage.ref(path).put(file);

            // Wait for upload
            await uploadTask;

            // Get download URL
            const imageUrl = await storage.ref(path).getDownloadURL();

            // Submit to Firestore
            const db = window.FirebaseApp.getDb();

            await db.collection('fanart').add({
                artist: user.displayName || 'Anonymous',
                artistId: user.uid,
                artistLink: artistLink || window.Auth.getProfileLink() || '',
                artistAvatar: user.photoURL || '',
                artistProvider: window.Auth.getProviderId() || '',
                imagePath: path,
                imageUrl: imageUrl,
                caption: caption,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                reported: false,
                reportCount: 0,
                reportedBy: [],
                hidden: false
            });

            // Update user stats
            await this.updateUserStats('fanart');

            // Success
            alert(this.getTranslation('fanart_submitted'));
            form.reset();
            document.getElementById('image-preview').style.display = 'none';
            this.closeAllModals();

            // Refresh gallery
            if (window.Gallery) {
                window.Gallery.loadFromFirestore();
            }

        } catch (error) {
            console.error('Fanart submission error:', error);
            alert(error.message || this.getTranslation('submit_error'));
        } finally {
            submitBtn.disabled = true; // Keep disabled until checkboxes are checked again
            submitBtn.textContent = originalText;
        }
    },

    async checkMessageRateLimit() {
        const db = window.FirebaseApp.getDb();
        const userId = window.Auth.getUserId();

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Reset daily count if new day
        if (!userData.dailyResetAt || userData.dailyResetAt.toDate() < todayStart) {
            return; // New day, no limit yet
        }

        if (userData.dailyMessageCount >= this.limits.messagesPerDay) {
            throw new Error(this.getTranslation('rate_limit_message'));
        }
    },

    async checkFanartRateLimit() {
        const db = window.FirebaseApp.getDb();
        const userId = window.Auth.getUserId();

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Reset daily count if new day
        if (!userData.dailyResetAt || userData.dailyResetAt.toDate() < todayStart) {
            return; // New day, no limit yet
        }

        if (userData.dailyFanartCount >= this.limits.fanartPerDay) {
            throw new Error(this.getTranslation('rate_limit_fanart'));
        }
    },

    async updateUserStats(type) {
        const db = window.FirebaseApp.getDb();
        const userId = window.Auth.getUserId();
        const user = window.Auth.getUser();

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        const userData = userDoc.data() || {};

        // Check if we need to reset daily counts
        const needsReset = !userData.dailyResetAt ||
            userData.dailyResetAt.toDate() < todayStart;

        const updates = {
            username: user.displayName || 'Anonymous',
            avatarUrl: user.photoURL || ''
        };

        if (type === 'message') {
            updates.messageCount = firebase.firestore.FieldValue.increment(1);
            updates.lastMessageAt = firebase.firestore.FieldValue.serverTimestamp();
            updates.dailyMessageCount = needsReset ? 1 :
                firebase.firestore.FieldValue.increment(1);
        } else if (type === 'fanart') {
            updates.fanartCount = firebase.firestore.FieldValue.increment(1);
            updates.lastFanartAt = firebase.firestore.FieldValue.serverTimestamp();
            updates.dailyFanartCount = needsReset ? 1 :
                firebase.firestore.FieldValue.increment(1);
        }

        if (needsReset) {
            updates.dailyResetAt = firebase.firestore.FieldValue.serverTimestamp();
            if (type === 'message') {
                updates.dailyFanartCount = 0;
            } else {
                updates.dailyMessageCount = 0;
            }
        }

        await userRef.set(updates, { merge: true });
    },

    getTranslation(key) {
        const translations = {
            'ja': {
                login_required: 'ログインが必要です',
                submitting: '送信中...',
                uploading: 'アップロード中...',
                empty_message: 'メッセージを入力してください',
                message_too_short: `最低${this.limits.messageMinLength}文字以上入力してください`,
                message_too_long: 'メッセージが長すぎます',
                no_image: '画像を選択してください',
                invalid_image_type: 'PNG または JPG 画像のみ対応しています',
                image_too_large: '画像サイズは10MB以下にしてください',
                message_submitted: 'メッセージを投稿しました！',
                fanart_submitted: 'イラストを投稿しました！',
                submit_error: '投稿に失敗しました。もう一度お試しください。',
                rate_limit_message: '本日の投稿上限に達しました（1日3件まで）',
                rate_limit_fanart: '本日の投稿上限に達しました（1日2件まで）'
            },
            'zh-TW': {
                login_required: '請先登入',
                submitting: '送出中...',
                uploading: '上傳中...',
                empty_message: '請輸入留言內容',
                message_too_short: `請輸入至少 ${this.limits.messageMinLength} 個字元`,
                message_too_long: '留言內容過長',
                no_image: '請選擇圖片',
                invalid_image_type: '僅支援 PNG 或 JPG 圖片',
                image_too_large: '圖片大小請小於 10MB',
                message_submitted: '留言已送出！',
                fanart_submitted: '繪圖已送出！',
                submit_error: '送出失敗，請再試一次。',
                rate_limit_message: '今日已達投稿上限（每日3則）',
                rate_limit_fanart: '今日已達投稿上限（每日2張）'
            },
            'en': {
                login_required: 'Please log in first',
                submitting: 'Submitting...',
                uploading: 'Uploading...',
                empty_message: 'Please enter a message',
                message_too_short: `Please enter at least ${this.limits.messageMinLength} characters`,
                message_too_long: 'Message is too long',
                no_image: 'Please select an image',
                invalid_image_type: 'Only PNG or JPG images are supported',
                image_too_large: 'Image size must be under 10MB',
                message_submitted: 'Message submitted!',
                fanart_submitted: 'Fan art submitted!',
                submit_error: 'Submission failed. Please try again.',
                rate_limit_message: 'Daily limit reached (3 messages per day)',
                rate_limit_fanart: 'Daily limit reached (2 images per day)'
            }
        };

        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'ja';
        return translations[lang]?.[key] || translations['en'][key] || key;
    }
};

// Initialize
Submit.init();

// Export
window.Submit = Submit;
