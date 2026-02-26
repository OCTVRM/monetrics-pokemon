// ─── Firebase SDK (modular v10) via CDN ───────────────────────────────────────
// This file initializes Firebase and exports the auth and db instances.
// Config is from the Firebase Console for project: monetrics-pokemon

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyD5PLlTPFnjapikX-gfU_eFvuSOExz52BQ",
    authDomain: "monetrics-pokemon.firebaseapp.com",
    projectId: "monetrics-pokemon",
    storageBucket: "monetrics-pokemon.firebasestorage.app",
    messagingSenderId: "811540032531",
    appId: "1:811540032531:web:cfdb0bdb1369b6b8b663e6"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});
