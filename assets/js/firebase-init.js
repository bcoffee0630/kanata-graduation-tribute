/**
 * Firebase Initialization
 * Firebase 初始化
 */

// Initialize Firebase
let app, auth, db, storage;

async function initializeFirebase() {
    try {
        // Import Firebase config (must be created from firebase-config.example.js)
        const configModule = await import('./firebase-config.js');
        const firebaseConfig = configModule.default;

        // Initialize Firebase app
        app = firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();

        console.log('Firebase initialized successfully');

        // Dispatch event for other scripts
        window.dispatchEvent(new CustomEvent('firebaseReady'));

        return { app, auth, db, storage };
    } catch (error) {
        console.error('Failed to initialize Firebase:', error);
        throw error;
    }
}

// Export for use in other modules
window.FirebaseApp = {
    init: initializeFirebase,
    getAuth: () => auth,
    getDb: () => db,
    getStorage: () => storage
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase().catch(err => {
        console.warn('Firebase initialization failed. Some features may not work.');
    });
});
