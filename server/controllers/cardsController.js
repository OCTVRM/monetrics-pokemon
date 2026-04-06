const fetch = require('node-fetch');
const https = require('https');

// In-memory cache: key → { data, timestamp }
const searchCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

// Agente HTTPS con soporte IPv4 forzado (evita timeouts por IPv6 en algunos entornos)
const httpsAgent = new https.Agent({ family: 4 });

// Detecta si la query es un código de carta (ej: sv4-100, xy1-12, base1-4, swsh9-150)
const CARD_CODE_REGEX = /^[a-z0-9]+-\d+$/i;

/**
 * Normaliza una carta proveniente de api.pokemontcg.io
 */
function normalizeCard(raw) {
    const prices = raw.tcgplayer?.prices || {};
    const variantPrices = Object.values(prices);
    const mainVariant = variantPrices.length > 0 ? variantPrices[0] : {};

    const avgPrice = mainVariant.market || mainVariant.mid || null;
    const highPrice = mainVariant.high || null;
    const lowPrice = mainVariant.low || null;

    return {
        id: raw.id || null,
        name: raw.name || 'Unknown',
        set: raw.set?.name || 'Unknown Set',
        setId: raw.set?.id || null,
        number: raw.number || null,
        rarity: raw.rarity || null,
        image: raw.images?.large || raw.images?.small || null,
        avgPrice: avgPrice ? parseFloat(avgPrice) : null,
        highPrice: highPrice ? parseFloat(highPrice) : null,
        lowPrice: lowPrice ? parseFloat(lowPrice) : null,
        lastUpdated: raw.tcgplayer?.updatedAt || new Date().toISOString(),
    };
}

/**
 * Llama a api.pokemontcg.io con los parámetros indicados
 */
async function fetchFromOfficialAPI(queryString, pageSize = 20) {
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queryString)}&orderBy=-set.releaseDate&pageSize=${pageSize}`;
    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        agent: httpsAgent,
        timeout: 15000,
    });
    if (!response.ok) {
        throw new Error(`Pokemon TCG API respondió con ${response.status}`);
    }
    const data = await response.json();
    return (data.data || []).map(normalizeCard);
}

/**
 * GET /api/cards/search?q=<nombre o código>
 *
 * - Si q coincide con formato de código (ej: sv4-100): busca la carta exacta por ID.
 * - Si q es un nombre: retorna las 20 cartas más recientes del Pokémon indicado.
 * - Caché en memoria de 1 hora por query.
 */
exports.searchCards = async (req, res) => {
    const { q } = req.query;

    if (!q || !q.trim()) {
        return res.status(400).json({ error: 'Se requiere el parámetro "q".' });
    }

    const rawQuery = q.trim();
    const cacheKey = rawQuery.toLowerCase();

    // Servir desde caché si está vigente
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        let results = [];

        if (CARD_CODE_REGEX.test(rawQuery)) {
            // ── Búsqueda por CÓDIGO exacto ──────────────────────────────────────
            // Buscamos la carta cuyo id coincida exactamente, ej: id:sv4-100
            results = await fetchFromOfficialAPI(`id:${rawQuery.toLowerCase()}`, 1);

            if (results.length === 0) {
                // Fallback: búsqueda por número y set parcial  
                const [setCode, num] = rawQuery.toLowerCase().split('-');
                results = await fetchFromOfficialAPI(`number:${num} set.id:${setCode}`, 1);
            }
        } else {
            // ── Búsqueda por NOMBRE ─────────────────────────────────────────────
            // Traemos las 20 cartas más recientes cuyo nombre coincida
            results = await fetchFromOfficialAPI(`name:"${rawQuery}"`, 20);
        }

        const result = {
            results,
            total: results.length,
            query: rawQuery,
        };

        // Guardar en caché
        searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return res.json(result);

    } catch (err) {
        console.error('[cardsController] Error:', err.message);
        return res.status(500).json({
            error: 'No se pudo conectar con la API de Pokémon TCG.',
            message: err.message,
        });
    }
};
