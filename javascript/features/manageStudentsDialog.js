/**
 * "Управление на студенти" dialog (markup: #manageStudentsOverlay in
 * teacherHomepage.html, styles: css/manageStudentsDialog.css).
 *
 * The shell (title, Close, search, Filters, column headings, Back / Add
 * students) and five skeleton rows are static HTML, so the dialog paints at
 * once. Data then arrives from two independent sources:
 *
 *   roster      ensureRoster()          names, faculty numbers, e-mail, filters
 *   attendance  attendanceSummaryStore  one course-level summary request
 *
 * Whatever is cached is shown immediately and refreshed in the background.
 * Rows are reconciled by stable student id (unchanged rows are not rebuilt,
 * focus stays where it is). Every async result is checked against the dialog
 * session it was started for, so a late response never lands in a closed
 * dialog or in another course.
 *
 * Attendance cells: skeleton while unknown, "N занятия" only when the summary
 * confirms it (0 included), "Няма данни" when the summary has no total or the
 * request failed (with Retry).
 */

import { ensureRoster, markRosterChanged } from '../data/rosterStore.js';
import {
    readAttendanceSummary, isAttendanceSummaryFresh, loadAttendanceSummary,
    invalidateAttendanceSummary, attendanceCountFor
} from '../data/attendanceSummaryStore.js';
import { loadClassStudentsFromStorage } from '../storage/studentStorage.js';
import { showOverlay, hideOverlay, getOverlay, isOverlayVisible } from '../ui/overlays.js';
import { showLoadError, showStaleNote, hideStaleNote } from '../ui/skeleton.js';

const SKELETON_ROWS = 5;
const FILTER_KEYS = ['level', 'faculty', 'specialization', 'group'];

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

function tf(key, fallback, params) {
    return Object.entries(params).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), t(key, fallback));
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function normalizeText(value) {
    return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------- state ----------

let deps = null;            // callbacks from studentManagement.js
let dom = null;
let session = 0;            // bumped on every open / close / class switch
let renderedClassKey = null;

const state = {
    classId: null,
    className: '',
    rows: [],               // normalized students, server order
    rosterStatus: 'loading', // loading | ready | error
    rosterRefreshFailed: false,
    summary: null,          // { byId, byFacultyNumber } | null
    attendanceStatus: 'loading', // loading | ready | error
    query: '',
    filters: { level: '', faculty: '', specialization: '', group: '' },
    filtersOpen: false,
    opener: null
};

// Search, filters and scroll per course, kept while moving to a student's
// details or to "Добави студенти" and back.
const viewMemory = new Map();

function classKey() {
    return String(state.classId || state.className || '');
}

// ---------- DOM ----------

function bindDom() {
    const overlay = getOverlay('manageStudentsOverlay');
    if (!overlay) return null;
    return {
        overlay,
        dialog: overlay.querySelector('.msd-dialog'),
        subtitle: overlay.querySelector('#manageStudentsClassName'),
        close: overlay.querySelector('#closeManageOverlayBtn'),
        search: overlay.querySelector('#manageStudentsSearchInput'),
        filterToggle: overlay.querySelector('#manageStudentsFilterBtn'),
        filterPanel: overlay.querySelector('#manageFilterPanel'),
        filterSelects: {
            level: overlay.querySelector('#manageFilterLevel'),
            faculty: overlay.querySelector('#manageFilterFaculty'),
            specialization: overlay.querySelector('#manageFilterSpecialization'),
            group: overlay.querySelector('#manageFilterGroup')
        },
        filterReset: overlay.querySelector('#manageFilterResetBtn'),
        attError: overlay.querySelector('#manageAttendanceError'),
        scroll: overlay.querySelector('#manageStudentsList'),
        table: overlay.querySelector('#manageStudentsTable'),
        body: overlay.querySelector('#manageStudentsRows'),
        stateBox: overlay.querySelector('#manageStudentsState'),
        status: overlay.querySelector('#manageStudentsStatus'),
        count: overlay.querySelector('#manageStudentsCount'),
        stale: overlay.querySelector('#manageStudentsStale'),
        back: overlay.querySelector('#backToReadyBtn'),
        add: overlay.querySelector('#addStudentManageBtn')
    };
}

function skeletonRow(index) {
    const widths = [['62%', '58%'], ['48%', '64%'], ['70%', '52%'], ['54%', '60%'], ['44%', '56%']][index % 5];
    const tr = el('tr', 'msd-row msd-row--skel');
    tr.setAttribute('aria-hidden', 'true');
    const name = el('td', 'msd-cell msd-cell--name');
    const nameBar = el('span', 'sk msd-sk msd-sk--name');
    nameBar.style.setProperty('--sk-w', widths[0]);
    name.appendChild(nameBar);
    const fn = el('td', 'msd-cell msd-cell--fn');
    const fnBar = el('span', 'sk msd-sk msd-sk--fn');
    fnBar.style.setProperty('--sk-w', widths[1]);
    fn.appendChild(fnBar);
    const att = el('td', 'msd-cell msd-cell--att');
    att.appendChild(el('span', 'sk msd-sk msd-sk--att'));
    tr.append(name, fn, att);
    return tr;
}

function showSkeleton() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < SKELETON_ROWS; i += 1) fragment.appendChild(skeletonRow(i));
    dom.body.replaceChildren(fragment);
    dom.table.hidden = false;
    hideState();
}

function setBusy(busy) {
    if (busy) dom.scroll.setAttribute('aria-busy', 'true');
    else dom.scroll.removeAttribute('aria-busy');
    if (dom.status) {
        dom.status.hidden = !busy;
        if (busy) dom.status.textContent = t('msd_loading', 'Зареждане на студентите…');
    }
}

function hideState() {
    dom.stateBox.hidden = true;
    dom.stateBox.replaceChildren();
}

function showState(message, actionLabel, onAction) {
    const box = dom.stateBox;
    box.replaceChildren(el('p', 'msd-state-text', message));
    if (actionLabel) {
        const button = el('button', 'msd-state-action', actionLabel);
        button.type = 'button';
        button.addEventListener('click', onAction);
        box.appendChild(button);
    }
    box.hidden = false;
}

// ---------- rows ----------

function attendanceCell(row) {
    if (state.attendanceStatus === 'loading' && !state.summary) return { kind: 'loading' };
    const count = attendanceCountFor(state.summary, { id: row.id, facultyNumber: row.facultyNumber });
    if (count !== null) return { kind: 'count', count };
    return { kind: 'unavailable' };
}

function renderAttendance(td, info) {
    const sig = info.kind === 'count' ? `c${info.count}` : info.kind;
    if (td.dataset.sig === sig && td.dataset.lang === (window.i18n?.getLanguage?.() || '')) return;
    td.dataset.sig = sig;
    td.dataset.lang = window.i18n?.getLanguage?.() || '';
    td.replaceChildren();
    td.removeAttribute('title');
    if (info.kind === 'loading') {
        td.appendChild(el('span', 'sk msd-sk msd-sk--att'));
        td.firstChild.setAttribute('aria-hidden', 'true');
        return;
    }
    if (info.kind === 'count') {
        const n = info.count;
        td.appendChild(el('span', 'msd-att', n === 1
            ? tf('msd_sessions_one', '{n} занятие', { n })
            : tf('msd_sessions_many', '{n} занятия', { n })));
        return;
    }
    const na = el('span', 'msd-att msd-att--na', '—');
    na.setAttribute('aria-hidden', 'true');
    td.append(na, el('span', 'tp-visually-hidden', t('msd_att_unavailable', 'Няма данни')));
    td.title = t('msd_att_unavailable', 'Няма данни');
}

function createRow(row) {
    const tr = el('tr', 'msd-row');
    tr.dataset.key = row.key;
    const name = el('td', 'msd-cell msd-cell--name');
    const button = el('button', 'msd-name');
    button.type = 'button';
    button.dataset.openKey = row.openKey;
    const nameText = el('span', 'msd-name-text');
    const sub = el('span', 'msd-sub');
    button.append(nameText, sub);
    name.appendChild(button);
    const fn = el('td', 'msd-cell msd-cell--fn');
    const att = el('td', 'msd-cell msd-cell--att');
    tr.append(name, fn, att);
    return tr;
}

function updateRow(tr, row) {
    const button = tr.querySelector('.msd-name');
    const nameText = button.querySelector('.msd-name-text');
    const sub = button.querySelector('.msd-sub');
    const displayName = row.name || row.facultyNumber || '—';
    if (nameText.textContent !== displayName) nameText.textContent = displayName;
    // Faculty number under the name on narrow screens (its column is hidden there)
    if (sub.textContent !== row.facultyNumber) sub.textContent = row.facultyNumber;
    if (button.dataset.openKey !== row.openKey) button.dataset.openKey = row.openKey;
    const fnCell = tr.children[1];
    if (fnCell.textContent !== row.facultyNumber) fnCell.textContent = row.facultyNumber;
    renderAttendance(tr.children[2], attendanceCell(row));
}

function reconcileRows() {
    const body = dom.body;
    body.querySelectorAll('.msd-row--skel').forEach((tr) => tr.remove());
    const existing = new Map();
    body.querySelectorAll('tr[data-key]').forEach((tr) => existing.set(tr.dataset.key, tr));
    const wanted = new Set(state.rows.map((r) => r.key));
    existing.forEach((tr, key) => { if (!wanted.has(key)) tr.remove(); });

    let cursor = body.firstElementChild;
    state.rows.forEach((row) => {
        let tr = existing.get(row.key);
        if (!tr) tr = createRow(row);
        updateRow(tr, row);
        if (tr !== cursor) body.insertBefore(tr, cursor);
        else cursor = cursor.nextElementSibling;
    });
}

function matches(row) {
    const q = normalizeText(state.query);
    if (q && !row.searchText.includes(q)) return false;
    const f = state.filters;
    if (f.level && row.level !== f.level.toLowerCase()) return false;
    if (f.faculty && row.faculty !== f.faculty) return false;
    if (f.specialization && row.specialization !== f.specialization) return false;
    if (f.group && row.group !== f.group) return false;
    return true;
}

function filtersActive() {
    return FILTER_KEYS.some((k) => state.filters[k]);
}

function applyFilters() {
    let shown = 0;
    const byKey = new Map(state.rows.map((r) => [r.key, r]));
    dom.body.querySelectorAll('tr[data-key]').forEach((tr) => {
        const row = byKey.get(tr.dataset.key);
        const visible = !!row && matches(row);
        if (tr.hidden === visible) tr.hidden = !visible;
        if (visible) shown += 1;
    });
    return shown;
}

function render() {
    if (!dom) return;
    const key = classKey();
    if (renderedClassKey !== key) {
        // Another course: never show the previous course's rows
        dom.body.replaceChildren();
        renderedClassKey = key;
    }

    const hasRows = state.rows.length > 0;
    if (!hasRows && state.rosterStatus === 'loading') {
        if (!dom.body.querySelector('.msd-row--skel')) showSkeleton();
        hideState();
        setBusy(true);
        updateCount(null);
        return;
    }

    if (!hasRows && state.rosterStatus === 'error') {
        dom.body.replaceChildren();
        dom.table.hidden = true;
        setBusy(false);
        hideState();
        const box = el('div');
        dom.stateBox.replaceChildren(box);
        dom.stateBox.hidden = false;
        showLoadError(box, t('tp_students_error', 'Неуспешно зареждане на студентите.'), () => retryRoster());
        updateCount(null);
        return;
    }

    if (!hasRows) {
        dom.body.replaceChildren();
        dom.table.hidden = true;
        setBusy(false);
        showState(t('msd_empty', 'В тази дисциплина все още няма студенти.'), t('add_students', 'Добави студенти'), () => openAddStudents());
        updateCount(null);
        return;
    }

    dom.table.hidden = false;
    reconcileRows();
    const shown = applyFilters();
    if (shown === 0) {
        showState(t('msd_no_results', 'Няма студенти, които отговарят на търсенето и филтрите.'), t('msd_clear', 'Изчисти търсенето и филтрите'), clearCriteria);
    } else {
        hideState();
    }
    // Only the attendance column can still be loading here
    setBusy(state.attendanceStatus === 'loading' && !state.summary);
    updateCount(shown);
    updateAttendanceError();
}

function updateCount(shown) {
    if (!dom.count) return;
    const narrowed = state.query || filtersActive();
    dom.count.textContent = shown === null || !narrowed
        ? ''
        : tf('msd_shown', 'Показани {n} от {m}', { n: shown, m: state.rows.length });
}

function updateAttendanceError() {
    const box = dom.attError;
    if (!box) return;
    const failed = state.attendanceStatus === 'error' && !state.summary && state.rows.length > 0;
    if (!failed) {
        box.hidden = true;
        box.replaceChildren();
        return;
    }
    if (!box.hidden && box.dataset.lang === (window.i18n?.getLanguage?.() || '')) return;
    box.dataset.lang = window.i18n?.getLanguage?.() || '';
    const retry = el('button', 'msd-inline-retry', t('tp_retry', 'Опитай отново'));
    retry.type = 'button';
    retry.addEventListener('click', () => retryAttendance());
    box.replaceChildren(el('span', null, t('msd_att_error', 'Присъствията не можаха да се заредят.')), retry);
    box.hidden = false;
}

// ---------- data ----------

function setRoster(list) {
    state.rows = (Array.isArray(list) ? list : []).map((s) => deps.normalizeStudent(s)).filter((r) => r.key);
    deps.onRows?.(state.rows);
}

function loadRoster(token, { force = false } = {}) {
    const hadRows = state.rows.length > 0;
    if (force) markRosterChanged(state.classId);
    return ensureRoster(state.classId, state.className, { rethrow: true })
        .then((list) => {
            if (token !== session) return;
            setRoster(list);
            state.rosterStatus = 'ready';
            state.rosterRefreshFailed = false;
            hideStaleNote(dom.stale);
            render();
            deps.enrich?.(state.rows, () => {
                if (token !== session) return;
                deps.onRows?.(state.rows);
                render();
            });
        })
        .catch((error) => {
            if (token !== session) return;
            console.error('[manageStudents] roster load failed', error);
            if (error?.status === 401) {
                document.dispatchEvent(new CustomEvent('app:authexpired'));
                return;
            }
            if (hadRows || state.rows.length > 0) {
                state.rosterRefreshFailed = true;
                showStaleNote(dom.stale, () => refreshAll({ force: true }));
            } else {
                state.rosterStatus = 'error';
            }
            render();
        });
}

function loadAttendance(token) {
    if (!state.classId) {
        state.attendanceStatus = state.summary ? 'ready' : 'error';
        render();
        return Promise.resolve();
    }
    return loadAttendanceSummary(state.classId)
        .then(({ data, current }) => {
            if (token !== session) return;
            if (current) {
                state.summary = data;
                state.attendanceStatus = 'ready';
            } else if (!state.summary) {
                // Invalidated while in flight (e.g. attendance just saved): ask again
                loadAttendance(token);
                return;
            }
            render();
        })
        .catch((error) => {
            if (token !== session) return;
            console.error('[manageStudents] attendance load failed', error);
            if (state.summary) {
                // Older totals stay on screen; a discreet note offers a retry
                showStaleNote(dom.stale, () => refreshAll({ force: true }));
            } else {
                state.attendanceStatus = 'error';
            }
            render();
        });
}

function retryRoster() {
    state.rosterStatus = 'loading';
    render();
    loadRoster(session, { force: true });
}

function retryAttendance() {
    state.attendanceStatus = 'loading';
    render();
    loadAttendance(session);
}

/** Refresh both sources; rows stay visible meanwhile. */
function refreshAll({ force = false } = {}) {
    hideStaleNote(dom.stale);
    if (force) invalidateAttendanceSummary(state.classId);
    if (!state.rows.length) state.rosterStatus = 'loading';
    if (!state.summary) state.attendanceStatus = 'loading';
    render();
    const token = session;
    loadRoster(token, { force });
    loadAttendance(token);
}

// ---------- view state (search / filters / scroll) ----------

function syncControls() {
    if (dom.search.value !== state.query) dom.search.value = state.query;
    FILTER_KEYS.forEach((k) => {
        const select = dom.filterSelects[k];
        if (select && select.value !== state.filters[k]) select.value = state.filters[k];
    });
    dom.filterPanel.hidden = !state.filtersOpen;
    dom.filterToggle.setAttribute('aria-expanded', String(state.filtersOpen));
    dom.filterToggle.classList.toggle('has-filters', filtersActive());
}

function rememberView() {
    if (!classKey()) return;
    viewMemory.set(classKey(), {
        query: state.query,
        filters: { ...state.filters },
        filtersOpen: state.filtersOpen,
        scrollTop: dom?.scroll?.scrollTop || 0
    });
}

function clearCriteria() {
    state.query = '';
    state.filters = { level: '', faculty: '', specialization: '', group: '' };
    syncControls();
    render();
    dom.search.focus({ preventScroll: true });
}

// ---------- focus trap ----------

function focusables() {
    return Array.from(dom.dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function onKeydown(event) {
    if (!isOverlayVisible(dom.overlay)) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        goBack();
        return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dom.dialog || !dom.dialog.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (active === last || !dom.dialog.contains(active))) {
        event.preventDefault();
        first.focus();
    }
}

// ---------- open / close / navigation ----------

function hide() {
    session += 1;
    hideStaleNote(dom.stale);
    hideOverlay(dom.overlay, false);
}

function restoreFocus() {
    const target = state.opener;
    state.opener = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

function closeDialog() {
    hide();
    deps.close();
    restoreFocus();
}

function goBack() {
    hide();
    state.opener = null;
    deps.back(state.className);
}

function openAddStudents() {
    rememberView();
    hide();
    deps.openAddStudents(state.className);
}

function openStudent(openKey, opener) {
    rememberView();
    // The details dialog hides this one and shows it again on return (state kept);
    // it gets the row (identity shown at once) and the row's button (focus on return)
    const row = state.rows.find((r) => r.openKey === openKey) || null;
    deps.openStudent(openKey, state.className, row, opener || null);
}

function bindEvents() {
    dom.close.addEventListener('click', (e) => { e.preventDefault(); closeDialog(); });
    dom.back.addEventListener('click', goBack);
    dom.add.addEventListener('click', openAddStudents);
    dom.overlay.addEventListener('click', (e) => { if (e.target === dom.overlay) goBack(); });
    document.addEventListener('keydown', onKeydown);

    dom.search.addEventListener('input', () => {
        state.query = dom.search.value;
        render();
    });
    dom.filterToggle.addEventListener('click', () => {
        state.filtersOpen = !state.filtersOpen;
        syncControls();
    });
    FILTER_KEYS.forEach((k) => {
        dom.filterSelects[k]?.addEventListener('change', () => {
            state.filters[k] = dom.filterSelects[k].value;
            syncControls();
            render();
        });
    });
    dom.filterReset?.addEventListener('click', () => {
        state.filters = { level: '', faculty: '', specialization: '', group: '' };
        syncControls();
        render();
    });

    // Row interactions: the name is a button (keyboard); the whole row is a
    // larger mouse/touch target.
    dom.body.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-key]');
        if (!tr) return;
        const button = tr.querySelector('.msd-name');
        if (button?.dataset.openKey) openStudent(button.dataset.openKey, button);
    });

    document.addEventListener('app:languagechange', () => {
        if (!dom) return;
        dom.body.querySelectorAll('td.msd-cell--att').forEach((td) => { delete td.dataset.sig; });
        if (isOverlayVisible(dom.overlay)) render();
    });
}

/**
 * @param {object} callbacks
 * @param {(student) => object} callbacks.normalizeStudent - roster entry -> row
 *   { key, openKey, id, facultyNumber, name, email, level, faculty, specialization, group, searchText }
 * @param {(openKey, className, row, opener) => void} callbacks.openStudent
 * @param {(className) => void} callbacks.openAddStudents
 * @param {(className) => void} callbacks.back - to the discipline menu
 * @param {() => void} callbacks.close - close every class overlay
 * @param {(rows) => void} [callbacks.onRows] - rows rendered (keep lookups in sync)
 * @param {(rows, done) => void} [callbacks.enrich] - fill missing details in the background
 */
export function initManageStudentsDialog(callbacks) {
    if (deps) return;
    deps = callbacks;
    dom = bindDom();
    if (dom) bindEvents();
}

/**
 * Show the dialog for a course.
 * @param {object} opts
 * @param {string} opts.className
 * @param {number|string|null} opts.classId
 * @param {boolean} [opts.restore] - returning from Add students: keep search, filters, scroll
 * @param {HTMLElement} [opts.opener] - focus goes back here when the dialog is closed
 */
export function openManageStudentsDialog({ className, classId, restore = false, opener = null }) {
    if (!dom) return;
    session += 1;
    const token = session;
    const switched = String(classId || className || '') !== classKey();
    state.className = className;
    state.classId = classId || null;
    if (opener) state.opener = opener;
    if (dom.subtitle) dom.subtitle.textContent = className || '';

    // Search / filters: kept when coming back, fresh when opened from the menu
    const remembered = restore ? viewMemory.get(classKey()) : null;
    state.query = remembered?.query || '';
    state.filters = remembered ? { ...remembered.filters } : { level: '', faculty: '', specialization: '', group: '' };
    state.filtersOpen = remembered?.filtersOpen || false;
    if (!restore) viewMemory.delete(classKey());
    syncControls();

    // Cached data first (rows, then totals); skeletons only for what is missing
    const stored = loadClassStudentsFromStorage(className);
    if (Array.isArray(stored)) {
        setRoster(stored);
        state.rosterStatus = 'ready';
    } else if (switched || !state.rows.length) {
        state.rows = [];
        state.rosterStatus = 'loading';
    }
    const cachedSummary = readAttendanceSummary(state.classId);
    state.summary = cachedSummary ? cachedSummary.data : null;
    state.attendanceStatus = cachedSummary ? 'ready' : 'loading';
    state.rosterRefreshFailed = false;
    hideStaleNote(dom.stale);

    render();
    showOverlay(dom.overlay, false);
    document.body.style.overflow = 'hidden';
    dom.scroll.scrollTop = remembered?.scrollTop || 0;
    if (restore) dom.add.focus({ preventScroll: true });
    // The dialog itself, not the search field: no keyboard popping up on phones
    else dom.dialog.focus({ preventScroll: true });

    loadRoster(token);
    if (!isAttendanceSummaryFresh(state.classId)) loadAttendance(token);
}

/** Reload after a change (student removed, etc.); rows stay on screen meanwhile. */
export function refreshManageStudentsDialog({ classId, className } = {}) {
    if (!dom) return Promise.resolve();
    if (className && className !== state.className) return Promise.resolve();
    if (classId && !state.classId) state.classId = classId;
    refreshAll({ force: true });
    return Promise.resolve();
}

/** The dialog was hidden by another module (close all, route change). */
export function onManageStudentsHidden() {
    session += 1;
}

/** Rename while open: update the subtitle. */
export function renameManageStudentsDialog(oldName, newName) {
    if (state.className !== oldName) return;
    state.className = newName;
    if (dom?.subtitle) dom.subtitle.textContent = newName;
}
