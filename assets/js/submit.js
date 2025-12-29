/**
 * Submission Module
 * 投稿模組 - 處理留言和繪圖投稿
 */

const Submit = {
    messageModal: null,
    fanartModal: null,

    // Rate limiting
    limits: {
        messagesPerDay: 10,
        fanartPerDay: 3,
        messageMaxLength: 500
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

            const language = document.getElementById('message-language').value;
            const content = document.getElementById('message-content').value.trim();

            // Validate
            if (!content) {
                throw new Error(this.getTranslation('empty_message'));
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
                authorLink: `https://github.com/${user.displayName || ''}`,
                authorAvatar: user.photoURL || '',
                language: language,
                content: content,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                reported: false,
                reportCount: 0
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
            submitBtn.disabled = false;
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
            const captionJa = document.getElementById('caption-ja')?.value.trim() || '';
            const captionZh = document.getElementById('caption-zh')?.value.trim() || '';
            const captionEn = document.getElementById('caption-en')?.value.trim() || '';
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
                artistLink: artistLink || `https://github.com/${user.displayName || ''}`,
                artistAvatar: user.photoURL || '',
                imagePath: path,
                imageUrl: imageUrl,
                caption: {
                    ja: captionJa,
                    'zh-TW': captionZh,
                    en: captionEn
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                reported: false,
                reportCount: 0
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
            submitBtn.disabled = false;
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
                message_too_long: 'メッセージが長すぎます',
                no_image: '画像を選択してください',
                invalid_image_type: 'PNG または JPG 画像のみ対応しています',
                image_too_large: '画像サイズは10MB以下にしてください',
                message_submitted: 'メッセージを投稿しました！',
                fanart_submitted: 'イラストを投稿しました！',
                submit_error: '投稿に失敗しました。もう一度お試しください。',
                rate_limit_message: '本日の投稿上限に達しました（1日10件まで）',
                rate_limit_fanart: '本日の投稿上限に達しました（1日3件まで）'
            },
            'zh-TW': {
                login_required: '請先登入',
                submitting: '送出中...',
                uploading: '上傳中...',
                empty_message: '請輸入留言內容',
                message_too_long: '留言內容過長',
                no_image: '請選擇圖片',
                invalid_image_type: '僅支援 PNG 或 JPG 圖片',
                image_too_large: '圖片大小請小於 10MB',
                message_submitted: '留言已送出！',
                fanart_submitted: '繪圖已送出！',
                submit_error: '送出失敗，請再試一次。',
                rate_limit_message: '今日已達投稿上限（每日10則）',
                rate_limit_fanart: '今日已達投稿上限（每日3張）'
            },
            'en': {
                login_required: 'Please log in first',
                submitting: 'Submitting...',
                uploading: 'Uploading...',
                empty_message: 'Please enter a message',
                message_too_long: 'Message is too long',
                no_image: 'Please select an image',
                invalid_image_type: 'Only PNG or JPG images are supported',
                image_too_large: 'Image size must be under 10MB',
                message_submitted: 'Message submitted!',
                fanart_submitted: 'Fan art submitted!',
                submit_error: 'Submission failed. Please try again.',
                rate_limit_message: 'Daily limit reached (10 messages per day)',
                rate_limit_fanart: 'Daily limit reached (3 images per day)'
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
