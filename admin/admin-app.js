const AdminApp = {
    state: {
        user: null,
        role: null,
        view: 'dashboard',
        contentType: 'message',
        contentVisibility: 'all',
        contentAuthorUid: '',
        contentDateFrom: '',
        contentDateTo: '',
        reportStatus: 'all',
        reportType: 'all',
        userQuery: '',
        userPageToken: null,
        userResults: [],
        detailUserUid: null
    },
    refs: {},
    auth: null,
    db: null,
    functions: null,
    modalResolver: null,
    toastTimer: null,
    mediaObjectUrls: [],
    userDetailRequest: 0,
    contributionDefaultsRequest: 0,

    async init() {
        try {
            this.cacheRefs();
            await window.AdminI18n.init();
            await window.FirebaseApp.init();
            this.auth = window.FirebaseApp.getAuth();
            this.db = window.FirebaseApp.getDb();
            this.functions = window.FirebaseApp.getFunctions();
            this.syncAuthLanguage();
            this.bindEvents();
            this.refreshIcons();
            this.auth.onAuthStateChanged((user) => this.handleAuthState(user));
        } catch (error) {
            console.error('Admin initialization failed:', error);
            this.refs.loading.textContent = window.AdminI18n?.t('errors.load') || 'Initialization failed';
        }
    },

    cacheRefs() {
        this.refs = {
            loading: document.getElementById('admin-loading'),
            authView: document.getElementById('auth-view'),
            accessView: document.getElementById('access-view'),
            app: document.getElementById('admin-app'),
            main: document.getElementById('admin-main'),
            viewTitle: document.getElementById('view-title'),
            role: document.getElementById('admin-role'),
            identity: document.getElementById('admin-identity'),
            drawer: document.getElementById('detail-drawer'),
            drawerTitle: document.getElementById('drawer-title'),
            drawerContent: document.getElementById('drawer-content'),
            drawerBackdrop: document.getElementById('drawer-backdrop'),
            modal: document.getElementById('admin-modal'),
            modalTitle: document.getElementById('admin-modal-title'),
            modalForm: document.getElementById('admin-modal-form'),
            toast: document.getElementById('admin-toast')
        };
    },

    bindEvents() {
        document.getElementById('login-form').addEventListener('submit', (event) => this.signIn(event));
        document.getElementById('forgot-password').addEventListener('click', () => this.resetPassword());
        document.getElementById('logout-button-admin').addEventListener('click', () => this.auth.signOut());
        document.getElementById('access-logout').addEventListener('click', () => this.auth.signOut());
        document.getElementById('link-google').addEventListener('click', () => this.linkGoogleAccount());
        document.getElementById('bootstrap-owner').addEventListener('click', () => this.bootstrapOwner());
        this.sidebarMedia = window.matchMedia('(max-width: 760px)');
        document.getElementById('sidebar-collapse').addEventListener('click', () => {
            if (this.sidebarMedia.matches) this.setMobileNavigation(false);
            else {
                this.refs.app.classList.toggle('sidebar-collapsed');
                this.syncNavigationChrome();
            }
        });
        document.getElementById('mobile-menu').addEventListener('click', () => {
            this.setMobileNavigation(!this.refs.app.classList.contains('mobile-nav-open'));
        });
        this.sidebarMedia.addEventListener('change', () => {
            const mobileToggleFocused = document.activeElement === document.getElementById('mobile-menu');
            this.setMobileNavigation(false);
            if (!this.sidebarMedia.matches && mobileToggleFocused) {
                document.getElementById('sidebar-collapse').focus({ preventScroll: true });
            }
        });
        document.querySelectorAll('[data-view]').forEach((button) => {
            button.addEventListener('click', () => this.setView(button.dataset.view));
        });
        document.getElementById('drawer-close').addEventListener('click', () => this.closeDrawer());
        this.refs.drawerBackdrop.addEventListener('click', () => this.closeDrawer());
        document.getElementById('admin-modal-close').addEventListener('click', () => this.closeModal(null));
        this.refs.modal.addEventListener('click', (event) => {
            if (event.target === this.refs.modal) this.closeModal(null);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                if (this.refs.modal.classList.contains('is-open')) this.closeModal(null);
                else if (this.refs.drawer.classList.contains('is-open')) this.closeDrawer();
                else if (this.sidebarMedia.matches && this.refs.app.classList.contains('mobile-nav-open')) {
                    this.setMobileNavigation(false);
                }
            }
        });
        window.addEventListener('adminLanguageChanged', () => {
            this.syncAuthLanguage();
            if (this.state.role) this.renderView();
            if (this.state.detailUserUid && this.refs.drawer.classList.contains('is-open')) {
                this.openUser(this.state.detailUserUid);
            }
            this.updateChrome();
        });
        this.syncNavigationChrome();
    },

    setMobileNavigation(open) {
        const sidebar = document.getElementById('admin-sidebar');
        const returnFocus = this.sidebarMedia.matches && !open && sidebar.contains(document.activeElement);
        this.refs.app.classList.toggle('mobile-nav-open', open);
        this.syncNavigationChrome();
        if (returnFocus) document.getElementById('mobile-menu').focus({ preventScroll: true });
        if (open && this.sidebarMedia.matches) {
            sidebar.querySelector('.nav-item:not(.is-hidden)')?.focus({ preventScroll: true });
        }
    },

    syncNavigationChrome() {
        const mobile = this.sidebarMedia.matches;
        const open = this.refs.app.classList.contains('mobile-nav-open');
        const collapsed = this.refs.app.classList.contains('sidebar-collapsed');
        const sidebar = document.getElementById('admin-sidebar');
        sidebar.inert = mobile && !open;
        sidebar.setAttribute('aria-hidden', String(mobile && !open));
        const toggle = document.getElementById('sidebar-collapse');
        const key = mobile ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse';
        const label = this.t(key);
        toggle.title = label;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-expanded', String(mobile ? open : !collapsed));
        const text = toggle.querySelector('span');
        text.dataset.adminI18n = key;
        text.textContent = label;
        const icon = document.createElement('i');
        icon.dataset.lucide = !mobile && collapsed ? 'panel-left-open' : 'panel-left-close';
        icon.setAttribute('aria-hidden', 'true');
        toggle.querySelector('svg, i[data-lucide]')?.replaceWith(icon);
        const mobileToggle = document.getElementById('mobile-menu');
        mobileToggle.setAttribute('aria-expanded', String(mobile && open));
        mobileToggle.setAttribute('aria-label', this.t(mobile && open ? 'nav.close' : 'nav.open'));
        document.querySelectorAll('.admin-nav .nav-item').forEach((item) => {
            const label = item.querySelector('[data-admin-i18n]')?.textContent || '';
            item.setAttribute('aria-label', label);
            item.title = label;
        });
        this.refreshIcons();
    },

    syncAuthLanguage() {
        if (this.auth) this.auth.languageCode = window.AdminI18n.currentLang;
    },

    passwordResetSettings() {
        const adminSiteIds = [
            'eienkanata-admin',
            'kanata-memorial-governance',
            'eienkanata-governance'
        ];
        const hostedAtRoot = window.location.hostname === 'admin.eienkanata.com' ||
            adminSiteIds.some((siteId) => window.location.hostname.startsWith(siteId));
        const path = hostedAtRoot ? '/' : '/admin/';
        return { url: new URL(path, window.location.origin).toString(), handleCodeInApp: false };
    },

    t(key, replacements) {
        return window.AdminI18n.t(key, replacements);
    },

    refreshIcons() {
        if (window.lucide) window.lucide.createIcons();
    },

    el(tag, className = '', text = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== '') element.textContent = String(text);
        return element;
    },

    xPostLink(item) {
        if (item.deleted || item.sourceType !== 'x') return null;
        try {
            const url = new URL(item.postUrl);
            const match = url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d+)$/);
            if (url.protocol !== 'https:' || url.hostname !== 'x.com' || url.port ||
                url.username || url.password || !match || match[1] !== item.postId) return null;
            const link = this.el('a', 'secondary-command', this.t('content.xOriginalLink'));
            link.href = `${url.origin}${url.pathname}`;
            link.target = '_blank';
            // Open the original without loading third-party scripts in the admin session.
            link.rel = 'noopener noreferrer';
            return link;
        } catch {
            return null;
        }
    },

    iconButton(icon, label, handler, className = 'table-command') {
        const button = this.el('button', className);
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        const iconNode = this.el('i');
        iconNode.dataset.lucide = icon;
        button.append(iconNode);
        button.addEventListener('click', handler);
        return button;
    },

    command(label, icon, handler, variant = 'primary-command') {
        const button = this.el('button', variant);
        button.type = 'button';
        if (icon) {
            const iconNode = this.el('i');
            iconNode.dataset.lucide = icon;
            button.append(iconNode);
        }
        button.append(document.createTextNode(label));
        button.addEventListener('click', handler);
        return button;
    },

    showOnly(view) {
        [this.refs.loading, this.refs.authView, this.refs.accessView, this.refs.app]
            .forEach((element) => element.classList.add('is-hidden'));
        view.classList.remove('is-hidden');
    },

    async handleAuthState(user) {
        if (this.state.user?.uid !== user?.uid) {
            this.closeDrawer();
            this.refs.drawerContent.replaceChildren();
        }
        this.state.user = user;
        if (!user) {
            this.state.role = null;
            this.showOnly(this.refs.authView);
            document.getElementById('login-password').value = '';
            return;
        }

        this.showOnly(this.refs.loading);
        try {
            const token = await user.getIdTokenResult(true);
            const role = ['owner', 'moderator'].includes(token.claims.adminRole)
                ? token.claims.adminRole
                : null;
            this.state.role = role;
            if (!role) {
                if (new URLSearchParams(window.location.search).get('bootstrap') !== '1') {
                    await this.auth.signOut();
                    document.getElementById('login-error').textContent = this.t('errors.permission');
                    return;
                }
                document.getElementById('access-account').textContent = user.email || user.uid;
                document.getElementById('access-error').textContent = '';
                const hasGoogleProvider = user.providerData
                    .some((provider) => provider.providerId === 'google.com');
                document.getElementById('link-google').classList.toggle('is-hidden', hasGoogleProvider);
                document.getElementById('bootstrap-owner').classList.toggle('is-hidden', !hasGoogleProvider);
                this.showOnly(this.refs.accessView);
                this.refreshIcons(this.refs.accessView);
                return;
            }

            await this.functions.httpsCallable('recordAdminLogin')({});
            this.showOnly(this.refs.app);
            this.updateChrome();
            await this.renderView();
        } catch (error) {
            console.error('Admin claim verification failed:', error);
            await this.auth.signOut();
            this.showOnly(this.refs.authView);
            document.getElementById('login-error').textContent = this.t('errors.session');
        }
    },

    updateChrome() {
        if (!this.state.role) return;
        this.refs.role.textContent = this.state.role === 'owner'
            ? this.t('admins.owner')
            : this.t('admins.moderator');
        this.refs.identity.textContent = this.state.user?.email || this.state.user?.uid || '';
        document.querySelectorAll('.owner-only').forEach((element) => {
            element.classList.toggle('is-hidden', this.state.role !== 'owner');
        });
        this.refs.viewTitle.textContent = this.t(`nav.${this.state.view}`);
        window.AdminI18n.apply(document);
        this.syncNavigationChrome();
    },

    async signIn(event) {
        event.preventDefault();
        const submit = document.getElementById('login-submit');
        const errorNode = document.getElementById('login-error');
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        submit.disabled = true;
        errorNode.textContent = '';
        try {
            await this.auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            console.error('Admin sign-in failed:', error);
            errorNode.textContent = this.t('errors.signIn');
        } finally {
            submit.disabled = false;
        }
    },

    async resetPassword() {
        const result = await this.openModal({
            title: this.t('auth.resetTitle'),
            description: this.t('auth.resetDescription'),
            submitLabel: this.t('auth.sendReset'),
            fields: [{
                name: 'email', label: this.t('auth.email'), type: 'email', required: true,
                value: document.getElementById('login-email').value.trim()
            }]
        });
        if (!result) return;
        try {
            this.syncAuthLanguage();
            await this.auth.sendPasswordResetEmail(result.email, this.passwordResetSettings());
            this.toast(this.t('auth.resetSent'));
        } catch (error) {
            console.error('Password reset request failed:', error);
            // Keep the response identical so the form cannot be used to enumerate accounts.
            this.toast(this.t('auth.resetSent'));
        }
    },

    async linkGoogleAccount() {
        const user = this.state.user;
        const button = document.getElementById('link-google');
        const errorNode = document.getElementById('access-error');
        if (!user?.email) {
            errorNode.textContent = this.t('errors.googleLink');
            return;
        }

        button.disabled = true;
        errorNode.textContent = '';
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account', login_hint: user.email });
            const result = await user.linkWithPopup(provider);
            const linkedUser = result.user;
            const googleProvider = linkedUser?.providerData
                .find((entry) => entry.providerId === 'google.com');
            if (googleProvider?.email?.toLowerCase() !== linkedUser.email?.toLowerCase()) {
                if (googleProvider) await linkedUser.unlink('google.com');
                throw new Error('The linked Google account does not match the administrator email.');
            }
            await this.auth.signOut();
            this.toast(this.t('access.googleLinked'));
        } catch (error) {
            console.error('Google account linking failed:', error);
            errorNode.textContent = this.t('errors.googleLink');
        } finally {
            button.disabled = false;
        }
    },

    async bootstrapOwner() {
        const errorNode = document.getElementById('access-error');
        errorNode.textContent = '';
        try {
            await this.call('bootstrapOwner', {});
            this.toast(this.t('access.bootstrapSuccess'));
            await this.state.user.getIdToken(true);
            window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
            await this.handleAuthState(this.state.user);
        } catch (error) {
            console.error('Owner bootstrap failed:', error);
            errorNode.textContent = this.t('errors.bootstrap');
        }
    },

    async call(name, data) {
        const response = await this.functions.httpsCallable(name)(data);
        return response.data;
    },

    humanError(error, fallback = 'errors.save') {
        const code = String(error?.code || '');
        if (code.includes('permission-denied')) return this.t('errors.permission');
        if (error?.message && window.FirebaseApp.isUsingEmulators()) return error.message;
        return this.t(fallback);
    },

    toast(message, isError = false) {
        clearTimeout(this.toastTimer);
        this.refs.toast.textContent = message;
        this.refs.toast.classList.toggle('is-error', isError);
        this.refs.toast.classList.add('is-visible');
        this.toastTimer = setTimeout(() => this.refs.toast.classList.remove('is-visible'), 3600);
    },

    setView(view) {
        if (!['dashboard', 'reports', 'content', 'users', 'contributionLimits', 'admins', 'audit'].includes(view)) return;
        if (view === 'admins' && this.state.role !== 'owner') return;
        this.state.view = view;
        document.querySelectorAll('[data-view]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.view === view);
        });
        this.setMobileNavigation(false);
        this.refs.viewTitle.textContent = this.t(`nav.${view}`);
        this.closeDrawer();
        this.renderView();
    },

    async renderView() {
        this.refs.main.replaceChildren(this.loadingState());
        try {
            if (this.state.view === 'dashboard') await this.renderDashboard();
            if (this.state.view === 'reports') await this.renderReports();
            if (this.state.view === 'content') await this.renderContent();
            if (this.state.view === 'users') await this.renderUsers();
            if (this.state.view === 'contributionLimits') await this.renderContributionDefaults();
            if (this.state.view === 'admins') await this.renderAdmins();
            if (this.state.view === 'audit') await this.renderAudit();
            this.refreshIcons(this.refs.main);
        } catch (error) {
            console.error(`Failed to render ${this.state.view}:`, error);
            this.refs.main.replaceChildren(this.errorState(() => this.renderView()));
            this.refreshIcons(this.refs.main);
        }
    },

    loadingState() {
        return this.el('div', 'loading-state', this.t('common.loading'));
    },

    emptyState(key) {
        return this.el('div', 'empty-state', this.t(key));
    },

    errorState(retry) {
        const box = this.el('div', 'error-state');
        box.append(this.el('p', '', this.t('errors.load')));
        box.append(this.command(this.t('common.retry'), 'refresh-cw', retry, 'secondary-command'));
        return box;
    },

    heading(titleKey, subtitleKey, action) {
        const header = this.el('header', 'section-heading');
        const copy = this.el('div');
        copy.append(this.el('h2', '', this.t(titleKey)), this.el('p', '', this.t(subtitleKey)));
        header.append(copy);
        if (action) header.append(action);
        return header;
    },

    statusLabel(status) {
        const normalized = status || 'unknown';
        const key = `status.${normalized}`;
        const translated = this.t(key);
        return this.el('span', `status-label status-${normalized}`, translated === key ? this.t('common.unknown') : translated);
    },

    reportReason(reason) {
        const key = `reports.reasons.${reason || 'unknown'}`;
        const translated = this.t(key);
        return translated === key ? reason || this.t('common.unknown') : translated;
    },

    formatDate(value) {
        if (!value) return this.t('common.none');
        const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
        if (Number.isNaN(date.getTime())) return this.t('common.unknown');
        return new Intl.DateTimeFormat(window.AdminI18n.currentLang, {
            dateStyle: 'medium', timeStyle: 'short'
        }).format(date);
    },

    adminMediaUrl(fanartId) {
        const normalizedId = String(fanartId || '').trim();
        if (!normalizedId || normalizedId.length > 128 || normalizedId.includes('/')) return '';
        const url = new URL('/api/fanart-media', window.location.origin);
        url.searchParams.set('fanartId', normalizedId);
        return url.href;
    },

    async adminMediaImage(fanartId, alt) {
        const url = this.adminMediaUrl(fanartId);
        if (!url) return null;
        const token = await this.state.user.getIdToken();
        const response = await fetch(url, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return null;
        const objectUrl = URL.createObjectURL(blob);
        this.mediaObjectUrls.push(objectUrl);
        const image = this.el('img', 'drawer-media');
        image.src = objectUrl;
        image.alt = alt;
        return image;
    },

    releaseMediaObjectUrls() {
        this.mediaObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        this.mediaObjectUrls = [];
    },

    cell(primary, secondary = '') {
        const wrap = this.el('div');
        wrap.append(this.el('span', 'cell-primary', primary || this.t('common.none')));
        if (secondary) wrap.append(this.el('span', 'cell-secondary', secondary));
        return wrap;
    },

    table(columns, rows) {
        const wrap = this.el('div', 'data-table-wrap');
        const table = this.el('table', 'data-table');
        const head = this.el('thead');
        const headRow = this.el('tr');
        columns.forEach((column) => {
            const th = this.el('th', '', column.label);
            const width = typeof column.width === 'string'
                ? column.width.match(/^(\d{2,3})px$/)?.[1]
                : null;
            if (width) th.classList.add(`column-width-${width}`);
            headRow.append(th);
        });
        head.append(headRow);
        const body = this.el('tbody');
        rows.forEach((row) => {
            const tr = this.el('tr');
            columns.forEach((column) => {
                const td = this.el('td');
                td.dataset.label = column.label;
                const value = column.render(row);
                if (value instanceof Node) td.append(value);
                else td.textContent = value === undefined || value === null ? '' : String(value);
                tr.append(td);
            });
            body.append(tr);
        });
        table.append(head, body);
        wrap.append(table);
        return wrap;
    },

    reportTable(cases) {
        return this.table([
            { label: this.t('table.status'), width: '105px', render: (item) => this.statusLabel(item.status) },
            { label: this.t('reports.target'), render: (item) => this.cell(item.targetPreview || this.t('common.none'), `${item.targetType || ''} · ${item.targetId || ''}`) },
            { label: this.t('reports.targetAuthor'), width: '160px', render: (item) => this.cell(item.targetAuthorUid || this.t('common.unknown')) },
            { label: this.t('reports.reportCount'), width: '90px', render: (item) => String(item.reportCount || 0) },
            { label: this.t('reports.latestReport'), width: '160px', render: (item) => this.formatDate(item.latestAt) },
            {
                label: this.t('table.actions'), width: '76px', render: (item) => {
                    const actions = this.el('div', 'row-actions');
                    actions.append(this.iconButton('eye', this.t('actions.view'), () => this.openReportCase(item)));
                    return actions;
                }
            }
        ], cases);
    },

    async renderDashboard() {
        const data = await this.call('getDashboard', {});
        const fragment = document.createDocumentFragment();
        fragment.append(this.heading('dashboard.title', 'dashboard.subtitle'));

        const metrics = this.el('section', 'metric-grid');
        [
            ['flag', 'metrics.openReports', data.metrics.openReports],
            ['eye-off', 'metrics.hiddenContent', data.metrics.hiddenContent],
            ['volume-x', 'metrics.mutedUsers', data.metrics.mutedUsers],
            ['user-x', 'metrics.bannedUsers', data.metrics.bannedUsers]
        ].forEach(([icon, key, value]) => {
            const panel = this.el('article', 'metric-panel');
            const iconNode = this.el('i');
            iconNode.dataset.lucide = icon;
            const copy = this.el('div');
            copy.append(this.el('span', '', this.t(key)), this.el('strong', '', value));
            panel.append(iconNode, copy);
            metrics.append(panel);
        });
        fragment.append(metrics);

        const grid = this.el('div', 'dashboard-grid');
        const reports = this.el('section', 'surface-section');
        reports.append(this.el('h3', 'surface-title', this.t('dashboard.recentReports')));
        reports.append(data.recentCases.length ? this.reportTable(data.recentCases) : this.emptyState('reports.noReports'));

        const audit = this.el('section', 'surface-section');
        audit.append(this.el('h3', 'surface-title', this.t('dashboard.recentAudit')));
        audit.append(this.auditList(data.recentAudit));
        grid.append(reports, audit);
        fragment.append(grid);
        this.refs.main.replaceChildren(fragment);
    },

    auditList(items) {
        if (!items.length) return this.emptyState('audit.noAudit');
        const list = this.el('ul', 'audit-list');
        items.forEach((item) => {
            const row = this.el('li');
            const icon = this.el('i');
            icon.dataset.lucide = 'history';
            const copy = this.el('div');
            copy.append(
                this.el('strong', '', item.action || this.t('common.unknown')),
                this.el('span', '', `${item.actorEmail || item.actorUid || ''} · ${this.formatDate(item.createdAt)}`)
            );
            row.append(icon, copy);
            list.append(row);
        });
        return list;
    },

    async renderReports() {
        const fragment = document.createDocumentFragment();
        fragment.append(this.heading('reports.title', 'reports.subtitle'));
        const toolbar = this.el('div', 'toolbar');
        const statusSelect = this.selectControl([
            ['all', this.t('common.all')], ['open', this.t('status.open')], ['reviewing', this.t('status.reviewing')],
            ['resolved', this.t('status.resolved')], ['dismissed', this.t('status.dismissed')]
        ], this.state.reportStatus);
        const typeSelect = this.selectControl([
            ['all', this.t('common.all')], ['message', this.t('content.messages')], ['fanart', this.t('content.fanart')]
        ], this.state.reportType);
        statusSelect.addEventListener('change', () => {
            this.state.reportStatus = statusSelect.value;
            this.renderView();
        });
        typeSelect.addEventListener('change', () => {
            this.state.reportType = typeSelect.value;
            this.renderView();
        });
        toolbar.append(statusSelect, typeSelect, this.el('span'), this.command(this.t('common.refresh'), 'refresh-cw', () => this.renderView(), 'secondary-command'));
        fragment.append(toolbar);

        let query = this.db.collection('reportCases');
        if (this.state.reportStatus !== 'all') query = query.where('status', '==', this.state.reportStatus);
        if (this.state.reportType !== 'all') query = query.where('targetType', '==', this.state.reportType);
        const snapshot = await query.orderBy('latestAt', 'desc').limit(50).get();
        const cases = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        fragment.append(cases.length ? this.reportTable(cases) : this.emptyState('reports.noReports'));
        this.refs.main.replaceChildren(fragment);
    },

    selectControl(options, value) {
        const select = this.el('select');
        options.forEach(([optionValue, label]) => {
            const option = this.el('option', '', label);
            option.value = optionValue;
            option.selected = optionValue === value;
            select.append(option);
        });
        return select;
    },

    async openReportCase(item) {
        const collection = item.targetType === 'message' ? 'messages' : 'fanart';
        const [targetSnapshot, reportsSnapshot] = await Promise.all([
            this.db.collection(collection).doc(item.targetId).get(),
            this.db.collection('reportCases').doc(item.id).collection('reports').orderBy('createdAt', 'desc').get()
        ]);
        const target = targetSnapshot.exists ? targetSnapshot.data() : null;
        const reports = reportsSnapshot.docs.map((document) => document.data());
        this.openDrawer(this.t('reports.caseDetails'));
        const content = this.refs.drawerContent;
        content.append(this.drawerSection([
            this.statusLabel(item.status),
            this.el('p', 'muted-text', item.id)
        ]));
        content.append(this.drawerSection([
            this.el('h3', '', this.t('reports.reportReason')),
            this.el('p', '', `${this.reportReason(item.latestReason)} · ${item.reportCount || 0}`),
            this.el('p', 'muted-text', this.formatDate(item.latestAt))
        ]));

        const targetNodes = [this.el('h3', '', this.t('reports.target'))];
        if (target && item.targetType === 'fanart') {
            if (target.sourceType === 'x') {
                const link = this.xPostLink(target);
                if (link) targetNodes.push(link);
            } else {
                const image = await this.adminMediaImage(
                    item.targetId,
                    target.caption || this.t('content.fanart')
                );
                if (image) targetNodes.push(image);
            }
        }
        targetNodes.push(this.el('p', '', target
            ? (item.targetType === 'message' ? target.content : target.caption) || this.t('common.none')
            : this.t('common.none')));
        content.append(this.drawerSection(targetNodes));

        const authorSection = this.drawerSection([
            this.el('h3', '', this.t('reports.targetAuthor')),
            this.el('p', '', item.targetAuthorUid || this.t('common.unknown'))
        ]);
        if (item.targetAuthorUid) {
            authorSection.append(this.command(this.t('actions.viewUser'), 'user-round-search', () => this.openUser(item.targetAuthorUid), 'secondary-command'));
        }
        content.append(authorSection);

        const reportSection = this.drawerSection([this.el('h3', '', this.t('reports.reporters'))]);
        reports.forEach((report) => {
            const entry = this.el('div', 'drawer-section');
            entry.append(
                this.el('p', '', `${this.reportReason(report.reason)} · ${report.reporterUid || ''}`),
                this.el('p', '', report.details || ''),
                this.el('p', 'muted-text', this.formatDate(report.createdAt))
            );
            if (report.reporterUid) {
                entry.append(this.command(
                    this.t('actions.viewUser'),
                    'user-round-search',
                    () => this.openUser(report.reporterUid),
                    'secondary-command'
                ));
            }
            reportSection.append(entry);
        });
        content.append(reportSection);

        const actions = this.el('div', 'drawer-actions');
        if (item.status === 'open') actions.append(this.command(this.t('reports.startReview'), 'scan-eye', () => this.updateCase(item.id, 'reviewing'), 'secondary-command'));
        if (target && !target.deleted) {
            const action = target.hidden ? 'restore' : 'hide';
            actions.append(this.command(
                action === 'restore' ? this.t('content.restore') : this.t('content.hide'),
                action === 'restore' ? 'eye' : 'eye-off',
                () => this.moderate(item.targetType, item.targetId, action),
                'secondary-command'
            ));
        }
        if (item.status !== 'resolved' && item.status !== 'dismissed') {
            actions.append(this.command(this.t('reports.resolve'), 'circle-check', () => this.updateCase(item.id, 'resolved'), 'primary-command'));
            actions.append(this.command(this.t('reports.dismiss'), 'circle-x', () => this.updateCase(item.id, 'dismissed'), 'secondary-command'));
        }
        if (item.targetAuthorUid) {
            actions.append(this.command(this.t('users.mute'), 'volume-x', () => this.restrictUser(item.targetAuthorUid, 'mute'), 'secondary-command'));
            actions.append(this.command(this.t('users.ban'), 'user-x', () => this.restrictUser(item.targetAuthorUid, 'ban'), 'danger-command'));
        }
        content.append(actions);
        this.refreshIcons(this.refs.drawer);
    },

    async updateCase(caseId, status) {
        const result = await this.openModal({
            title: status === 'dismissed' ? this.t('reports.dismiss') : status === 'reviewing' ? this.t('reports.startReview') : this.t('reports.resolve'),
            submitLabel: this.t('common.confirm'),
            fields: [{ name: 'note', label: this.t('reports.resolutionNote'), type: 'textarea', required: false }]
        });
        if (!result) return;
        try {
            await this.call('resolveReportCase', { caseId, status, note: result.note || '' });
            this.toast(this.t('common.saved'));
            this.closeDrawer();
            await this.renderView();
        } catch (error) {
            this.toast(this.humanError(error), true);
        }
    },

    async renderContent() {
        const fragment = document.createDocumentFragment();
        const tabs = this.el('div', 'tab-control');
        [['message', 'content.messages'], ['fanart', 'content.fanart']].forEach(([value, key]) => {
            const button = this.el('button', value === this.state.contentType ? 'is-active' : '', this.t(key));
            button.type = 'button';
            button.addEventListener('click', () => {
                this.state.contentType = value;
                this.renderView();
            });
            tabs.append(button);
        });
        fragment.append(this.heading('content.title', 'content.subtitle', tabs));

        const toolbar = this.el('div', 'toolbar content-toolbar');
        const visibility = this.selectControl([
            ['all', this.t('common.all')], ['visible', this.t('status.visible')],
            ['hidden', this.t('status.admin_hidden')], ['removed', this.t('status.removed')]
        ], this.state.contentVisibility);
        const authorInput = this.el('input');
        authorInput.type = 'search';
        authorInput.placeholder = this.t('content.authorUid');
        authorInput.value = this.state.contentAuthorUid;
        const dateFromInput = this.el('input');
        dateFromInput.type = 'date';
        dateFromInput.value = this.state.contentDateFrom;
        dateFromInput.setAttribute('aria-label', this.t('content.dateFrom'));
        const dateToInput = this.el('input');
        dateToInput.type = 'date';
        dateToInput.value = this.state.contentDateTo;
        dateToInput.setAttribute('aria-label', this.t('content.dateTo'));
        visibility.addEventListener('change', () => {
            this.state.contentVisibility = visibility.value;
            this.renderView();
        });
        const search = this.command(this.t('common.search'), 'search', () => {
            this.state.contentAuthorUid = authorInput.value.trim();
            this.state.contentDateFrom = dateFromInput.value;
            this.state.contentDateTo = dateToInput.value;
            this.renderView();
        }, 'secondary-command');
        toolbar.append(
            visibility,
            authorInput,
            dateFromInput,
            dateToInput,
            search,
            this.command(this.t('common.refresh'), 'refresh-cw', () => this.renderView(), 'secondary-command')
        );
        fragment.append(toolbar);

        const collection = this.state.contentType === 'message' ? 'messages' : 'fanart';
        const authorField = this.state.contentType === 'message' ? 'authorId' : 'artistId';
        let query = this.db.collection(collection);
        if (this.state.contentAuthorUid) query = query.where(authorField, '==', this.state.contentAuthorUid);
        if (this.state.contentDateFrom) {
            query = query.where('createdAt', '>=', new Date(`${this.state.contentDateFrom}T00:00:00`));
        }
        if (this.state.contentDateTo) {
            const dateToExclusive = new Date(`${this.state.contentDateTo}T00:00:00`);
            dateToExclusive.setDate(dateToExclusive.getDate() + 1);
            query = query.where('createdAt', '<', dateToExclusive);
        }
        const snapshot = await query.orderBy('createdAt', 'desc').limit(50).get();
        let items = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        if (this.state.contentVisibility === 'visible') items = items.filter((item) => !item.hidden && !item.deleted);
        if (this.state.contentVisibility === 'hidden') items = items.filter((item) => item.hidden && !item.deleted);
        if (this.state.contentVisibility === 'removed') items = items.filter((item) => item.deleted);

        const type = this.state.contentType;
        const table = this.table([
            { label: this.t('table.status'), width: '120px', render: (item) => this.statusLabel(item.deleted ? 'removed' : item.hidden ? item.moderation?.status || 'admin_hidden' : 'visible') },
            { label: this.t('content.content'), render: (item) => this.cell(type === 'message' ? item.content : item.caption, item.id) },
            { label: this.t('content.author'), width: '170px', render: (item) => this.cell(type === 'message' ? item.author : item.artist, item[authorField]) },
            { label: this.t('content.reportCount'), width: '90px', render: (item) => String(item.reportCount || 0) },
            { label: this.t('content.createdAt'), width: '165px', render: (item) => this.formatDate(item.createdAt) },
            {
                label: this.t('table.actions'), width: '76px', render: (item) => {
                    const actions = this.el('div', 'row-actions');
                    actions.append(this.iconButton('eye', this.t('actions.view'), () => this.openContent(type, item)));
                    return actions;
                }
            }
        ], items);
        fragment.append(items.length ? table : this.emptyState('content.noContent'));
        this.refs.main.replaceChildren(fragment);
    },

    async openContent(type, item) {
        this.openDrawer(this.t('content.details'));
        const status = item.deleted ? 'removed' : item.hidden ? item.moderation?.status || 'admin_hidden' : 'visible';
        this.refs.drawerContent.append(this.drawerSection([
            this.statusLabel(status),
            this.el('p', 'muted-text', item.id)
        ]));
        if (type === 'fanart') {
            if (item.sourceType === 'x') {
                const link = this.xPostLink(item);
                if (link) this.refs.drawerContent.append(this.drawerSection([link]));
            } else {
                const image = await this.adminMediaImage(
                    item.id,
                    item.caption || this.t('content.fanart')
                );
                if (image) this.refs.drawerContent.append(this.drawerSection([image]));
            }
        }
        this.refs.drawerContent.append(this.drawerSection([
            this.el('h3', '', this.t('content.content')),
            this.el('p', '', (type === 'message' ? item.content : item.caption) || this.t('common.none'))
        ]));
        const uid = type === 'message' ? item.authorId : item.artistId;
        this.refs.drawerContent.append(this.drawerSection([
            this.el('h3', '', this.t('content.author')),
            this.el('p', '', `${type === 'message' ? item.author : item.artist || ''}`),
            this.el('p', 'muted-text', uid || this.t('common.unknown')),
            this.el('p', 'muted-text', this.formatDate(item.createdAt))
        ]));
        const actions = this.el('div', 'drawer-actions');
        if (uid) actions.append(this.command(this.t('actions.viewUser'), 'user-round-search', () => this.openUser(uid), 'secondary-command'));
        if (!item.deleted) {
            const action = item.hidden ? 'restore' : 'hide';
            actions.append(this.command(
                action === 'restore' ? this.t('content.restore') : this.t('content.hide'),
                action === 'restore' ? 'eye' : 'eye-off',
                () => this.moderate(type, item.id, action),
                'secondary-command'
            ));
            if (this.state.role === 'owner') {
                actions.append(this.command(this.t('content.remove'), 'trash-2', () => this.moderate(type, item.id, 'remove'), 'danger-command'));
            }
        }
        this.refs.drawerContent.append(actions);
        this.refreshIcons(this.refs.drawer);
    },

    async moderate(type, contentId, action) {
        const result = await this.openModal({
            title: this.t(`content.${action}`),
            description: action === 'remove' ? this.t('content.removeWarning') : '',
            submitLabel: this.t('common.confirm'),
            danger: action === 'remove',
            fields: [{ name: 'reason', label: this.t('content.reason'), type: 'textarea', required: true, minLength: 3 }]
        });
        if (!result) return;
        try {
            await this.call('moderateContent', { contentType: type, contentId, action, reason: result.reason });
            this.toast(this.t('common.saved'));
            this.closeDrawer();
            await this.renderView();
        } catch (error) {
            this.toast(this.humanError(error), true);
        }
    },

    async renderUsers(append = false) {
        const data = await this.call('listUsers', {
            query: this.state.userQuery,
            pageToken: append ? this.state.userPageToken : null,
            pageSize: 25
        });
        const fragment = document.createDocumentFragment();
        fragment.append(this.heading('users.title', 'users.subtitle'));
        const toolbar = this.el('div', 'toolbar');
        const input = this.el('input');
        input.type = 'search';
        input.placeholder = this.t('users.searchPlaceholder');
        input.value = this.state.userQuery;
        const search = this.command(this.t('common.search'), 'search', () => {
            this.state.userQuery = input.value.trim();
            this.state.userPageToken = null;
            this.renderView();
        }, 'secondary-command');
        toolbar.append(input, search, this.el('span'), this.command(this.t('common.refresh'), 'refresh-cw', () => {
            this.state.userQuery = '';
            this.state.userPageToken = null;
            this.renderView();
        }, 'secondary-command'));
        fragment.append(toolbar);

        this.state.userResults = append
            ? [...this.state.userResults, ...(data.users || [])]
            : (data.users || []);
        const rows = this.state.userResults;
        const table = this.table([
            { label: this.t('users.user'), render: (user) => this.cell(user.displayName || user.email || user.uid, user.email || user.uid) },
            { label: this.t('users.providers'), width: '170px', render: (user) => (user.providers || []).map((provider) => provider.providerId).join(', ') || this.t('common.none') },
            { label: this.t('users.lastSignIn'), width: '170px', render: (user) => this.formatDate(user.lastSignInAt) },
            {
                label: this.t('users.restriction'), width: '120px', render: (user) => this.statusLabel(
                    user.restriction?.state === 'banned'
                        ? 'banned'
                        : user.disabled ? 'disabled' : user.restriction?.state || 'active'
                )
            },
            {
                label: this.t('table.actions'), width: '76px', render: (user) => {
                    const actions = this.el('div', 'row-actions');
                    actions.append(this.iconButton('eye', this.t('actions.view'), () => this.openUser(user.uid)));
                    return actions;
                }
            }
        ], rows);
        fragment.append(rows.length ? table : this.emptyState('users.noUsers'));
        this.state.userPageToken = data.pageToken;
        if (data.pageToken && !this.state.userQuery) {
            const footer = this.el('div', 'section-heading');
            footer.append(this.el('span'), this.command(this.t('common.loadMore'), 'chevron-down', () => {
                this.toast(this.t('common.loading'));
                this.renderUsers(true);
            }, 'secondary-command'));
            fragment.append(footer);
        }
        this.refs.main.replaceChildren(fragment);
    },

    async openUser(uid) {
        const actorUid = this.state.user?.uid;
        const actorRole = this.state.role;
        const requestId = ++this.userDetailRequest;
        const current = () => requestId === this.userDetailRequest && actorUid === this.state.user?.uid &&
            actorRole === this.state.role && this.state.role;
        try {
            const data = await this.call('getUser', { uid });
            if (!current()) return;
            const user = data.user;
            const restrictionState = user.restriction?.state || 'active';
            const displayState = restrictionState === 'banned'
                ? 'banned'
                : user.disabled ? 'disabled' : restrictionState;
            this.openDrawer(this.t('users.details'), requestId);
            this.state.detailUserUid = uid;
            this.refs.drawerContent.append(this.drawerSection([
                this.statusLabel(displayState),
                this.el('p', '', user.displayName || user.email || uid),
                this.el('p', 'muted-text', user.email || ''),
                this.el('p', 'muted-text', uid)
            ]));
            this.refs.drawerContent.append(this.drawerSection([
                this.el('h3', '', this.t('users.providers')),
                this.el('p', '', (user.providers || []).map((provider) => `${provider.providerId}: ${provider.uid}`).join('\n') || this.t('common.none')),
                this.el('p', 'muted-text', `${this.t('users.lastSignIn')}: ${this.formatDate(user.lastSignInAt)}`)
            ]));
            this.refs.drawerContent.append(this.userContributionSection(uid, data.contributionLimits, user));
            const recent = this.drawerSection([this.el('h3', '', this.t('users.recentContent'))]);
            [...(data.messages || []), ...(data.fanart || [])].slice(0, 12).forEach((item) => {
                recent.append(this.el('p', '', item.content || item.caption || this.t('common.none')));
            });
            this.refs.drawerContent.append(recent);
            const actions = this.el('div', 'drawer-actions');
            const banPending = user.restriction?.authDisablePending === true;
            const enablePending = user.restriction?.authEnablePending === true;
            if (
                !user.adminRole &&
                !user.disabled &&
                restrictionState !== 'banned' &&
                !enablePending
            ) {
                actions.append(this.command(this.t('users.mute'), 'volume-x', () => this.restrictUser(uid, 'mute'), 'secondary-command'));
                actions.append(this.command(this.t('users.ban'), 'user-x', () => this.restrictUser(uid, 'ban'), 'danger-command'));
            }
            if (
                !user.adminRole &&
                restrictionState === 'banned' &&
                banPending
            ) {
                actions.append(this.command(this.t('users.ban'), 'refresh-cw', () => this.restrictUser(uid, 'ban'), 'danger-command'));
            }
            if (
                !user.adminRole &&
                (restrictionState === 'muted' ||
                    (restrictionState === 'banned' && !banPending) ||
                    enablePending)
            ) {
                actions.append(this.command(this.t('users.clear'), 'user-check', () => this.restrictUser(uid, 'clear'), 'secondary-command'));
            }
            this.refs.drawerContent.append(actions);
            this.refreshIcons(this.refs.drawer);
        } catch (error) {
            if (current()) this.toast(this.humanError(error, 'errors.load'), true);
        }
    },

    async restrictUser(uid, action) {
        let fields = [];
        if (action === 'mute') {
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const localValue = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            fields = [
                { name: 'reason', label: this.t('users.reason'), type: 'textarea', required: true, minLength: 3 },
                { name: 'expiresAt', label: this.t('users.expiresAt'), type: 'datetime-local', required: true, value: localValue },
                { name: 'hideExisting', label: this.t('users.hideExisting'), type: 'checkbox' }
            ];
        } else if (action === 'ban') {
            fields = [
                { name: 'reason', label: this.t('users.reason'), type: 'textarea', required: true, minLength: 3 },
                { name: 'hideExisting', label: this.t('users.hideExisting'), type: 'checkbox' }
            ];
        }
        const result = await this.openModal({
            title: this.t(`users.${action}`),
            submitLabel: this.t('common.confirm'),
            danger: action === 'ban',
            fields
        });
        if (!result) return;
        try {
            await this.call('setUserRestriction', {
                uid,
                action,
                reason: result.reason || '',
                expiresAt: result.expiresAt ? new Date(result.expiresAt).toISOString() : null,
                hideExisting: result.hideExisting === true
            });
            this.toast(this.t('users.restrictionSaved'));
            this.closeDrawer();
            await this.renderView();
        } catch (error) {
            this.toast(this.humanError(error), true);
        }
    },

    contributionField(labelText, input) {
        const wrap = this.el('div', 'modal-field');
        const label = this.el('label', '', labelText);
        label.htmlFor = input.id;
        wrap.append(label, input);
        return wrap;
    },

    contributionNumber(id, value) {
        const input = this.el('input');
        input.id = id;
        input.type = 'number';
        input.min = '0';
        input.max = String(Number.MAX_SAFE_INTEGER);
        input.step = '1';
        input.required = true;
        input.value = String(value);
        input.addEventListener('input', () => input.setCustomValidity(''));
        return input;
    },

    contributionReason(id) {
        const input = this.el('textarea');
        input.id = id;
        input.required = true;
        input.minLength = 3;
        input.maxLength = 500;
        input.addEventListener('input', () => input.setCustomValidity(''));
        return input;
    },

    validateContributionForm(form, numbers, reason) {
        for (const input of numbers) {
            const value = Number(input.value);
            input.setCustomValidity(input.value.trim() !== '' && Number.isSafeInteger(value) && value >= 0
                ? '' : this.t('quota.invalidNumber'));
        }
        const reasonLength = reason.value.trim().length;
        reason.setCustomValidity(reasonLength >= 3 && reasonLength <= 500 ? '' : this.t('quota.invalidReason'));
        return form.reportValidity();
    },

    contributionError(reload) {
        const box = this.el('div', 'quota-error');
        const message = this.el('p', 'form-error');
        message.setAttribute('role', 'alert');
        const button = this.command(this.t('quota.reload'), 'refresh-cw', reload, 'secondary-command');
        button.classList.add('is-hidden');
        box.append(message, button);
        return { box, show: (error) => {
            const conflict = String(error?.code || '').includes('aborted');
            message.textContent = conflict ? this.t('quota.conflict') : this.humanError(error);
            button.classList.toggle('is-hidden', !conflict);
        } };
    },

    contributionBusy(form, busy) {
        form.setAttribute('aria-busy', String(busy));
        if (busy) {
            form.quotaDisabledControls = Array.from(form.elements, (input) => [input, input.disabled]);
            form.quotaDisabledControls.forEach(([input]) => { input.disabled = true; });
        } else {
            (form.quotaDisabledControls || []).forEach(([input, disabled]) => { input.disabled = disabled; });
            delete form.quotaDisabledControls;
        }
    },

    async renderContributionDefaults() {
        const actorUid = this.state.user?.uid;
        const actorRole = this.state.role;
        const requestId = ++this.contributionDefaultsRequest;
        const current = () => requestId === this.contributionDefaultsRequest &&
            actorUid === this.state.user?.uid && actorRole === this.state.role &&
            this.state.role && this.state.view === 'contributionLimits';
        let data;
        try {
            data = await this.call('getContributionDefaults', {});
        } catch (error) {
            if (!current()) return;
            throw error;
        }
        if (!current()) return;
        const fragment = document.createDocumentFragment();
        fragment.append(this.heading('quota.title', 'quota.subtitle',
            this.command(this.t('common.refresh'), 'refresh-cw', () => this.renderView(), 'secondary-command')));
        const panel = this.el('section', 'quota-panel');
        panel.append(this.el('p', 'quota-note', this.t('quota.defaultHint')));
        if (this.state.role !== 'owner') {
            panel.append(this.el('p', 'quota-note', this.t('quota.readOnly')));
            for (const kind of ['message', 'fanart']) {
                const item = this.el('div', 'quota-readonly-value');
                item.append(this.el('strong', '', this.t(`quota.${kind}`)),
                    this.el('span', '', this.t('quota.dailyValue', { limit: data.defaults[`${kind}DailyLimit`] })));
                panel.append(item);
            }
        } else {
            const form = this.el('form', 'quota-form');
            form.id = 'contribution-defaults-form';
            form.noValidate = true;
            const fields = this.el('div', 'quota-default-fields');
            const message = this.contributionNumber('default-message-limit', data.defaults.messageDailyLimit);
            const fanart = this.contributionNumber('default-fanart-limit', data.defaults.fanartDailyLimit);
            fields.append(this.contributionField(this.t('quota.messageDaily'), message),
                this.contributionField(this.t('quota.fanartDaily'), fanart));
            const reason = this.contributionReason('defaults-limit-reason');
            const error = this.contributionError(() => this.renderView());
            const submit = this.el('button', 'primary-command', this.t('actions.save'));
            submit.type = 'submit';
            const actions = this.el('div', 'quota-form-actions');
            actions.append(submit);
            form.append(fields, this.contributionField(this.t('quota.reason'), reason),
                this.el('small', 'modal-field-hint', this.t('quota.reasonHint')), error.box, actions);
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (submit.disabled || !this.validateContributionForm(form, [message, fanart], reason)) return;
                this.contributionBusy(form, true);
                try {
                    await this.call('setContributionDefaults', {
                        messageDailyLimit: Number(message.value), fanartDailyLimit: Number(fanart.value),
                        expectedRevision: data.revision, reason: reason.value.trim()
                    });
                    if (current()) {
                        this.toast(this.t('quota.saved'));
                        await this.renderView();
                    }
                } catch (failure) {
                    if (current()) error.show(failure);
                } finally {
                    this.contributionBusy(form, false);
                }
            });
            panel.append(form);
        }
        fragment.append(panel);
        this.refs.main.replaceChildren(fragment);
    },

    contributionLimitValue(limit) {
        return limit === null ? this.t('quota.unlimited') : this.t('quota.dailyValue', { limit });
    },

    userContributionSection(uid, limits, user) {
        const actorUid = this.state.user?.uid;
        const requestId = this.userDetailRequest;
        const current = () => actorUid === this.state.user?.uid && this.state.role === 'owner' &&
            this.state.detailUserUid === uid && requestId === this.userDetailRequest;
        const section = this.drawerSection([this.el('h3', '', this.t('quota.userTitle'))]);
        section.id = 'user-contribution-limits';
        if (!limits) {
            section.append(this.el('p', '', this.t('errors.load')));
            return section;
        }
        section.append(this.el('p', 'quota-note', this.t('quota.usageDate', { day: limits.dayKey })),
            this.el('p', 'quota-note', this.t('quota.userHint')));
        const hasSocialProvider = (user.providers || []).some((provider) => ['google.com', 'github.com'].includes(provider.providerId));
        if (!hasSocialProvider) section.append(this.el('p', 'quota-note', this.t('quota.socialRequired')));
        const editable = this.state.role === 'owner';
        if (!editable) section.append(this.el('p', 'quota-note', this.t('quota.readOnly')));
        const form = this.el('form', 'quota-form');
        form.id = 'user-contribution-limits-form';
        form.noValidate = true;
        const controls = {};
        for (const kind of ['message', 'fanart']) {
            const fieldset = this.el('fieldset', 'quota-kind');
            fieldset.dataset.contributionKind = kind;
            fieldset.append(this.el('legend', '', this.t(`quota.${kind}`)));
            const effective = limits.effective[kind];
            fieldset.append(this.el('p', 'quota-effective', this.t('quota.effective', {
                limit: this.contributionLimitValue(effective.limit)
            })), this.el('p', 'quota-source', this.t('quota.source', {
                source: this.t(effective.source === 'override' ? 'quota.overrideSource' : 'quota.defaultSource')
            })), this.el('p', 'quota-usage', this.t('quota.used', { used: limits.usage[kind] })));
            if (editable) {
                const mode = this.el('select');
                mode.id = `user-${kind}-limit-mode`;
                for (const value of ['inherit', 'limited', 'unlimited']) {
                    const option = this.el('option', '', this.t(`quota.${value}`));
                    option.value = value;
                    mode.append(option);
                }
                mode.value = limits.overrides[kind].mode;
                const number = this.contributionNumber(`user-${kind}-limit`,
                    limits.overrides[kind].value ?? limits.defaults[`${kind}DailyLimit`]);
                const numberWrap = this.contributionField(this.t(`quota.${kind}Custom`), number);
                const syncMode = () => {
                    const limited = mode.value === 'limited';
                    numberWrap.classList.toggle('is-hidden', !limited);
                    number.disabled = !limited;
                    number.required = limited;
                };
                mode.addEventListener('change', syncMode);
                syncMode();
                fieldset.append(this.contributionField(this.t(`quota.${kind}Mode`), mode), numberWrap);
                controls[kind] = { mode, number };
            } else {
                fieldset.append(this.el('p', '', this.t('quota.setting', {
                    mode: this.t(`quota.${limits.overrides[kind].mode}`)
                })));
            }
            form.append(fieldset);
        }
        if (editable) {
            const reason = this.contributionReason('user-limit-reason');
            const error = this.contributionError(() => this.openUser(uid));
            const submit = this.el('button', 'primary-command', this.t('actions.save'));
            submit.type = 'submit';
            const actions = this.el('div', 'quota-form-actions');
            actions.append(submit);
            form.append(this.contributionField(this.t('quota.reason'), reason),
                this.el('small', 'modal-field-hint', this.t('quota.reasonHint')), error.box, actions);
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const numbers = Object.values(controls).filter((control) => control.mode.value === 'limited')
                    .map((control) => control.number);
                if (submit.disabled || !this.validateContributionForm(form, numbers, reason)) return;
                const changes = Object.fromEntries(Object.entries(controls).map(([kind, control]) => [kind,
                    control.mode.value === 'limited' ? { mode: 'limited', value: Number(control.number.value) }
                        : { mode: control.mode.value }]));
                this.contributionBusy(form, true);
                try {
                    await this.call('setUserContributionLimits', {
                        uid, ...changes, expectedRevision: limits.revision, reason: reason.value.trim()
                    });
                    if (current()) {
                        this.toast(this.t('quota.saved'));
                        await this.openUser(uid);
                    }
                } catch (failure) {
                    if (current()) error.show(failure);
                } finally {
                    this.contributionBusy(form, false);
                }
            });
        }
        section.append(form);
        return section;
    },

    async renderAdmins() {
        if (this.state.role !== 'owner') return this.setView('dashboard');
        const snapshot = await this.db.collection('adminAccounts').orderBy('updatedAt', 'desc').limit(100).get();
        const admins = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        const invite = this.command(this.t('admins.invite'), 'user-plus', () => this.inviteAdmin());
        const fragment = document.createDocumentFragment();
        fragment.append(this.heading('admins.title', 'admins.subtitle', invite));
        const table = this.table([
            { label: this.t('admins.name'), render: (admin) => this.cell(admin.displayName || admin.email, admin.email) },
            { label: this.t('admins.role'), width: '130px', render: (admin) => this.el('span', 'role-label', admin.role === 'owner' ? this.t('admins.owner') : this.t('admins.moderator')) },
            { label: this.t('admins.status'), width: '120px', render: (admin) => this.statusLabel(admin.disabled ? 'disabled' : admin.status || 'active') },
            { label: this.t('admins.lastLogin'), width: '170px', render: (admin) => this.formatDate(admin.lastLoginAt) },
            {
                label: this.t('table.actions'), width: '76px', render: (admin) => {
                    const actions = this.el('div', 'row-actions');
                    actions.append(this.iconButton('settings', this.t('actions.view'), () => this.openAdmin(admin)));
                    return actions;
                }
            }
        ], admins);
        fragment.append(admins.length ? table : this.emptyState('admins.noAdmins'));
        this.refs.main.replaceChildren(fragment);
    },

    async inviteAdmin() {
        const result = await this.openModal({
            title: this.t('admins.invite'),
            submitLabel: this.t('admins.invite'),
            fields: [
                { name: 'displayName', label: this.t('admins.name'), type: 'text', required: true },
                { name: 'email', label: this.t('admins.email'), type: 'email', required: true },
                { name: 'role', label: this.t('admins.role'), type: 'select', required: true, options: [
                    ['moderator', this.t('admins.moderator')], ['owner', this.t('admins.owner')]
                ] }
            ]
        });
        if (!result) return;
        try {
            await this.call('inviteAdmin', result);
            this.syncAuthLanguage();
            await this.auth.sendPasswordResetEmail(result.email, this.passwordResetSettings());
            this.toast(this.t('admins.inviteSent'));
            await this.renderView();
        } catch (error) {
            this.toast(this.humanError(error), true);
        }
    },

    openAdmin(admin) {
        this.openDrawer(this.t('admins.title'));
        this.refs.drawerContent.append(this.drawerSection([
            this.statusLabel(admin.disabled ? 'disabled' : admin.status || 'active'),
            this.el('p', '', admin.displayName || admin.email),
            this.el('p', 'muted-text', admin.email || ''),
            this.el('p', 'muted-text', admin.id)
        ]));
        this.refs.drawerContent.append(this.drawerSection([
            this.el('h3', '', this.t('admins.role')),
            this.el('p', '', admin.role === 'owner' ? this.t('admins.owner') : this.t('admins.moderator')),
            this.el('p', 'muted-text', `${this.t('admins.lastLogin')}: ${this.formatDate(admin.lastLoginAt)}`)
        ]));
        const actions = this.el('div', 'drawer-actions');
        actions.append(this.command(
            admin.role === 'owner' ? this.t('admins.moderator') : this.t('admins.owner'),
            'shield',
            () => this.updateAdmin(admin, { role: admin.role === 'owner' ? 'moderator' : 'owner' }),
            'secondary-command'
        ));
        actions.append(this.command(
            admin.disabled ? this.t('admins.enable') : this.t('admins.disable'),
            admin.disabled ? 'user-check' : 'user-x',
            () => this.updateAdmin(admin, { disabled: !admin.disabled }),
            admin.disabled ? 'secondary-command' : 'danger-command'
        ));
        actions.append(this.command(this.t('admins.revoke'), 'log-out', () => this.updateAdmin(admin, { revokeSessions: true }), 'secondary-command'));
        actions.append(this.command(this.t('admins.reset'), 'mail', async () => {
            try {
                this.syncAuthLanguage();
                await this.auth.sendPasswordResetEmail(admin.email, this.passwordResetSettings());
                this.toast(this.t('auth.resetSent'));
            } catch (error) {
                this.toast(this.humanError(error), true);
            }
        }, 'secondary-command'));
        this.refs.drawerContent.append(actions);
        this.refreshIcons(this.refs.drawer);
    },

    async updateAdmin(admin, changes) {
        const result = await this.openModal({
            title: this.t('admins.title'),
            description: `${admin.displayName || admin.email} · ${admin.email || ''}`,
            submitLabel: this.t('common.confirm'),
            danger: changes.disabled === true,
            fields: []
        });
        if (!result) return;
        try {
            await this.call('updateAdminAccount', { uid: admin.id, ...changes });
            this.toast(this.t('admins.updated'));
            if (admin.id === this.state.user?.uid && changes.revokeSessions === true) {
                await this.auth.signOut();
                return;
            }
            this.closeDrawer();
            await this.renderView();
        } catch (error) {
            this.toast(this.humanError(error), true);
        }
    },

    async renderAudit() {
        const snapshot = await this.db.collection('adminAuditLogs').orderBy('createdAt', 'desc').limit(100).get();
        const items = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        const fragment = document.createDocumentFragment();
        fragment.append(this.heading('audit.title', 'audit.subtitle'));
        const table = this.table([
            { label: this.t('audit.action'), width: '170px', render: (item) => this.cell(item.action, item.id) },
            { label: this.t('audit.actor'), width: '200px', render: (item) => this.cell(item.actorEmail || item.actorUid, item.actorRole) },
            { label: this.t('audit.target'), render: (item) => this.cell(`${item.targetType || ''}: ${item.targetId || ''}`) },
            { label: this.t('audit.reason'), render: (item) => item.reason || this.t('common.none') },
            { label: this.t('audit.createdAt'), width: '170px', render: (item) => this.formatDate(item.createdAt) }
        ], items);
        fragment.append(items.length ? table : this.emptyState('audit.noAudit'));
        this.refs.main.replaceChildren(fragment);
    },

    drawerSection(nodes) {
        const section = this.el('section', 'drawer-section');
        nodes.forEach((node) => section.append(node));
        return section;
    },

    openDrawer(title, userRequestId = null) {
        if (userRequestId !== this.userDetailRequest) this.userDetailRequest++;
        this.state.detailUserUid = null;
        this.releaseMediaObjectUrls();
        this.refs.drawerTitle.textContent = title;
        this.refs.drawerContent.replaceChildren();
        this.refs.drawer.classList.add('is-open');
        this.refs.drawer.setAttribute('aria-hidden', 'false');
        this.refs.drawerBackdrop.classList.add('is-visible');
    },

    closeDrawer() {
        this.userDetailRequest++;
        this.state.detailUserUid = null;
        this.releaseMediaObjectUrls();
        this.refs.drawer.classList.remove('is-open');
        this.refs.drawer.setAttribute('aria-hidden', 'true');
        this.refs.drawerBackdrop.classList.remove('is-visible');
    },

    openModal(config) {
        if (this.modalResolver) this.closeModal(null);
        this.refs.modalTitle.textContent = config.title;
        this.refs.modalForm.replaceChildren();
        if (config.description) this.refs.modalForm.append(this.el('p', 'muted-text', config.description));

        (config.fields || []).forEach((field) => {
            if (field.type === 'checkbox') {
                const label = this.el('label', 'checkbox-field');
                const input = this.el('input');
                input.type = 'checkbox';
                input.name = field.name;
                input.checked = field.value === true;
                label.append(input, document.createTextNode(field.label));
                this.refs.modalForm.append(label);
                return;
            }

            const wrap = this.el('div', 'modal-field');
            const label = this.el('label', '', field.label);
            label.htmlFor = `modal-${field.name}`;
            let input;
            if (field.type === 'textarea') input = this.el('textarea');
            else if (field.type === 'select') {
                input = this.el('select');
                (field.options || []).forEach(([value, optionLabel]) => {
                    const option = this.el('option', '', optionLabel);
                    option.value = value;
                    input.append(option);
                });
            } else {
                input = this.el('input');
                input.type = field.type || 'text';
            }
            input.id = `modal-${field.name}`;
            input.name = field.name;
            input.required = field.required === true;
            if (field.minLength) input.minLength = field.minLength;
            if (field.value !== undefined) input.value = field.value;
            wrap.append(label, input);
            if (field.hint) wrap.append(this.el('small', 'modal-field-hint', field.hint));
            this.refs.modalForm.append(wrap);
        });

        const actions = this.el('div', 'modal-actions');
        const cancel = this.command(this.t('common.cancel'), null, () => this.closeModal(null), 'secondary-command');
        cancel.type = 'button';
        const submit = this.el('button', config.danger ? 'danger-command' : 'primary-command', config.submitLabel || this.t('common.confirm'));
        submit.type = 'submit';
        actions.append(cancel, submit);
        this.refs.modalForm.append(actions);
        this.refs.modalForm.onsubmit = (event) => {
            event.preventDefault();
            const result = {};
            (config.fields || []).forEach((field) => {
                const input = this.refs.modalForm.elements[field.name];
                result[field.name] = field.type === 'checkbox' ? input.checked : input.value;
            });
            this.closeModal(result);
        };

        this.refs.modal.classList.add('is-open');
        this.refs.modal.setAttribute('aria-hidden', 'false');
        this.refreshIcons(this.refs.modal);
        const firstInput = this.refs.modalForm.querySelector('input, select, textarea');
        setTimeout(() => firstInput?.focus(), 0);
        return new Promise((resolve) => { this.modalResolver = resolve; });
    },

    closeModal(result) {
        this.refs.modal.classList.remove('is-open');
        this.refs.modal.setAttribute('aria-hidden', 'true');
        const resolver = this.modalResolver;
        this.modalResolver = null;
        if (resolver) resolver(result);
    }
};

document.addEventListener('DOMContentLoaded', () => AdminApp.init());
window.AdminApp = AdminApp;
