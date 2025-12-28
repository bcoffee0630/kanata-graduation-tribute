class I18n {
    constructor() {
        this.currentLang = this.getStoredLanguage() || this.detectLanguage();
        this.translations = {};
        this.init();
    }

    detectLanguage() {
        const browserLang = navigator.language || navigator.userLanguage;
        
        if (browserLang.startsWith('ja')) return 'ja';
        if (browserLang.startsWith('zh')) return 'zh-TW';
        return 'en';
    }

    getStoredLanguage() {
        return localStorage.getItem('preferred-language');
    }

    async init() {
        await this.loadLanguage(this.currentLang);
        this.updateLanguageButtons();
    }

    async loadLanguage(lang) {
        try {
            const response = await fetch(`assets/locales/${lang}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load language: ${lang}`);
            }
            this.translations = await response.json();
            this.currentLang = lang;
            localStorage.setItem('preferred-language', lang);
            this.updatePageContent();
            this.updateHtmlLang();
            this.updateLanguageButtons();
            
            // Trigger custom event for other scripts
            window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
        } catch (error) {
            console.error('Failed to load language:', lang, error);
            if (lang !== 'en') {
                this.loadLanguage('en');
            }
        }
    }

    updateHtmlLang() {
        document.documentElement.lang = this.currentLang;
    }

    updateLanguageButtons() {
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-lang') === this.currentLang) {
                btn.classList.add('active');
            }
        });
    }

    t(key, params = {}) {
        const keys = key.split('.');
        let value = this.translations;
        
        for (const k of keys) {
            value = value[k];
            if (!value) return key;
        }
        
        // Replace parameters
        Object.keys(params).forEach(param => {
            value = value.replace(`{{${param}}}`, params[param]);
        });
        
        return value;
    }

    updatePageContent() {
        // Update elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            element.textContent = this.t(key);
        });

        // Update elements with data-i18n-placeholder attribute
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            element.placeholder = this.t(key);
        });

        // Update page title
        document.title = this.t('site_title');
    }

    switchLanguage(lang) {
        this.loadLanguage(lang);
    }
}

// Initialize i18n
const i18n = new I18n();