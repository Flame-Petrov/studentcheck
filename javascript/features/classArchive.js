/**
 * Архив (teacherHomepage.html#archive, inside the Дисциплини view).
 *
 * "Archive" on a class (options dialog / long press) moves it here: it is
 * hidden from the class list, statistics and the students' pages, with its
 * students and attendance kept. From here a class can be
 *   - restored to the class list (by id; when an active class already has its
 *     name, the teacher picks a new one, pre-filled with the server's
 *     suggestion "<name> (2)"), or
 *   - deleted: it leaves the archive too. The server still keeps it.
 *
 * Several archived classes can share a name; each row shows when it was
 * archived, its lessons (with their date range) and students to tell them apart.
 */

import { fetchArchivedClasses, restoreArchivedClass, deleteArchivedClass } from '../api/classApi.js';
import { upsertCachedClass } from '../data/classesStore.js';
import { loadClasses } from './classesView.js';
import { openConfirmOverlay, showOverlay, hideOverlay, isOverlayVisible } from '../ui/overlays.js';
import { toast as uiToast } from '../ui/toast.js';
import { showSkeletonRows, showLoadError, endBusy } from '../ui/skeleton.js';

export const ARCHIVE_HASH = '#archive';

function t(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback;
}

function tf(key, fallback, params = {}) {
    return t(key, fallback).replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? ''));
}

function lang() {
    return window.i18n?.getLanguage?.() === 'en' ? 'en-GB' : 'bg-BG';
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function countText(n, oneKey, oneFallback, manyKey, manyFallback) {
    return (n === 1 ? t(oneKey, oneFallback) : t(manyKey, manyFallback)).replace('{n}', String(n));
}

export function isArchiveRoute() {
    return location.hash === ARCHIVE_HASH;
}

const dom = {};
let bound = false;
const state = {
    status: 'idle',        // idle | loading | ready | error
    items: [],
    promise: null,
    pending: new Map(),    // class id -> 'restore' | 'delete'
    shown: false
};

function bind() {
    if (bound) return;
    bound = true;
    dom.section = document.getElementById('classesSection');
    dom.link = document.getElementById('archiveLink');
    dom.view = document.getElementById('archiveView');
    dom.back = document.getElementById('archiveBack');
    dom.title = document.getElementById('archiveTitle');
    dom.list = document.getElementById('archiveList');
    dom.region = document.getElementById('archiveRegion');
    dom.empty = document.getElementById('archiveEmpty');
    dom.name = {
        overlay: document.getElementById('restoreNameOverlay'),
        dialog: document.querySelector('#restoreNameOverlay .rnd-dialog'),
        text: document.getElementById('restoreNameText'),
        form: document.getElementById('restoreNameForm'),
        input: document.getElementById('restoreNameInput'),
        error: document.getElementById('restoreNameError'),
        cancel: document.getElementById('restoreNameCancel'),
        submit: document.getElementById('restoreNameSubmit')
    };

    dom.link?.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        history.pushState({ tpView: 'classes', tpArchiveFromList: true }, '', ARCHIVE_HASH);
        window.scrollTo(0, 0);
        syncClassesRoute({ focus: true });
    });
    dom.back?.addEventListener('click', () => {
        if (history.state && history.state.tpArchiveFromList) {
            history.back();
            return;
        }
        history.replaceState({ tpView: 'classes' }, '', `${location.pathname}${location.search}`);
        syncClassesRoute({ focus: true });
    });
    dom.list?.addEventListener('click', onListClick);
    dom.name.form?.addEventListener('submit', onNameSubmit);
    dom.name.cancel?.addEventListener('click', () => closeNameDialog());
    dom.name.input?.addEventListener('input', () => setNameError(''));
    dom.name.overlay?.addEventListener('click', (event) => {
        if (event.target === dom.name.overlay && !nameDialog.pending) closeNameDialog();
    });
    document.addEventListener('keydown', onNameKeydown);
    document.addEventListener('app:languagechange', () => {
        if (state.shown) render();
        if (nameDialog.item) renderNameText();
    });
}

/**
 * Show the archive or the class list, following location.hash. Called on
 * entering the Дисциплини view and on every route change inside it.
 */
export function syncClassesRoute({ focus = false } = {}) {
    bind();
    if (!dom.view) return;
    const show = isArchiveRoute();
    const wasShown = state.shown;
    state.shown = show;
    document.documentElement.toggleAttribute('data-classes-archive', show);
    dom.view.hidden = !show;
    if (show) {
        if (state.status === 'ready') render();
        load({ force: wasShown === false && state.status === 'ready' });
        if (focus) dom.title?.focus({ preventScroll: true });
        return;
    }
    if (wasShown) {
        closeNameDialog({ restoreFocus: false });
        if (focus) dom.link?.focus({ preventScroll: true });
    }
}

// ---------- data ----------

function load({ force = false } = {}) {
    if (state.promise) return state.promise;
    if (state.status === 'ready' && !force) return Promise.resolve();
    if (state.status !== 'ready') {
        state.status = 'loading';
        render();
    }
    state.promise = fetchArchivedClasses()
        .then((items) => {
            state.items = Array.isArray(items) ? items : [];
            state.status = 'ready';
        })
        .catch((error) => {
            if (error?.redirectingAuth) return;
            console.error('[archive] load failed', error);
            // A refresh that fails keeps the list on screen
            if (state.status !== 'ready') state.status = 'error';
        })
        .finally(() => {
            state.promise = null;
            if (state.shown) render();
        });
    return state.promise;
}

// ---------- rendering ----------

function formatDate(iso, opts) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang(), opts);
}

function lessonsText(item) {
    const n = Number(item.lessons_count) || 0;
    if (n === 0) return t('tp_stats_no_lessons', 'Няма проведени занятия');
    const count = countText(n, 'tp_stats_lessons_one', '{n} занятие', 'tp_stats_lessons_many', '{n} занятия');
    const short = { day: 'numeric', month: 'short', year: 'numeric' };
    const first = formatDate(item.first_lesson_at, short);
    const last = formatDate(item.last_lesson_at, short);
    if (!first || !last) return count;
    return `${count} (${first === last ? first : `${first} – ${last}`})`;
}

function itemRow(item) {
    const li = el('li', 'arc-item');
    li.dataset.classId = String(item.id);
    const main = el('div', 'arc-main');
    const nameId = `arcName-${item.id}`;
    const name = el('h3', 'arc-name', item.name);
    name.id = nameId;
    const meta = [
        tf('arc_archived_on', 'Архивирана на {date}', { date: formatDate(item.archived_at, { day: 'numeric', month: 'long', year: 'numeric' }) }),
        lessonsText(item),
        countText(Number(item.students_count) || 0, 'tp_stats_students_one', '{n} студент', 'tp_stats_students_many', '{n} студенти')
    ];
    main.append(name, el('p', 'arc-meta', meta.join(' · ')));

    const pending = state.pending.get(item.id);
    const actions = el('div', 'arc-actions');
    const restore = el('button', 'arc-btn arc-restore', pending === 'restore' ? t('arc_restoring', 'Възстановяване…') : t('arc_restore', 'Възстанови'));
    restore.type = 'button';
    restore.dataset.action = 'restore';
    restore.setAttribute('aria-label', tf('arc_restore_label', 'Възстанови „{name}“', { name: item.name }));
    const del = el('button', 'arc-btn arc-delete', pending === 'delete' ? t('arc_deleting', 'Изтриване…') : t('arc_delete', 'Изтрий'));
    del.type = 'button';
    del.dataset.action = 'delete';
    del.setAttribute('aria-label', tf('arc_delete_label', 'Изтрий „{name}“', { name: item.name }));
    if (pending) {
        restore.disabled = true;
        del.disabled = true;
        (pending === 'restore' ? restore : del).setAttribute('aria-busy', 'true');
    }
    actions.append(restore, del);
    li.append(main, actions);
    return li;
}

function render() {
    if (!dom.region) return;
    // Keyboard focus survives a re-render (same row, same button)
    const active = document.activeElement;
    const focusRow = active && dom.list?.contains(active) ? active.closest('.arc-item')?.dataset.classId : null;
    const focusAction = focusRow ? active.dataset.action : null;

    dom.empty.hidden = true;
    if (state.status === 'loading' || state.status === 'idle') {
        dom.list.replaceChildren();
        dom.list.hidden = true;
        showSkeletonRows(dom.region, { count: 3, lines: 2, label: t('arc_loading', 'Зареждане на архива…') });
        return;
    }
    if (state.status === 'error') {
        dom.list.replaceChildren();
        dom.list.hidden = true;
        showLoadError(dom.region, t('arc_load_error', 'Архивът не можа да се зареди.'), () => load({ force: true }));
        return;
    }
    endBusy(dom.region);
    dom.region.replaceChildren();
    dom.list.hidden = state.items.length === 0;
    dom.empty.hidden = state.items.length > 0;
    dom.list.replaceChildren(...state.items.map(itemRow));
    if (focusRow) {
        const row = dom.list.querySelector(`.arc-item[data-class-id="${CSS.escape(focusRow)}"]`);
        const target = row?.querySelector(`[data-action="${focusAction}"]`);
        if (target && !target.disabled) target.focus({ preventScroll: true });
    }
}

function itemById(id) {
    return state.items.find((x) => String(x.id) === String(id)) || null;
}

/** After a row leaves the list: focus the next row's button of the same kind, else the title. */
function removeItem(id, action) {
    const index = state.items.findIndex((x) => String(x.id) === String(id));
    if (index < 0) return;
    state.items.splice(index, 1);
    state.pending.delete(Number(id));
    render();
    const next = state.items[index] || state.items[index - 1];
    const target = next ? dom.list.querySelector(`.arc-item[data-class-id="${CSS.escape(String(next.id))}"] [data-action="${action}"]`) : null;
    (target || dom.title)?.focus({ preventScroll: true });
}

function setPending(id, value) {
    if (value) state.pending.set(Number(id), value);
    else state.pending.delete(Number(id));
    render();
}

function errorText(error, fallbackKey, fallback) {
    if (error?.status === 403) return t('cod_forbidden', 'Нямате права да променяте тази дисциплина.');
    return t(fallbackKey, fallback);
}

// ---------- restore ----------

function onListClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const id = button.closest('.arc-item')?.dataset.classId;
    const item = itemById(id);
    if (!item || state.pending.has(item.id)) return;
    if (button.dataset.action === 'restore') restore(item, undefined, button);
    else confirmDelete(item, button);
}

async function restore(item, name, opener) {
    setPending(item.id, 'restore');
    let restored;
    try {
        restored = await restoreArchivedClass(item.id, name);
    } catch (error) {
        if (error?.redirectingAuth) return;
        if (error?.status === 409 && error.body?.code === 'name_taken') {
            setPending(item.id, null);
            openNameDialog(item, error.body, opener);
            return;
        }
        if (error?.status === 404) {
            // Restored or deleted elsewhere: refresh the list
            setPending(item.id, null);
            uiToast(t('arc_gone', 'Дисциплината вече не е в архива.'), { tone: 'error', size: 'wide', duration: 2200, replace: true });
            load({ force: true });
            return;
        }
        console.error('[archive] restore failed', error);
        setPending(item.id, null);
        uiToast(errorText(error, 'arc_restore_error', 'Неуспешно възстановяване. Опитайте отново.'), { tone: 'error', size: 'wide', duration: 2200, replace: true });
        return;
    }
    // Back in the class list: cache now, and a fresh list in the background
    upsertCachedClass({ id: restored.id, name: restored.name });
    loadClasses({ force: true }).catch(() => {});
    removeItem(item.id, 'restore');
    uiToast(tf('arc_restored', '„{name}“ е върната в „Дисциплини“.', { name: restored.name }), { tone: 'success', size: 'wide', duration: 2000, replace: true });
}

// The "name is taken" dialog: a new name, pre-filled with the server's suggestion
const nameDialog = { item: null, opener: null, taken: '', pending: false };

function renderNameText() {
    if (!dom.name.text || !nameDialog.item) return;
    dom.name.text.textContent = tf('arc_name_text', 'Вече имате дисциплина „{name}“. Изберете друго име, за да я възстановите.', { name: nameDialog.taken });
}

function setNameError(message) {
    if (!dom.name.error) return;
    dom.name.error.textContent = message;
    dom.name.error.hidden = !message;
    dom.name.input?.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function openNameDialog(item, body, opener) {
    if (!dom.name.overlay) return;
    nameDialog.item = item;
    nameDialog.opener = opener || null;
    nameDialog.taken = body?.name || item.name;
    nameDialog.pending = false;
    renderNameText();
    setNameError('');
    dom.name.input.value = body?.suggestedName || `${item.name} (2)`;
    dom.name.submit.disabled = false;
    dom.name.submit.removeAttribute('aria-busy');
    dom.name.submit.textContent = t('arc_restore', 'Възстанови');
    showOverlay(dom.name.overlay);
    dom.name.input.focus();
    dom.name.input.select();
}

function closeNameDialog({ restoreFocus = true } = {}) {
    if (!dom.name?.overlay || !isOverlayVisible(dom.name.overlay)) return;
    hideOverlay(dom.name.overlay);
    const item = nameDialog.item;
    nameDialog.item = null;
    nameDialog.pending = false;
    if (!restoreFocus) return;
    const row = item ? dom.list.querySelector(`.arc-item[data-class-id="${CSS.escape(String(item.id))}"] [data-action="restore"]`) : null;
    (row || nameDialog.opener || dom.title)?.focus({ preventScroll: true });
}

async function onNameSubmit(event) {
    event.preventDefault();
    const item = nameDialog.item;
    if (!item || nameDialog.pending) return;
    const name = dom.name.input.value.replace(/\s+/g, ' ').trim();
    if (!name) {
        setNameError(t('arc_name_empty', 'Въведете име.'));
        dom.name.input.focus();
        return;
    }
    nameDialog.pending = true;
    dom.name.submit.disabled = true;
    dom.name.submit.setAttribute('aria-busy', 'true');
    dom.name.submit.textContent = t('arc_restoring', 'Възстановяване…');
    let restored;
    try {
        restored = await restoreArchivedClass(item.id, name);
    } catch (error) {
        if (error?.redirectingAuth) return;
        nameDialog.pending = false;
        dom.name.submit.disabled = false;
        dom.name.submit.removeAttribute('aria-busy');
        dom.name.submit.textContent = t('arc_restore', 'Възстанови');
        if (error?.status === 409 && error.body?.code === 'name_taken') {
            // Taken too: say so and offer the next free name
            nameDialog.taken = error.body.name || name;
            renderNameText();
            setNameError(tf('arc_name_taken', 'И „{name}“ е заето.', { name: nameDialog.taken }));
            if (error.body.suggestedName) dom.name.input.value = error.body.suggestedName;
            dom.name.input.focus();
            dom.name.input.select();
            return;
        }
        if (error?.status === 404) {
            closeNameDialog({ restoreFocus: false });
            uiToast(t('arc_gone', 'Дисциплината вече не е в архива.'), { tone: 'error', size: 'wide', duration: 2200, replace: true });
            load({ force: true });
            dom.title?.focus({ preventScroll: true });
            return;
        }
        console.error('[archive] restore (renamed) failed', error);
        setNameError(errorText(error, 'arc_restore_error', 'Неуспешно възстановяване. Опитайте отново.'));
        return;
    }
    closeNameDialog({ restoreFocus: false });
    upsertCachedClass({ id: restored.id, name: restored.name });
    loadClasses({ force: true }).catch(() => {});
    removeItem(item.id, 'restore');
    uiToast(tf('arc_restored', '„{name}“ е върната в „Дисциплини“.', { name: restored.name }), { tone: 'success', size: 'wide', duration: 2000, replace: true });
}

function onNameKeydown(event) {
    if (!dom.name?.overlay || !isOverlayVisible(dom.name.overlay)) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        if (!nameDialog.pending) closeNameDialog();
        return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dom.name.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dom.name.dialog.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (active === last || !dom.name.dialog.contains(active))) {
        event.preventDefault();
        first.focus();
    }
}

// ---------- delete ----------

function confirmDelete(item, opener) {
    openConfirmOverlay(
        tf('arc_delete_confirm', '„{name}“ ще бъде премахната и от архива. Няма да можете да я възстановите.', { name: item.name }),
        () => performDelete(item),
        () => opener?.focus({ preventScroll: true }),
        {
            title: t('arc_delete_title', 'Изтриване на дисциплината'),
            okText: t('arc_delete', 'Изтрий'),
            cancelText: t('arc_cancel', 'Отказ')
        }
    );
}

async function performDelete(item) {
    setPending(item.id, 'delete');
    try {
        await deleteArchivedClass(item.id);
    } catch (error) {
        if (error?.redirectingAuth) return;
        if (error?.status === 404 || error?.status === 409) {
            // Already gone from the archive (restored or deleted elsewhere)
            setPending(item.id, null);
            load({ force: true });
            return;
        }
        console.error('[archive] delete failed', error);
        setPending(item.id, null);
        uiToast(errorText(error, 'arc_delete_error', 'Неуспешно изтриване. Опитайте отново.'), { tone: 'error', size: 'wide', duration: 2200, replace: true });
        dom.list.querySelector(`.arc-item[data-class-id="${CSS.escape(String(item.id))}"] [data-action="delete"]`)?.focus({ preventScroll: true });
        return;
    }
    removeItem(item.id, 'delete');
    uiToast(tf('arc_deleted', '„{name}“ е изтрита.', { name: item.name }), { tone: 'success', size: 'wide', duration: 2000, replace: true });
}

/** A class was archived from the list: the archive reloads (with it) next time. */
export function invalidateArchive() {
    if (state.shown) {
        load({ force: true });
        return;
    }
    if (state.status === 'ready') {
        state.status = 'idle';
        state.items = [];
    }
}
