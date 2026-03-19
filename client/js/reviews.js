import { supabase } from './supabase.js';

/**
 * Submit a review for a user.
 */
export async function submitReview(revieweeId, conversationId, rating, comment) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autenticado');

    const { data, error } = await supabase
        .from('reviews')
        .insert({
            reviewer_id: user.id,
            reviewee_id: revieweeId,
            conversation_id: conversationId,
            rating: parseInt(rating),
            comment: comment ? comment.trim() : ''
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Get all reviews for a specific user.
 */
export async function getUserReviews(uid) {
    const { data, error } = await supabase
        .from('reviews')
        .select(`
            *,
            reviewer:users!reviews_reviewer_id_fkey(id, nickname, email)
        `)
        .eq('reviewee_id', uid)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching reviews:", error);
        return [];
    }

    return data || [];
}
