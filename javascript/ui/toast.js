/**
 * Toast — the transient "bubble" message shown at the edge of the screen.
 *
 * One implementation for the whole app; callers pass tone, size and timing.
 * Markup: <div class="toast-bubble toast-<tone> toast-<size>"> with a "show"
 * class toggled for the CSS fade.
 */

import { el } from './dom.js';

/**
 * Show a toast bubble.
 * @param {string} message
 * @param {object} [opts]
 * @param {'success'|'error'|string} [opts.tone='success']
 * @param {'wide'|'large'|string} [opts.size='wide'] - extra size class (toast-<size>)
 * @param {number} [opts.duration=1400] - ms the toast stays fully shown
 * @param {number} [opts.fadeMs=300] - ms for the fade-out before removal
 * @param {boolean} [opts.replace=false] - remove any existing toast first
 */
export function toast(message, { tone = 'success', size = 'wide', duration = 1400, fadeMs = 300, replace = false } = {}) {
    if (replace) {
        const existing = document.querySelector('.toast-bubble');
        if (existing) existing.remove();
    }

    const bubble = el('div', `toast-bubble toast-${tone} toast-${size}`, message);
    document.body.appendChild(bubble);

    requestAnimationFrame(() => bubble.classList.add('show'));

    setTimeout(() => {
        bubble.classList.remove('show');
        setTimeout(() => bubble.remove(), fadeMs);
    }, duration);

    return bubble;
}
