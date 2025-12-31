/**
 * Authentication Module
 * Multi-provider OAuth 認證模組 (GitHub + Google)
 */

const Auth = {
    currentUser: null,
    loginButtons: null,
    userDisplay: null,

    // Provider factory
    providers: {
        github: () => {
            const provider = new firebase.auth.GithubAuthProvider();
            provider.addScope('read:user');
            return provider;
        },
        google: () => {
            return new firebase.auth.GoogleAuthProvider();
        }
    },

    init() {
        // Wait for Firebase to be ready
        window.addEventListener('firebaseReady', () => {
            this.setupAuthListener();
            this.setupUI();
        });
    },

    setupAuthListener() {
        const auth = window.FirebaseApp.getAuth();
        auth.onAuthStateChanged((user) => {
            this.currentUser = user;
            this.updateUI();

            // Dispatch auth state change event
            window.dispatchEvent(new CustomEvent('authStateChanged', {
                detail: { user }
            }));
        });
    },

    setupUI() {
        this.loginButtons = document.getElementById('login-buttons');
        this.userDisplay = document.getElementById('user-display');

        // Bind login buttons
        const githubBtn = document.getElementById('login-github');
        const googleBtn = document.getElementById('login-google');

        if (githubBtn) {
            githubBtn.addEventListener('click', () => this.login('github'));
        }
        if (googleBtn) {
            googleBtn.addEventListener('click', () => this.login('google'));
        }

        // Bind logout button
        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', () => {
                this.closeDropdown();
                this.logout();
            });
        }

        // Bind user trigger for dropdown
        const userTrigger = this.userDisplay?.querySelector('.user-trigger');
        if (userTrigger) {
            userTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDropdown();
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (this.userDisplay && !this.userDisplay.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Close dropdown on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDropdown();
            }
        });
    },

    toggleDropdown() {
        if (!this.userDisplay) return;
        this.userDisplay.classList.toggle('open');

        // Update aria-expanded
        const trigger = this.userDisplay.querySelector('.user-trigger');
        if (trigger) {
            const isOpen = this.userDisplay.classList.contains('open');
            trigger.setAttribute('aria-expanded', isOpen);
        }
    },

    closeDropdown() {
        if (!this.userDisplay) return;
        this.userDisplay.classList.remove('open');

        const trigger = this.userDisplay.querySelector('.user-trigger');
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
        }
    },

    updateUI() {
        if (!this.loginButtons || !this.userDisplay) return;

        if (this.currentUser) {
            // User is logged in - hide login buttons, show user display
            this.loginButtons.style.display = 'none';
            this.userDisplay.classList.add('show');
            this.closeDropdown(); // Ensure dropdown is closed on login

            const avatar = this.userDisplay.querySelector('.user-avatar');
            const name = this.userDisplay.querySelector('.user-name');
            const providerBadge = this.userDisplay.querySelector('.user-provider');

            if (avatar && this.currentUser.photoURL) {
                avatar.src = this.currentUser.photoURL;
                avatar.alt = this.currentUser.displayName || 'User';
            }
            if (name) {
                name.textContent = this.currentUser.displayName || 'User';
            }
            if (providerBadge) {
                providerBadge.textContent = `via ${this.getProviderName()}`;
            }
        } else {
            // User is logged out - show login buttons, hide user display
            this.loginButtons.style.display = 'flex';
            this.userDisplay.classList.remove('show');
            this.closeDropdown();
        }

        // Update submit buttons visibility
        this.updateSubmitButtons();
    },

    updateSubmitButtons() {
        const submitButtons = document.querySelectorAll('.submit-btn');
        const loginPrompts = document.querySelectorAll('.login-prompt');

        submitButtons.forEach(btn => {
            btn.style.display = this.currentUser ? 'inline-flex' : 'none';
        });

        loginPrompts.forEach(prompt => {
            prompt.style.display = this.currentUser ? 'none' : 'block';
        });
    },

    async login(providerName = 'github') {
        try {
            const auth = window.FirebaseApp.getAuth();
            const providerFactory = this.providers[providerName];

            if (!providerFactory) {
                throw new Error(`Unknown provider: ${providerName}`);
            }

            const provider = providerFactory();
            const result = await auth.signInWithPopup(provider);
            console.log('Login successful:', result.user.displayName);

            return result.user;
        } catch (error) {
            console.error('Login error:', error);

            // Show user-friendly error message
            if (error.code === 'auth/popup-closed-by-user') {
                // User closed popup, do nothing
                return null;
            }

            const errorMsg = this.getErrorMessage(error.code);
            alert(errorMsg);
            return null;
        }
    },

    async logout() {
        try {
            const auth = window.FirebaseApp.getAuth();
            await auth.signOut();
            console.log('Logout successful');
        } catch (error) {
            console.error('Logout error:', error);
        }
    },

    getErrorMessage(code) {
        const messages = {
            'auth/account-exists-with-different-credential':
                'An account already exists with this email.',
            'auth/popup-blocked':
                'Popup was blocked. Please allow popups for this site.',
            'auth/cancelled-popup-request':
                'Login cancelled.',
            'auth/network-request-failed':
                'Network error. Please check your connection.'
        };

        return messages[code] || 'Login failed. Please try again.';
    },

    // Get the provider ID of current user
    getProviderId() {
        return this.currentUser?.providerData[0]?.providerId || null;
    },

    // Get human-readable provider name
    getProviderName() {
        const providerId = this.getProviderId();
        const names = {
            'github.com': 'GitHub',
            'google.com': 'Google'
        };
        return names[providerId] || 'Unknown';
    },

    // Get profile link based on provider
    getProfileLink() {
        if (!this.currentUser) return null;

        const providerId = this.getProviderId();

        switch (providerId) {
            case 'github.com':
                // GitHub: construct profile URL from display name
                const githubData = this.currentUser.providerData.find(
                    p => p.providerId === 'github.com'
                );
                if (githubData?.displayName) {
                    return `https://github.com/${githubData.displayName}`;
                }
                break;
            case 'google.com':
                // Google: no public profile page (Google+ shut down in 2019)
                return null;
        }
        return null;
    },

    isLoggedIn() {
        return !!this.currentUser;
    },

    getUser() {
        return this.currentUser;
    },

    getUserId() {
        return this.currentUser?.uid || null;
    },

    getUserName() {
        return this.currentUser?.displayName || 'Anonymous';
    },

    getUserAvatar() {
        return this.currentUser?.photoURL || null;
    },

    // Legacy method for backwards compatibility
    getGitHubLink() {
        return this.getProfileLink();
    }
};

// Initialize auth module
Auth.init();

// Export for use in other modules
window.Auth = Auth;
