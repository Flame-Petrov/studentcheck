/**
 * Teacher shell — the frame shared by every teacher page.
 *
 * Builds, in one place: the icon sprite, the skip link, the brand (logo that
 * opens shared.js's slide-out menu with language + log out), the navigation
 * (sidebar on desktop, bottom bar on phones — css/teacherShell.css), the
 * language selector and the support chat.
 *
 * Each page only provides the slots and its own <main>:
 *   <body class="tp-app">
 *     <div class="tp-shell">
 *       <div class="tp-sidebar" id="tpSidebar"></div>
 *       <div class="tp-content">
 *         <div class="tp-topbar" id="tpTopbar"></div>
 *         <main class="tp-main">…</main>
 *       </div>
 *     </div>
 * and calls mountTeacherShell({ active, skipTarget }) at module top level, so
 * the logo exists before shared.js wires its menu on DOMContentLoaded.
 * Static labels carry ids that shared.js translates on every page.
 */

import { initLanguageSelect } from './languageSelect.js';
import { initSupportChat } from '../features/chatSupport.js';

const NAV = [
    { key: 'classes', href: 'teacherHomepage.html', icon: 'tp-i-cap', id: 'tpNavClasses', label: 'Дисциплини' },
    { key: 'payments', href: 'billing.html', icon: 'tp-i-currency', id: 'tpNavPayments', label: 'Плащания' },
    { key: 'chat', action: 'open-support-chat', icon: 'tp-i-chat', id: 'tpNavChat', label: 'Чат' },
];

const SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
    <symbol id="tp-i-cap" viewBox="0 0 24 24"><path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></symbol>
    <symbol id="tp-i-currency" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M15.5 8.5H11a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H8.5"/><path d="M12 6.5v11"/></symbol>
    <symbol id="tp-i-chat" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8.5 10h7"/><path d="M8.5 14h4.5"/></symbol>
    <symbol id="tp-i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/></symbol>
    <symbol id="tp-i-plus" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></symbol>
    <symbol id="tp-i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></symbol>
    <symbol id="tp-i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
    <symbol id="tp-i-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
    <symbol id="tp-i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
    <symbol id="tp-i-close" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
    <symbol id="tp-i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
    <symbol id="tp-i-scan" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h1.5"/><path d="M19.5 12H21"/></symbol>
    <symbol id="tp-i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>
    <symbol id="tp-i-settings" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></symbol>
    <symbol id="tp-i-loader" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></symbol>
</svg>`;

const BRAND = `
<div class="tp-brand">
    <button class="navbar-logo tp-logo" type="button" aria-label="Home" data-custom-logo="true" onclick="handleLogoClick()">
        <svg class="tp-logo-mark" viewBox="0 0 38 35" aria-hidden="true" focusable="false">
            <path d="M0.6 19.6c1.3-1.5 2.7-2.6 4.2-3.4 2.6 2.2 5 4.9 7.3 8.1C18 14.6 25.6 6.6 35.4 0.4c0.9 0.5 1.7 1.2 2.2 2C28.7 10.8 21.3 21.4 15.6 34.6h-3.4C9 28.6 5.2 23.6 0.6 19.6z"/>
        </svg>
    </button>
</div>`;

const LANG = `
<div class="tp-lang" id="tpLang">
    <button class="tp-lang-btn" id="tpLangBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="tpLangMenu">
        <svg class="tp-icon tp-lang-globe" aria-hidden="true"><use href="#tp-i-globe"/></svg>
        <span class="tp-lang-code" id="tpLangCode">BG</span>
        <svg class="tp-icon tp-lang-chevron" aria-hidden="true"><use href="#tp-i-chevron-down"/></svg>
    </button>
    <ul class="tp-lang-menu" id="tpLangMenu" role="menu" aria-labelledby="tpLangBtn" hidden>
        <li role="none">
            <button class="tp-lang-option" type="button" role="menuitemradio" aria-checked="false" data-lang="bg" lang="bg" tabindex="-1">
                <span>Български</span>
                <svg class="tp-icon tp-lang-check" aria-hidden="true"><use href="#tp-i-check"/></svg>
            </button>
        </li>
        <li role="none">
            <button class="tp-lang-option" type="button" role="menuitemradio" aria-checked="false" data-lang="en" lang="en" tabindex="-1">
                <span>English</span>
                <svg class="tp-icon tp-lang-check" aria-hidden="true"><use href="#tp-i-check"/></svg>
            </button>
        </li>
    </ul>
</div>`;

const CHAT = `
<div id="supportChatOverlay" class="overlay tp-chat-overlay">
    <div class="chat-popup" role="dialog" aria-modal="true" aria-labelledby="supportChatTitle">
        <div class="chat-header">
            <h2 id="supportChatTitle">Support Chat</h2>
            <button id="supportChatLanguageBtn" class="chat-language-btn" type="button">Change Language</button>
            <button id="closeSupportChatBtn" class="tp-chat-close" type="button" aria-label="Close">
                <svg class="tp-icon" aria-hidden="true"><use href="#tp-i-close"/></svg>
            </button>
        </div>
        <div id="chatHistoryContainer" class="chat-history" aria-live="polite">
            <div class="chat-message model">Hello! I am the StudentCheck support assistant. How can I help you today?</div>
        </div>
        <div class="chat-input-area">
            <input type="text" id="chatInput" placeholder="Ask a question..." autocomplete="off" aria-labelledby="supportChatTitle" />
            <button id="sendChatBtn" type="button">Send</button>
        </div>
    </div>
</div>`;

function navItem(item, active) {
    const isActive = item.key === active;
    const inner = `
        <svg class="tp-icon tp-nav-icon" aria-hidden="true"><use href="#${item.icon}"/></svg>
        <span class="tp-nav-label" id="${item.id}">${item.label}</span>`;
    if (item.action) {
        return `<li><button class="tp-nav-item" type="button" data-action="${item.action}" aria-haspopup="dialog">${inner}</button></li>`;
    }
    return `<li><a class="tp-nav-item" href="${item.href}"${isActive ? ' aria-current="page"' : ''}>${inner}</a></li>`;
}

/**
 * @param {object} opts
 * @param {'classes'|'payments'} opts.active - current page's nav entry
 * @param {string} [opts.skipTarget] - id of the element the skip link jumps to (the page h1)
 */
export function mountTeacherShell({ active, skipTarget } = {}) {
    const body = document.body;
    const sidebar = document.getElementById('tpSidebar');
    const topbar = document.getElementById('tpTopbar');
    if (!sidebar || !topbar || body.dataset.tpShell === 'mounted') return;
    body.dataset.tpShell = 'mounted';

    body.insertAdjacentHTML('afterbegin', SPRITE);
    if (skipTarget) {
        const skip = document.createElement('a');
        skip.className = 'tp-skip-link';
        skip.id = 'tpSkipLink';
        skip.href = `#${skipTarget}`;
        skip.textContent = 'Към съдържанието';
        body.insertBefore(skip, body.firstElementChild.nextSibling);
    }

    sidebar.innerHTML = `${BRAND}
<nav class="tp-nav" id="tpNav" aria-label="Основна навигация">
    <ul class="tp-nav-list">${NAV.map((item) => navItem(item, active)).join('')}</ul>
</nav>`;
    topbar.innerHTML = LANG;

    if (!document.getElementById('supportChatOverlay')) {
        body.insertAdjacentHTML('beforeend', CHAT);
    }

    initLanguageSelect(document.getElementById('tpLang'));
    initSupportChat();
}
