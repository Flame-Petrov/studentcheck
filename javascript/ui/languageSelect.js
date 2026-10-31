/**
 * Language selector — globe + current code + chevron, opening a small menu.
 *
 * Markup lives in the page (see teacherHomepage.html #tpLang):
 *   button[aria-haspopup=menu][aria-controls] + ul[role=menu] of
 *   button[role=menuitemradio][data-lang].
 * Switching delegates to the shared i18n layer (window.i18n.setLanguage), which
 * persists the choice and fires `app:languagechange`.
 *
 * Keyboard: Enter/Space/ArrowDown/ArrowUp open the menu and focus an item;
 * ArrowUp/ArrowDown/Home/End move; Enter/Space choose; Escape closes and
 * returns focus to the button; Tab closes.
 */

const LANG_NAMES = { bg: 'Български', en: 'English' };

function currentLang() {
    try {
        return (window.i18n?.getLanguage?.() || document.documentElement.lang || 'bg').toLowerCase();
    } catch (_) {
        return 'bg';
    }
}

function label(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

/**
 * @param {HTMLElement} root - the .tp-lang wrapper
 */
export function initLanguageSelect(root) {
    if (!root || root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';

    const button = root.querySelector('.tp-lang-btn');
    const menu = root.querySelector('[role="menu"]');
    const codeEl = root.querySelector('.tp-lang-code');
    if (!button || !menu) return;
    const items = () => Array.from(menu.querySelectorAll('[role="menuitemradio"]'));

    function sync() {
        const lang = currentLang();
        if (codeEl) codeEl.textContent = lang.toUpperCase();
        items().forEach((item) => {
            item.setAttribute('aria-checked', String(item.dataset.lang === lang));
        });
        const languageWord = label('language_label', lang === 'bg' ? 'Език' : 'Language');
        button.setAttribute('aria-label', `${languageWord}: ${LANG_NAMES[lang] || lang.toUpperCase()}`);
    }

    function isOpen() {
        return !menu.hidden;
    }

    function focusItem(index) {
        const list = items();
        if (!list.length) return;
        const i = (index + list.length) % list.length;
        list.forEach((item, n) => { item.tabIndex = n === i ? 0 : -1; });
        list[i].focus();
    }

    function open(focusIndex) {
        sync();
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        root.classList.add('is-open');
        const list = items();
        const checked = list.findIndex((item) => item.getAttribute('aria-checked') === 'true');
        focusItem(typeof focusIndex === 'number' ? focusIndex : Math.max(0, checked));
    }

    function close({ restoreFocus = false } = {}) {
        if (!isOpen()) return;
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        root.classList.remove('is-open');
        if (restoreFocus) button.focus();
    }

    function choose(item) {
        const lang = item?.dataset.lang;
        close({ restoreFocus: true });
        if (!lang || lang === currentLang()) return;
        if (window.i18n && typeof window.i18n.setLanguage === 'function') {
            window.i18n.setLanguage(lang);
        }
        sync();
    }

    button.addEventListener('click', () => {
        if (isOpen()) close();
        else open();
    });

    button.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            open(0);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            open(items().length - 1);
        }
    });

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('[role="menuitemradio"]');
        if (item) choose(item);
    });

    menu.addEventListener('keydown', (e) => {
        const list = items();
        const index = list.indexOf(document.activeElement);
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); focusItem(index + 1); break;
            case 'ArrowUp': e.preventDefault(); focusItem(index - 1); break;
            case 'Home': e.preventDefault(); focusItem(0); break;
            case 'End': e.preventDefault(); focusItem(list.length - 1); break;
            case 'Escape': e.preventDefault(); close({ restoreFocus: true }); break;
            case 'Tab': close(); break;
            default: break;
        }
    });

    // Click / tap outside closes without stealing focus
    document.addEventListener('pointerdown', (e) => {
        if (isOpen() && !root.contains(e.target)) close();
    });
    root.addEventListener('focusout', (e) => {
        if (isOpen() && e.relatedTarget && !root.contains(e.relatedTarget)) close();
    });

    document.addEventListener('app:languagechange', sync);
    sync();
}
