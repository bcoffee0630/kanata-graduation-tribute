const ActionPage = {
    auth: null,
    code: '',
    language: 'zh-TW',
    descriptionKey: 'checking',
    resultKey: '',
    resultIsError: false,
    formErrorKey: '',
    messages: {
        'zh-TW': {
            brand: '天音彼方紀念站', eyebrow: '治理中心', title: '設定新密碼',
            checking: '正在驗證重設連結...', ready: '請為管理員帳號設定新的登入密碼。',
            password: '新密碼', confirmPassword: '確認新密碼',
            policy: '至少 12 字元，並包含大小寫英文字母、數字與符號。', submit: '更新密碼',
            back: '返回後台登入', mismatch: '兩次輸入的密碼不一致。', weak: '密碼不符合安全要求。',
            invalid: '這個重設連結無效或已過期，請返回後台重新申請。',
            success: '密碼已更新。請返回後台，以新密碼登入。', failed: '無法更新密碼，請重新申請重設連結。'
        },
        ja: {
            brand: '天音かなた記念サイト', eyebrow: '管理センター', title: '新しいパスワードを設定',
            checking: 'リセットリンクを確認しています...', ready: '管理者アカウントの新しいパスワードを設定してください。',
            password: '新しいパスワード', confirmPassword: 'パスワードの確認',
            policy: '12文字以上で、大文字・小文字・数字・記号を含めてください。', submit: 'パスワードを更新',
            back: '管理画面のログインへ戻る', mismatch: '入力したパスワードが一致しません。', weak: 'パスワードが要件を満たしていません。',
            invalid: 'このリセットリンクは無効か期限切れです。管理画面から再度お試しください。',
            success: 'パスワードを更新しました。新しいパスワードでログインしてください。', failed: 'パスワードを更新できませんでした。新しいリセットリンクを申請してください。'
        },
        en: {
            brand: 'Amane Kanata Memorial', eyebrow: 'Governance center', title: 'Set a new password',
            checking: 'Verifying the reset link...', ready: 'Set a new sign-in password for the administrator account.',
            password: 'New password', confirmPassword: 'Confirm new password',
            policy: 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.', submit: 'Update password',
            back: 'Return to administrator sign-in', mismatch: 'The passwords do not match.', weak: 'The password does not meet the security requirements.',
            invalid: 'This reset link is invalid or expired. Request a new link from the administrator sign-in page.',
            success: 'The password has been updated. Return to the administrator site and sign in with it.', failed: 'The password could not be updated. Request a new reset link.'
        }
    },

    t(key) {
        return this.messages[this.language]?.[key] || this.messages.en[key] || key;
    },

    adminPath() {
        return window.location.pathname.startsWith('/admin/') ? '/admin/' : '/';
    },

    applyLanguage() {
        document.documentElement.lang = this.language;
        document.getElementById('action-language').value = this.language;
        document.querySelectorAll('[data-action-i18n]').forEach((node) => {
            node.textContent = this.t(node.dataset.actionI18n);
        });
        document.getElementById('action-description').textContent = this.t(this.descriptionKey);
        if (this.resultKey) this.showResult(this.resultKey, this.resultIsError);
        if (this.formErrorKey) this.showFormError(this.formErrorKey);
        document.title = `${this.t('title')} | ${this.t('brand')}`;
        if (this.auth) this.auth.languageCode = this.language;
    },

    setDescription(key) {
        this.descriptionKey = key;
        document.getElementById('action-description').textContent = this.t(key);
    },

    showResult(key, isError = false) {
        const result = document.getElementById('action-result');
        this.resultKey = key;
        this.resultIsError = isError;
        result.textContent = this.t(key);
        result.classList.remove('is-hidden');
        result.classList.toggle('is-error', isError);
    },

    showFormError(key = '') {
        this.formErrorKey = key;
        document.getElementById('action-error').textContent = key ? this.t(key) : '';
    },

    validPassword(value) {
        const allowedSymbols = "^$*.[]{}()?\"!@#%&/\\,><':;|_~`";
        return value.length >= 12 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
            /[0-9]/.test(value) && [...value].some((character) => allowedSymbols.includes(character));
    },

    async init() {
        const params = new URLSearchParams(window.location.search);
        const requestedLanguage = params.get('lang') ||
            localStorage.getItem('kanata-admin-language') || navigator.language;
        this.language = requestedLanguage?.startsWith('ja')
            ? 'ja'
            : requestedLanguage?.startsWith('zh') ? 'zh-TW' : 'en';
        const adminPath = this.adminPath();
        document.getElementById('back-to-admin').href = adminPath;
        document.getElementById('brand-link').href = adminPath;
        this.applyLanguage();

        document.getElementById('action-language').addEventListener('change', (event) => {
            this.language = event.target.value;
            localStorage.setItem('kanata-admin-language', this.language);
            this.applyLanguage();
        });
        document.getElementById('reset-form').addEventListener('submit', (event) => this.submit(event));

        try {
            await window.FirebaseApp.init();
            this.auth = window.FirebaseApp.getAuth();
            this.auth.languageCode = this.language;
            this.code = params.get('oobCode') || '';
            if (params.get('mode') !== 'resetPassword' || !this.code) throw new Error('invalid action');
            const email = await this.auth.verifyPasswordResetCode(this.code);
            this.setDescription('ready');
            const emailNode = document.getElementById('action-email');
            emailNode.textContent = email;
            emailNode.classList.remove('is-hidden');
            document.getElementById('reset-form').classList.remove('is-hidden');
        } catch (error) {
            console.error('Password reset verification failed:', error);
            this.setDescription('invalid');
            this.showResult('invalid', true);
        }
    },

    async submit(event) {
        event.preventDefault();
        const password = document.getElementById('new-password').value;
        const confirmation = document.getElementById('confirm-password').value;
        const submit = document.getElementById('reset-submit');
        this.showFormError();
        if (!this.validPassword(password)) {
            this.showFormError('weak');
            return;
        }
        if (password !== confirmation) {
            this.showFormError('mismatch');
            return;
        }

        submit.disabled = true;
        try {
            await this.auth.confirmPasswordReset(this.code, password);
            document.getElementById('reset-form').classList.add('is-hidden');
            this.setDescription('success');
            this.showResult('success');
        } catch (error) {
            console.error('Password reset confirmation failed:', error);
            this.showFormError('failed');
        } finally {
            submit.disabled = false;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => ActionPage.init());
