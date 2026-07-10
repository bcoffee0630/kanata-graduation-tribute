const AdminI18n = {
    currentLang: 'zh-TW',
    messages: {},
    initialized: false,

    detectLanguage() {
        const stored = localStorage.getItem('kanata-admin-language');
        if (['zh-TW', 'ja', 'en'].includes(stored)) return stored;
        const browser = navigator.language || 'en';
        if (browser.startsWith('ja')) return 'ja';
        if (browser.startsWith('zh')) return 'zh-TW';
        return 'en';
    },

    async init() {
        if (this.initialized) return;
        this.currentLang = this.detectLanguage();
        await this.load(this.currentLang);
        document.querySelectorAll('[data-language-select]').forEach((select) => {
            select.value = this.currentLang;
            select.addEventListener('change', () => this.setLanguage(select.value));
        });
        this.initialized = true;
    },

    async load(lang) {
        const response = await fetch(`locales/${lang}.json`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Admin locale failed (${response.status})`);
        this.messages = await response.json();
        this.currentLang = lang;
        document.documentElement.lang = lang;
        localStorage.setItem('kanata-admin-language', lang);
        document.querySelectorAll('[data-language-select]').forEach((select) => {
            select.value = lang;
        });
        this.apply(document);
    },

    async setLanguage(lang) {
        if (!['zh-TW', 'ja', 'en'].includes(lang) || lang === this.currentLang) return;
        await this.load(lang);
        window.dispatchEvent(new CustomEvent('adminLanguageChanged', { detail: { lang } }));
    },

    t(path, replacements = {}) {
        const value = path.split('.').reduce((current, key) => current?.[key], this.messages);
        const text = typeof value === 'string' ? value : path;
        return Object.entries(replacements).reduce(
            (result, [key, replacement]) => result.replaceAll(`{${key}}`, String(replacement)),
            text
        );
    },

    apply(root = document) {
        root.querySelectorAll('[data-admin-i18n]').forEach((element) => {
            element.textContent = this.t(element.dataset.adminI18n);
        });
        root.querySelectorAll('[data-admin-i18n-title]').forEach((element) => {
            element.title = this.t(element.dataset.adminI18nTitle);
            element.setAttribute('aria-label', this.t(element.dataset.adminI18nTitle));
        });
    }
};

window.AdminI18n = AdminI18n;
