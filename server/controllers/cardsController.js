const fetch = require('node-fetch');

// Simple in-memory cache for search results
// Key: query string, Value: { data, timestamp }
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Normalize a raw card object from pokemonpricetracker.com API
 */
function normalizeCard(raw) {
    // The API uses 'variants' for market data and 'tcgplayer' for links
    const variants = raw.variants || {};
    const variantKeys = Object.keys(variants);

    // Pick the first available variant (e.g., 'Normal', 'Holofoil') to extract prices
    const mainVariant = variantKeys.length > 0 ? variants[variantKeys[0]] : {};

    const avgPrice =
        mainVariant.marketPrice ||
        mainVariant.price ||
        raw.price ||
        raw.marketPrice ||
        null;

    const highPrice =
        mainVariant.highPrice ||
        raw.highPrice ||
        null;

    const lowPrice =
        mainVariant.lowPrice ||
        raw.lowPrice ||
        null;

    return {
        id: raw.id || raw.cardId || null,
        name: raw.name || 'Unknown',
        set: raw.set?.name || raw.setName || raw.set || 'Unknown Set',
        number: raw.number || raw.cardNumber || null,
        rarity: raw.rarity || null,
        // Use CDN URLs for better reliability
        image: raw.imageCdnUrl || raw.imageCdnUrl400 || raw.images?.large || raw.image || raw.imageUrl || null,
        avgPrice: avgPrice ? parseFloat(avgPrice) : null,
        highPrice: highPrice ? parseFloat(highPrice) : null,
        lowPrice: lowPrice ? parseFloat(lowPrice) : null,
        lastUpdated: raw.updatedAt || raw.lastUpdated || new Date().toISOString(),
    };
}

/**
 * GET /api/cards/search?q=
 */
exports.searchCards = async (req, res) => {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
        return res.status(400).json({ error: 'Query parameter "q" is required.' });
    }

    const apiKey = process.env.POKEMON_API_KEY;
    if (!apiKey || apiKey === 'your_key_here') {
        return res.status(503).json({
            error: 'API key not configured.',
            message: 'Please set POKEMON_API_KEY in the server .env file.',
        });
    }

    const baseUrl = process.env.POKEMON_API_BASE_URL || 'https://www.pokemonpricetracker.com/api/v2';
    const url = `${baseUrl}/cards?search=${encodeURIComponent(q.trim())}&limit=20`;

    // Check cache first
    const cacheKey = q.trim().toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        console.log(`[Cache Hit] Serving results for: "${cacheKey}"`);
        return res.json(cached.data);
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            timeout: 10000,
        });

        if (response.status === 401) {
            return res.status(401).json({ error: 'Invalid or expired API key.' });
        }

        if (response.status === 429) {
            const errorText = await response.text();
            console.warn(`[API Rate Limit] 429 hit for: "${cacheKey}". Response:`, errorText);
            // Fallback to stale cache if available
            if (cached) {
                console.log(`[Cache Fallback] Serving stale data for: "${cacheKey}"`);
                return res.json(cached.data);
            }
            return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Pokemon API error ${response.status}:`, errorText);
            return res.status(502).json({
                error: 'Pokemon Price Tracker API error.',
                statusCode: response.status,
            });
        }

        const data = await response.json();

        // The API may return { data: [...] } or directly an array
        const rawCards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);

        if (!rawCards.length) {
            return res.json({ results: [], total: 0, query: q });
        }

        const normalized = rawCards.map(normalizeCard);
        const result = {
            results: normalized,
            total: normalized.length,
            query: q,
        };

        // Save to cache
        searchCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });

        return res.json(result);
    } catch (err) {
        console.error('Error calling Pokemon Price Tracker API:', err.message);
        return res.status(500).json({
            error: 'Failed to reach Pokemon Price Tracker API.',
            message: err.message,
        });
    }
};
