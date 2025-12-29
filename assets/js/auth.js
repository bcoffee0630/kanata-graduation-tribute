/**
 * Authentication Module
 * GitHub OAuth 認證模組
 */

const Auth = {
    currentUser: null,
    loginButton: null,
    userDisplay: null,

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
        this.loginButton = document.getElementById('login-button');
        this.userDisplay = document.getElementById('user-display');

        if (this.loginButton) {
            this.loginButton.addEventListener('click', () => this.login());
        }

        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', () => this.logout());
        }
    },

    updateUI() {
        if (!this.loginButton || !this.userDisplay) return;

        if (this.currentUser) {
            // User is logged in
            this.loginButton.style.display = 'none';
            this.userDisplay.style.display = 'flex';

            const avatar = this.userDisplay.querySelector('.user-avatar');
            const name = this.userDisplay.querySelector('.user-name');

            if (avatar && this.currentUser.photoURL) {
                avatar.src = this.currentUser.photoURL;
                avatar.alt = this.currentUser.displayName || 'User';
            }
            if (name) {
                name.textContent = this.currentUser.displayName || 'User';
            }
        } else {
            // User is logged out
            this.loginButton.style.display = 'flex';
            this.userDisplay.style.display = 'none';
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

    async login() {
        try {
            const auth = window.FirebaseApp.getAuth();
            const provider = new firebase.auth.GithubAuthProvider();

            // Request additional scopes
            provider.addScope('read:user');

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

    getGitHubLink() {
        // GitHub provider data
        if (this.currentUser?.providerData) {
            const githubData = this.currentUser.providerData.find(
                p => p.providerId === 'github.com'
            );
            if (githubData) {
                // Extract username from photoURL or use uid
                const match = githubData.photoURL?.match(/\/u\/(\d+)/);
                if (match) {
                    return `https://github.com/${githubData.displayName || ''}`;
                }
            }
        }
        return null;
    }
};

// Initialize auth module
Auth.init();

// Export for use in other modules
window.Auth = Auth;
