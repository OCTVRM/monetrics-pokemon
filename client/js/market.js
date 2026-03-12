// ─── Market Module ─────────────────────────────────────────────────────────────
// Handles all Firestore CRUD for the Community Market listings.

import { db } from './firebase.js';
import {
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    updateDoc,
    serverTimestamp,
    orderBy,
    query,
    where,
    onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Market Listings ───────────────────────────────────────────────────────────

/**
 * Subscribe to all active market listings.
 * Returns an unsubscribe function.
 */
export function subscribeToMarketListings(callback) {
    const q = query(
        collection(db, 'market'),
        where('estado', '==', 'activo')
    );
    return onSnapshot(q, (snap) => {
        let listings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Sort locally by createdAt desc to avoid requiring a Firestore composite index
        listings.sort((a, b) => {
            const timeA = a.createdAt?.toMillis() || Date.now();
            const timeB = b.createdAt?.toMillis() || Date.now();
            return timeB - timeA;
        });
        callback(listings);
    }, (err) => {
        console.error('Error subscribing to market:', err);
        callback([]);
    });
}

/**
 * Get a single market listing by ID.
 */
export async function getMarketListing(listingId) {
    const ref = doc(db, 'market', listingId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Publicación no encontrada');
    return { id: snap.id, ...snap.data() };
}

/**
 * Create a new market listing.
 */
export async function createMarketListing(uid, data) {
    const ref = collection(db, 'market');
    const docRef = await addDoc(ref, {
        uid,
        nombre: data.nombre.trim(),
        edicion: data.edicion ? data.edicion.trim() : '',
        rareza: data.rareza ? data.rareza.trim() : '',
        numero: data.numero ? data.numero.trim() : '',
        ilustrador: data.ilustrador ? data.ilustrador.trim() : '',
        idioma: data.idioma || 'Español',
        precio: parseFloat(data.precio) || 0,
        precioRecomendado: parseFloat(data.precioRecomendado) || 0,
        imagenUrl: data.imagenUrl || null,
        estado: 'activo',
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/**
 * Get all active listings for the same card name + edition.
 */
export async function getListingsBySameCard(nombre, edicion) {
    const q = query(
        collection(db, 'market'),
        where('estado', '==', 'activo'),
        where('nombre', '==', nombre),
        where('edicion', '==', edicion)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Deactivate a listing (soft delete).
 */
export async function deactivateMarketListing(listingId) {
    const ref = doc(db, 'market', listingId);
    await updateDoc(ref, { estado: 'inactivo' });
}
