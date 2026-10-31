/**
 * Selective prefetching helpers.
 *
 * Warm only the likely next view or small data after the current view is
 * usable (idle), or on intent (hover / keyboard focus / touchstart — the mobile
 * signal, ~100ms before the tap). Respects Save-Data, slow connections and
 * prefers-reduced-data. Never runs page initialisation.
 */

export function canPrefetch() {
    try {
        const connection = navigator.connection;
        if (connection && (connection.saveData || /(^|-)2g$/.test(String(connection.effectiveType || '')))) return false;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-data: reduce)').matches) return false;
    } catch (_) {}
    return true;
}

/** Run when the main thread is idle (after the current view is usable). */
export function whenIdle(fn, timeout = 2500) {
    if (typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(() => fn(), { timeout });
    }
    return window.setTimeout(fn, 600);
}

/**
 * Call `fn` when the user shows intent to use `element` (once per cool-down).
 * @returns {Function} cleanup
 */
export function prefetchOnIntent(element, fn, { cooldownMs = 15000 } = {}) {
    if (!element) return () => {};
    let last = 0;
    const handler = () => {
        const now = Date.now();
        if (now - last < cooldownMs || !canPrefetch()) return;
        last = now;
        try { fn(); } catch (_) {}
    };
    const opts = { passive: true };
    element.addEventListener('pointerenter', handler, opts);
    element.addEventListener('focus', handler, opts);
    element.addEventListener('touchstart', handler, opts);
    return () => {
        element.removeEventListener('pointerenter', handler, opts);
        element.removeEventListener('focus', handler, opts);
        element.removeEventListener('touchstart', handler, opts);
    };
}

const prefetchedUrls = new Set();

/** Ask the browser to fetch a file into its HTTP cache without executing it. */
export function prefetchUrl(href, as) {
    if (!href || prefetchedUrls.has(href) || !canPrefetch()) return;
    prefetchedUrls.add(href);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    if (as) link.as = as;
    document.head.appendChild(link);
}
