/**
 * Class UI Module
 * 
 * Handles class button rendering and UI updates.
 * Manages class list display and status indicators.
 */

import { isClassReady, getCurrentClass } from '../state/appState.js';
import { getRawClassNameFromButton } from '../utils/helpers.js';
import { el } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Fill a class card button with its title and chevron, and keep the name
 * datasets in sync. The only place a class card's visible label is written,
 * so creation and rename both keep the card structure intact.
 * @param {HTMLElement} btn - Class card button (.newClassBtn)
 * @param {string} name - Class name
 */
export function setClassButtonLabel(btn, name) {
    if (!btn) return;
    const label = String(name || '');
    btn.dataset.className = label;
    btn.dataset.originalLabel = label;

    let title = btn.querySelector('.tp-card-title');
    if (!title) {
        btn.replaceChildren();
        title = el('span', 'tp-card-title');
        const chevron = document.createElementNS(SVG_NS, 'svg');
        chevron.setAttribute('class', 'tp-icon tp-card-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.setAttribute('focusable', 'false');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', '#tp-i-chevron-right');
        chevron.appendChild(use);
        btn.append(title, chevron);
    }
    title.textContent = label;
}

/**
 * Update class status UI (ready badge)
 * @param {HTMLElement} btn - Class button element
 */
export function updateClassStatusUI(btn) {
    const current = getCurrentClass();
    const button = btn || current.button;
    if (!button) return;
    const className = getRawClassNameFromButton(button);
    const isReady = isClassReady(className);
    if (isReady) {
        button.classList.add('class-ready');
    } else {
        button.classList.remove('class-ready');
    }
}

/**
 * Flash ready badge on a button
 * @param {HTMLElement} button - Class button element
 */
export function flashReadyBadge(button) {
    if (!button) return;
    const badge = document.createElement('div');
    badge.className = 'ready-badge';
    badge.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('class_ready_badge') : '✓ Ready';
    button.appendChild(badge);
    setTimeout(() => {
        badge.remove();
    }, 2000);
}

/**
 * Attach click behavior to a class button
 * @param {HTMLElement} buttonEl - Class button element
 * @param {Function} onClickHandler - Click handler function
 */
export function attachNewClassButtonBehavior(buttonEl, onClickHandler) {
    if (!buttonEl) return;
    const animate = () => {
        buttonEl.classList.add('clicked');
        setTimeout(() => buttonEl.classList.remove('clicked'), 340);
    };
    buttonEl.addEventListener('mousedown', animate);
    buttonEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') animate();
    });
    buttonEl.addEventListener('click', (e) => {
        e.preventDefault();
        if (onClickHandler) onClickHandler(buttonEl);
    });
}

/**
 * Render a class item (button) in the class list
 * @param {string} name - Class name
 * @param {number} id - Class ID
 * @param {HTMLElement} classList - Class list container element
 * @param {Function} onClickHandler - Click handler function
 * @param {Function} loadStudentsFn - Function to preload students
 */
export function renderClassItem(name, id, classList, onClickHandler, loadStudentsFn) {
    const li = el('li', 'tp-card-item');
    const btn = el('button', 'newClassBtn tp-card');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');

    setClassButtonLabel(btn, name);
    // CRITICAL: Set data-class-id for reliable click handler resolution
    if (id) {
        btn.dataset.classId = String(id);
    }

    attachNewClassButtonBehavior(btn, onClickHandler);

    li.appendChild(btn);
    classList?.appendChild(li);

    // Apply readiness if already stored
    if (isClassReady(name)) {
        updateClassStatusUI(btn);
    }

    // Preload students for this class
    if (loadStudentsFn) {
        loadStudentsFn(name, id);
    }
}

/**
 * Ensure classes container is visible
 */
export function ensureClassesContainerVisible() {
    const sec = document.getElementById('classesSection');
    if (!sec) return;
    const style = window.getComputedStyle(sec);
    if (style.display === 'none') {
        sec.style.display = 'flex';
    }
    const list = document.getElementById('classList');
    if (list) {
        const listStyle = window.getComputedStyle(list);
        if (listStyle.display === 'none') list.style.display = 'flex';
    }
}
