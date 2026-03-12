// ─── Decks Module ─────────────────────────────────────────────────────────────
// Handles all Firestore CRUD for users, decks, and cards.

import { db } from './firebase.js';
import {
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    updateDoc,
    serverTimestamp,
    orderBy,
    query,
    onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── User Document ─────────────────────────────────────────────────────────────

export async function ensureUserDocument(uid, email) {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
        await setDoc(userRef, { email, createdAt: serverTimestamp() });
    }
}

/**
 * Get user profile data (nickname, ciudad, email).
 */
export async function getUserProfile(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) return {};
        return snap.data();
    } catch (err) {
        console.warn("Error in getUserProfile, returning empty:", err);
        return {};
    }
}

/**
 * Update user profile fields (nickname, ciudad).
 */
export async function updateUserProfile(uid, data) {
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, {
        nickname: data.nickname || '',
        ciudad: data.ciudad || ''
    }, { merge: true });
}

// ─── Decks CRUD ────────────────────────────────────────────────────────────────

/**
 * Create a new deck for the user.
 */
export async function createDeck(uid, { nombre, descripcion }) {
    const decksRef = collection(db, 'users', uid, 'decks');
    const docRef = await addDoc(decksRef, {
        nombre: nombre.trim(),
        descripcion: descripcion ? descripcion.trim() : '',
        totalCards: 0,
        totalValue: 0,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/**
 * Get all decks for a user.
 */
export async function getUserDecks(uid) {
    const decksRef = collection(db, 'users', uid, 'decks');
    const q = query(decksRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get a single deck by ID.
 */
export async function getDeck(uid, deckId) {
    const deckRef = doc(db, 'users', uid, 'decks', deckId);
    const snap = await getDoc(deckRef);
    if (!snap.exists()) throw new Error('Deck not found');
    return { id: snap.id, ...snap.data() };
}

/**
 * Subscribe to a single deck.
 */
export function subscribeToDeck(uid, deckId, callback) {
    const deckRef = doc(db, 'users', uid, 'decks', deckId);
    return onSnapshot(deckRef, (snap) => {
        if (!snap.exists()) {
            callback(null);
        } else {
            callback({ id: snap.id, ...snap.data() });
        }
    }, (err) => {
        console.error('Error subscribing to deck:', err);
    });
}

/**
 * Subscribe to all decks for a user.
 */
export function subscribeToUserDecks(uid, callback) {
    const decksRef = collection(db, 'users', uid, 'decks');
    const q = query(decksRef, orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
        const decks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(decks);
    }, (err) => {
        console.error('Error subscribing to decks:', err);
    });
}

/**
 * Delete a deck and all its cards.
 */
export async function deleteDeck(uid, deckId) {
    // Delete all cards first
    const cardsSnap = await getDocs(collection(db, 'users', uid, 'decks', deckId, 'cards'));
    const delPromises = cardsSnap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(delPromises);
    // Delete the deck document
    await deleteDoc(doc(db, 'users', uid, 'decks', deckId));
}

// ─── Cards CRUD ────────────────────────────────────────────────────────────────

/**
 * Add a card to a deck.
 */
export async function addCardToDeck(uid, deckId, cardData) {
    const cardsRef = collection(db, 'users', uid, 'decks', deckId, 'cards');
    const existingSnap = await getDocs(cardsRef);

    const existingCard = existingSnap.docs.find(
        d => d.data().cardIdAPI === cardData.cardIdAPI
    );

    let resId;
    if (existingCard) {
        const newQty = (existingCard.data().cantidad || 1) + 1;
        await updateDoc(existingCard.ref, { cantidad: newQty });
        resId = existingCard.id;
    } else {
        const docRef = await addDoc(cardsRef, {
            cardIdAPI: cardData.cardIdAPI || null,
            nombre: cardData.nombre,
            set: cardData.set || 'Unknown',
            numero: cardData.numero || null,
            imagen: cardData.imagen || null,
            precioUnitario: cardData.precioUnitario || 0,
            cantidad: 1,
            fechaAgregada: serverTimestamp()
        });
        resId = docRef.id;
    }

    await syncDeckStats(uid, deckId);
    return resId;
}

/**
 * Remove a card from a deck completely.
 */
export async function removeCardFromDeck(uid, deckId, cardId) {
    await deleteDoc(doc(db, 'users', uid, 'decks', deckId, 'cards', cardId));
    await syncDeckStats(uid, deckId);
}

/**
 * Update the quantity of a card in a deck.
 */
export async function updateCardQuantity(uid, deckId, cardId, cantidad) {
    if (cantidad <= 0) {
        return removeCardFromDeck(uid, deckId, cardId);
    }
    await updateDoc(doc(db, 'users', uid, 'decks', deckId, 'cards', cardId), { cantidad });
    await syncDeckStats(uid, deckId);
}

/**
 * Get all cards in a deck.
 */
export async function getDeckCards(uid, deckId) {
    const cardsRef = collection(db, 'users', uid, 'decks', deckId, 'cards');
    const q = query(cardsRef, orderBy('fechaAgregada', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Subscribe to all cards in a deck.
 */
export function subscribeToDeckCards(uid, deckId, callback) {
    const cardsRef = collection(db, 'users', uid, 'decks', deckId, 'cards');
    const q = query(cardsRef, orderBy('fechaAgregada', 'desc'));
    return onSnapshot(q, (snap) => {
        const cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(cards);
    }, (err) => {
        console.error('Error subscribing to cards:', err);
    });
}

// ─── Summary Calculation ───────────────────────────────────────────────────────

/**
 * Recalculate stats for a deck and save them to the deck document.
 */
export async function syncDeckStats(uid, deckId) {
    const cards = await getDeckCards(uid, deckId);
    const summary = calculateDeckSummary(cards);
    const deckRef = doc(db, 'users', uid, 'decks', deckId);
    await updateDoc(deckRef, {
        totalCards: summary.cardCount,
        totalValue: summary.total
    });
    return summary;
}

/**
 * Calculate the deck summary from a list of card objects.
 */
export function calculateDeckSummary(cards) {
    if (!cards || cards.length === 0) {
        return { total: 0, cardCount: 0, mostExpensive: null, uniqueCards: 0 };
    }

    let total = 0;
    let cardCount = 0;
    let mostExpensive = null;

    for (const card of cards) {
        const price = parseFloat(card.precioUnitario) || 0;
        const qty = parseInt(card.cantidad) || 1;
        total += price * qty;
        cardCount += qty;
        if (!mostExpensive || price > parseFloat(mostExpensive.precioUnitario || 0)) {
            mostExpensive = card;
        }
    }

    return {
        total: parseFloat(total.toFixed(2)),
        cardCount,
        mostExpensive,
        uniqueCards: cards.length
    };
}
