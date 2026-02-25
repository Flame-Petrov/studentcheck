/**
 * Class Management Feature Module
 * 
 * Handles class rename, delete, and options overlay.
 * Manages class storage migration and UI updates.
 */

import { getClassIdByNameFromStorage, classItemKey, removeClassFromStoredMap } from '../storage/classStorage.js';
import { loadClassStudentsFromStorage, saveClassStudents } from '../storage/studentStorage.js';
import { fetchClassStudents, deleteClassById, renameClassById } from '../api/classApi.js';
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
import { updateClassStatusUI } from '../ui/classUI.js';
import { openConfirmOverlay, showOverlay, hideOverlay, getOverlay } from '../ui/overlays.js';
import { getActiveClassName, getRawClassNameFromButton } from '../utils/helpers.js';
import { getTeacherEmail, normalizeEmail } from '../config/api.js';

let classOptionsOverlay = null;

/**
 * Ensure class options overlay exists
 * @returns {HTMLElement} Overlay element
 */
function ensureClassOptionsOverlay() {
    if (classOptionsOverlay) return classOptionsOverlay;
    classOptionsOverlay = document.createElement('div');
    classOptionsOverlay.id = 'classOptionsOverlay';
    classOptionsOverlay.className = 'overlay';
    classOptionsOverlay.style.visibility = 'hidden';
    classOptionsOverlay.innerHTML = `
        <div class="ready-class-popup class-options-popup" role="dialog" aria-modal="true" aria-labelledby="classOptionsTitle">
            <div class="overlay-top-bar">
                <h2 id="classOptionsTitle" data-i18n="class_options_title">Class Options</h2>
                <button type="button" id="closeClassOptionsBtn" class="close-small" aria-label="Close">×</button>
            </div>
            <p id="classOptionsClassName" class="class-options-name"></p>
            <div class="class-options-row">
                <input type="text" id="classOptionsNameInput" data-i18n-placeholder="class_name_placeholder" placeholder="Class name" />
                <button type="button" id="classOptionsSaveBtn" class="role-button primary" data-i18n="rename_btn">Rename</button>
            </div>
            <p id="classOptionsError" class="class-options-error" aria-live="polite"></p>
            <div class="class-options-footer">
                <button type="button" id="classOptionsDeleteBtn" class="role-button danger" data-i18n="delete_class_btn">Delete Class</button>
            </div>
        </div>`;
    document.body.appendChild(classOptionsOverlay);
    
    // Wire events
    const closeBtn = classOptionsOverlay.querySelector('#closeClassOptionsBtn');
    closeBtn?.addEventListener('click', () => closeClassOptionsOverlay());
    classOptionsOverlay.addEventListener('click', (e) => {
        if (e.target === classOptionsOverlay) closeClassOptionsOverlay();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOverlayVisible(classOptionsOverlay)) {
            closeClassOptionsOverlay();
        }
    });
    
    const saveBtn = classOptionsOverlay.querySelector('#classOptionsSaveBtn');
    const deleteBtn = classOptionsOverlay.querySelector('#classOptionsDeleteBtn');
    saveBtn?.addEventListener('click', onSaveClassOptions);
    deleteBtn?.addEventListener('click', onDeleteClassFromOptions);
    const nameInput = classOptionsOverlay.querySelector('#classOptionsNameInput');
    nameInput?.addEventListener('input', () => setClassOptionsError(''));
    
    return classOptionsOverlay;
}

/**
 * Open class options overlay
 * @param {string} className - Class name
 */
export function openClassOptionsOverlay(className) {
    ensureClassOptionsOverlay();
    applyI18n();
    const input = classOptionsOverlay.querySelector('#classOptionsNameInput');
    const resolvedName = (className || getActiveClassName() || '').trim();
    if (input) input.value = resolvedName;
    setClassOptionsError('');
    
    const titleEl = classOptionsOverlay.querySelector('#classOptionsTitle');
    if (titleEl) titleEl.textContent = i18nText('class_options_title', 'Class Options');
    const nameEl = classOptionsOverlay.querySelector('#classOptionsClassName');
    if (nameEl) nameEl.textContent = resolvedName || 'Class';
    
    showOverlay(classOptionsOverlay);
}

/**
 * Close class options overlay
 */
export function closeClassOptionsOverlay() {
    if (classOptionsOverlay) {
        hideOverlay(classOptionsOverlay, false); // Don't restore overflow if ready popup is open
    }
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    if (!readyPopupOverlay || !isOverlayVisible(readyPopupOverlay)) {
        document.body.style.overflow = '';
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

        // Remove the ${className}:students key for both names
        const oldStudentsKey = `${from}:students`;
        const newStudentsKey = `${to}:students`;
        localStorage.removeItem(oldStudentsKey);
        localStorage.removeItem(newStudentsKey);
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
        btn.dataset.className = to;
        btn.dataset.originalLabel = to;
        btn.textContent = to;
        updateClassStatusUI(btn);
    }
    
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
        manageTitle.textContent = 'Students';
    }
    
    const scannerTitle = document.getElementById('scannerTitle');
    const scannerOverlay = getOverlay('scannerOverlay');
    if (scannerTitle && scannerOverlay && isOverlayVisible(scannerOverlay)) {
        scannerTitle.textContent = to;
    }
    
    const attendanceTitle = document.getElementById('attendanceTitle');
    const attendanceOverlay = getOverlay('attendanceOverlay');
    if (attendanceTitle && attendanceOverlay && isOverlayVisible(attendanceOverlay)) {
        attendanceTitle.textContent = `Attendance — ${to}`;
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
    }
    
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
    const btn = Array.from(document.querySelectorAll('.newClassBtn')).find(b => {
        const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '')
            .replace(/✓\s*Ready/g, '')
            .trim();
        return btnName === n;
    });
    if (btn) {
        const li = btn.closest('li');
        if (li) li.remove();
    }
    
    // If current class matches, reset and close overlays
    const current = getCurrentClass();
    if (current.name === n) {
        clearCurrentClass();
        closeAllClassOverlays();
    }
}

/**
 * Handle save class options (rename)
 */
async function onSaveClassOptions() {
    const input = classOptionsOverlay?.querySelector('#classOptionsNameInput');
    if (!input) return;
    
    const proposed = (input.value || '').trim();
    const oldName = getActiveClassName();
    
    if (!proposed) {
        setClassOptionsError('Name cannot be empty.');
        // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
        return;
    }
    if (proposed.length > 50) {
        setClassOptionsError('Name must be 50 characters or less.');
        return;
    }
    
    if (proposed === oldName) {
        closeClassOptionsOverlay();
        return;
    }

    const classId = getClassIdByName(oldName) || getClassIdByNameFromStorage(oldName);
    const teacherEmail = getTeacherEmail();
    try {
        if (classId && teacherEmail) {
            await renameClassById(classId, proposed, teacherEmail);
        }
    } catch (e) {
        setClassOptionsError(`Failed to update class name on server: ${e.message}`);
        return;
    }

    const ok = renameClass(oldName, proposed);
    if (ok) {
        showClassOptionsToast(i18nText('toast_class_renamed', 'Class was renamed'), 'success');
        closeClassOptionsOverlay();
    }
}

function setClassOptionsError(message) {
    const errorEl = classOptionsOverlay?.querySelector('#classOptionsError');
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.style.display = message ? 'block' : 'none';
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
    const existing = document.querySelector('.toast-bubble');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast-bubble toast-${tone} toast-wide`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 1600);
}

/**
 * Handle delete class from options
 */
function onDeleteClassFromOptions() {
    const name = getActiveClassName();
    openConfirmOverlay(
        i18nText('confirm_delete_class', 'Are you sure you want to delete this class?'),
        () => {
            deleteClass(name);
            closeClassOptionsOverlay();
        },
        () => { /* canceled */ }
    );
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
