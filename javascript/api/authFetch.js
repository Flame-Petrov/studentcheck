import { getAuthToken } from '../auth/authStore.js';

/**
 * Build request headers that include the teacher's bearer token when signed in.
 * @param {Object} [extra] - Additional headers (e.g. Content-Type)
 * @returns {Object} Headers object for fetch
 */
export function authHeaders(extra = {}) {
    const token = getAuthToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

export async function authJsonFetch(url, options = {}) {
    const token = getAuthToken();
    const headers = new Headers(options.headers || {});
    const hadAuthHeader = Boolean(token);

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(body?.error || body?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.body = body;
        error.endpoint = url;
        error.hadAuthHeader = hadAuthHeader;
        throw error;
    }

    return body;
}

