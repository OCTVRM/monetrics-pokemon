import { supabase } from './supabase.js';

export const store = {
    // Products
    async getProducts() {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    },

    async createProduct(productData) {
        const { data, error } = await supabase
            .from('products')
            .insert([productData])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async deleteProduct(productId) {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', productId);

        if (error) throw error;
    },

    // Cart Items
    async getCartItems(userId) {
        if (!userId) return [];

        const { data, error } = await supabase
            .from('cart_items')
            .select(`
                *,
                products (*)
            `)
            .eq('user_id', userId);

        if (error) throw error;
        return data;
    },

    async addToCart(userId, productId, cantidad = 1) {
        // Get product stock first
        const { data: product, error: pError } = await supabase
            .from('products')
            .select('stock')
            .eq('id', productId)
            .single();

        if (pError || !product) throw new Error('Producto no encontrado');

        // Try to get existing item
        const { data: existing } = await supabase
            .from('cart_items')
            .select('*')
            .eq('user_id', userId)
            .eq('product_id', productId)
            .single();

        const newCantidad = existing ? existing.cantidad + cantidad : cantidad;

        if (newCantidad > product.stock) {
            throw new Error(`Stock insuficiente. Solo quedan ${product.stock} unidades.`);
        }

        if (existing) {
            const { data, error } = await supabase
                .from('cart_items')
                .update({ cantidad: newCantidad })
                .eq('id', existing.id)
                .select()
                .single();
            if (error) throw error;
            return data;
        } else {
            const { data, error } = await supabase
                .from('cart_items')
                .insert([{ user_id: userId, product_id: productId, cantidad }])
                .select()
                .single();
            if (error) throw error;
            return data;
        }
    },

    async updateCartItemQuantity(userId, itemId, cantidad) {
        if (cantidad <= 0) {
            return this.removeFromCart(userId, itemId);
        }

        // Get product stock from joined item
        const { data: item, error: iError } = await supabase
            .from('cart_items')
            .select('*, products(stock)')
            .eq('id', itemId)
            .single();

        if (iError || !item) throw new Error('Item del carrito no encontrado');
        if (cantidad > item.products.stock) {
            throw new Error(`Stock insuficiente. Solo quedan ${item.products.stock} unidades.`);
        }

        const { data, error } = await supabase
            .from('cart_items')
            .update({ cantidad })
            .eq('id', itemId)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async removeFromCart(userId, itemId) {
        const { error } = await supabase
            .from('cart_items')
            .delete()
            .eq('id', itemId)
            .eq('user_id', userId);

        if (error) throw error;
    },

    async clearCart(userId) {
        const { error } = await supabase
            .from('cart_items')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;
    },

    subscribeToCart(userId, callback) {
        if (!userId) return null;

        return supabase
            .channel(`cart:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'cart_items',
                    filter: `user_id=eq.${userId}`
                },
                () => {
                    this.getCartItems(userId).then(callback);
                }
            )
            .subscribe();
    }
};
