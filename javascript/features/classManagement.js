/**
 * Class Management Feature Module
 * 
 * Handles class rename, delete, and options overlay.
 * Manages class storage migration and UI updates.
 */

import { getClassIdByNameFromStorage, classItemKey, removeClassFromStoredMap, getStoredClassesMap, saveClassesMap } from '../storage/classStorage.js';
import { loadClassStudentsFromStorage, saveClassStudents } from '../storage/studentStorage.js';
import { fetchClassStudents, fetchClasses, deleteClassById, renameClassById } from '../api/classApi.js';
import {
    getCurrentClass,
    setCurrentClass,
    clearCurrentClass,
    isClassReady,
    setClassReady,
    getClassStudentAssignments,
    setClassStudentAssignments,
    getClassIdByName,
    setClassId
} from '../state/appState.js';
import { updateClassStatusUI, setClassButtonLabel } from '../ui/classUI.js';
import { renameCachedClass, removeCachedClass, readCachedClasses } from '../data/classesStore.js';
import { markRosterChanged } from '../data/rosterStore.js';
import { invalidateAttendanceSummary } from '../data/attendanceSummaryStore.js';
import { renameManageStudentsDialog } from './manageStudentsDialog.js';
import { toast as uiToast } from '../ui/toast.js';
import { openConfirmOverlay, showOverlay, hideOverlay, getOverlay } from '../ui/overlays.js';
import { getActiveClassName, getRawClassNameFromButton } from '../utils/helpers.js';
import { getTeacherEmail, normalizeEmail } from '../config/api.js';

/*
 * "Опции на дисциплината" dialog (static markup: #classOptionsOverlay in
 * teacherHomepage.html, styles: css/classOptionsDialog.css).
 *
 * Opens at once from the class list's state (id + name). Only when that is
 * genuinely missing is the class looked up, with a skeleton in the name field
 * and the actions disabled. Every action is bound to the class id captured
 * when the dialog opened; a session token keeps late responses from touching
 * a closed or re-opened dialog, while a completed mutation still updates the
 * class card, state and caches.
 */

const NAME_MAX = 50;
let optionsDom = null;
let optionsSession = 0;
const optionsState = {
    classId: null,
    original: '',     // the name on the server (what "unchanged" compares against)
    status: 'ready',  // ready | loading | error
    pending: null,    // null | 'rename' | 'delete'
    tried: false,     // a submit was attempted (show "required" from then on)
    opener: null
};

function bindClassOptionsDom() {
    if (optionsDom) return optionsDom;
    const overlay = document.getElementById('classOptionsOverlay');
    if (!overlay) return null;
    optionsDom = {
        overlay,
        dialog: overlay.querySelector('.cod-dialog'),
        form: overlay.querySelector('#classOptionsRenameForm'),
        field: overlay.querySelector('#classOptionsField'),
        input: overlay.querySelector('#classOptionsNameInput'),
        skeleton: overlay.querySelector('#classOptionsNameSkeleton'),
        rename: overlay.querySelector('#classOptionsSaveBtn'),
        renameLabel: overlay.querySelector('#classOptionsSaveLabel'),
        error: overlay.querySelector('#classOptionsError'),
        loadError: overlay.querySelector('#classOptionsLoadError'),
        del: overlay.querySelector('#classOptionsDeleteBtn'),
        delLabel: overlay.querySelector('#classOptionsDeleteLabel'),
        delError: overlay.querySelector('#classOptionsDeleteError'),
        close: overlay.querySelector('#closeClassOptionsBtn')
    };

    optionsDom.close.addEventListener('click', () => closeClassOptionsOverlay());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeClassOptionsOverlay();
    });
    document.addEventListener('keydown', onClassOptionsKeydown);
    optionsDom.input.addEventListener('input', () => {
        setOptionsError(optionsDom.error, '');
        updateClassOptionsControls();
    });
    optionsDom.form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitRename();
    });
    // Enter submits even while Rename is disabled (browsers skip implicit
    // submission then), so an empty or too long name gets its message
    optionsDom.input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        submitRename();
    });
    optionsDom.del.addEventListener('click', confirmDelete);
    // Static labels are re-translated; pending labels and messages follow
    document.addEventListener('app:languagechange', () => {
        if (isOverlayVisible(optionsDom.overlay)) updateClassOptionsControls();
    });
    return optionsDom;
}

function validateName(value) {
    const name = String(value || '').trim();
    if (!name) return { ok: false, code: 'required' };
    if (name.length > NAME_MAX) return { ok: false, code: 'too_long' };
    return { ok: true, name };
}

function setOptionsError(el, message) {
    if (!el) return;
    if (el.textContent !== (message || '')) el.textContent = message || '';
    el.hidden = !message;
}

function setButtonLabel(labelEl, text) {
    if (labelEl && labelEl.textContent !== text) labelEl.textContent = text;
}

/** Enabled/disabled state, labels and live validation message. */
function updateClassOptionsControls() {
    const d = optionsDom;
    if (!d) return;
    const ready = optionsState.status === 'ready';
    const check = validateName(d.input.value);
    const unchanged = check.ok && check.name === optionsState.original;
    d.rename.disabled = !ready || !!optionsState.pending || !check.ok || unchanged;
    d.del.disabled = !ready || !!optionsState.pending || !optionsState.classId;
    d.input.readOnly = !!optionsState.pending;

    setButtonLabel(d.renameLabel, optionsState.pending === 'rename'
        ? i18nText('cod_renaming', 'Преименуване…')
        : i18nText('cod_rename', 'Преименувай'));
    setButtonLabel(d.delLabel, optionsState.pending === 'delete'
        ? i18nText('cod_deleting', 'Изтриване…')
        : i18nText('cod_delete_btn', 'Изтрий дисциплината'));
    d.rename.setAttribute('aria-busy', String(optionsState.pending === 'rename'));
    d.del.setAttribute('aria-busy', String(optionsState.pending === 'delete'));

    // Validation feedback: "too long" as you type, "required" once a submit was tried
    if (ready && !optionsState.pending) {
        if (check.code === 'too_long') {
            setOptionsError(d.error, i18nText('err_name_too_long', 'Името трябва да е 50 символа или по-малко.'));
        } else if (check.code === 'required' && optionsState.tried) {
            setOptionsError(d.error, i18nText('err_name_required', 'Името е задължително.'));
        } else if (d.error.dataset.kind === 'validation') {
            setOptionsError(d.error, '');
        }
        d.error.dataset.kind = check.ok ? (d.error.dataset.kind || '') : 'validation';
    }
    d.input.setAttribute('aria-invalid', String(!check.ok && (check.code === 'too_long' || optionsState.tried)));
}

function setLoadingField(loading) {
    const d = optionsDom;
    d.field.classList.toggle('is-loading', loading);
    if (loading) d.field.setAttribute('aria-busy', 'true');
    else d.field.removeAttribute('aria-busy');
    d.skeleton.hidden = !loading;
}

function showLoadError(message) {
    const d = optionsDom;
    d.loadError.replaceChildren(document.createTextNode(message + ' '));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'cod-link';
    retry.textContent = i18nText('tp_retry', 'Опитай отново');
    retry.addEventListener('click', () => {
        d.loadError.hidden = true;
        loadClassDetails(optionsSession, { name: '', classId: optionsState.classId });
    });
    d.loadError.appendChild(retry);
    d.loadError.hidden = false;
}

function setOriginalName(name) {
    const d = optionsDom;
    const editing = d.input.value.trim() !== optionsState.original;
    optionsState.original = name;
    // A refresh never overwrites what the user has started typing
    if (!editing || optionsState.status !== 'ready') d.input.value = name;
}

/** Class details genuinely missing (e.g. stale state): look them up. */
function loadClassDetails(token, { name, classId }) {
    optionsState.status = 'loading';
    setLoadingField(true);
    updateClassOptionsControls();
    return fetchClasses()
        .then(({ classes }) => {
            if (token !== optionsSession) return;
            const list = Array.isArray(classes) ? classes : [];
            const match = list.find((c) => (classId && String(c.id) === String(classId)) || (!classId && name && String(c.name).trim() === name));
            if (!match) throw Object.assign(new Error('Class not found'), { notFound: true });
            optionsState.classId = String(match.id);
            optionsState.status = 'ready';
            setLoadingField(false);
            setOriginalName(String(match.name || '').trim());
            updateClassOptionsControls();
        })
        .catch((error) => {
            if (token !== optionsSession) return;
            console.error('[classOptions] details load failed', error);
            optionsState.status = 'error';
            setLoadingField(false);
            optionsDom.input.value = '';
            updateClassOptionsControls();
            showLoadError(error?.notFound
                ? i18nText('cod_not_found', 'Дисциплината не беше намерена.')
                : i18nText('cod_load_error', 'Неуспешно зареждане на дисциплината.'));
        });
}

function classNameFromCard(classId) {
    if (!classId) return '';
    const card = document.querySelector(`.newClassBtn[data-class-id="${CSS.escape(String(classId))}"]`);
    return card ? String(getRawClassNameFromButton(card) || card.dataset.className || '').trim() : '';
}

/**
 * Open the dialog for a class.
 * @param {string} className - name from the class list (normally known)
 * @param {object} [opts]
 * @param {string|number} [opts.classId] - stable id (normally known)
 * @param {HTMLElement} [opts.opener] - focus returns here on close
 */
export function openClassOptionsOverlay(className, { classId = null, opener = null } = {}) {
    const d = bindClassOptionsDom();
    if (!d) return;
    optionsSession += 1;
    const token = optionsSession;

    // Everything we normally already have: the class list's id + name
    let name = String(className || '').trim();
    let id = classId ? String(classId) : '';
    if (!id && name) id = String(getClassIdByName(name) || getClassIdByNameFromStorage(name) || '');
    if (!name && id) {
        name = classNameFromCard(id)
            || String((readCachedClasses()?.data || []).find((c) => String(c.id) === id)?.name || '').trim();
    }

    optionsState.classId = id || null;
    optionsState.original = name;
    optionsState.pending = null;
    optionsState.tried = false;
    optionsState.opener = opener || getCurrentClass().button || null;
    d.input.value = name;
    d.error.dataset.kind = '';
    setOptionsError(d.error, '');
    setOptionsError(d.delError, '');
    d.loadError.hidden = true;

    if (name && id) {
        optionsState.status = 'ready';
        setLoadingField(false);
        updateClassOptionsControls();
    } else {
        d.input.value = '';
        loadClassDetails(token, { name, classId: id });
    }

    showOverlay(d.overlay, false);
    document.body.style.overflow = 'hidden';
    // The dialog itself, not the input: no keyboard popping up on phones
    d.dialog.focus({ preventScroll: true });
}

/**
 * The class list re-rendered (background refresh): pick up a name changed
 * elsewhere, without touching what the user is typing.
 */
export function syncClassOptionsWithList() {
    const d = optionsDom;
    if (!d || !isOverlayVisible(d.overlay) || optionsState.status !== 'ready' || optionsState.pending) return;
    const fresh = classNameFromCard(optionsState.classId);
    if (fresh && fresh !== optionsState.original) {
        setOriginalName(fresh);
        updateClassOptionsControls();
    }
}

/**
 * Close class options overlay
 */
export function closeClassOptionsOverlay({ restoreFocus = true } = {}) {
    // Responses still in flight belong to a dialog that is gone
    optionsSession += 1;
    if (optionsDom) {
        hideOverlay(optionsDom.overlay, false);
        optionsState.pending = null;
    }
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    if (!readyPopupOverlay || !isOverlayVisible(readyPopupOverlay)) {
        document.body.style.overflow = '';
    }
    if (restoreFocus) {
        const target = optionsState.opener;
        if (target && target.isConnected) target.focus({ preventScroll: true });
        else document.getElementById('classesTitle')?.focus({ preventScroll: true });
    }
    optionsState.opener = null;
}

function onClassOptionsKeydown(e) {
    const d = optionsDom;
    if (!d || !isOverlayVisible(d.overlay)) return;
    // The delete confirmation sits on top and handles its own keys
    const confirm = document.getElementById('confirmOverlay');
    if (confirm && confirm.style.visibility === 'visible') return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeClassOptionsOverlay();
        return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(d.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter((node) => node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === d.dialog || !d.dialog.contains(active))) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (active === last || !d.dialog.contains(active))) {
        e.preventDefault();
        first.focus();
    }
}

function mutationErrorMessage(error, fallbackKey, fallbackText) {
    if (error?.status === 409) return i18nText('cod_duplicate', 'Вече имате дисциплина с това име.');
    if (error?.status === 403) return i18nText('cod_forbidden', 'Нямате права да променяте тази дисциплина.');
    return i18nText(fallbackKey, fallbackText);
}

/**
 * Handle save class options (rename)
 */
async function submitRename() {
    const d = optionsDom;
    if (!d || optionsState.pending || optionsState.status !== 'ready') return;
    optionsState.tried = true;
    const check = validateName(d.input.value);
    if (!check.ok) {
        updateClassOptionsControls();
        return;
    }
    if (check.name === optionsState.original) return;

    const token = optionsSession;
    const classId = optionsState.classId;
    const fromName = optionsState.original;
    const teacherEmail = getTeacherEmail();
    optionsState.pending = 'rename';
    d.error.dataset.kind = '';
    setOptionsError(d.error, '');
    updateClassOptionsControls();

    try {
        await renameClassById(classId, check.name, teacherEmail);
    } catch (error) {
        if (error?.redirectingAuth) return;
        console.error('[classOptions] rename failed', error);
        const message = mutationErrorMessage(error, 'cod_rename_error', 'Неуспешно преименуване. Опитайте отново.');
        if (token === optionsSession) {
            optionsState.pending = null;
            d.error.dataset.kind = 'server';
            updateClassOptionsControls();
            // The entered name stays; the error is announced (role="alert")
            setOptionsError(d.error, message);
        } else {
            showClassOptionsToast(message, 'error');
        }
        return;
    }

    // Confirmed by the server: update card, titles, state, storage and caches,
    // even if the dialog was closed in the meantime
    renameClass(fromName, check.name);
    showClassOptionsToast(i18nText('toast_class_renamed', 'Class was renamed'), 'success');
    if (token === optionsSession) {
        optionsState.pending = null;
        optionsState.original = check.name;
        closeClassOptionsOverlay();
    }
}

/**
 * Handle delete class from options (existing confirmation, then delete)
 */
function confirmDelete() {
    const d = optionsDom;
    if (!d || optionsState.pending || optionsState.status !== 'ready' || !optionsState.classId) return;
    const token = optionsSession;
    const classId = optionsState.classId;
    const name = optionsState.original;
    openConfirmOverlay(
        i18nText('confirm_delete_class', 'Are you sure you want to delete this class?'),
        () => performDelete(token, classId, name),
        () => {
            if (token === optionsSession) d.del.focus({ preventScroll: true });
        }
    );
}

async function performDelete(token, classId, name) {
    const d = optionsDom;
    if (token === optionsSession) {
        optionsState.pending = 'delete';
        setOptionsError(d.delError, '');
        updateClassOptionsControls();
    }
    try {
        await deleteClassById(classId, getTeacherEmail());
    } catch (error) {
        if (error?.redirectingAuth) return;
        console.error('[classOptions] delete failed', error);
        const message = mutationErrorMessage(error, 'cod_delete_error', 'Неуспешно изтриване. Дисциплината не е изтрита.');
        if (token === optionsSession) {
            optionsState.pending = null;
            updateClassOptionsControls();
            setOptionsError(d.delError, message);
        } else {
            showClassOptionsToast(message, 'error');
        }
        return;
    }

    // Confirmed: now remove it from the UI, state, storage and caches
    removeDeletedClassLocally(name, classId);
    showClassOptionsToast(i18nText('cod_deleted', 'Дисциплината е изтрита.'), 'success');
    if (token === optionsSession) {
        optionsState.pending = null;
        // The card is gone: focus goes to the list heading
        optionsState.opener = null;
        closeClassOptionsOverlay();
    }
}

/**
 * Check if overlay is visible
 */
function isOverlayVisible(overlay) {
    return overlay && overlay.style.visibility === 'visible';
}

/**
 * Rename a class
 * @param {string} oldName - Old class name
 * @param {string} newName - New class name
 * @returns {boolean} True if rename succeeded
 */
export function renameClass(oldName, newName) {
    const from = (oldName || '').trim();
    const to = (newName || '').trim();
    if (!from || !to || from === to) return false;
    
    const teacherEmail = getTeacherEmail();
    
    // Remove per-class local storage data on rename (avoid stale cache)
    try {
        const oldKey = classItemKey(from, teacherEmail);
        const newKey = classItemKey(to, teacherEmail);
        if (oldKey) localStorage.removeItem(oldKey);
        if (newKey) localStorage.removeItem(newKey);

        // Move the cached roster and any unsaved scanner draft to the new name.
        // The scanner and export look rosters up by name, so deleting them here
        // made every scan be ignored (and exports empty) until a reload.
        [[`${from}:students`, `${to}:students`], [`scanner:draft:${from}`, `scanner:draft:${to}`]].forEach(([oldK, newK]) => {
            const value = localStorage.getItem(oldK);
            localStorage.removeItem(oldK);
            if (value !== null) localStorage.setItem(newK, value);
            else localStorage.removeItem(newK);
        });

        // Keep the id -> name map in sync so getClassIdByNameFromStorage finds the class
        const storedMap = getStoredClassesMap();
        if (storedMap && typeof storedMap.forEach === 'function') {
            const updatedMap = new Map();
            storedMap.forEach((name, id) => updatedMap.set(id, name === from ? to : name));
            saveClassesMap(updatedMap);
        }
    } catch (e) {
        console.warn('Rename class storage cleanup failed', e);
    }
    
    // Update state
    if (isClassReady(from)) {
        setClassReady(from, false);
        setClassReady(to, true);
    }
    
    const assignments = getClassStudentAssignments(from);
    if (assignments) {
        setClassStudentAssignments(to, assignments);
        setClassStudentAssignments(from, null);
    }
    
    // Migrate class ID
    const classId = getClassIdByName(from);
    if (classId) {
        setClassId(to, classId);
        setClassId(from, null);
    }
    
    // Remove attendance logs for the old class name
    try {
        if (teacherEmail) {
            const normEmail = normalizeEmail(teacherEmail);
            const oldPrefix = `teacher:attendance:${normEmail}:logs:${encodeURIComponent(from)}:`;
            const toMove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(oldPrefix)) toMove.push(k);
            }
            toMove.forEach(k => localStorage.removeItem(k));
        }
    } catch (e) {
        console.warn('Attendance logs cleanup failed', e);
    }
    
    // Update UI: button, titles, currentClassName, datasets
    const btn = Array.from(document.querySelectorAll('.newClassBtn')).find(b => {
        const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '')
            .replace(/✓\s*Ready/g, '')
            .trim();
        return btnName === from;
    });
    
    if (btn) {
        setClassButtonLabel(btn, to);
        updateClassStatusUI(btn);
    }
    renameCachedClass(from, to);
    renameManageStudentsDialog(from, to);
    
    const current = getCurrentClass();
    if (current.name === from) {
        setCurrentClass(to, current.id, current.button === btn ? btn : current.button);
    }
    if (current.button === btn && btn) {
        btn.dataset.className = to;
    }
    
    // Update any open overlay titles
    const readyTitle = document.getElementById('readyClassTitle');
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    if (readyTitle && readyPopupOverlay && isOverlayVisible(readyPopupOverlay)) {
        readyTitle.textContent = to;
        readyTitle.dataset.dynamicTitle = 'true';
    }
    
    const manageTitle = document.getElementById('manageStudentsTitle');
    const manageStudentsOverlay = getOverlay('manageStudentsOverlay');
    if (manageTitle && manageStudentsOverlay && isOverlayVisible(manageStudentsOverlay)) {
        // The title stays "Управление на студенти"; the course name is the subtitle
        const manageSubtitle = document.getElementById('manageStudentsClassName');
        if (manageSubtitle) manageSubtitle.textContent = to;
    }
    
    const scannerTitle = document.getElementById('scannerTitle');
    const scannerOverlay = getOverlay('scannerOverlay');
    if (scannerTitle && scannerOverlay && isOverlayVisible(scannerOverlay)) {
        scannerTitle.textContent = to;
    }
    
    const attendanceTitle = document.getElementById('attendanceTitle');
    const attendanceOverlay = getOverlay('attendanceOverlay');
    if (attendanceTitle && attendanceOverlay && isOverlayVisible(attendanceOverlay)) {
        attendanceTitle.textContent = `${i18nText('attendance', 'Attendance')} — ${to}`;
    }
    
    return true;
}

/**
 * Delete a class completely
 * @param {string} name - Class name
 */
export async function deleteClass(name) {
    const n = (name || '').trim();
    if (!n) return;
    
    const teacherEmail = getTeacherEmail();
    const classId = getClassIdByName(n) || getClassIdByNameFromStorage(n);

    try {
        if (classId && teacherEmail) {
            await deleteClassById(classId, teacherEmail);
        }
    } catch (e) {
        alert('Failed to delete class from server: ' + e.message);
        // Keep it on screen: removing it locally would only make it reappear on reload
        return false;
    }

    removeDeletedClassLocally(n, classId);
    return true;
}

/**
 * After the server confirmed a deletion: remove the class from storage,
 * state, the class list and caches.
 * @param {string} n - Class name
 * @param {string|number} [classId]
 */
function removeDeletedClassLocally(n, classId) {
    const teacherEmail = getTeacherEmail();
    if (!classId) classId = getClassIdByName(n) || getClassIdByNameFromStorage(n);

    // Remove per-class item
    try {
        const key = classItemKey(n, teacherEmail);
        if (key) localStorage.removeItem(key);
    } catch (_) {}
    
    // Remove ${className}:students key
    try {
        localStorage.removeItem(`${n}:students`);
    } catch (_) {}
    
    // Remove readiness
    setClassReady(n, false);
    
    // Remove assignments
    setClassStudentAssignments(n, null);
    
    // Remove class ID
    setClassId(n, null);

    // Remove from stored classes map
    removeClassFromStoredMap(n);
    
    // Remove attendance logs
    try {
        if (teacherEmail) {
            const normEmail = normalizeEmail(teacherEmail);
            const prefix = `teacher:attendance:${normEmail}:logs:${encodeURIComponent(n)}:`;
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) keys.push(k);
            }
            keys.forEach(k => localStorage.removeItem(k));
        }
    } catch (_) {}
    
    // Remove button from UI
    let btn = Array.from(document.querySelectorAll('.newClassBtn')).find(b => {
        const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '')
            .replace(/✓\s*Ready/g, '')
            .trim();
        return btnName === n;
    });
    if (!btn && classId) btn = document.querySelector(`.newClassBtn[data-class-id="${CSS.escape(String(classId))}"]`);
    if (btn) {
        const li = btn.closest('li');
        if (li) li.remove();
    }
    removeCachedClass(n);
    if (classId) {
        markRosterChanged(classId);
        invalidateAttendanceSummary(classId);
    }
    
    // If current class matches, reset and close overlays
    const current = getCurrentClass();
    if (current.name === n) {
        clearCurrentClass();
        closeAllClassOverlays();
    }
}

function applyI18n() {
    try {
        if (window.i18n && typeof window.i18n.applyTranslations === 'function') {
            window.i18n.applyTranslations();
        }
    } catch (_) {}
}

function i18nText(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
        }
    } catch (_) {}
    return fallback || key;
}

function showClassOptionsToast(message, tone = 'success') {
    uiToast(message, { tone, size: 'wide', duration: 1600, fadeMs: 300, replace: true });
}

/**
 * Close all class-related overlays
 */
function closeAllClassOverlays() {
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    const manageStudentsOverlay = getOverlay('manageStudentsOverlay');
    const studentInfoOverlay = getOverlay('studentInfoOverlay');
    const scannerOverlay = getOverlay('scannerOverlay');
    
    if (readyPopupOverlay) hideOverlay(readyPopupOverlay);
    if (manageStudentsOverlay) hideOverlay(manageStudentsOverlay);
    if (studentInfoOverlay) hideOverlay(studentInfoOverlay);
    if (scannerOverlay) {
        // Scanner has its own close function that handles cleanup
        // This will be handled by the scanner module
    }
    document.body.style.overflow = '';
}
