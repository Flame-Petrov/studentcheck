/**
 * Student Management Feature Module
 * 
 * Handles student add/remove/info/history management.
 * Manages manage students overlay, student info overlay, attendance history, and add students overlay.
 */

import { removeStudentFromClass as apiRemoveStudentFromClass, addStudentsToClass } from '../api/classApi.js';
import { fetchAllStudents } from '../api/studentApi.js';
import { showSkeletonRows, showLoadError, endBusy, showStaleNote, hideStaleNote } from '../ui/skeleton.js';
import { ensureRoster, markRosterChanged } from '../data/rosterStore.js';
import { invalidateAttendanceSummary, readAttendanceSummary, isAttendanceSummaryFresh, loadAttendanceSummary, attendanceCountFor } from '../data/attendanceSummaryStore.js';
import { initManageStudentsDialog, openManageStudentsDialog, refreshManageStudentsDialog, onManageStudentsHidden } from './manageStudentsDialog.js';
import { initStudentDetailsDialog, openStudentDetails, onStudentDetailsHidden } from './studentDetailsDialog.js';
import { fetchClassStudents } from '../api/classApi.js';
import { getStudentAttendanceCountForClass } from './attendance.js';
import { fetchStudentAttendanceHistory, fetchClassAttendanceTimestamps, fetchClassAttendance } from '../api/attendanceApi.js';
import {
    getCurrentClass,
    setCurrentClass,
    getClassStudentAssignments,
    ensureClassStudentAssignments,
    removeStudentFromClassAssignments,
    setClassReady,
    getClassIdByName,
    setClassId,
    getAllStudents,
    setAllStudents
} from '../state/appState.js';
import { loadClassStudentsFromStorage, addNewStudentsToStorage, getStudentInfoForFacultyNumber, resolveStudentFacultyNumber } from '../storage/studentStorage.js';
import { getClassIdByNameFromStorage, getStoredClassesMap } from '../storage/classStorage.js';
import { fetchClasses } from '../api/classApi.js';
import { showOverlay, hideOverlay, getOverlay, openConfirmOverlay } from '../ui/overlays.js';
import { toast as uiToast } from '../ui/toast.js';
import { updateClassStatusUI } from '../ui/classUI.js';
import { renderAttendanceForClass } from '../ui/attendanceUI.js';
import { getTeacherEmail, SERVER_BASE_URL, ENDPOINTS } from '../config/api.js';
import { authHeaders } from '../api/authFetch.js';

// Module state
let studentIndex = new Map(); // id -> full student object
let addStudentsOverlayInitialized = false;
let addStudentsReturnToManage = false;

function getStudentFullName(student) {
    return student?.fullName || student?.full_name || student?.name || '';
}

function getStudentFacultyNumber(student) {
    return String(resolveStudentFacultyNumber(student) || '').trim();
}

function decodeBase64Utf8(input) {
    try {
        const normalized = String(input || '').trim().replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const raw = atob(padded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (_) {
        return '';
    }
}

function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function decryptStudentEmail(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';
    if (looksLikeEmail(raw)) return raw;

    // Optional app-level hook for encrypted values (if provided elsewhere).
    // Expected signature: window.decryptStudentEmail(cipherText) => plainEmail
    try {
        if (typeof window.decryptStudentEmail === 'function') {
            const decrypted = String(window.decryptStudentEmail(raw) || '').trim();
            if (looksLikeEmail(decrypted)) return decrypted;
        }
    } catch (_) {}

    // Optional object hook: window.EmailCrypto.decryptEmail(cipherText)
    try {
        if (window.EmailCrypto && typeof window.EmailCrypto.decryptEmail === 'function') {
            const decrypted = String(window.EmailCrypto.decryptEmail(raw) || '').trim();
            if (looksLikeEmail(decrypted)) return decrypted;
        }
    } catch (_) {}

    // Common transport format: "enc:<base64>"
    if (raw.toLowerCase().startsWith('enc:')) {
        const decoded = decodeBase64Utf8(raw.slice(4));
        if (looksLikeEmail(decoded)) return decoded;
    }

    // Fallback: treat value as base64-encoded UTF-8 text.
    const decoded = decodeBase64Utf8(raw);
    if (looksLikeEmail(decoded)) return decoded;

    // Do not leak ciphertext-ish values to UI.
    return '';
}

function getStudentEmail(student) {
    const candidates = [
        student?.email,
        student?.email_address,
        student?.emailAddress,
        student?.student_email,
        student?.decrypted_email,
        student?.plain_email,
        student?.original_email,
        student?.encrypted_email,
        student?.email_encrypted
    ];

    // Prefer any candidate that is already a valid plain email.
    for (const candidate of candidates) {
        const raw = String(candidate || '').trim();
        if (looksLikeEmail(raw)) return raw;
    }

    // Then try decrypt/decoding each candidate and keep first valid email.
    for (const candidate of candidates) {
        const decoded = decryptStudentEmail(candidate);
        if (looksLikeEmail(decoded)) return decoded;
    }

    // Final fallback: keep UI clean and only show valid emails.
    return '';
}

function summarizeEmailCandidate(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return { present: false, status: 'missing' };

    if (looksLikeEmail(raw)) {
        return {
            present: true,
            status: 'plain_valid',
            preview: raw.slice(0, 48),
            length: raw.length
        };
    }

    const decoded = decryptStudentEmail(raw);
    if (looksLikeEmail(decoded)) {
        return {
            present: true,
            status: 'decoded_valid',
            preview: raw.slice(0, 48),
            length: raw.length
        };
    }

    return {
        present: true,
        status: 'invalid_or_undecodable',
        preview: raw.slice(0, 48),
        length: raw.length
    };
}

function summarizeEmailSource(source) {
    if (!source || typeof source !== 'object') {
        return { exists: false };
    }

    const fields = [
        'email',
        'email_address',
        'emailAddress',
        'student_email',
        'decrypted_email',
        'plain_email',
        'original_email',
        'encrypted_email',
        'email_encrypted'
    ];

    const candidates = fields
        .map((field) => ({ field, ...summarizeEmailCandidate(source[field]) }))
        .filter((entry) => entry.present);

    return {
        exists: true,
        id: String(source.id || source.student_id || '').trim() || null,
        faculty_number: String(getStudentFacultyNumber(source) || '').trim() || null,
        resolved_email: getStudentEmail(source) || null,
        candidates
    };
}

function logMissingEmailDiagnostics({ studentId, className, studentObj, storageInfo, allInfo, mergedInfo }) {
    console.warn('[student-info] Missing resolvable email for student', {
        studentId: String(studentId || '').trim(),
        className: String(className || '').trim(),
        sources: {
            overlayStudent: summarizeEmailSource(studentObj),
            classStorage: summarizeEmailSource(storageInfo),
            allStudentsCache: summarizeEmailSource(allInfo),
            merged: summarizeEmailSource(mergedInfo)
        }
    });
}

function getStudentGroup(student) {
    return student?.group || student?.group_name || student?.groupName || student?.group_number || student?.groupNumber || '';
}

function getStudentLevel(student) {
    return student?.level || student?.education_level || student?.educationLevel || '';
}

function getStudentFacultyName(student) {
    return student?.faculty || student?.faculty_name || student?.facultyName || '';
}

function getStudentSpecialization(student) {
    return student?.specialization || student?.specialization_name || student?.specializationName || '';
}

function i18nText(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

function normalizeStudentKey(value) {
    if (value === null || value === undefined) return '';
    const normalized = String(value).trim();
    return normalized;
}

function getStudentPrimaryKey(student) {
    return normalizeStudentKey(
        student?.id
        || student?.student_id
        || getStudentFacultyNumber(student)
    );
}

function findStudentByKey(key, students) {
    const normalized = normalizeStudentKey(key);
    if (!normalized) return null;
    return (students || []).find((student) => {
        const idKey = normalizeStudentKey(student?.id || student?.student_id);
        const facultyKey = normalizeStudentKey(getStudentFacultyNumber(student));
        return normalized === idKey || normalized === facultyKey;
    }) || null;
}

function fillMissing(target, source) {
    if (!source) return;
    if (!getStudentFullName(target)) {
        const name = getStudentFullName(source);
        if (name) target.fullName = name;
    }
    if (!getStudentFacultyNumber(target)) {
        const fac = getStudentFacultyNumber(source);
        if (fac) target.faculty_number = fac;
    }
    if (!getStudentEmail(target)) {
        const email = getStudentEmail(source);
        if (email) target.email = email;
    }
    if (!getStudentGroup(target)) {
        const group = getStudentGroup(source);
        if (group) target.group = group;
    }
}

function applyI18n() {
    try {
        if (window.i18n && typeof window.i18n.applyTranslations === 'function') {
            window.i18n.applyTranslations();
        }
    } catch (_) {}
}

function parseTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const bgMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4}) г\., (\d{2}):(\d{2}):(\d{2})$/);
        if (bgMatch) {
            const [, day, month, year, hours, minutes, seconds] = bgMatch;
            const d = new Date(year, month - 1, day, hours, minutes, seconds);
            const parsed = d.getTime();
            return Number.isNaN(parsed) ? null : parsed;
        }
        if (/^\d+$/.test(trimmed)) {
            const numeric = Number(trimmed);
            return Number.isFinite(numeric) ? numeric : null;
        }
    }
    // iOS Safari rejects date strings with a space separator (e.g. "2024-01-15 10:30:00").
    // Normalize to ISO 8601 by replacing the space with 'T' before parsing.
    const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function logAttendanceHistoryDebug(stage, payload = {}) {
}

function showToast(message, tone = 'success') {
    uiToast(message, { tone, size: 'wide', duration: 1400, fadeMs: 300, replace: false });
}
let addStudentsSelections = new Set();
let addStudentsRequestId = 0;
let addStudentsIndex = new Map();

// DOM helpers
function getManageStudentsOverlay() { return getOverlay('manageStudentsOverlay'); }
function getManageStudentsListEl() { return document.getElementById('manageStudentsList'); }
function getAddStudentsClassOverlay() { return getOverlay('addStudentsClassOverlay'); }
function getAddStudentsListEl() {
    const overlay = getAddStudentsClassOverlay();
    const scoped = overlay?.querySelector('#classAddStudentsList');
    return scoped || document.getElementById('classAddStudentsList');
}

/**
 * "Управление на студенти" dialog: rendering, loading and states live in
 * ./manageStudentsDialog.js; this module supplies how a roster entry looks
 * and where the dialog's actions lead.
 */

function normalizeManageStudent(student) {
    const id = String(student?.id ?? student?.student_id ?? '').trim();
    const facultyNumber = getStudentFacultyNumber(student);
    const name = getStudentFullName(student) || '';
    const email = getStudentEmail(student) || '';
    return {
        key: id || facultyNumber,
        // student details / removal are keyed by faculty number (as before)
        openKey: facultyNumber || id,
        id,
        facultyNumber,
        name,
        email,
        group: String(getStudentGroup(student) || ''),
        level: String(getStudentLevel(student) || '').toLowerCase(),
        faculty: getStudentFacultyName(student) || '',
        specialization: getStudentSpecialization(student) || '',
        searchText: [name, email, facultyNumber].join(' ').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
    };
}

function indexManageRows(rows) {
    rows.forEach((row) => {
        if (!row.openKey) return;
        studentIndex.set(String(row.openKey), {
            id: row.id,
            fullName: row.name,
            faculty_number: row.facultyNumber,
            email: row.email,
            group: row.group,
            level: row.level,
            facultyName: row.faculty,
            specialization: row.specialization
        });
    });
}

/** Older rosters may lack a name or e-mail: fill them in from the student list, in the background. */
function enrichManageRows(rows, done) {
    if (!rows.some((r) => !r.name || !r.email)) return;
    fetchAllStudents()
        .then((all) => {
            const lookup = new Map();
            (all || []).forEach((st) => {
                const id = String(st.id || st.student_id || '').trim();
                const fn = getStudentFacultyNumber(st);
                if (id) lookup.set(`id:${id}`, st);
                if (fn) lookup.set(`fn:${fn}`, st);
            });
            let changed = false;
            rows.forEach((row) => {
                const match = lookup.get(`id:${row.id}`) || lookup.get(`fn:${row.facultyNumber}`);
                if (!match) return;
                if (!row.name && getStudentFullName(match)) { row.name = getStudentFullName(match); changed = true; }
                if (!row.email && getStudentEmail(match)) { row.email = getStudentEmail(match); changed = true; }
                if (!row.group && getStudentGroup(match)) row.group = String(getStudentGroup(match));
                if (!row.level && getStudentLevel(match)) row.level = String(getStudentLevel(match)).toLowerCase();
                if (!row.faculty && getStudentFacultyName(match)) row.faculty = getStudentFacultyName(match);
                if (!row.specialization && getStudentSpecialization(match)) row.specialization = getStudentSpecialization(match);
                row.searchText = [row.name, row.email, row.facultyNumber].join(' ').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
            });
            if (changed) done();
        })
        .catch(() => {});
}

function ensureManageStudentsDialog() {
    initManageStudentsDialog({
        normalizeStudent: normalizeManageStudent,
        onRows: indexManageRows,
        enrich: enrichManageRows,
        openStudent: (openKey, className, row, opener) => openStudentInfoOverlay(openKey, className, { row, opener }),
        openAddStudents: (className) => openAddStudentsToClass(className, { returnToManage: true }),
        back: (className) => returnToReadyClassPopup(className || getCurrentClass().name),
        close: () => closeAllClassOverlays()
    });
}

/**
 * Reload the open dialog after a change (e.g. a student removed). Rows stay
 * visible while it refreshes.
 * @param {string} className - Class name
 */
export async function renderManageStudentsForClass(className) {
    ensureManageStudentsDialog();
    const classId = await resolveClassId(className);
    return refreshManageStudentsDialog({ classId, className });
}

/**
 * Open the "Управление на студенти" dialog
 * @param {string} className - Class name
 * @param {object} [options]
 * @param {boolean} [options.restore] - coming back from Add students: keep search, filters and scroll
 */
export async function openManageStudentsOverlay(className, { restore = false } = {}) {
    ensureManageStudentsDialog();
    applyI18n();

    const current = getCurrentClass();
    setCurrentClass(className, current.id, current.button);

    // Hide the discipline menu to avoid stacking
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    if (readyPopupOverlay) hideOverlay(readyPopupOverlay);

    // Known id: open at once. Otherwise resolve it first (rare: stale state).
    let classId = Number(current.id) > 0 ? Number(current.id) : null;
    if (!classId) classId = await resolveClassId(className);

    openManageStudentsDialog({
        className,
        classId,
        restore,
        // Focus returns to the discipline card when the dialog is closed
        opener: current.button || null
    });
}

/**
 * Close manage students overlay
 */
function closeManageStudentsOverlay() {
    const overlay = getManageStudentsOverlay();
    if (overlay) {
        onManageStudentsHidden();
        hideOverlay(overlay);
    }
}

/**
 * Return to ready class popup from manage students
 * @param {string} className - Class name
 */
function returnToReadyClassPopup(className) {
    closeManageStudentsOverlay();
    // This will be handled by the main file's ready popup handler
    const event = new CustomEvent('openReadyClassPopup', { detail: { className } });
    document.dispatchEvent(event);
}

/**
 * Ensure student info overlay exists
 * @returns {HTMLElement} Overlay element
 */
/*
 * "Данни за студента" (details + attendance history in one dialog):
 * rendering, loading and states live in ./studentDetailsDialog.js; this module
 * supplies the roster identity, the removal and the way back to the roster.
 */

function ensureStudentDetailsDialog() {
    initStudentDetailsDialog({
        normalizeStudent: normalizeManageStudent,
        removeStudent: removeStudentEnrollment,
        returnToParent: returnToManageFromDetails,
        toast: (message, tone) => showToast(message, tone)
    });
}

/**
 * Open the details of a student of the current class.
 * @param {string} studentKey - faculty number (or id) of the roster entry
 * @param {string} className - Class name
 * @param {object} [options]
 * @param {object} [options.row] - the roster row (identity shown at once)
 * @param {HTMLElement} [options.opener] - focus returns here on close
 */
export function openStudentInfoOverlay(studentKey, className, { row = null, opener = null } = {}) {
    ensureStudentDetailsDialog();
    const key = String(studentKey || '').trim();
    const indexed = studentIndex.get(key);
    const student = row
        ? { ...row }
        : {
            id: indexed?.id || '',
            openKey: key,
            facultyNumber: indexed?.faculty_number || (/^\d+$/.test(key) && key.length < 9 ? '' : key),
            name: indexed?.fullName || '',
            email: indexed?.email || '',
            group: indexed?.group || ''
        };
    const current = getCurrentClass();
    const classId = Number(current.id) > 0 ? Number(current.id) : getClassIdByName(className);

    // The roster stays mounted (search, filters, scroll kept); only hidden
    const manageOverlay = getManageStudentsOverlay();
    if (manageOverlay) hideOverlay(manageOverlay, false);

    openStudentDetails({ student, classId, className: className || current.name, opener });
}

/** Back from the details dialog to the roster (after Close or a removal). */
function returnToManageFromDetails({ opener, removedKey, className } = {}) {
    const manageOverlay = getManageStudentsOverlay();
    if (!manageOverlay) {
        document.body.style.overflow = '';
        return;
    }
    showOverlay(manageOverlay, false);
    document.body.style.overflow = 'hidden';
    if (removedKey) {
        // The removed row goes away in place; focus stays inside the roster dialog
        renderManageStudentsForClass(className || getCurrentClass().name);
        manageOverlay.querySelector('.msd-dialog')?.focus({ preventScroll: true });
        return;
    }
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    else manageOverlay.querySelector('.msd-dialog')?.focus({ preventScroll: true });
}

/**
 * Remove a student's enrollment in a class (their account and attendance
 * records stay, as before). Throws when the server refuses.
 * @param {{ classId, className, studentId, facultyNumber }} target
 */
async function removeStudentEnrollment({ classId, className, studentId, facultyNumber }) {
    if (!classId || !facultyNumber) throw new Error('Student or class is not known');
    try {
        await apiRemoveStudentFromClass(classId, facultyNumber, getTeacherEmail());
    } catch (error) {
        // Already not enrolled (e.g. removed in another tab): same end state
        const message = String(error?.body?.error || error?.message || '');
        if (!(error?.status === 404 && /not found in this class/i.test(message))) throw error;
    }
    markRosterChanged(classId);
    invalidateAttendanceSummary(classId);

    // Local roster copy and assignments: match by id, then faculty number
    const idKey = normalizeStudentKey(studentId);
    const fnKey = normalizeStudentKey(facultyNumber);
    const classStudents = loadClassStudentsFromStorage(className);
    if (Array.isArray(classStudents)) {
        addNewStudentsToStorage(className, classStudents.filter((s) => {
            const sid = normalizeStudentKey(s?.id || s?.student_id);
            const sfn = normalizeStudentKey(getStudentFacultyNumber(s));
            return !((idKey && sid === idKey) || (fnKey && sfn === fnKey));
        }));
    }
    removeStudentFromClassAssignments(className, fnKey);
    if (idKey) {
        removeStudentFromClassAssignments(className, idKey);
        if (/^\d+$/.test(idKey)) removeStudentFromClassAssignments(className, Number(idKey));
    }
}

/**
 * Filter add students list by query
 * @param {string} query - Search query
 */
function filterAddStudentsList(query) {
    requestAddStudentsWithFilters({
        search: query || ''
    });
}

/**
 * Filter by dropdown selects (stub - only uses search)
 */
function filterAddStudentsListBySelects(levelValue, facultyValue, specializationValue, groupValue, searchInputValue) {
    requestAddStudentsWithFilters({
        level: levelValue,
        faculty: facultyValue,
        specialization: specializationValue,
        group: groupValue,
        search: searchInputValue
    });
}

/**
 * Reset add students filters
 */
function resetAddStudentsFilters() {
    resetAddStudentsFiltersState();
    requestAddStudentsWithFilters();
}

function resetAddStudentsFiltersState() {
    const levelSelect = document.getElementById('addStudentsFilterLevel');
    const facultySelect = document.getElementById('addStudentsFilterFaculty');
    const specializationSelect = document.getElementById('addStudentsFilterSpecialization');
    const groupSelect = document.getElementById('addStudentsFilterGroup');
    const searchInput = document.getElementById('addStudentsSearchInput');

    if (levelSelect) levelSelect.value = '';
    if (facultySelect) facultySelect.value = '';
    if (specializationSelect) specializationSelect.value = '';
    if (groupSelect) groupSelect.value = '';
    if (searchInput) searchInput.value = '';
}

/**
 * Update add students counter
 */
function updateAddStudentsCounter() {
    // Counts every selection, including students hidden by the current search/filters
    const countEl = document.getElementById('addStudentsCount');
    if (countEl) {
        countEl.textContent = i18nText('tp_selected_count', 'Избрани: {n}').replace('{n}', String(addStudentsSelections.size));
    }
}

/**
 * Ensure add students overlay is initialized (idempotent)
 */
function ensureAddStudentsOverlayInitialized() {
    if (addStudentsOverlayInitialized) return;
    addStudentsOverlayInitialized = true;

    const overlay = getAddStudentsClassOverlay();
    if (!overlay) return;

    const closeBtn = overlay.querySelector('#closeAddStudentsClassBtn');
    const searchInput = overlay.querySelector('#addStudentsSearchInput');
    const confirmBtn = overlay.querySelector('#classAddStudentsOverlayBtn');
    const resetBtn = overlay.querySelector('#addStudentsResetFiltersBtn');
    const levelSelect = overlay.querySelector('#addStudentsFilterLevel');
    const facultySelect = overlay.querySelector('#addStudentsFilterFaculty');
    const specializationSelect = overlay.querySelector('#addStudentsFilterSpecialization');
    const groupSelect = overlay.querySelector('#addStudentsFilterGroup');

    closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeAddStudentsToClass();
    });

    // Counter text is rendered by script: follow language changes
    document.addEventListener('app:languagechange', updateAddStudentsCounter);

    // Back: same destination as before (manage students when opened from there)
    overlay.querySelector('#addStudentsBackBtn')?.addEventListener('click', () => closeAddStudentsToClass());

    const filterToggle = overlay.querySelector('#addStudentsFilterToggle');
    const filterPanel = overlay.querySelector('#addStudentsFilters');
    filterToggle?.addEventListener('click', () => {
        const open = filterPanel.hidden;
        filterPanel.hidden = !open;
        filterToggle.setAttribute('aria-expanded', String(open));
    });

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const current = getCurrentClass();
            finalizeAddStudentsToClass(current.name);
        });
    }

    if (searchInput) {
        if (window.Utils && typeof window.Utils.debounce === 'function') {
            const debounced = window.Utils.debounce((value) => filterAddStudentsList(value), 250);
            searchInput.addEventListener('input', (e) => debounced(e.target.value));
        } else {
            let debounceTimer = null;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => filterAddStudentsList(e.target.value), 250);
            });
        }
    }

    levelSelect?.addEventListener('change', () => {
        filterAddStudentsListBySelects(
            levelSelect.value,
            facultySelect?.value || '',
            specializationSelect?.value || '',
            groupSelect?.value || '',
            searchInput?.value || ''
        );
    });

    facultySelect?.addEventListener('change', () => {
        filterAddStudentsListBySelects(
            levelSelect?.value || '',
            facultySelect.value,
            specializationSelect?.value || '',
            groupSelect?.value || '',
            searchInput?.value || ''
        );
    });

    specializationSelect?.addEventListener('change', () => {
        filterAddStudentsListBySelects(
            levelSelect?.value || '',
            facultySelect?.value || '',
            specializationSelect.value,
            groupSelect?.value || '',
            searchInput?.value || ''
        );
    });

    groupSelect?.addEventListener('change', () => {
        filterAddStudentsListBySelects(
            levelSelect?.value || '',
            facultySelect?.value || '',
            specializationSelect?.value || '',
            groupSelect.value,
            searchInput?.value || ''
        );
    });

    resetBtn?.addEventListener('click', resetAddStudentsFilters);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAddStudentsToClass();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOverlayVisible(overlay)) {
            closeAddStudentsToClass();
        }
    });
}

function collectAddStudentsFilters(overrides = {}) {
    const levelSelect = document.getElementById('addStudentsFilterLevel');
    const facultySelect = document.getElementById('addStudentsFilterFaculty');
    const specializationSelect = document.getElementById('addStudentsFilterSpecialization');
    const groupSelect = document.getElementById('addStudentsFilterGroup');
    const searchInput = document.getElementById('addStudentsSearchInput');

    return {
        level: overrides.level ?? (levelSelect?.value || ''),
        faculty: overrides.faculty ?? (facultySelect?.value || ''),
        specialization: overrides.specialization ?? (specializationSelect?.value || ''),
        group: overrides.group ?? (groupSelect?.value || ''),
        search: overrides.search ?? (searchInput?.value || '')
    };
}

function addStudentsFiltersActive(filters = collectAddStudentsFilters()) {
    return Boolean(filters.level || filters.faculty || filters.specialization || filters.group || String(filters.search || '').trim());
}

function updateAddStudentsFilterToggle() {
    const f = collectAddStudentsFilters();
    const toggle = document.getElementById('addStudentsFilterToggle');
    toggle?.classList.toggle('has-filters', Boolean(f.level || f.faculty || f.specialization || f.group));
}

/**
 * Search / filter request. Rows already on screen stay visible (muted) while
 * it runs; only the newest response is rendered (shared request counter).
 */
async function requestAddStudentsWithFilters(overrides = {}) {
    const current = getCurrentClass();
    const className = current?.name || '';
    if (!className) return;

    const listEl = getAddStudentsListEl();
    if (!listEl) return;
    updateAddStudentsFilterToggle();
    hideStaleNote(document.getElementById('addStudentsStale'));

    const requestId = ++addStudentsRequestId;
    const filters = collectAddStudentsFilters(overrides);

    if (!addStudentsFiltersActive(filters)) {
        // Back to the full list: cached students render at once
        const cached = cachedAllStudents();
        if (cached) {
            renderAddStudentsRows(listEl, cached, addStudentsExistingKeys(className), { filtered: false });
            return;
        }
        await loadAddStudents(className);
        return;
    }

    if (addStudentsShownList) {
        listEl.classList.add('is-refreshing');
        listEl.setAttribute('aria-busy', 'true');
    } else {
        showAddStudentsSkeleton(listEl);
    }

    const params = new URLSearchParams();
    if (filters.level) params.append('level', filters.level);
    if (filters.faculty) params.append('faculty', filters.faculty);
    if (filters.specialization) params.append('specialization', filters.specialization);
    if (filters.group) params.append('group', filters.group);
    if (filters.search) params.append('search', filters.search);

    try {
        const url = `${SERVER_BASE_URL + ENDPOINTS.students}?${params.toString()}`;
        const result = await fetch(url, { method: 'GET', headers: authHeaders({ 'Accept': 'application/json' }) });
        if (!result.ok) {
            throw new Error(`HTTP ${result.status}`);
        }
        const data = await result.json();
        const students = Array.isArray(data?.students) ? data.students : (Array.isArray(data) ? data : []);

        if (requestId !== addStudentsRequestId) return; // a newer search/filter won
        renderAddStudentsRows(listEl, students, addStudentsExistingKeys(className), { filtered: true });
    } catch (e) {
        if (requestId !== addStudentsRequestId) return;
        console.error('[Add Students] Filter request failed:', e);
        listEl.classList.remove('is-refreshing');
        endBusy(listEl);
        const retry = () => requestAddStudentsWithFilters();
        if (addStudentsShownList) {
            showStaleNote(document.getElementById('addStudentsStale'), retry);
        } else {
            showLoadError(listEl, i18nText('tp_students_error', 'Неуспешно зареждане на студентите.'), retry);
        }
    }
}

/**
 * Open add students to class overlay
 * @param {string} className - Class name
 */
export async function openAddStudentsToClass(className, options = {}) {
    closeManageStudentsOverlay();

    if (!className) return;

    ensureAddStudentsOverlayInitialized();
    addStudentsReturnToManage = Boolean(options.returnToManage);

    const overlay = getAddStudentsClassOverlay();

    addStudentsSelections.clear();
    addStudentsIndex = new Map();
    addStudentsShownList = false;
    resetAddStudentsFiltersState();
    const filterPanel = overlay?.querySelector('#addStudentsFilters');
    if (filterPanel) filterPanel.hidden = true;
    overlay?.querySelector('#addStudentsFilterToggle')?.setAttribute('aria-expanded', 'false');
    updateAddStudentsFilterToggle();
    setAddStudentsError('');
    setAddStudentsSubmitting(false);
    hideStaleNote(document.getElementById('addStudentsStale'));
    updateAddStudentsCounter();

    // The dialog shell (title, search, footer) shows at once; the list fills in
    if (overlay) {
        showOverlay(overlay, false);
        // Focus the dialog itself (no keyboard popping up on phones)
        overlay.querySelector('.asd-dialog')?.focus({ preventScroll: true });
    }

    await loadAddStudents(className);
}

/**
 * Close add students to class overlay
 */
function closeAddStudentsToClass() {
    const overlay = getAddStudentsClassOverlay();
    // Responses still in flight are for a dialog that is gone: ignore them
    addStudentsRequestId += 1;
    resetAddStudentsFiltersState();
    if (overlay) hideOverlay(overlay, false);
    if (addStudentsReturnToManage) {
        addStudentsReturnToManage = false;
        const current = getCurrentClass();
        if (current?.name) {
            openManageStudentsOverlay(current.name, { restore: true });
            return;
        }
    }
    const manageOverlay = getManageStudentsOverlay();
    if (!manageOverlay || !isOverlayVisible(manageOverlay)) {
        document.body.style.overflow = '';
    }
}

/**
 * Resolve class ID with fallback logic
 * @param {string} className - Class name
 * @returns {Promise<number|null>} Class ID or null if not found
 */
async function resolveClassId(className) {
    // Prefer currently selected class context (authoritative for this UI flow)
    const current = getCurrentClass();
    if ((current?.name || '').trim() === String(className || '').trim() && current?.id) {
        const currentIdNum = Number(current.id);
        if (Number.isFinite(currentIdNum) && currentIdNum > 0) return currentIdNum;
    }

    // Try appState first
    let classId = getClassIdByName(className);
    if (classId) {
        const classIdNum = Number(classId);
        if (Number.isFinite(classIdNum) && classIdNum > 0) return classIdNum;
    }

    // Server list is the source of truth for ownership; prefer it over storage fallback.
    try {
        const teacherEmail = getTeacherEmail();
        if (!teacherEmail) {
            console.error('[resolveClassId] No teacher email available');
        } else {
            const data = await fetchClasses(teacherEmail);
            const classes = data.classes || [];
            
            for (const _class of classes) {
                setClassId(_class.name, _class.id);
                if (_class.name === className) {
                    return Number(_class.id);
                }
            }
        }
    } catch (e) {
        console.error('[resolveClassId] Failed to fetch classes:', e);
    }

    // Last resort: localStorage fallback (can be stale)
    classId = getClassIdByNameFromStorage(className);
    if (classId) {
        const classIdNum = Number(classId);
        if (Number.isFinite(classIdNum) && classIdNum > 0) {
            setClassId(className, classIdNum);
            return classIdNum;
        }
    }

    return null;
}

/**
 * Render add students list
 * @param {string} className - Class name
 */
async function renderAddStudentsList(className) {
    // Kept for existing callers (Retry): reload the list for this class
    return loadAddStudents(className);
}

// A list (or an empty/no-results message) for the current opening is on screen
let addStudentsShownList = false;
let addStudentsSubmitting = false;

/** All students from memory or the per-device cache (null when none). */
function cachedAllStudents() {
    const memory = getAllStudents();
    if (Array.isArray(memory) && memory.length > 0) return memory;
    try {
        const stored = JSON.parse(localStorage.getItem('allStudents') || 'null');
        if (Array.isArray(stored) && stored.length > 0) {
            setAllStudents(stored);
            return stored;
        }
    } catch (_) {}
    return null;
}

/** Faculty numbers already in the class (assignments + stored roster). */
function addStudentsExistingKeys(className) {
    const assignments = getClassStudentAssignments(className);
    const keys = new Set(Array.from(assignments || new Set()).map(normalizeStudentKey).filter(Boolean));
    (loadClassStudentsFromStorage(className) || []).forEach((student) => {
        const key = normalizeStudentKey(getStudentFacultyNumber(student));
        if (key) keys.add(key);
    });
    return keys;
}

function showAddStudentsSkeleton(listEl) {
    listEl.classList.remove('is-refreshing');
    listEl.setAttribute('aria-busy', 'true');
    const widths = [['46%', '24%'], ['58%', '22%'], ['38%', '26%'], ['52%', '24%'], ['42%', '22%'], ['55%', '25%']];
    listEl.innerHTML = `<p class="sk-status-text" role="status">${i18nText('tp_students_loading', 'Зареждане на студентите…')}</p>`
        + widths.map(([w, f]) => `<div class="asd-skel-row" aria-hidden="true"><span class="sk asd-skel-box"></span><span class="asd-skel-text"><span class="sk sk-line" style="--sk-w:${w}"></span><span class="sk sk-line sk-line--sub" style="--sk-w:${f}"></span></span></div>`).join('');
    addStudentsShownList = false;
}

function addStudentsTextBlock(student) {
    const parts = (window.Students?.splitNames || (() => ({ fullName: '' })))(student);
    const wrap = document.createElement('div');
    wrap.className = 'student-card-text';
    const nameEl = document.createElement('span');
    nameEl.className = 'student-name';
    nameEl.textContent = parts.fullName || getStudentFullName(student) || '';
    const facEl = document.createElement('span');
    facEl.className = 'student-fac';
    facEl.textContent = getStudentFacultyNumber(student) || '';
    wrap.append(nameEl, facEl);
    return wrap;
}

/**
 * Render the students. Selections (by student key) survive every re-render;
 * scroll position and keyboard focus are kept.
 */
function renderAddStudentsRows(listEl, students, existingSet, { filtered = false } = {}) {
    const focusedKey = listEl.contains(document.activeElement) ? document.activeElement?.dataset?.studentKey : null;
    const scrollTop = listEl.scrollTop;
    listEl.classList.remove('is-refreshing');
    endBusy(listEl);

    if (!Array.isArray(students) || students.length === 0) {
        const message = filtered
            ? i18nText('tp_no_student_results', 'Няма студенти, отговарящи на търсенето.')
            : i18nText('tp_no_students_yet', 'Все още няма регистрирани студенти.');
        listEl.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'asd-state';
        p.textContent = message;
        listEl.appendChild(p);
        addStudentsShownList = true;
        updateAddStudentsCounter();
        return;
    }

    const ul = document.createElement('ul');
    students.forEach((student, idx) => {
        const li = document.createElement('li');
        li.className = 'list-item';
        const facultyKey = normalizeStudentKey(getStudentFacultyNumber(student));
        const studentKey = getStudentPrimaryKey(student);

        if (!studentKey || (facultyKey && existingSet.has(facultyKey))) {
            // Already in the class (or not selectable): no checkbox, "Added" badge
            li.classList.add('already-in');
            const badge = document.createElement('span');
            badge.className = 'already-in-badge';
            badge.textContent = i18nText('already_in_badge', 'Already in');
            li.append(addStudentsTextBlock(student), badge);
            ul.appendChild(li);
            return;
        }

        if (!addStudentsIndex.has(studentKey)) addStudentsIndex.set(studentKey, student);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `addStudent_${idx}`;
        checkbox.dataset.studentKey = studentKey;
        if (facultyKey) checkbox.dataset.facultyNumber = facultyKey;
        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.appendChild(addStudentsTextBlock(student));

        if (addStudentsSelections.has(studentKey)) {
            checkbox.checked = true;
            li.classList.add('selected');
        }

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                addStudentsSelections.add(studentKey);
                li.classList.add('selected');
            } else {
                addStudentsSelections.delete(studentKey);
                li.classList.remove('selected');
            }
            updateAddStudentsCounter();
        });

        li.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target.tagName === 'LABEL' || (e.target && e.target.closest('label'))) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        li.append(checkbox, label);
        ul.appendChild(li);
    });

    listEl.replaceChildren(ul);
    listEl.scrollTop = scrollTop;
    if (focusedKey) {
        listEl.querySelector(`input[data-student-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
    }
    addStudentsShownList = true;
    updateAddStudentsCounter();
}

/**
 * Open / refresh: cached students render immediately; the roster and the
 * latest student list load in the background. Skeleton only without a cache.
 */
async function loadAddStudents(className) {
    const listEl = getAddStudentsListEl();
    if (!listEl) return;
    const staleEl = document.getElementById('addStudentsStale');
    hideStaleNote(staleEl);
    const requestId = ++addStudentsRequestId;

    const cached = cachedAllStudents();
    if (cached && !addStudentsFiltersActive()) {
        renderAddStudentsRows(listEl, cached, addStudentsExistingKeys(className), { filtered: false });
    } else if (!addStudentsShownList) {
        showAddStudentsSkeleton(listEl);
    }

    try {
        const classId = await resolveClassId(className);
        const [students] = await Promise.all([
            fetchAllStudents({ forceRefresh: true }),
            classId ? ensureRoster(classId, className).catch(() => null) : null
        ]);
        if (requestId !== addStudentsRequestId) return; // closed, reopened or filtered meanwhile
        if (addStudentsFiltersActive()) return;
        renderAddStudentsRows(listEl, Array.isArray(students) ? students : [], addStudentsExistingKeys(className), { filtered: false });
    } catch (e) {
        if (requestId !== addStudentsRequestId) return;
        console.error('[Add Students] Failed to load students:', e);
        const retry = () => loadAddStudents(className);
        if (addStudentsShownList) {
            showStaleNote(staleEl, retry);
        } else {
            showLoadError(listEl, i18nText('tp_students_error', 'Неуспешно зареждане на студентите.'), () => {
                showAddStudentsSkeleton(listEl);
                retry();
            });
        }
    }
}

function setAddStudentsError(message) {
    const el = document.getElementById('addStudentsError');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
}

function setAddStudentsSubmitting(pending) {
    addStudentsSubmitting = pending;
    const btn = document.getElementById('classAddStudentsOverlayBtn');
    if (!btn) return;
    btn.disabled = pending;
    btn.setAttribute('aria-busy', String(pending));
    if (pending) {
        btn.dataset.pending = 'true';
        btn.textContent = i18nText('tp_adding', 'Добавяне…');
    } else {
        delete btn.dataset.pending;
        btn.textContent = i18nText('add', 'Добави');
    }
}

/**
 * Finalize adding students to class
 * @param {string} className - Class name
 */
export async function finalizeAddStudentsToClass(className) {
    if (addStudentsSubmitting) return; // no duplicate submissions
    if (!className || addStudentsSelections.size === 0) {
        closeAddStudentsToClass();
        return;
    }
    // Dialog and selections stay visible; only the button shows progress
    setAddStudentsError('');
    setAddStudentsSubmitting(true);
    try {
        await submitAddStudents(className);
    } finally {
        setAddStudentsSubmitting(false);
    }
}

async function submitAddStudents(className) {

    const assignSet = ensureClassStudentAssignments(className);
    const normalizedAssignSet = new Set();
    assignSet.forEach((value) => {
        const normalized = normalizeStudentKey(value);
        if (normalized) normalizedAssignSet.add(normalized);
    });
    if (normalizedAssignSet.size !== assignSet.size) {
        assignSet.clear();
        normalizedAssignSet.forEach(value => assignSet.add(value));
    }

    const studentsFromDatabase = await fetchAllStudents();

    // Update per-class student objects list
    const existingStudentsInClass = loadClassStudentsFromStorage(className) || [];
    const newlyAddedStudents = [];
    const existingFacultySet = new Set(
        existingStudentsInClass
            .map(student => normalizeStudentKey(getStudentFacultyNumber(student)))
            .filter(Boolean)
    );
    assignSet.forEach((value) => {
        const normalized = normalizeStudentKey(value);
        if (normalized) existingFacultySet.add(normalized);
    });

    const selectedFacultyNumbers = new Set();

    addStudentsSelections.forEach(studentKey => {
        let studentInfo = addStudentsIndex.get(studentKey);
        if (!studentInfo) {
            studentInfo = findStudentByKey(studentKey, studentsFromDatabase);
        }
        if (!studentInfo) return;

        const facultyNumber = normalizeStudentKey(getStudentFacultyNumber(studentInfo));
        if (!facultyNumber) {
            return;
        }

        // Prevent duplicates (faculty-number based)
        const duplicate = existingFacultySet.has(facultyNumber) || selectedFacultyNumbers.has(facultyNumber);

        if (!duplicate) {
            selectedFacultyNumbers.add(facultyNumber);
            newlyAddedStudents.push({
                ...studentInfo,
                faculty_number: facultyNumber
            });
        }
    });
    if (newlyAddedStudents.length === 0) {
        closeAddStudentsToClass();
        return;
    }

    const classId = await resolveClassId(className);
    if (!classId) {
        setAddStudentsError(i18nText('tp_add_students_error', 'Неуспешно добавяне на студентите. Опитайте отново.'));
        return;
    }

    try {
        await addStudentsToClass(classId, newlyAddedStudents);
        markRosterChanged(classId);
        invalidateAttendanceSummary(classId);

        // Commit local state only after the server accepts the write.
        selectedFacultyNumbers.forEach((facultyNumber) => assignSet.add(facultyNumber));
        addNewStudentsToStorage(className, [...existingStudentsInClass, ...newlyAddedStudents]);

        // WORKAROUND: Server may not await inserts, so wait a bit then verify
        // This ensures inserts complete before we try to fetch the updated list
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify by fetching the class students again.
        // Do NOT pass className here — fetchClassStudents writes to localStorage when className is
        // given, and if the server hasn't committed the new student yet it would overwrite our
        // optimistic localStorage update (written above) with an incomplete list, breaking
        // isStudentInClass() for students that are already checked in.
        try {
            const verifyTimeout = setTimeout(() => {
                console.warn('[finalizeAddStudentsToClass] Verification fetch timed out, proceeding anyway');
            }, 2000);

            const verifiedStudents = await fetchClassStudents(classId);
            clearTimeout(verifyTimeout);

            // If verification shows fewer students than expected, log warning but continue
            if (verifiedStudents && verifiedStudents.length < newlyAddedStudents.length) {
                console.warn('[finalizeAddStudentsToClass] Verification shows fewer students than added', {
                    className,
                    classId,
                    addedCount: newlyAddedStudents.length,
                    verifiedCount: verifiedStudents.length,
                    note: 'Server inserts may still be processing'
                });
            }
        } catch (verifyError) {
            console.warn('[finalizeAddStudentsToClass] Verification fetch failed, proceeding anyway', {
                className,
                classId,
                error: verifyError.message
            });
            // Continue even if verification fails - server may still be processing
        }
    } catch (error) {
        if (error?.redirectingAuth) return;
        console.error('[finalizeAddStudentsToClass] Failed to add students to class', {
            className,
            classId,
            error: error.message,
            status: error.status
        });
        setAddStudentsError(i18nText('tp_add_students_error', 'Неуспешно добавяне на студентите. Опитайте отново.'));
        return;
    }

    if (newlyAddedStudents.length > 0) {
        const nounKey = newlyAddedStudents.length === 1 ? 'toast_student_added' : 'toast_students_added';
        const fallback = newlyAddedStudents.length === 1
            ? 'Successfully added student'
            : 'Successfully added students';
        showToast(i18nText(nounKey, fallback), 'success');
    }

    // Ensure class marked ready
    setClassReady(className, true);
    const btn = Array.from(document.querySelectorAll('.newClassBtn')).find(b => {
        const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '').trim();
        return btnName === className;
    });
    if (btn) updateClassStatusUI(btn);

    // Re-render manage list
    const manageOverlay = getManageStudentsOverlay();
    if (manageOverlay && isOverlayVisible(manageOverlay)) {
        await renderManageStudentsForClass(className);
    }

    // Refresh attendance overlay if open
    const attendanceOverlay = getOverlay('attendanceOverlay');
    if (attendanceOverlay && isOverlayVisible(attendanceOverlay)) {
        renderAttendanceForClass(className, document.getElementById('attendanceList'));
    }

    closeAddStudentsToClass();
}

/**
 * Check if overlay is visible
 */
function isOverlayVisible(overlay) {
    return overlay && overlay.style.visibility === 'visible';
}

/**
 * Close all class overlays (helper for main file)
 */
function closeAllClassOverlays() {
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    const manageOverlay = getManageStudentsOverlay();
    const studentInfo = getOverlay('studentInfoOverlay');
    onStudentDetailsHidden();
    const scannerOverlay = getOverlay('scannerOverlay');

    if (readyPopupOverlay) hideOverlay(readyPopupOverlay);
    if (manageOverlay) {
        onManageStudentsHidden();
        hideOverlay(manageOverlay);
    }
    if (studentInfo) hideOverlay(studentInfo);
    // Scanner has its own close function
    document.body.style.overflow = '';
}

// Export closeAllClassOverlays for main file
export { closeAllClassOverlays };
