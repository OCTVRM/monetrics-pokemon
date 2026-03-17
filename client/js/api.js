// ─── API Module ───────────────────────────────────────────────────────────────
// All calls go through our Express backend proxy — API key never exposed here.

const BASE_URL = '/api';

/**
 * Search cards by name or number.
 * @param {string} query - e.g. "Charizard" or "4/102"
 * @returns {Promise<{ results: Array, total: number, query: string }>}
 */
export async function searchCards(query) {
    if (!query || !query.trim()) throw new Error('Query cannot be empty');
    const url = `${BASE_URL}/cards/search?q=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || `Server error: ${res.status}`);
    }
    return res.json();
}

/**
 * Get the current USD → CLP conversion rate from backend config.
 * @returns {Promise<{ usdToClp: number }>}
 */
export async function getConversionRate() {
    try {
        const res = await fetch(`${BASE_URL}/config/rate`);
        if (!res.ok) {
            console.warn(`Conversion rate API returned ${res.status}, using default 900`);
            return { usdToClp: 900 };
        }
        return await res.json();
    } catch (err) {
        console.warn('Error fetching conversion rate, using default 900:', err);
        return { usdToClp: 900 };
    }
}

