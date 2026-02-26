const fetch = require('node-fetch');

/**
 * Normalize a raw card object from pokemonpricetracker.com API
 */
function normalizeCard(raw) {
    // The API may return nested price objects — handle gracefully
    const prices = raw.prices || raw.marketData || {};
    const market = prices.market || prices.tcgplayer || prices.marketPrice || {};

    const avgPrice =
        market.avg ||
        market.marketPrice ||
        market.mid ||
        raw.price ||
        raw.marketPrice ||
        null;

    const highPrice =
        market.high ||
        market.highPrice ||
        raw.highPrice ||
        null;

    const lowPrice =
        market.low ||
        market.lowPrice ||
        raw.lowPrice ||
        null;

    return {
        id: raw.id || raw.cardId || null,
        name: raw.name || 'Unknown',
        set: raw.set?.name || raw.setName || raw.set || 'Unknown Set',
        number: raw.number || raw.cardNumber || null,
        rarity: raw.rarity || null,
        image: raw.images?.large || raw.images?.small || raw.image || raw.imageUrl || null,
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
    const url = `${baseUrl}/cards?search=${encodeURIComponent(q.trim())}`;

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

        return res.json({
            results: normalized,
            total: normalized.length,
            query: q,
        });
    } catch (err) {
        console.error('Error calling Pokemon Price Tracker API:', err.message);
        return res.status(500).json({
            error: 'Failed to reach Pokemon Price Tracker API.',
            message: err.message,
        });
    }
};
