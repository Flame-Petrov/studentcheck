/**
 * Teacher shell — wires up the frame shared by the teacher views.
 *
 * The markup (icon sprite, logo, navigation, language selector, support chat)
 * is static in teacherHomepage.html so it paints before any JavaScript runs;
 * the views (Дисциплини, Плащания) switch inside the same document, so this
 * frame stays mounted while navigating. This module only binds behaviour:
 *
 *   const shell = initTeacherShell({ onNavigate: (view) => router.go(view) });
 *   shell.setActive('payments');
 */

import { initLanguageSelect } from './languageSelect.js';
import { initSupportChat } from '../features/chatSupport.js';

let initialised = null;

/**
 * @param {object} opts
 * @param {(view: string, event: Event) => void} opts.onNavigate - in-document view change
 * @param {(view: string) => void} [opts.onIntent] - hover/focus/touch on a nav item (prefetch)
 */
export function initTeacherShell({ onNavigate, onIntent } = {}) {
    if (initialised) return initialised;

    initLanguageSelect(document.getElementById('tpLang'));
    initSupportChat();

    const links = Array.from(document.querySelectorAll('.tp-nav-item[data-view]'));
    links.forEach((link) => {
        link.addEventListener('click', (e) => {
            // Let the browser handle new tab / new window / download
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (typeof onNavigate !== 'function') return;
            e.preventDefault();
            onNavigate(link.dataset.view, e);
        });
        if (typeof onIntent === 'function') {
            const intent = () => onIntent(link.dataset.view);
            link.addEventListener('pointerenter', intent, { passive: true });
            link.addEventListener('focus', intent, { passive: true });
            link.addEventListener('touchstart', intent, { passive: true });
        }
    });

    function setActive(view) {
        links.forEach((link) => {
            if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    initialised = { setActive };
    return initialised;
}
