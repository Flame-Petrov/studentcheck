/**
 * DisciplineActionsModal — the menu that opens when a discipline card is clicked.
 *
 *   const modal = createDisciplineActionsModal({
 *       root,                       // overlay element (moved to <body>, the portal)
 *       onManageStudents(d),        // d = { id, name }
 *       onStartScanner(d),
 *       onExportAttendance(d),      // async; resolves on success, throws on failure
 *       onOptions(d),
 *   });
 *   modal.open({ id, name }, { opener });   modal.close();   modal.isOpen();
 *
 * Accessibility: role="dialog" + aria-modal + aria-labelledby, focus moved in on
 * open and trapped (Tab wraps), the rest of <body> is made `inert`, Escape /
 * close button / backdrop click dismiss and return focus to the opener.
 *
 * Compatibility: keeps the ids other modules already use (#readyClassPopupOverlay,
 * #readyClassTitle, #manageStudentsBtn, #startScannerBtn,
 * #downloadAttendanceTableBtn, #classOptionsBtn, #closeReadyPopupBtn). Other
 * modules hide it via ui/overlays.hideOverlay(); a MutationObserver notices that
 * and releases the inert background + state without stealing focus.
 */

import { showOverlay, hideOverlay } from './overlays.js';
import { toast } from './toast.js';

const TRANSITION_MS = 180;

const ACTIONS = [
    { key: 'manage', id: 'manageStudentsBtn', icon: 'tp-i-users', i18n: 'manage_students', label: 'Управление на студенти', chevron: true },
    { key: 'scanner', id: 'startScannerBtn', icon: 'tp-i-scan', i18n: 'start_scanner', label: 'Стартирай скенер', primary: true },
    { key: 'export', id: 'downloadAttendanceTableBtn', icon: 'tp-i-download', i18n: 'download_attendance_table', label: 'Изтегли таблица с присъствия', async: true },
    { key: 'options', id: 'classOptionsBtn', icon: 'tp-i-settings', i18n: 'options', label: 'Опции', chevron: true },
];

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

const icon = (id, cls) => `<svg class="tp-icon ${cls}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;

/** One full-width action row (reusable for any action list in the shell). */
export function actionRowHTML({ id, icon: iconId, label, primary = false, chevron = false, async: isAsync = false, key }) {
    return `
        <li class="tp-action-item">
            <button type="button" class="tp-action${primary ? ' tp-action--primary' : ''}" id="${id}" data-action="${key}">
                <span class="tp-action-icon">
                    ${icon(iconId, 'tp-action-glyph')}
                    ${isAsync ? icon('tp-i-loader', 'tp-action-spinner') : ''}
                </span>
                <span class="tp-action-label">${label}</span>
                ${key === 'scanner' ? `<span class="tp-action-dot" hidden aria-hidden="true"></span><span class="tp-visually-hidden tp-action-dot-text" hidden></span>` : ''}
                ${chevron ? icon('tp-i-chevron-right', 'tp-action-chevron') : ''}
            </button>
        </li>`;
}

export function createDisciplineActionsModal({ root, onManageStudents, onStartScanner, onExportAttendance, onOptions } = {}) {
    if (!root) throw new Error('DisciplineActionsModal: root element is required');

    const handlers = { manage: onManageStudents, scanner: onStartScanner, export: onExportAttendance, options: onOptions };

    // Portal: a direct child of <body>, so no container clips it and the rest of
    // the page can be made inert while it is open.
    document.body.appendChild(root);
    root.classList.add('tp-modal-overlay');
    root.classList.remove('overlay');
    root.style.visibility = 'hidden';
    root.innerHTML = `
        <div class="tp-modal" role="dialog" aria-modal="true" aria-labelledby="readyClassTitle" tabindex="-1">
            <!-- Outside the scroll area: always reachable, even with a long title on a short screen -->
            <button type="button" class="tp-modal-close" id="closeReadyPopupBtn" aria-label="Затвори">
                ${icon('tp-i-close', 'tp-modal-close-icon')}
            </button>
            <div class="tp-modal-scroll">
                <h2 class="tp-modal-title" id="readyClassTitle" data-dynamic-title="true"></h2>
                <ul class="tp-action-list" role="list">
                    ${ACTIONS.map(actionRowHTML).join('')}
                </ul>
                <p class="tp-modal-error" role="alert" hidden></p>
                <p class="tp-visually-hidden tp-modal-live" aria-live="polite"></p>
            </div>
        </div>`;

    const panel = root.querySelector('.tp-modal');
    const titleEl = root.querySelector('#readyClassTitle');
    const closeBtn = root.querySelector('#closeReadyPopupBtn');
    const errorEl = root.querySelector('.tp-modal-error');
    const liveEl = root.querySelector('.tp-modal-live');
    const rows = Object.fromEntries(ACTIONS.map((a) => [a.key, root.querySelector(`#${a.id}`)]));

    const state = { open: false, discipline: null, opener: null, internalHide: false, hideTimer: null };
    const pending = new Set();
    let inerted = [];

    // ----- helpers -----

    function setBackgroundInert(on) {
        if (on) {
            inerted = Array.from(document.body.children).filter((node) => node !== root && node.tagName !== 'SCRIPT' && !node.inert);
            inerted.forEach((node) => { node.inert = true; });
        } else {
            inerted.forEach((node) => { node.inert = false; });
            inerted = [];
        }
    }

    function focusables() {
        return Array.from(panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
            .filter((node) => !node.hidden && node.offsetParent !== null);
    }

    function setError(message) {
        errorEl.textContent = message || '';
        errorEl.hidden = !message;
    }

    function announce(message) {
        liveEl.textContent = '';
        if (message) requestAnimationFrame(() => { liveEl.textContent = message; });
    }

    function setBusy(key, busy) {
        const row = rows[key];
        if (!row) return;
        row.classList.toggle('is-busy', busy);
        row.setAttribute('aria-busy', String(busy));
        if (busy) row.setAttribute('aria-disabled', 'true');
        else row.removeAttribute('aria-disabled');
    }

    function syncLabels() {
        ACTIONS.forEach((a) => {
            const label = rows[a.key]?.querySelector('.tp-action-label');
            if (label) label.textContent = t(a.i18n, a.label);
        });
        closeBtn.setAttribute('aria-label', t('close', 'Затвори'));
        const dotText = rows.scanner?.querySelector('.tp-action-dot-text');
        if (dotText) dotText.textContent = t('tp_scanner_draft', 'има незапазено сканиране');
    }

    // ----- open / close -----

    function open(discipline, { opener } = {}) {
        if (!discipline) return;
        clearTimeout(state.hideTimer);
        state.discipline = { id: discipline.id != null ? String(discipline.id) : '', name: String(discipline.name || '') };
        if (opener) state.opener = opener;

        titleEl.textContent = state.discipline.name;
        titleEl.dataset.dynamicTitle = 'true';
        root.dataset.disciplineId = state.discipline.id;
        setError('');
        syncLabels();

        if (!state.open) {
            state.open = true;
            setBackgroundInert(true);
            showOverlay(root);                       // visibility + body scroll lock
            requestAnimationFrame(() => {
                root.classList.add('is-open');
                // Focus the dialog itself: announced by its heading, no stray focus
                // ring after a mouse click; Tab continues into the controls.
                panel.focus({ preventScroll: true });
            });
        }
    }

    /**
     * @param {object} [opts]
     * @param {boolean} [opts.restoreFocus=true] - focus the opener (dismissals) or not (navigation)
     * @param {boolean} [opts.immediate=false]   - skip the fade (another overlay is opening)
     */
    function close({ restoreFocus = true, immediate = false } = {}) {
        if (!state.open) return;
        state.open = false;
        root.classList.remove('is-open');
        setBackgroundInert(false);
        document.body.style.overflow = '';

        const finish = () => {
            state.internalHide = true;
            hideOverlay(root, false);
            state.internalHide = false;
        };
        if (immediate) finish();
        else state.hideTimer = setTimeout(finish, TRANSITION_MS);

        const opener = state.opener;
        if (restoreFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
    }

    // Another module hid the overlay directly (scanner, manage students, delete…)
    new MutationObserver(() => {
        if (state.internalHide) return;
        if (state.open && root.style.visibility === 'hidden') {
            state.open = false;
            root.classList.remove('is-open');
            setBackgroundInert(false);
        }
    }).observe(root, { attributes: true, attributeFilter: ['style'] });

    // ----- actions -----

    async function run(key) {
        if (!state.open || pending.has(key)) return;
        const action = ACTIONS.find((a) => a.key === key);
        const handler = handlers[key];
        const discipline = { ...state.discipline };
        setError('');

        if (typeof handler !== 'function') {
            setError(t('tp_action_unavailable', 'Тази функция все още не е налична.'));
            return;
        }

        if (action.async) {
            // Stays in the modal: spinner in the row, no duplicate runs, result announced.
            pending.add(key);
            setBusy(key, true);
            announce(t('tp_export_pending', 'Изтегляне на таблицата…'));
            try {
                await handler(discipline);
                announce(t('tp_export_success', 'Таблицата с присъствия е изтеглена.'));
                toast(t('tp_export_success', 'Таблицата с присъствия е изтеглена.'), { tone: 'success', duration: 1800 });
            } catch (error) {
                console.error(`[DisciplineActions] ${key} failed`, error);
                setError(t('tp_export_error', 'Неуспешно изтегляне на таблицата. Опитайте отново.'));
            } finally {
                pending.delete(key);
                setBusy(key, false);
            }
            return;
        }

        // Navigation: close as the destination opens. If it cannot open, come back.
        close({ restoreFocus: false, immediate: true });
        try {
            const result = handler(discipline);
            if (result && typeof result.then === 'function') {
                result.catch((error) => {
                    console.error(`[DisciplineActions] ${key} failed`, error);
                    toast(t('tp_action_error', 'Действието не може да бъде изпълнено. Опитайте отново.'), { tone: 'error', duration: 2600 });
                });
            }
        } catch (error) {
            console.error(`[DisciplineActions] ${key} failed`, error);
            open(discipline);
            setError(t('tp_action_error', 'Действието не може да бъде изпълнено. Опитайте отново.'));
        }
    }

    // ----- events -----

    root.addEventListener('click', (e) => {
        if (e.target === root) { close(); return; }          // backdrop
        const row = e.target.closest('.tp-action');
        if (row && panel.contains(row)) run(row.dataset.action);
    });
    closeBtn.addEventListener('click', () => close());

    // On document: a click on non-focusable panel content leaves focus on <body>
    document.addEventListener('keydown', (e) => {
        if (!state.open) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key === 'Tab') {
            const list = focusables();
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            const inside = panel.contains(document.activeElement) && document.activeElement !== panel;
            if (e.shiftKey && (document.activeElement === first || !inside)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    document.addEventListener('app:languagechange', syncLabels);
    syncLabels();

    return {
        open,
        close,
        isOpen: () => state.open,
        getDiscipline: () => (state.discipline ? { ...state.discipline } : null),
        setTitle(name) {
            titleEl.textContent = name;
            if (state.discipline) state.discipline.name = name;
        },
        /** Red dot on "Стартирай скенер" while an unsaved scan draft exists. */
        setScannerDraft(hasDraft) {
            rows.scanner?.querySelectorAll('.tp-action-dot, .tp-action-dot-text').forEach((n) => { n.hidden = !hasDraft; });
        },
    };
}
