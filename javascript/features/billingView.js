/**
 * Плащания view (inside teacherHomepage.html; billing.html redirects here).
 *
 * Shows the static card immediately with skeleton values, renders a cached
 * status at once when there is one, and refreshes in the background:
 *   - no data        -> skeleton (static markup) -> values / inline error + retry
 *   - cached data    -> values now, quiet refresh when stale
 *   - refresh failed -> keep values, discreet retry note
 * After a trip to Stripe (portal/checkout) the status is always refreshed.
 */

import { SERVER_BASE_URL } from '../config/api.js';
import { authHeaders } from '../api/authFetch.js';
import { cacheKey, teacherScope, readCache, isFresh, revalidate, invalidateCache } from '../data/cache.js';
import { showStaleNote, hideStaleNote } from '../ui/skeleton.js';

const MAX_AGE_MS = 60 * 1000;
const STRIPE_FLAG = 'sc.billing.stripeReturn';

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

const els = {};
let bound = false;
let hasRendered = false;
let canManageBilling = false;
let renderedState = null;

function key() {
    return cacheKey(teacherScope(), 'billing-status');
}

async function fetchStatus() {
    const res = await fetch(`${SERVER_BASE_URL}/api/billing/status`, { headers: authHeaders({ 'Accept': 'application/json' }) });
    if (!res.ok) {
        const error = new Error(`Status request failed (${res.status})`);
        error.status = res.status;
        throw error;
    }
    return res.json();
}

function formatWords(value) {
    return value ? String(value).replace(/_/g, ' ') : '—';
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const lang = window.i18n?.getLanguage?.() || 'bg';
    return date.toLocaleDateString(lang === 'bg' ? 'bg-BG' : 'en-GB');
}

function setError(message) {
    if (els.error) els.error.textContent = message || '';
}

function render(state) {
    renderedState = state;
    hasRendered = true;
    els.card?.removeAttribute('aria-busy');
    els.loadingStatus?.remove();
    if (els.plan) els.plan.textContent = formatWords(state?.plan);
    if (els.status) els.status.textContent = formatWords(state?.subscription_status);
    if (els.renewal) els.renewal.textContent = formatDate(state?.current_period_end);

    canManageBilling = state?.can_manage_billing !== false;
    if (els.manage && !els.manage.dataset.pending) els.manage.disabled = !canManageBilling;

    const priceId = els.upgrade?.dataset?.priceId;
    if (els.upgrade) els.upgrade.hidden = !(state?.plan === 'free' && !!priceId);
}

function renderInitialError() {
    els.card?.removeAttribute('aria-busy');
    ['plan', 'status', 'renewal'].forEach((k) => { if (els[k]) els[k].textContent = '—'; });
    showStaleNote(els.stale, () => refresh({ force: true }));
    els.stale.querySelector('span').textContent = t('billing_err_status', 'Неуспешно зареждане на статуса на плащанията.');
}

/** Refresh from the server; keeps what is shown if it fails. */
export function refresh({ force = false } = {}) {
    const k = key();
    const cached = readCache(k);
    if (!force && isFresh(cached, MAX_AGE_MS) && hasRendered) return Promise.resolve();
    if (force) invalidateCache(k);
    return revalidate(k, fetchStatus)
        .then(({ data, current }) => {
            if (!current) return;
            hideStaleNote(els.stale);
            setError('');
            render(data);
        })
        .catch((error) => {
            console.error('Billing status error:', error);
            if (error.status === 401) {
                document.dispatchEvent(new CustomEvent('app:authexpired'));
                return;
            }
            if (hasRendered && renderedState) showStaleNote(els.stale, () => refresh({ force: true }));
            else renderInitialError();
        });
}

function setPending(button, pending, label, idleLabel) {
    if (!button) return;
    if (pending) button.dataset.pending = 'true';
    else delete button.dataset.pending;
    button.disabled = pending;
    button.setAttribute('aria-busy', String(pending));
    button.textContent = pending ? label : idleLabel;
}

async function goToStripe(endpoint, body, button, pendingKey, pendingFallback, idleKey, idleFallback, errorKey, errorFallback) {
    setError('');
    setPending(button, true, t(pendingKey, pendingFallback), t(idleKey, idleFallback));
    try {
        const res = await fetch(`${SERVER_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`${endpoint} failed (${res.status})`);
        const data = await res.json();
        if (!data?.url) throw new Error('Stripe URL missing in response');
        // The plan may change on Stripe: refresh when we come back
        try { sessionStorage.setItem(STRIPE_FLAG, '1'); } catch (_) {}
        invalidateCache(key());
        window.location.assign(data.url);
    } catch (error) {
        console.error('Billing redirect error:', error);
        setError(t(errorKey, errorFallback));
        setPending(button, false, '', t(idleKey, idleFallback));
        if (button === els.manage) els.manage.disabled = !canManageBilling;
    }
}

function returnUrl() {
    // Come back to this view in the single teacher document
    return `${location.origin}${location.pathname}#payments`;
}

function bind() {
    if (bound) return;
    bound = true;
    els.card = document.getElementById('billingCard');
    els.loadingStatus = document.getElementById('billingLoadingStatus');
    els.plan = document.getElementById('billingPlan');
    els.status = document.getElementById('billingStatus');
    els.renewal = document.getElementById('billingRenewal');
    els.error = document.getElementById('billingError');
    els.stale = document.getElementById('billingStale');
    els.manage = document.getElementById('manageBillingBtn');
    els.upgrade = document.getElementById('upgradeBillingBtn');

    els.manage?.addEventListener('click', () => {
        if (!canManageBilling || els.manage.dataset.pending) return;
        goToStripe('/api/billing/portal', { returnUrl: returnUrl() }, els.manage,
            'billing_opening', 'Отваряне...', 'billing_manage', 'Управление на плащания',
            'billing_err_portal', 'Неуспешно отваряне на портала за плащания. Опитайте отново.');
    });
    els.upgrade?.addEventListener('click', () => {
        const priceId = els.upgrade.dataset.priceId;
        if (!priceId) { setError(t('billing_upgrade_not_configured', 'Надграждането все още не е конфигурирано.')); return; }
        if (els.upgrade.dataset.pending) return;
        goToStripe('/api/billing/checkout', { priceId, returnUrl: returnUrl() }, els.upgrade,
            'billing_starting', 'Стартиране...', 'billing_upgrade', 'Надграждане',
            'billing_err_checkout', 'Неуспешно стартиране на плащането. Опитайте отново.');
    });

    document.addEventListener('app:languagechange', () => {
        if (renderedState) render(renderedState);
    });
}

/** Called each time the Плащания view is shown. */
export function showBillingView() {
    bind();
    let returning = false;
    try {
        returning = sessionStorage.getItem(STRIPE_FLAG) === '1';
        if (returning) sessionStorage.removeItem(STRIPE_FLAG);
    } catch (_) {}

    const cached = readCache(key());
    if (cached && !hasRendered) render(cached.data);
    refresh({ force: returning });
}

/** Warm the status cache without rendering (idle / nav intent). */
export function prefetchBilling() {
    if (!teacherScope()) return; // signed out meanwhile
    const k = key();
    if (isFresh(readCache(k), MAX_AGE_MS)) return;
    revalidate(k, fetchStatus).catch(() => {});
}

/** bfcache restore (e.g. Back from Stripe): refresh if we were away. */
export function onBillingPageRestored() {
    let returning = false;
    try { returning = sessionStorage.getItem(STRIPE_FLAG) === '1'; } catch (_) {}
    if (!bound) return;
    if (returning) {
        try { sessionStorage.removeItem(STRIPE_FLAG); } catch (_) {}
        // Re-enable buttons left in "Opening…" when the page was frozen
        setPending(els.manage, false, '', t('billing_manage', 'Управление на плащания'));
        setPending(els.upgrade, false, '', t('billing_upgrade', 'Надграждане'));
        if (els.manage) els.manage.disabled = !canManageBilling;
        refresh({ force: true });
    }
}
