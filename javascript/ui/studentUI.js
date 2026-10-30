/**
 * Student homepage UI — presentational builders for the student pages.
 *
 * These take plain data, already-translated text, and callbacks, and return DOM
 * nodes. They hold no app state and do no i18n; studentHomepage.js supplies the
 * strings (via its t()/fmt()) and wires behavior.
 */

import { el } from './dom.js';

/**
 * Attendance progress bar.
 * @param {{hasData:boolean, ratio:number, low:boolean}} stats
 * @param {boolean} [large]
 * @returns {HTMLElement}
 */
export function progressBar(stats, large = false) {
    const bar = el('span', `sp-bar${large ? ' sp-bar-lg' : ''}${stats.low ? ' is-low' : ''}`);
    const fill = el('span', 'sp-bar-fill');
    fill.style.width = `${stats.hasData ? stats.ratio : 0}%`;
    bar.appendChild(fill);
    return bar;
}

/**
 * A centered message box, optionally with an action node (button/link) under it.
 * @param {string} message
 * @param {HTMLElement} [action]
 * @returns {HTMLElement}
 */
export function stateBox(message, action) {
    const box = el('div', 'sp-state');
    box.appendChild(el('p', null, message));
    if (action) box.appendChild(action);
    return box;
}

/**
 * A "try again" button.
 * @param {string} label - already-translated text
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
export function retryButton(label, onClick) {
    const btn = el('button', 'sp-button', label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * A link back to the login page, styled as a button.
 * @param {string} label - already-translated text
 * @returns {HTMLAnchorElement}
 */
export function signInLink(label) {
    const link = el('a', 'sp-button', label);
    link.href = 'index.html';
    return link;
}
