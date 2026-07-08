// ─── Tournaments Module ────────────────────────────────────────────────────────
// Handles all Supabase CRUD for tournaments and matches.

import { supabase } from './supabase.js';

/**
 * Create a new tournament.
 */
export async function createTournament(uid, { name, deck_name, date, format }) {
    const { data, error } = await supabase
        .from('tournaments')
        .insert({
            user_id: uid,
            name: name.trim(),
            deck_name: deck_name.trim(),
            date: date,
            format: format
        })
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
}

/**
 * Get all tournaments for a user.
 */
export async function getUserTournaments(uid) {
    const { data, error } = await supabase
        .from('tournaments')
        .select(`
            *,
            tournament_matches (
                id,
                result,
                points,
                opponent_deck
            )
        `)
        .eq('user_id', uid)
        .order('date', { ascending: false });
    if (error) throw error;
    return data || [];
}

/**
 * Get a single tournament by ID.
 */
export async function getTournament(uid, tournamentId) {
    const { data, error } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .eq('user_id', uid)
        .single();
    if (error) throw error;
    return data;
}

/**
 * Delete a tournament.
 */
export async function deleteTournament(uid, tournamentId) {
    const { error } = await supabase
        .from('tournaments')
        .delete()
        .eq('id', tournamentId)
        .eq('user_id', uid);
    if (error) throw error;
}

/**
 * Add a match to a tournament.
 */
export async function addTournamentMatch(uid, { tournament_id, opponent_deck, result, round_results }) {
    // Result points: Ganador (3), Perdedor (0), Empate (1), BYE (3)
    const points = (result === 'Ganador' || result === 'BYE') ? 3 : (result === 'Empate' ? 1 : 0);
    const opponent = result === 'BYE' ? '-' : opponent_deck.trim();

    const { data, error } = await supabase
        .from('tournament_matches')
        .insert({
            tournament_id,
            opponent_deck: opponent,
            result,
            points,
            round_results: round_results || null
        })
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
}

/**
 * Get all matches for a tournament.
 */
export async function getTournamentMatches(tournamentId) {
    const { data, error } = await supabase
        .from('tournament_matches')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

/**
 * Delete a match.
 */
export async function deleteTournamentMatch(matchId) {
    const { error } = await supabase
        .from('tournament_matches')
        .delete()
        .eq('id', matchId);
    if (error) throw error;
}

/**
 * Subscribe to user tournaments.
 */
export function subscribeToUserTournaments(uid, callback) {
    getUserTournaments(uid).then(callback).catch(() => callback([]));

    const channel = supabase.channel(`user_tournaments_${uid}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'tournaments', filter: `user_id=eq.${uid}` },
            () => getUserTournaments(uid).then(callback)
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}

/**
 * Subscribe to tournament matches.
 */
export function subscribeToTournamentMatches(tournamentId, callback) {
    getTournamentMatches(tournamentId).then(callback).catch(() => callback([]));

    const channel = supabase.channel(`tournament_matches_${tournamentId}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` },
            () => getTournamentMatches(tournamentId).then(callback)
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}
