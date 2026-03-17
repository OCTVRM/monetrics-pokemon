// ─── Market Module ─────────────────────────────────────────────────────────────
// Handles all Supabase CRUD for the Community Market listings.

import { supabase } from './supabase.js';

// ─── Market Listings ───────────────────────────────────────────────────────────

/**
 * Format DB market listing to UI representation
 */
function formatListing(l) {
    if (!l) return null;
    return {
        id: l.id,
        uid: l.seller_id,
        nombre: l.nombre,
        edicion: l.edicion,
        rareza: l.rareza,
        numero: l.numero,
        ilustrador: l.ilustrador,
        idioma: l.idioma,
        precio: parseFloat(l.precio) || 0,
        precioRecomendado: parseFloat(l.precio_recomendado) || 0,
        imagenUrl: l.imagen_url,
        estado: l.estado,
        createdAt: l.created_at
    };
}

/**
 * Subscribe to all active market listings.
 * Returns an unsubscribe function.
 */
export function subscribeToMarketListings(callback) {
    // Initial fetch
    supabase
        .from('market')
        .select('*')
        .eq('estado', 'activo')
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
            if (error) {
                console.error('Error fetching market:', error);
                callback([]);
                return;
            }
            callback((data || []).map(formatListing));
        });

    const channel = supabase.channel('public:market')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'market' },
            (payload) => {
                // To keep sorting and filtering logic intact, we just re-fetch all active on any change
                supabase
                    .from('market')
                    .select('*')
                    .eq('estado', 'activo')
                    .order('created_at', { ascending: false })
                    .then(({ data, error }) => {
                        if (error) {
                            console.error('Error fetching market on change:', error);
                            callback([]);
                            return;
                        }
                        callback((data || []).map(formatListing));
                    });
            }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
}

/**
 * Get a single market listing by ID.
 */
export async function getMarketListing(listingId) {
    const { data, error } = await supabase
        .from('market')
        .select('*')
        .eq('id', listingId)
        .single();
    if (error) throw new Error('Publicación no encontrada');
    return formatListing(data);
}

/**
 * Create a new market listing.
 */
export async function createMarketListing(uid, data) {
    const { data: inserted, error } = await supabase
        .from('market')
        .insert({
            seller_id: uid,
            nombre: data.nombre.trim(),
            edicion: data.edicion ? data.edicion.trim() : '',
            rareza: data.rareza ? data.rareza.trim() : '',
            numero: data.numero ? data.numero.trim() : '',
            ilustrador: data.ilustrador ? data.ilustrador.trim() : '',
            idioma: data.idioma || 'Español',
            precio: parseFloat(data.precio) || 0,
            precio_recomendado: parseFloat(data.precioRecomendado) || 0,
            imagen_url: data.imagenUrl || null,
            estado: 'activo'
        })
        .select('id')
        .single();
    if (error) throw error;
    return inserted.id;
}

/**
 * Get all active listings for the same card name + edition.
 */
export async function getListingsBySameCard(nombre, edicion) {
    const { data, error } = await supabase
        .from('market')
        .select('*')
        .eq('estado', 'activo')
        .eq('nombre', nombre)
        .eq('edicion', edicion)
        .order('precio', { ascending: true }); // A nice touch, order by price!

    if (error) throw error;
    return (data || []).map(formatListing);
}

/**
 * Deactivate a listing (soft delete).
 */
export async function deactivateMarketListing(listingId) {
    const { error } = await supabase
        .from('market')
        .update({ estado: 'inactivo' })
        .eq('id', listingId);
    if (error) throw error;
}
