// ─── Decks Module ─────────────────────────────────────────────────────────────
// Handles all Supabase CRUD for users, decks, and cards.

import { supabase } from './supabase.js';

// ─── User Document ─────────────────────────────────────────────────────────────

/**
 * ensureUserDocument is now handled by a Postgres trigger on auth.users in Supabase.
 * We keep the function signature as a no-op to not break ui.js.
 */
export async function ensureUserDocument(uid, email) {
    return Promise.resolve();
}

/**
 * Get user profile data (nickname, ciudad, email, role).
 */
export async function getUserProfile(uid) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', uid)
            .single();
        if (error) throw error;
        return data || {};
    } catch (err) {
        console.warn("Error in getUserProfile, returning empty:", err);
        return {};
    }
}

/**
 * Get public profile data (nickname, ciudad, role, phone_number) and aggregate rating.
 */
export async function getPublicProfile(uid) {
    try {
        const { data: user, error: uError } = await supabase
            .from('users')
            .select('id, email, nickname, ciudad, phone_number, created_at')
            .eq('id', uid)
            .single();
        if (uError) throw uError;

        const { data: reviews, error: rError } = await supabase
            .from('reviews')
            .select('rating')
            .eq('reviewee_id', uid);

        let avgRating = 0;
        if (reviews && reviews.length > 0) {
            avgRating = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;
        }

        return { ...user, avgRating, totalReviews: reviews?.length || 0 };
    } catch (err) {
        console.error("Error in getPublicProfile:", err);
        throw err;
    }
}

/**
 * Update user profile fields (nickname, ciudad).
 */
export async function updateUserProfile(uid, data) {
    const { error } = await supabase
        .from('users')
        .update({
            nickname: (data.nickname || '').trim(),
            ciudad: (data.ciudad || '').trim(),
            phone_number: (data.phone_number || '').trim()
        })
        .eq('id', uid);
    if (error) throw error;
}

// ─── Decks CRUD ────────────────────────────────────────────────────────────────

/**
 * Format a DB deck record into what UI expects.
 */
function formatDeck(d) {
    if (!d) return null;
    return {
        id: d.id,
        nombre: d.nombre,
        descripcion: d.descripcion,
        totalCards: d.total_cards,
        totalValue: d.total_value,
        createdAt: d.created_at,
        user_id: d.user_id
    };
}

/**
 * Create a new deck for the user.
 */
export async function createDeck(uid, { nombre, descripcion }) {
    const { data, error } = await supabase
        .from('decks')
        .insert({
            user_id: uid,
            nombre: nombre.trim(),
            descripcion: descripcion ? descripcion.trim() : '',
            total_cards: 0,
            total_value: 0
        })
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
}

/**
 * Get all decks for a user.
 */
export async function getUserDecks(uid) {
    const { data, error } = await supabase
        .from('decks')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(formatDeck);
}

/**
 * Get a single deck by ID.
 */
export async function getDeck(uid, deckId) {
    const { data, error } = await supabase
        .from('decks')
        .select('*')
        .eq('id', deckId)
        .single();
    if (error) throw new Error('Deck not found');
    return formatDeck(data);
}

/**
 * Subscribe to a single deck.
 */
export function subscribeToDeck(uid, deckId, callback) {
    // Initial fetch
    getDeck(uid, deckId).then(callback).catch(() => callback(null));

    const channel = supabase.channel(`deck_${deckId}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'decks', filter: `id=eq.${deckId}` },
            (payload) => {
                getDeck(uid, deckId).then(callback).catch(() => callback(null));
            }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}

/**
 * Subscribe to all decks for a user.
 */
export function subscribeToUserDecks(uid, callback) {
    // Initial fetch
    getUserDecks(uid).then(callback).catch(() => callback([]));

    const channel = supabase.channel(`user_decks_${uid}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'decks', filter: `user_id=eq.${uid}` },
            (payload) => {
                getUserDecks(uid).then(callback).catch(() => callback([]));
            }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}

/**
 * Delete a deck and all its cards. (Cascade delete handles cards automatically in PG)
 */
export async function deleteDeck(uid, deckId) {
    const { error } = await supabase
        .from('decks')
        .delete()
        .eq('id', deckId)
        .eq('user_id', uid);
    if (error) throw error;
}

// ─── Cards CRUD ────────────────────────────────────────────────────────────────

/**
 * Format DB card to UI representation
 */
function formatCard(c) {
    if (!c) return null;
    return {
        id: c.id,
        cardIdAPI: c.card_id,
        nombre: c.nombre,
        set: c.set_name,
        numero: c.numero,
        imagen: c.image_url,
        precioUnitario: parseFloat(c.price) || 0,
        cantidad: c.cantidad,
        fechaAgregada: c.created_at
    };
}

/**
 * Add a card to a deck.
 */
export async function addCardToDeck(uid, deckId, cardData) {
    // Check if card exists in this deck
    const { data: existing } = await supabase
        .from('cards')
        .select('*')
        .eq('deck_id', deckId)
        .eq('card_id', cardData.cardIdAPI || '')
        .single();

    let resId;
    if (existing) {
        const newQty = (existing.cantidad || 1) + 1;
        const { error } = await supabase
            .from('cards')
            .update({ cantidad: newQty })
            .eq('id', existing.id);
        if (error) throw error;
        resId = existing.id;
    } else {
        const { data, error } = await supabase
            .from('cards')
            .insert({
                user_id: uid,
                deck_id: deckId,
                card_id: cardData.cardIdAPI || '',
                nombre: cardData.nombre,
                set_name: cardData.set || 'Unknown',
                numero: cardData.numero || null,
                image_url: cardData.imagen || null,
                price: parseFloat(cardData.precioUnitario) || 0,
                cantidad: 1
            })
            .select('id')
            .single();
        if (error) throw error;
        resId = data.id;
    }

    await syncDeckStats(uid, deckId);
    return resId;
}

/**
 * Remove a card from a deck completely.
 */
export async function removeCardFromDeck(uid, deckId, cardId) {
    const { error } = await supabase
        .from('cards')
        .delete()
        .eq('id', cardId);
    if (error) throw error;
    await syncDeckStats(uid, deckId);
}

/**
 * Update the quantity of a card in a deck.
 */
export async function updateCardQuantity(uid, deckId, cardId, cantidad) {
    if (cantidad <= 0) {
        return removeCardFromDeck(uid, deckId, cardId);
    }
    const { error } = await supabase
        .from('cards')
        .update({ cantidad })
        .eq('id', cardId);
    if (error) throw error;
    await syncDeckStats(uid, deckId);
}

/**
 * Get all cards in a deck.
 */
export async function getDeckCards(uid, deckId) {
    const { data, error } = await supabase
        .from('cards')
        .select('*')
        .eq('deck_id', deckId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(formatCard);
}

/**
 * Subscribe to all cards in a deck.
 */
export function subscribeToDeckCards(uid, deckId, callback) {
    // Initial fetch
    getDeckCards(uid, deckId).then(callback).catch(() => callback([]));

    const channel = supabase.channel(`deck_cards_${deckId}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'cards', filter: `deck_id=eq.${deckId}` },
            (payload) => {
                getDeckCards(uid, deckId).then(callback).catch(() => callback([]));
            }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}

// ─── Summary Calculation ───────────────────────────────────────────────────────

/**
 * Recalculate stats for a deck and save them to the deck document.
 */
export async function syncDeckStats(uid, deckId) {
    const cards = await getDeckCards(uid, deckId);
    const summary = calculateDeckSummary(cards);

    await supabase.from('decks').update({
        total_cards: summary.cardCount,
        total_value: summary.total || 0
    }).eq('id', deckId);

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
