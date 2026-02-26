// ─── Auth Module ──────────────────────────────────────────────────────────────
import { auth, db } from './firebase.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged as _onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    doc,
    setDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Register a new user and create their Firestore profile.
 */
export async function registerUser(email, password) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Create user document in Firestore
    await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp()
    });
    return cred.user;
}

/**
 * Sign in with email and password.
 */
export async function loginUser(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
}

/**
 * Sign the current user out.
 */
export async function logoutUser() {
    await signOut(auth);
}

/**
 * Listen to auth state changes.
 * @param {Function} callback - receives (user | null)
 */
export function onAuthStateChanged(callback) {
    return _onAuthStateChanged(auth, callback);
}

/**
 * Get the current user synchronously.
 */
export function getCurrentUser() {
    return auth.currentUser;
}
