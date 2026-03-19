import { supabase } from './supabase.js';

// ─── Conversation Queries ───────────────────────────────────────────────────────

/**
 * Get all conversations for the current user,
 * including the partner's profile, listing info, and the last message.
 */
export async function getConversations() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('conversations')
        .select(`
            id, buyer_id, seller_id, listing_id, created_at,
            listing:market(id, nombre, edicion, precio, imagen_url, numero),
            buyer:users!conversations_buyer_id_fkey(id, email, nickname),
            seller:users!conversations_seller_id_fkey(id, email, nickname)
        `)
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching conversations:", error);
        return [];
    }

    const convs = data || [];

    // Fetch the last message for each conversation in parallel
    await Promise.all(convs.map(async (conv) => {
        const { data: msgs } = await supabase
            .from('messages')
            .select('id, content, sender_id, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1);
        conv.lastMessage = msgs && msgs.length > 0 ? msgs[0] : null;
    }));

    return convs;
}

/**
 * Get a single conversation by ID (used when a new conversation was just created).
 */
export async function getConversationById(conversationId) {
    const { data, error } = await supabase
        .from('conversations')
        .select(`
            id, buyer_id, seller_id, listing_id, created_at,
            listing:market(id, nombre, edicion, precio, imagen_url, numero),
            buyer:users!conversations_buyer_id_fkey(id, email, nickname),
            seller:users!conversations_seller_id_fkey(id, email, nickname)
        `)
        .eq('id', conversationId)
        .single();

    if (error) {
        console.error("Error fetching conversation by id:", error);
        return null;
    }

    data.lastMessage = null;
    return data;
}

/**
 * Get or create a conversation for a listing.
 * Optionally sends an automatic first message from the buyer.
 */
export async function getOrCreateConversation(listingId, sellerId, listingInfo = null, cantidad = 1) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Debes iniciar sesión para comprar');
    if (user.id === sellerId) throw new Error('No puedes comprar tu propia carta');

    // Check if a conversation for this listing+buyer already exists
    const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('listing_id', listingId)
        .eq('buyer_id', user.id)
        .maybeSingle();

    if (existing) return existing;

    // Create new conversation
    const { data: created, error: cError } = await supabase
        .from('conversations')
        .insert({
            listing_id: listingId,
            buyer_id: user.id,
            seller_id: sellerId
        })
        .select('id')
        .single();

    if (cError) throw cError;

    // Send automatic initial message with listing details
    if (listingInfo) {
        const precio = Number(listingInfo.precio || 0).toLocaleString('es-CL');
        const introMsg = `¡Hola! Me interesa comprar ${cantidad} unidad(es) de tu publicación "${listingInfo.nombre}"` +
            (listingInfo.edicion ? ` (${listingInfo.edicion})` : '') +
            (listingInfo.numero ? ` #${listingInfo.numero}` : '') +
            ` por un total aproximado de CLP $${(Number(listingInfo.precio || 0) * cantidad).toLocaleString('es-CL')}. ¿Está disponible?`;

        await supabase.from('messages').insert({
            conversation_id: created.id,
            sender_id: user.id,
            content: introMsg
        });
    }

    return created;
}

// ─── Messages ──────────────────────────────────────────────────────────────────

/**
 * Get all messages for a conversation, including sender profile.
 */
export async function getMessages(conversationId) {
    const { data, error } = await supabase
        .from('messages')
        .select(`
            id, conversation_id, sender_id, content, created_at,
            sender:users!messages_sender_id_fkey(id, email, nickname)
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error("Error fetching messages:", error);
        return [];
    }

    return data || [];
}

/**
 * Send a message to a conversation.
 */
export async function sendMessage(conversationId, content) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No autenticado');

    const { data, error } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            sender_id: user.id,
            content: content.trim()
        })
        .select(`
            id, conversation_id, sender_id, content, created_at,
            sender:users!messages_sender_id_fkey(id, email, nickname)
        `)
        .single();

    if (error) throw error;
    return data;
}

// ─── Realtime Subscriptions ────────────────────────────────────────────────────

/**
 * Subscribe to new messages in a conversation.
 */
export function subscribeToMessages(conversationId, onNewMessage) {
    const channel = supabase.channel(`chat_msgs_${conversationId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `conversation_id=eq.${conversationId}`
            },
            async (payload) => {
                // Fetch full message with sender profile
                const { data } = await supabase
                    .from('messages')
                    .select(`
                        id, conversation_id, sender_id, content, created_at,
                        sender:users!messages_sender_id_fkey(id, email, nickname)
                    `)
                    .eq('id', payload.new.id)
                    .single();
                if (data) onNewMessage(data);
                else onNewMessage(payload.new); // fallback
            }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}

/**
 * Subscribe to new conversations where the current user is the seller.
 * Fires when a buyer initiates a new chat.
 */
export function subscribeToNewConversations(userId, onNewConversation) {
    const channel = supabase.channel(`seller_convs_${userId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'conversations'
            },
            async (payload) => {
                // Only trigger if this user is the seller
                if (payload.new.seller_id !== userId) return;

                // Fetch the full conversation with joins for the sidebar
                const full = await getConversationById(payload.new.id);
                if (full) onNewConversation(full);
            }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}
