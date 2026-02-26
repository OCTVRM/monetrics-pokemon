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
    query
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── User Document ─────────────────────────────────────────────────────────────

export async function ensureUserDocument(uid, email) {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
        await setDoc(userRef, { email, createdAt: serverTimestamp() });
    }
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
 * If the card already exists (by cardIdAPI), increment the quantity instead.
 */
export async function addCardToDeck(uid, deckId, cardData) {
    const cardsRef = collection(db, 'users', uid, 'decks', deckId, 'cards');
    const existingSnap = await getDocs(cardsRef);

    const existingCard = existingSnap.docs.find(
        d => d.data().cardIdAPI === cardData.cardIdAPI
    );

    if (existingCard) {
        const newQty = (existingCard.data().cantidad || 1) + 1;
        await updateDoc(existingCard.ref, { cantidad: newQty });
        return existingCard.id;
    }

    // New card - store current price as saved price
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
    return docRef.id;
}

/**
 * Remove a card from a deck completely.
 */
export async function removeCardFromDeck(uid, deckId, cardId) {
    await deleteDoc(doc(db, 'users', uid, 'decks', deckId, 'cards', cardId));
}

/**
 * Update the quantity of a card in a deck.
 */
export async function updateCardQuantity(uid, deckId, cardId, cantidad) {
    if (cantidad <= 0) {
        return removeCardFromDeck(uid, deckId, cardId);
    }
    await updateDoc(doc(db, 'users', uid, 'decks', deckId, 'cards', cardId), { cantidad });
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

// ─── Summary Calculation ───────────────────────────────────────────────────────

/**
 * Calculate the deck summary from a list of card objects.
 * @param {Array} cards
 * @returns {{ total: number, cardCount: number, mostExpensive: object|null, uniqueCards: number }}
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
