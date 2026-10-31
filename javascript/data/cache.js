/**
 * Small data cache for private, per-account content (stale-while-revalidate).
 *
 * - Keys are scoped by role + account (teacher e-mail / student faculty number)
 *   + resource + params; never by an auth token.
 * - Entries live in memory and in sessionStorage (dies with the tab, cleared on
 *   logout by shared.js clearSessionData()).
 * - In-flight requests are shared, and an epoch per key stops a response that
 *   was started before a mutation/invalidation from overwriting newer data.
 *
 *   const key = cacheKey(scope, 'classes');
 *   const hit = readCache(key);                 // { data, at } | null
 *   if (hit) render(hit.data);
 *   if (!isFresh(hit, 30_000)) revalidate(key, fetchClasses).then(({ data, current }) => current && render(data));
 */

const PREFIX = 'sc.cache.v1|';
const memory = new Map();
const inflight = new Map();
const epochs = new Map();
// Bumped by clearAllCaches(): responses started before a logout / auth
// rejection are dropped instead of being written back.
let generation = 0;

export function cacheKey(scope, resource, params) {
    const suffix = params === undefined || params === null ? '' : `|${typeof params === 'string' ? params : JSON.stringify(params)}`;
    return `${PREFIX}${scope || 'anon'}|${resource}${suffix}`;
}

/** Scope for the signed-in teacher, or null when there is no teacher session. */
export function teacherScope() {
    try {
        const raw = sessionStorage.getItem('teacherData');
        const email = raw ? String(JSON.parse(raw)?.email || '').trim().toLowerCase() : '';
        return email ? `teacher:${email}` : null;
    } catch (_) {
        return null;
    }
}

export function readCache(key) {
    if (memory.has(key)) return memory.get(key);
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (!entry || typeof entry.at !== 'number') return null;
        memory.set(key, entry);
        return entry;
    } catch (_) {
        return null;
    }
}

export function writeCache(key, data) {
    const entry = { data, at: Date.now() };
    // Private data is only cached for a known account
    if (key.includes('|anon|')) return entry;
    memory.set(key, entry);
    try {
        sessionStorage.setItem(key, JSON.stringify(entry));
    } catch (_) {
        // Quota or privacy mode: memory copy still works for this page
    }
    return entry;
}

export function isFresh(entry, maxAgeMs) {
    return !!entry && Date.now() - entry.at < maxAgeMs;
}

const epochOf = (key) => epochs.get(key) || 0;

/** Drop an entry and make any request already in flight for it "stale". */
export function invalidateCache(key) {
    epochs.set(key, epochOf(key) + 1);
    memory.delete(key);
    inflight.delete(key);
    try { sessionStorage.removeItem(key); } catch (_) {}
}

/**
 * Update an entry in place after a successful mutation (e.g. a rename),
 * marking older in-flight responses stale so they cannot undo it.
 */
export function updateCache(key, updater) {
    const current = readCache(key);
    if (!current) return null;
    epochs.set(key, epochOf(key) + 1);
    inflight.delete(key);
    return writeCache(key, updater(current.data));
}

/**
 * Fetch fresh data for a key, sharing a request that is already running.
 * Resolves to { data, current } — `current` is false when the cache was
 * invalidated/updated while the request was in flight (do not render it).
 */
export function revalidate(key, fetcher) {
    if (inflight.has(key)) return inflight.get(key);
    const startedEpoch = epochOf(key);
    const startedGeneration = generation;
    const promise = Promise.resolve()
        .then(fetcher)
        .then((data) => {
            const current = epochOf(key) === startedEpoch && generation === startedGeneration;
            if (current) writeCache(key, data);
            return { data, current };
        })
        .finally(() => {
            if (inflight.get(key) === promise) inflight.delete(key);
        });
    inflight.set(key, promise);
    return promise;
}

/** Remove every cached entry (all accounts). Used on logout / auth rejection. */
export function clearAllCaches() {
    generation += 1;
    memory.clear();
    inflight.clear();
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(PREFIX)) sessionStorage.removeItem(key);
        }
    } catch (_) {}
}
