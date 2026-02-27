/**
 * Student Management Feature Module
 * 
 * Handles student add/remove/info/history management.
 * Manages manage students overlay, student info overlay, attendance history, and add students overlay.
 */

import { removeStudentFromClass as apiRemoveStudentFromClass, addStudentsToClass } from '../api/classApi.js';
import { fetchAllStudents } from '../api/studentApi.js';
import { fetchClassStudents } from '../api/classApi.js';
import { getStudentAttendanceCountForClass } from './attendance.js';
import { fetchStudentAttendanceHistory, fetchClassAttendanceTimestamps } from '../api/attendanceApi.js';
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
import { loadClassStudentsFromStorage, addNewStudentsToStorage, getStudentInfoForFacultyNumber } from '../storage/studentStorage.js';
import { getClassIdByNameFromStorage, getStoredClassesMap } from '../storage/classStorage.js';
import { fetchClasses } from '../api/classApi.js';
import { showOverlay, hideOverlay, getOverlay, openConfirmOverlay } from '../ui/overlays.js';
import { updateClassStatusUI } from '../ui/classUI.js';
import { renderAttendanceForClass } from '../ui/attendanceUI.js';
import { getTeacherEmail, SERVER_BASE_URL, ENDPOINTS } from '../config/api.js';

// Module state
let studentIndex = new Map(); // id -> full student object
let studentInfoOverlay = null;
let manageStudentsScrollPos = 0;
let manageStudentsOverlayInitialized = false;
let attendanceHistoryOverlayInitialized = false;
let addStudentsOverlayInitialized = false;
let addStudentsReturnToManage = false;

function getStudentFullName(student) {
    return student?.fullName || student?.full_name || student?.name || '';
}

function getStudentFacultyNumber(student) {
    return student?.faculty_number || student?.facultyNumber || student?.faculty || '';
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

function getStudentGroup(student) {
    return student?.group || student?.group_name || student?.groupName || student?.group_number || student?.groupNumber || '';
}

function i18nText(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
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
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

async function fetchAttendedClassesCount(className, studentId, updateEl) {
    const classId = await resolveClassId(className);
    if (!classId || !studentId) return;
    try {
        const url = SERVER_BASE_URL + ENDPOINTS.getStudentAttendanceCount(classId, studentId);
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        const count = Number(data?.attendance_count ?? 0);
        if (updateEl && updateEl.isConnected) {
            updateEl.textContent = `${i18nText('attended_classes_label', 'Attended Classes')}: ${Number.isFinite(count) ? count : 0}`;
        }
    } catch (_) {
        // Silent fail; keep default count
    }
}

function showToast(message, tone = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast-bubble toast-${tone} toast-wide`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 1400);
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
    const scoped = overlay?.querySelector('#addStudentsList');
    return scoped || document.getElementById('addStudentsList');
}
function getAttendanceHistoryOverlay() { return getOverlay('attendanceHistoryOverlay'); }

/**
 * Load attendance log for a student
 * @param {string} className - Class name
 * @param {string} studentId - Student ID
 * @returns {Promise<Array<{joinAt:number|null, leaveAt:number|null}>>}
 */
async function loadAttendanceLog(className, studentId) {
    const classId = await resolveClassId(className);
    if (!classId) return [];

    const info = studentIndex.get(String(studentId)) || {};
    const facultyNumber = info.faculty_number || studentId;
    const studentKey = String(studentId || '').trim();
    const facultyKey = String(facultyNumber || '').trim();

    const normalize = (row) => {
        const joinedAt = parseTimestamp(
            row.joined_at ?? row.joinedAt ?? row.join_time ?? row.joinTime ?? row.in_time ?? row.inTime
        );
        const leftAt = parseTimestamp(
            row.left_at ?? row.leftAt ?? row.leave_time ?? row.leaveTime ?? row.out_time ?? row.outTime
        );
        return { joinAt: joinedAt, leaveAt: leftAt };
    };

    try {
        const numericStudentId = /^\d+$/.test(String(studentId || '')) ? String(studentId) : '';
        const useStudentId = numericStudentId && numericStudentId !== facultyKey;
        const data = await fetchStudentAttendanceHistory(classId, {
            studentId: useStudentId ? numericStudentId : null,
            facultyNumber: facultyKey
        });
        const raw = data?.records || data?.sessions || data?.history || data?.attendance || data?.items || [];
        if (Array.isArray(raw) && raw.length > 0) {
            return raw.map(normalize).filter(r => r.joinAt || r.leaveAt);
        }
    } catch (e) {
        console.warn('[loadAttendanceLog] Attendance history endpoint failed, falling back', e);
    }

    try {
        const data = await fetchClassAttendanceTimestamps(classId);
        const raw = data?.timestamps || data?.items || data?.records || data?.rows || [];
        if (!Array.isArray(raw)) return [];
        const filtered = raw.filter((row) => {
            const rowStudentId = String(row.student_id ?? row.studentId ?? '').trim();
            const rowFaculty = String(row.faculty_number ?? row.facultyNumber ?? '').trim();
            return (studentKey && rowStudentId && rowStudentId === studentKey)
                || (facultyKey && rowFaculty && rowFaculty === facultyKey);
        });
        if (filtered.length === 0) return [];
        return filtered.map(normalize).filter(r => r.joinAt || r.leaveAt);
    } catch (e) {
        console.error('[loadAttendanceLog] Failed to load attendance history fallback', e);
        return [];
    }
}

/**
 * Render manage students list for a class
 * @param {string} className - Class name
 */
export async function renderManageStudentsForClass(className) {
    const module = 'STUDENT_MANAGEMENT';
    const functionName = 'renderManageStudentsForClass';
    
    const current = getCurrentClass();
    const selectedClassId = current.id;
    
    const listEl = getManageStudentsListEl();
    if (!listEl) {
        console.error(`[${module}] List element not found for class:`, className);
        return;
    }

    // Show loading state initially
    listEl.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">Loading students...</p>';

    try {
        // First, try to load from localStorage (fast path)
        let students = loadClassStudentsFromStorage(className);
        
        // If localStorage is empty, fetch from API
        if (!students || students.length === 0) {
            
            // Resolve classId to fetch from API
            const classId = await resolveClassId(className);
            
            if (classId) {
                try {
                    const fetched = await fetchClassStudents(classId, className);
                    students = fetched || [];
                    
                    // WORKAROUND: If fetch returned empty but we have students in localStorage,
                    // the server inserts may still be processing. Wait and retry once.
                    if (students.length === 0) {
                        const storedStudents = loadClassStudentsFromStorage(className);
                        if (storedStudents && storedStudents.length > 0) {
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            
                            try {
                                const retryFetched = await fetchClassStudents(classId, className, 1);
                                if (retryFetched && retryFetched.length > 0) {
                                    students = retryFetched;
                                }
                            } catch (retryError) {
                                console.warn('[Class Overlay Render] Retry failed, using localStorage fallback', {
                                    className,
                                    error: retryError.message
                                });
                                // Use localStorage as fallback if retry fails
                                students = storedStudents;
                            }
                        }
                    }
                    
                } catch (e) {
                    console.error(`[${module}] Failed to fetch class students from API:`, {
                        className,
                        classId,
                        error: e.message,
                        status: e.status || 'unknown'
                    });
                    // Fallback to localStorage if fetch fails
                    const storedStudents = loadClassStudentsFromStorage(className);
                    if (storedStudents && storedStudents.length > 0) {
                        students = storedStudents;
                    } else {
                        students = [];
                    }
                }
            } else {
                console.warn(`[${module}] No classId found for "${className}", cannot fetch from API`);
                students = [];
            }
        }

        // Clear loading state
        listEl.innerHTML = '';

        // Render students if we have any
        if (students && students.length > 0) {
            let infoLookup = null;
            const needsInfo = students.some(s => (
                !getStudentFullName(s) ||
                !getStudentEmail(s) ||
                !getStudentGroup(s)
            ));
            if (needsInfo) {
                try {
                    const all = await fetchAllStudents({ forceRefresh: true });
                    infoLookup = new Map();
                    (all || []).forEach(s => {
                        const name = getStudentFullName(s);
                        const fac = String(getStudentFacultyNumber(s) || '').trim();
                        const id = String(s.id || s.student_id || '').trim();
                        const email = getStudentEmail(s);
                        const group = getStudentGroup(s);
                        const payload = { fullName: name, faculty_number: fac, email, group };
                        if (fac) infoLookup.set(fac, payload);
                        if (id) infoLookup.set(id, payload);
                    });
                } catch (_) {
                    infoLookup = null;
                }
            }

            const ul = document.createElement('ul');
            ul.style.listStyle = 'none';
            ul.style.padding = '0';
            ul.style.margin = '0';

            students.forEach(student => {
                const li = document.createElement('li');
                li.className = 'list-item';
                const studentId = student.faculty_number || student.facultyNumber || student.id || student.student_id;
                li.dataset.studentId = studentId;
                const lookup = infoLookup ? infoLookup.get(String(studentId || '').trim()) : null;
                const fullName = getStudentFullName(student) || lookup?.fullName || '';
                const facultyNumber = getStudentFacultyNumber(student) || lookup?.faculty_number || studentId || '';
                const email = getStudentEmail(student) || lookup?.email || '';
                const group = getStudentGroup(student) || lookup?.group || '';

                const wrap = document.createElement('div');
                wrap.className = 'student-card-text';

                const nameEl = document.createElement('span');
                nameEl.className = 'student-name';
                nameEl.textContent = fullName;

                const facEl = document.createElement('span');
                facEl.className = 'student-fac';
                facEl.textContent = facultyNumber || '';

                wrap.appendChild(nameEl);
                wrap.appendChild(facEl);
                li.appendChild(wrap);
                li.addEventListener('click', () => openStudentInfoOverlay(studentId, className));

                if (studentId) {
                    studentIndex.set(String(studentId), {
                        fullName,
                        faculty_number: facultyNumber,
                        email,
                        group
                    });
                }

                ul.appendChild(li);
            });

            listEl.appendChild(ul);
            return;
        }

        // Fallback to in-memory id set if no students from storage/API
        const assignments = getClassStudentAssignments(className);
        
        if (assignments && assignments.size > 0) {
            const ul = document.createElement('ul');
            ul.style.listStyle = 'none';
            ul.style.padding = '0';
            ul.style.margin = '0';

            Array.from(assignments).forEach((id) => {
                const info = studentIndex.get(id) || { fullName: id, faculty_number: '' };
                const li = document.createElement('li');
                li.className = 'list-item';
                li.dataset.studentId = id;

                const wrap = document.createElement('div');
                wrap.className = 'student-card-text';

                const nameEl = document.createElement('span');
                nameEl.className = 'student-name';
                nameEl.textContent = info.fullName || '';

                const facEl = document.createElement('span');
                facEl.className = 'student-fac';
                facEl.textContent = info.faculty_number || '';

                wrap.appendChild(nameEl);
                wrap.appendChild(facEl);
                li.appendChild(wrap);
                li.addEventListener('click', () => openStudentInfoOverlay(id, className));

                ul.appendChild(li);
            });

            listEl.appendChild(ul);
            return;
        }

        // Show empty state if no students found
        console.warn('[Class Overlay Render] Early exit - showing empty state', {
            reason: 'no students found from any source',
            className,
            selectedClassId,
            checkedLocalStorage: true,
            checkedAPI: true,
            checkedAssignments: true
        });
        
        const p = document.createElement('p');
        p.className = 'muted';
        p.style.textAlign = 'center';
        p.style.padding = '20px';
        p.textContent = 'No students assigned to this class.';
        listEl.appendChild(p);
        
    } catch (error) {
        console.error(`[${module}] Error rendering manage students list:`, {
            className,
            selectedClassId,
            error: error.message,
            stack: error.stack
        });
        listEl.innerHTML = '<p class="muted" style="text-align:center; padding:20px; color:red;">Error loading students. Please try again.</p>';
    }
}

/**
 * Ensure manage students overlay is initialized (idempotent)
 */
function ensureManageStudentsOverlayInitialized() {
    if (manageStudentsOverlayInitialized) return;
    manageStudentsOverlayInitialized = true;

    const overlay = getManageStudentsOverlay();
    if (!overlay) return;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            const current = getCurrentClass();
            returnToReadyClassPopup(current.name);
        }
    });

    const backBtn = overlay.querySelector('#backToReadyBtn');
    const closeBtn = overlay.querySelector('#closeManageOverlayBtn');
    const addBtn = overlay.querySelector('#addStudentManageBtn');

    backBtn?.addEventListener('click', () => {
        const current = getCurrentClass();
        returnToReadyClassPopup(current.name);
    });

    closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeAllClassOverlays();
    });

        addBtn?.addEventListener('click', async () => {
            const current = getCurrentClass();
            await openAddStudentsToClass(current.name, { returnToManage: true });
        });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOverlayVisible(overlay)) {
            const current = getCurrentClass();
            returnToReadyClassPopup(current.name);
        }
    });
}

/**
 * Open manage students overlay
 * @param {string} className - Class name
 */
export async function openManageStudentsOverlay(className) {
    ensureManageStudentsOverlayInitialized();
    applyI18n();

    const current = getCurrentClass();
    
    setCurrentClass(className, current.id, current.button);
    
    const currentAfterSet = getCurrentClass();

    // Hide ready overlay to avoid stacking
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    if (readyPopupOverlay) hideOverlay(readyPopupOverlay);

    const overlay = getManageStudentsOverlay();
    const titleEl = overlay?.querySelector('#manageStudentsTitle');
    if (titleEl) titleEl.textContent = i18nText('manage_students', 'Manage Students');

    // Show overlay immediately (renderManageStudentsForClass will show loading state)
    if (overlay) {
        showOverlay(overlay);
    }

    // Render students list (async, will fetch from API if needed)
    try {
        await renderManageStudentsForClass(className);
    } catch (e) {
        console.error('[openManageStudentsOverlay] Failed to render students list:', className, e);
        // Error handling is done inside renderManageStudentsForClass
    }
}

/**
 * Close manage students overlay
 */
function closeManageStudentsOverlay() {
    const overlay = getManageStudentsOverlay();
    if (overlay) {
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
function ensureStudentInfoOverlay() {
    if (studentInfoOverlay) return studentInfoOverlay;
    studentInfoOverlay = document.createElement('div');
    studentInfoOverlay.id = 'studentInfoOverlay';
    studentInfoOverlay.className = 'overlay';
    studentInfoOverlay.style.visibility = 'hidden';
    document.body.appendChild(studentInfoOverlay);
    
    studentInfoOverlay.addEventListener('click', (e) => {
        if (e.target === studentInfoOverlay) {
            closeStudentInfoOverlay();
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOverlayVisible(studentInfoOverlay)) {
            closeStudentInfoOverlay();
        }
    });
    
    return studentInfoOverlay;
}

/**
 * Build student info content HTML
 * @param {Object} studentObj - Student object
 * @param {string} studentId - Student ID
 * @param {string} className - Class name
 * @returns {HTMLElement} Content wrapper element
 */
function buildStudentInfoContent(studentObj, studentId, className) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ready-class-popup student-info-popup';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-modal', 'true');
    wrapper.innerHTML = '';

    const h2 = document.createElement('h2');
    h2.textContent = i18nText('student_info_title', 'Student Info');
    wrapper.appendChild(h2);

    // Get student data from storage/state if available
    const classStudents = loadClassStudentsFromStorage(className);
    const storageInfo = getStudentInfoForFacultyNumber(studentId, classStudents);
    const allStudents = getAllStudents();
    const allInfo = getStudentInfoForFacultyNumber(studentId, allStudents);

    const studentData = { ...(studentObj || {}) };
    fillMissing(studentData, storageInfo);
    fillMissing(studentData, allInfo);

    const nameP = document.createElement('p');
    nameP.textContent = `${i18nText('full_name_label', 'Full Name')}: ${getStudentFullName(studentData) || '—'}`;
    nameP.style.margin = '0 0 8px 0';
    wrapper.appendChild(nameP);

    const facultyP = document.createElement('p');
    facultyP.textContent = `${i18nText('faculty_number_label', 'Faculty number')}: ${getStudentFacultyNumber(studentData) || '—'}`;
    facultyP.style.margin = '0 0 12px 0';
    wrapper.appendChild(facultyP);

    const emailP = document.createElement('p');
    emailP.textContent = `${i18nText('email', 'Email')}: ${getStudentEmail(studentData) || '—'}`;
    emailP.style.margin = '0 0 8px 0';
    wrapper.appendChild(emailP);

    const groupP = document.createElement('p');
    groupP.textContent = `${i18nText('group', 'Group')}: ${getStudentGroup(studentData) || '—'}`;
    groupP.style.margin = '0 0 10px 0';
    wrapper.appendChild(groupP);

    // Attended classes counter (per-class, live)
    const current = getCurrentClass();
    const attended = getStudentAttendanceCountForClass(className || current.name, studentId, null);
    const attendedP = document.createElement('p');
    attendedP.setAttribute('data-attendance-counter', '');
    attendedP.textContent = `${i18nText('attended_classes_label', 'Attended Classes')}: ${attended}`;
    attendedP.style.margin = '10px 0 0 0';
    attendedP.style.fontWeight = '700';
    attendedP.style.fontSize = '1.15rem';
    attendedP.style.letterSpacing = '.5px';
    wrapper.appendChild(attendedP);
    fetchAttendedClassesCount(className || current.name, studentId, attendedP);

    // Attendance History button
    const historyBtn = document.createElement('button');
    historyBtn.type = 'button';
    historyBtn.className = 'role-button attendance-history-btn';
    historyBtn.textContent = i18nText('attendance_history', 'Attendance History');
    historyBtn.style.marginTop = '16px';
    historyBtn.style.width = '100%';
    historyBtn.addEventListener('click', () => {
        openAttendanceHistoryOverlay(className || current.name, studentId);
    });
    wrapper.appendChild(historyBtn);

    // Remove from class button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'role-button danger';
    removeBtn.textContent = i18nText('remove_from_class', 'Remove from Class');
    removeBtn.style.marginTop = '12px';
    removeBtn.style.width = '100%';
    removeBtn.style.backgroundColor = '#dc2626';
    removeBtn.style.color = 'white';
    removeBtn.style.border = 'none';
    removeBtn.style.cursor = 'pointer';
    removeBtn.addEventListener('mouseover', () => {
        removeBtn.style.backgroundColor = '#991b1b';
    });
    removeBtn.addEventListener('mouseout', () => {
        removeBtn.style.backgroundColor = '#dc2626';
    });
    removeBtn.addEventListener('click', () => {
        openConfirmOverlay(
            `${i18nText('confirm_remove_student_prefix', 'Are you sure you want to remove')} ${getStudentFullName(studentData) || i18nText('this_student', 'this student')} ${i18nText('confirm_remove_student_suffix', 'from the class?')}`,
            () => removeStudentFromClass(studentId, className || current.name),
            () => { /* cancelled */ }
        );
    });
    wrapper.appendChild(removeBtn);

    return wrapper;
}

/**
 * Open student info overlay
 * @param {string} studentId - Student ID
 * @param {string} className - Class name
 */
export function openStudentInfoOverlay(studentId, className) {
    ensureStudentInfoOverlay();
    applyI18n();

    // Preserve scroll of manage overlay
    const listEl = getManageStudentsListEl();
    if (listEl) manageStudentsScrollPos = listEl.scrollTop;

    // Hide manage overlay without destroying it
    const manageOverlay = getManageStudentsOverlay();
    if (manageOverlay) hideOverlay(manageOverlay, false);

    const info = studentIndex.get(studentId) || { fullName: studentId };
    studentInfoOverlay.innerHTML = '';
    const content = buildStudentInfoContent(info, studentId, className);
    studentInfoOverlay.appendChild(content);
    studentInfoOverlay.dataset.studentId = String(studentId);
    studentInfoOverlay.dataset.className = String(className || getCurrentClass().name || '');
    showOverlay(studentInfoOverlay, false);
}

/**
 * Close student info overlay
 */
function closeStudentInfoOverlay() {
    if (!studentInfoOverlay) return;
    hideOverlay(studentInfoOverlay, false);
    
    // Restore manage overlay
    const manageOverlay = getManageStudentsOverlay();
    if (manageOverlay) {
        showOverlay(manageOverlay, false);
        const listEl = getManageStudentsListEl();
        if (listEl) listEl.scrollTop = manageStudentsScrollPos;
    }
}

/**
 * Remove student from class
 * @param {string} facultyNumber - Faculty number
 * @param {string} className - Class name
 */
export async function removeStudentFromClass(facultyNumber, className) {
    const classId = getClassIdByName(className);
    if (!classId) {
        console.error('[removeStudentFromClass] Unable to get class ID for class:', className);
        alert('Error: Class ID not found.');
        return;
    }

    const teacherEmail = getTeacherEmail();

    try {
        await apiRemoveStudentFromClass(classId, facultyNumber, teacherEmail);

        // Update UI: remove from storage
        const targetKey = normalizeStudentKey(facultyNumber);
        const classStudents = loadClassStudentsFromStorage(className);
        if (classStudents && Array.isArray(classStudents)) {
            const filtered = classStudents.filter(s => 
                normalizeStudentKey(getStudentFacultyNumber(s) || s.id || s.student_id) !== targetKey
            );
            addNewStudentsToStorage(className, filtered);
        }

        // Update in-memory assignments
        removeStudentFromClassAssignments(className, targetKey);
        if (/^\d+$/.test(targetKey)) {
            removeStudentFromClassAssignments(className, Number(targetKey));
        }

        // Close overlays and refresh
        closeStudentInfoOverlay();
        const manageOverlay = getManageStudentsOverlay();
        if (manageOverlay && isOverlayVisible(manageOverlay)) {
            await renderManageStudentsForClass(className);
        }

        showToast(i18nText('toast_student_removed', 'Student removed'), 'error');
    } catch (error) {
        console.error('[removeStudentFromClass] Error:', error.message);
        alert('Failed to remove student: ' + error.message);
    }
}

/**
 * Render attendance history list
 * @param {string} className - Class name
 * @param {string} studentId - Student ID
 */
async function renderAttendanceHistoryList(className, studentId) {
    const container = document.getElementById('attendanceHistoryList');
    if (!container) return;

    container.innerHTML = '<p class="muted" style="text-align:center;">Loading...</p>';
    const sessions = await loadAttendanceLog(className, studentId);

    container.innerHTML = '';
    if (!Array.isArray(sessions) || sessions.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = i18nText('no_attendance_records', 'No attendance records.');
        container.appendChild(p);
        return;
    }

    const ul = document.createElement('ul');
    ul.className = 'attendance-history-ul';
    sessions.slice().reverse().forEach((sess) => {
        const li = document.createElement('li');
        li.className = 'attendance-history-item';
        const joined = new Date(sess.joinAt || sess.leaveAt || Date.now());
        const left = new Date(sess.leaveAt || sess.joinAt || Date.now());
        const timeOpts = { hour: 'numeric', minute: '2-digit' };
        const dateOpts = { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' };
        const lang = (window.i18n && typeof window.i18n.getLanguage === 'function')
            ? window.i18n.getLanguage()
            : (document.documentElement.lang || 'en');
        const locale = lang === 'bg' ? 'bg-BG' : 'en-US';
        const joinTime = joined.toLocaleTimeString(locale, timeOpts);
        const leaveTime = left.toLocaleTimeString(locale, timeOpts);
        const joinDate = joined.toLocaleDateString(locale, dateOpts);
        const leaveDate = left.toLocaleDateString(locale, dateOpts);

        const row1 = document.createElement('div');
        row1.className = 'att-row';
        const joinLabel = document.createElement('span');
        joinLabel.className = 'att-label att-label-joined';
        joinLabel.textContent = i18nText('joined_label', 'Joined');
        const joinVal = document.createElement('span');
        joinVal.className = 'att-value';
        joinVal.textContent = `${joinTime} - ${joinDate}`;
        row1.appendChild(joinLabel);
        row1.appendChild(joinVal);

        const row2 = document.createElement('div');
        row2.className = 'att-row';
        const leaveLabel = document.createElement('span');
        leaveLabel.className = 'att-label att-label-left';
        leaveLabel.textContent = i18nText('left_label', 'Left');
        const leaveVal = document.createElement('span');
        leaveVal.className = 'att-value';
        leaveVal.textContent = `${leaveTime} - ${leaveDate}`;
        row2.appendChild(leaveLabel);
        row2.appendChild(leaveVal);

        li.appendChild(row1);
        li.appendChild(row2);
        ul.appendChild(li);
    });
    container.appendChild(ul);
}

/**
 * Ensure attendance history overlay is initialized (idempotent)
 */
function ensureAttendanceHistoryOverlayInitialized() {
    if (attendanceHistoryOverlayInitialized) return;
    attendanceHistoryOverlayInitialized = true;

    const overlay = getAttendanceHistoryOverlay();
    if (!overlay) return;

    const closeBtn = overlay.querySelector('#closeAttendanceHistoryBtn');
    const backBtn = overlay.querySelector('#attendanceHistoryBackBtn');

    closeBtn?.addEventListener('click', () => returnToManageStudentsFromHistory());
    backBtn?.addEventListener('click', () => returnToStudentInfoOverlay());

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) returnToManageStudentsFromHistory();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOverlayVisible(overlay)) {
            returnToManageStudentsFromHistory();
        }
    });
}

/**
 * Open attendance history overlay
 * @param {string} className - Class name
 * @param {string} studentId - Student ID
 */
export function openAttendanceHistoryOverlay(className, studentId) {
    ensureAttendanceHistoryOverlayInitialized();
    applyI18n();

    // Hide student info overlay
    if (studentInfoOverlay) hideOverlay(studentInfoOverlay, false);

    const overlay = getAttendanceHistoryOverlay();
    const titleEl = overlay?.querySelector('#attendanceHistoryTitle');
    if (titleEl) titleEl.textContent = i18nText('attendance_history', 'Attendance History');

    if (overlay) {
        showOverlay(overlay, false);
        overlay.dataset.studentId = String(studentId);
        overlay.dataset.className = String(className || getCurrentClass().name || '');
    }
    renderAttendanceHistoryList(className, studentId);
}

/**
 * Return to student info overlay from history
 */
function returnToStudentInfoOverlay() {
    const overlay = getAttendanceHistoryOverlay();
    if (overlay) hideOverlay(overlay, false);
    if (studentInfoOverlay) showOverlay(studentInfoOverlay, false);
}

/**
 * Close attendance history overlay
 */
function closeAttendanceHistoryOverlay() {
    const overlay = getAttendanceHistoryOverlay();
    if (overlay) hideOverlay(overlay, false);
}

/**
 * Return to manage students from history
 */
function returnToManageStudentsFromHistory() {
    closeAttendanceHistoryOverlay();
    if (studentInfoOverlay) hideOverlay(studentInfoOverlay, false);
    const manageOverlay = getManageStudentsOverlay();
    if (manageOverlay) {
        showOverlay(manageOverlay, false);
        const listEl = getManageStudentsListEl();
        if (listEl) listEl.scrollTop = manageStudentsScrollPos;
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
    const overlay = getAddStudentsClassOverlay();
    const confirmBtn = overlay?.querySelector('#addStudentsOverlayBtn');
    if (confirmBtn) {
        const label = i18nText('add_btn', 'Add');
        confirmBtn.textContent = `${label} (${addStudentsSelections.size})`;
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
    const confirmBtn = overlay.querySelector('#addStudentsOverlayBtn');
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

async function requestAddStudentsWithFilters(overrides = {}) {
    const current = getCurrentClass();
    const className = current?.name || '';
    if (!className) return;

    const listEl = getAddStudentsListEl();
    if (listEl) {
        listEl.innerHTML = '<p class="muted" style="text-align:center;">Loading students...</p>';
    }

    const requestId = ++addStudentsRequestId;
    const filters = collectAddStudentsFilters(overrides);
    const params = new URLSearchParams();

    if (filters.level) params.append('level', filters.level);
    if (filters.faculty) params.append('faculty', filters.faculty);
    if (filters.specialization) params.append('specialization', filters.specialization);
    if (filters.group) params.append('group', filters.group);
    if (filters.search) params.append('search', filters.search);

    try {
        const url = `${SERVER_BASE_URL + ENDPOINTS.students}${params.toString() ? `?${params.toString()}` : ''}`;
        const result = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!result.ok) {
            throw new Error(`HTTP ${result.status}`);
        }
        const data = await result.json();
        const students = Array.isArray(data?.students) ? data.students : (Array.isArray(data) ? data : []);

        if (requestId !== addStudentsRequestId) return;
        await renderAddStudentsList(className, { studentsOverride: students });
    } catch (e) {
        if (requestId !== addStudentsRequestId) return;
        try {
            const fallback = await fetchAllStudents({ forceRefresh: true });
            await renderAddStudentsList(className, { studentsOverride: fallback });
        } catch (_) {
            if (listEl) {
                listEl.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">Unable to load students.</p>';
            }
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
    const confirmBtn = overlay?.querySelector('#addStudentsOverlayBtn');
    const searchInput = overlay?.querySelector('#addStudentsSearchInput');

    addStudentsSelections.clear();

    if (confirmBtn) {
        const label = i18nText('add_btn', 'Add');
        confirmBtn.textContent = `${label} (0)`;
    }

    // Show overlay immediately with loading state
    if (overlay) {
        showOverlay(overlay, false);
    }

    // Render students list (async, with error handling)
    try {
        await renderAddStudentsList(className);
    } catch (e) {
        console.error('[openAddStudentsToClass] Failed to render students list:', className, e);
        // Ensure list container shows error state
        const listEl = getAddStudentsListEl();
        if (listEl) {
            listEl.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">Unable to load students. Please try again.</p>';
        }
    }

    updateAddStudentsCounter();
    // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
}

/**
 * Close add students to class overlay
 */
function closeAddStudentsToClass() {
    const overlay = getAddStudentsClassOverlay();
    resetAddStudentsFiltersState();
    if (overlay) hideOverlay(overlay, false);
    if (addStudentsReturnToManage) {
        addStudentsReturnToManage = false;
        const current = getCurrentClass();
        if (current?.name) {
            openManageStudentsOverlay(current.name);
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
async function renderAddStudentsList(className, options = {}) {
    const listEl = getAddStudentsListEl();
    if (!listEl) {
        console.error('[Render Add Students] List element not found');
        return;
    }

    // Show loading state
    listEl.innerHTML = '<p class="muted" style="text-align:center;">Loading students...</p>';

    // Resolve classId with fallbacks
    const classId = await resolveClassId(className);
    if (!classId) {
        console.error('[Render Add Students] No class ID found for class:', className);
        // Still try to show all students even without classId
    }

    // Build existing set from assignments map and local storage (source of truth after removals)
    const assignments = getClassStudentAssignments(className);
    const existingSet = new Set(
        Array.from(assignments || new Set()).map(normalizeStudentKey).filter(Boolean)
    );
    const storedStudents = loadClassStudentsFromStorage(className) || [];
    const storedSet = new Set(
        storedStudents
            .map(student => normalizeStudentKey(getStudentFacultyNumber(student)))
            .filter(Boolean)
    );
    storedSet.forEach(key => existingSet.add(key));

    let classStudents = [];
    let allStudents = [];
    let fetchError = false;

    // Fetch class roster if classId is available
    if (classId) {
        try {
            const fetched = await fetchClassStudents(classId, className);
            classStudents = fetched || [];
            
            // Add to existing set
            if (classStudents && classStudents.length > 0) {
                // If we have local storage, trust it over server (server may be stale after removals)
                if (storedSet.size === 0) {
                    classStudents.forEach(student => {
                        const id = normalizeStudentKey(getStudentFacultyNumber(student));
                        if (id) {
                            existingSet.add(id);
                        }
                    });
                }
            }
        } catch (e) {
            console.error('[Render Add Students] Failed to fetch class students:', className, e);
            fetchError = true;
            // Try loading from storage as fallback
            if (storedStudents.length > 0) {
                classStudents = storedStudents;
            }
        }
    } else {
        // No classId, try storage only
        if (storedStudents.length > 0) {
            classStudents = storedStudents;
        }
    }

    const { studentsOverride = null } = options;
    if (Array.isArray(studentsOverride)) {
        allStudents = studentsOverride;
    } else {
        // Always refresh from API when opening Add Students
        allStudents = getAllStudents();
        
        try {
            allStudents = await fetchAllStudents({ forceRefresh: true });
        } catch (e) {
            console.error('[Render Add Students] Failed to fetch all students:', e);
            fetchError = true;
            // Fallback to cached data if available
            allStudents = getAllStudents() || [];
        }
    }
    
    // Ensure allStudents is an array
    if (!Array.isArray(allStudents)) {
        allStudents = [];
    }

    // Clear loading state
    listEl.innerHTML = '';

    // If no students available at all, show empty state
    if (!allStudents || allStudents.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.className = 'muted';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.padding = '20px';
        if (fetchError) {
            emptyMsg.textContent = 'Unable to load students. Please check your connection and try again.';
        } else {
            emptyMsg.textContent = 'No students available in the database.';
        }
        listEl.appendChild(emptyMsg);
        return;
    }

    // Render the list of all students
    addStudentsIndex = new Map();
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.margin = '0';
    ul.style.padding = '0';

    allStudents.forEach((student, idx) => {
        const li = document.createElement('li');
        li.className = 'list-item';
        const parts = (window.Students?.splitNames || (() => ({ fullName: '' })))(student);
        const facultyNumber = getStudentFacultyNumber(student);
        const facultyKey = normalizeStudentKey(facultyNumber);
        const studentKey = getStudentPrimaryKey(student);

        if (!studentKey) {
            li.classList.add('already-in');
            const textWrap = document.createElement('div');
            textWrap.className = 'student-card-text';
            const nameEl = document.createElement('span');
            nameEl.className = 'student-name';
            nameEl.textContent = parts.fullName;
            const facEl = document.createElement('span');
            facEl.className = 'student-fac';
            facEl.textContent = facultyNumber || '';
            textWrap.appendChild(nameEl);
            textWrap.appendChild(facEl);
            const badge = document.createElement('span');
            badge.className = 'already-in-badge';
            badge.textContent = i18nText('already_in_badge', 'Already in');
            li.appendChild(textWrap);
            li.appendChild(badge);
            ul.appendChild(li);
            return;
        }

        if (!addStudentsIndex.has(studentKey)) {
            addStudentsIndex.set(studentKey, student);
        }

        if (facultyKey && existingSet.has(facultyKey)) {
            // Render without checkbox, with 'Already in' badge
            li.classList.add('already-in');
            const textWrap = document.createElement('div');
            textWrap.className = 'student-card-text';
            const nameEl = document.createElement('span');
            nameEl.className = 'student-name';
            nameEl.textContent = parts.fullName;
            const facEl = document.createElement('span');
            facEl.className = 'student-fac';
            facEl.textContent = facultyNumber || '';
            textWrap.appendChild(nameEl);
            textWrap.appendChild(facEl);
            const badge = document.createElement('span');
            badge.className = 'already-in-badge';
            badge.textContent = i18nText('already_in_badge', 'Already in');
            li.appendChild(textWrap);
            li.appendChild(badge);
            ul.appendChild(li);
            return;
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `addStudent_${idx}`;
        checkbox.dataset.studentKey = studentKey;
        if (facultyKey) checkbox.dataset.facultyNumber = facultyKey;
        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        const wrap = document.createElement('div');
        wrap.className = 'student-card-text';
        const nameEl = document.createElement('span');
        nameEl.className = 'student-name';
        nameEl.textContent = parts.fullName;
        const facEl = document.createElement('span');
        facEl.className = 'student-fac';
        facEl.textContent = facultyNumber || '';
        wrap.appendChild(nameEl);
        wrap.appendChild(facEl);
        label.appendChild(wrap);

        checkbox.addEventListener('change', () => {
            const key = checkbox.dataset.studentKey;
            if (checkbox.checked) {
                if (key) addStudentsSelections.add(key);
                li.classList.add('selected');
            } else {
                if (key) addStudentsSelections.delete(key);
                li.classList.remove('selected');
            }
            updateAddStudentsCounter();
        });

        if (addStudentsSelections.has(studentKey)) {
            checkbox.checked = true;
            li.classList.add('selected');
        }

        li.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target.tagName === 'LABEL' || (e.target && e.target.closest('label'))) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        li.appendChild(checkbox);
        li.appendChild(label);
        ul.appendChild(li);
    });

    updateAddStudentsCounter();
    listEl.appendChild(ul);
}

/**
 * Finalize adding students to class
 * @param {string} className - Class name
 */
export async function finalizeAddStudentsToClass(className) {
    if (!className || addStudentsSelections.size === 0) {
        closeAddStudentsToClass();
        return;
    }

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
        alert('Failed to add students to class: Missing class id');
        return;
    }

    try {
        await addStudentsToClass(classId, newlyAddedStudents);

        // Commit local state only after the server accepts the write.
        selectedFacultyNumbers.forEach((facultyNumber) => assignSet.add(facultyNumber));
        addNewStudentsToStorage(className, [...existingStudentsInClass, ...newlyAddedStudents]);

        // WORKAROUND: Server may not await inserts, so wait a bit then verify
        // This ensures inserts complete before we try to fetch the updated list
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify by fetching the class students again
        try {
            const verifyTimeout = setTimeout(() => {
                console.warn('[finalizeAddStudentsToClass] Verification fetch timed out, proceeding anyway');
            }, 2000);

            const verifiedStudents = await fetchClassStudents(classId, className);
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
        alert(`Failed to add students to class: ${error.message}`);
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
    const studentInfo = studentInfoOverlay;
    const scannerOverlay = getOverlay('scannerOverlay');

    if (readyPopupOverlay) hideOverlay(readyPopupOverlay);
    if (manageOverlay) hideOverlay(manageOverlay);
    if (studentInfo) hideOverlay(studentInfo);
    // Scanner has its own close function
    document.body.style.overflow = '';
}

// Export closeAllClassOverlays for main file
export { closeAllClassOverlays };
