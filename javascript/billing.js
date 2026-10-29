import { SERVER_BASE_URL } from './config/api.js';
import { authHeaders } from './api/authFetch.js';
import { bootstrapTeacherAuthState } from './auth/authStore.js';

function t(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

const planEl = document.getElementById('billingPlan');
const statusEl = document.getElementById('billingStatus');
const renewalEl = document.getElementById('billingRenewal');
const errorEl = document.getElementById('billingError');
const manageBtn = document.getElementById('manageBillingBtn');
const upgradeBtn = document.getElementById('upgradeBillingBtn');

let canManageBilling = true;

function setError(message) {
    if (!errorEl) return;
    errorEl.textContent = message || '';
}

function setLoadingState(button, isLoading, labelWhenLoading, labelWhenIdle) {
    if (!button) return;
    button.disabled = isLoading;
    button.textContent = isLoading ? labelWhenLoading : labelWhenIdle;
}

function formatPlan(plan) {
    if (!plan) return '—';
    return String(plan).replace(/_/g, ' ');
}

function formatStatus(status) {
    if (!status) return '—';
    return String(status).replace(/_/g, ' ');
}

function formatDate(value) {
    if (!value) return '—';
    const asDate = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(asDate.getTime())) return '—';
    return asDate.toLocaleDateString();
}

function renderBillingState(state) {
    if (planEl) planEl.textContent = formatPlan(state?.plan);
    if (statusEl) statusEl.textContent = formatStatus(state?.subscription_status);
    if (renewalEl) renewalEl.textContent = formatDate(state?.current_period_end);

    canManageBilling = state?.can_manage_billing !== false;
    if (manageBtn) {
        manageBtn.disabled = !canManageBilling;
    }

    const upgradePriceId = upgradeBtn?.dataset?.priceId;
    const shouldShowUpgrade = state?.plan === 'free' && !!upgradePriceId;
    if (upgradeBtn) upgradeBtn.style.display = shouldShowUpgrade ? 'block' : 'none';
}

async function fetchBillingStatus() {
    setError('');
    const url = `${SERVER_BASE_URL}/api/billing/status`;
    const res = await fetch(url, { headers: authHeaders({ 'Accept': 'application/json' }) });
    if (!res.ok) {
        throw new Error(`Status request failed (${res.status})`);
    }
    return res.json();
}

async function openBillingPortal() {
    if (!canManageBilling) return;
    setError('');
    setLoadingState(manageBtn, true, t('billing_opening', 'Opening...'), t('billing_manage', 'Manage billing'));
    try {
        const url = `${SERVER_BASE_URL}/api/billing/portal`;
        const res = await fetch(url, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
            body: JSON.stringify({ returnUrl: window.location.href })
        });
        if (!res.ok) {
            throw new Error(`Portal request failed (${res.status})`);
        }
        const data = await res.json();
        if (!data?.url) {
            throw new Error('Portal URL missing in response');
        }
        window.location.assign(data.url);
    } catch (error) {
        console.error('Billing portal error:', error);
        setError(t('billing_err_portal', 'Unable to open billing portal. Please try again.'));
        setLoadingState(manageBtn, false, t('billing_opening', 'Opening...'), t('billing_manage', 'Manage billing'));
        if (manageBtn) manageBtn.disabled = !canManageBilling;
    }
}

async function startUpgradeCheckout() {
    if (!upgradeBtn) return;
    setError('');
    const priceId = upgradeBtn.dataset.priceId;
    if (!priceId) {
        setError(t('billing_upgrade_not_configured', 'Upgrade is not configured yet.'));
        return;
    }

    setLoadingState(upgradeBtn, true, t('billing_starting', 'Starting...'), t('billing_upgrade', 'Upgrade'));
    try {
        const url = `${SERVER_BASE_URL}/api/billing/checkout`;
        const res = await fetch(url, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
            body: JSON.stringify({ priceId, returnUrl: window.location.href })
        });
        if (!res.ok) {
            throw new Error(`Checkout request failed (${res.status})`);
        }
        const data = await res.json();
        if (!data?.url) {
            throw new Error('Checkout URL missing in response');
        }
        window.location.assign(data.url);
    } catch (error) {
        console.error('Checkout error:', error);
        setError(t('billing_err_checkout', 'Unable to start checkout. Please try again.'));
        setLoadingState(upgradeBtn, false, t('billing_starting', 'Starting...'), t('billing_upgrade', 'Upgrade'));
    }
}

async function initBilling() {
    // Billing belongs to a signed-in teacher; without a session every call would 401
    if (!bootstrapTeacherAuthState()) {
        window.location.replace('index.html');
        return;
    }
    if (manageBtn) {
        manageBtn.addEventListener('click', openBillingPortal);
    }
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', startUpgradeCheckout);
    }

    try {
        const state = await fetchBillingStatus();
        renderBillingState(state);
    } catch (error) {
        console.error('Billing status error:', error);
        setError(t('billing_err_status', 'Unable to load billing status.'));
    }
}

document.addEventListener('DOMContentLoaded', initBilling);
window.addEventListener('pageshow', () => {
    if (!bootstrapTeacherAuthState()) return;
    fetchBillingStatus()
        .then(renderBillingState)
        .catch((error) => {
            console.error('Billing status refresh error:', error);
        });
});
