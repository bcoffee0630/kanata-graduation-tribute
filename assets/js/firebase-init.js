/**
 * Firebase initialization shared by the public site and administration UI.
 * Hosting's reserved init endpoint keeps staging and production isolated.
 */

let app, auth, db, storage, functions;
let initializationPromise = null;

async function resolveFirebaseConfig() {
    if (window.__USE_LOCAL_FIREBASE_CONFIG__ && window.firebaseConfig) {
        return window.firebaseConfig;
    }

    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Firebase Hosting configuration failed (${response.status})`);
    }
    return response.json();
}

function shouldUseEmulators() {
    const host = window.location.hostname;
    const params = new URLSearchParams(window.location.search);
    return (host === 'localhost' || host === '127.0.0.1') &&
        (window.location.port === '5050' || params.get('emulator') === '1');
}

function initializeFirebase() {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
        const firebaseConfig = await resolveFirebaseConfig();
        const initializedApp = firebase.apps.length
            ? firebase.app()
            : firebase.initializeApp(firebaseConfig);
        const initializedAuth = initializedApp.auth();
        const initializedDb = typeof initializedApp.firestore === 'function'
            ? initializedApp.firestore()
            : null;
        const initializedStorage = typeof initializedApp.storage === 'function'
            ? initializedApp.storage()
            : null;
        const initializedFunctions = typeof initializedApp.functions === 'function'
            ? initializedApp.functions('asia-east1')
            : null;

        if (shouldUseEmulators()) {
            initializedAuth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
            initializedDb?.useEmulator('127.0.0.1', 8180);
            initializedStorage?.useEmulator('127.0.0.1', 9199);
            initializedFunctions?.useEmulator('127.0.0.1', 5001);
        }

        app = initializedApp;
        auth = initializedAuth;
        db = initializedDb;
        storage = initializedStorage;
        functions = initializedFunctions;

        window.dispatchEvent(new CustomEvent('firebaseReady', {
            detail: { projectId: firebaseConfig.projectId }
        }));
        return { app, auth, db, storage, functions };
    })().catch((error) => {
        initializationPromise = null;
        throw error;
    });

    return initializationPromise;
}

window.FirebaseApp = {
    init: initializeFirebase,
    getApp: () => app,
    getAuth: () => auth,
    getDb: () => db,
    getStorage: () => storage,
    getFunctions: () => functions,
    getProjectId: () => app?.options?.projectId || null,
    isUsingEmulators: shouldUseEmulators
};

document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase().catch((error) => {
        console.error('Failed to initialize Firebase:', error);
        window.dispatchEvent(new CustomEvent('firebaseError', { detail: { error } }));
    });
});
