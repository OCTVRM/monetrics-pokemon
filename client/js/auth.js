import { supabase } from './supabase.js';

/**
 * Register a new user
 */
export async function registerUser(email, password) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
    });
    if (error) throw error;
    // For auto-confirm, data.user is returned. Otherwise we might have to wait for verification.
    return data.user;
}

/**
 * Sign in with email and password
 */
export async function loginUser(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });
    if (error) throw error;
    return data.user;
}

/**
 * Sign the current user out.
 */
export async function logoutUser() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

/**
 * Listen to auth state changes.
 * @param {Function} callback - receives (user | null)
 */
export function onAuthStateChanged(callback) {
    // Call it once immediately with current session
    supabase.auth.getSession().then(({ data: { session } }) => {
        callback(session?.user || null);
    });

    // Then listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
            callback(session?.user || null);
        }
    );

    // Return unsubscribe function
    return () => subscription.unsubscribe();
}

/**
 * Get the current user synchronously (returns null if not cached).
 * Warning: this only checks local session in Supabase.
 */
export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}
