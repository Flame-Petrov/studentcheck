/**
 * Attendance Feature Module
 * 
 * Handles attendance state management and tracking logic.
 * Manages attendance state transitions and student validation.
 */

import {
    ensureAttendanceState,
    getAttendanceState,
    getClassIdByName,
    getAttendanceCountCache,
    setAttendanceCountCache,
    getStudentTimestamp,
    setStudentTimestamp,
    getStudentTimestamps,
    getCurrentClass,
    clearAttendanceState,
    clearStudentTimestamps,
    getAttendanceDotIndex
} from '../state/appState.js';
import { loadClassStudentsFromStorage, getStudentInfoForFacultyNumber, resolveStudentFacultyNumber } from '../storage/studentStorage.js';
import { fetchClassAttendance, saveStudentTimestamps, updateCompletedClassesCount, saveAttendanceData, saveAttendanceSession } from '../api/attendanceApi.js';
import { updateAttendanceDot } from '../ui/attendanceUI.js';
import { getActiveClassName, logError } from '../utils/helpers.js';
import { openConfirmOverlay, getOverlay, hideOverlay } from '../ui/overlays.js';
import { closeScanner } from './scanner.js';

const recentScanTimestamps = new Map();
// True while a Finish is saving: blocks a second Finish (double-counted class)
// and ignores scans that would be wiped when the session is cleared.
let attendanceSaveInProgress = false;
const SCAN_DEBOUNCE_MS = 1500;
const SCANNER_DRAFT_KEY_PREFIX = 'scanner:draft:';
const SCANNER_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h safety window

function i18nText(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

function showScanToast(message, tone) {
    const existing = document.querySelector('.toast-bubble');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast-bubble toast-${tone} toast-large`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 450);
    }, 2200);
}

function showInvalidQrToast() {
    showScanToast(i18nText('err_invalid_qr', 'Invalid QR code.'), 'error');
}

function scannerDraftKey(className) {
    return `${SCANNER_DRAFT_KEY_PREFIX}${String(className || '').trim()}`;
}

function isDraftFresh(savedAt) {
    return Number.isFinite(savedAt) && (Date.now() - savedAt) <= SCANNER_DRAFT_MAX_AGE_MS;
}

function normalizeDraftAttendanceEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const normalized = [];
    entries.forEach((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return;
        const studentId = String(entry[0] || '').trim();
        const status = entry[1];
        if (!studentId) return;
        if (status !== 'joined' && status !== 'completed') return;
        normalized.push([studentId, status]);
    });
    return normalized;
}

function normalizeDraftTimestampEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const normalized = [];
    entries.forEach((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return;
        const facultyNumber = String(entry[0] || '').trim();
        const ts = entry[1];
        if (!facultyNumber || !ts || typeof ts !== 'object') return;
        const joinedAt = Number.isFinite(ts.joined_at) ? ts.joined_at : null;
        const leftAt = Number.isFinite(ts.left_at) ? ts.left_at : null;
        if (joinedAt === null && leftAt === null) return;
        normalized.push([facultyNumber, { joined_at: joinedAt, left_at: leftAt }]);
    });
    return normalized;
}

export function saveScannerDraftForClass(className) {
    const key = scannerDraftKey(className);
    if (!String(className || '').trim()) return false;
    try {
        const classLabel = String(className);
        const attendanceMap = getAttendanceState(className) || new Map();
        const timestampsMap = getStudentTimestamps() || new Map();
        const attendance = normalizeDraftAttendanceEntries(Array.from(attendanceMap.entries()));
        const timestamps = normalizeDraftTimestampEntries(Array.from(timestampsMap.entries()));
        if (attendance.length === 0 && timestamps.length === 0) {
            if (localStorage.getItem(key) !== null) {
                localStorage.removeItem(key);
                document.dispatchEvent(new CustomEvent('scannerDraftChanged', { detail: { className: classLabel } }));
            }
            return false;
        }
        const payload = {
            className: classLabel,
            savedAt: Date.now(),
            attendance,
            timestamps
        };
        localStorage.setItem(key, JSON.stringify(payload));
        document.dispatchEvent(new CustomEvent('scannerDraftChanged', { detail: { className: classLabel } }));
        return true;
    } catch (_) {
        return false;
    }
}

export function restoreScannerDraftForClass(className) {
    const key = scannerDraftKey(className);
    if (!String(className || '').trim()) return false;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const savedAt = Number(parsed?.savedAt || 0);
        if (!isDraftFresh(savedAt)) {
            clearScannerDraftForClass(className);
            return false;
        }
        const attendanceEntries = normalizeDraftAttendanceEntries(parsed?.attendance);
        const timestampEntries = normalizeDraftTimestampEntries(parsed?.timestamps);
        if (attendanceEntries.length === 0 && timestampEntries.length === 0) {
            clearScannerDraftForClass(className);
            return false;
        }

        const attendanceMap = ensureAttendanceState(className);
        attendanceEntries.forEach(([studentId, status]) => {
            attendanceMap.set(String(studentId), status);
            updateAttendanceDot(String(studentId), status);
        });

        timestampEntries.forEach(([facultyNumber, ts]) => {
            setStudentTimestamp(String(facultyNumber), ts.joined_at, ts.left_at);
        });
        return attendanceEntries.length > 0 || timestampEntries.length > 0;
    } catch (_) {
        return false;
    }
}

export function clearScannerDraftForClass(className) {
    if (!String(className || '').trim()) return;
    try {
        localStorage.removeItem(scannerDraftKey(className));
        document.dispatchEvent(new CustomEvent('scannerDraftChanged', { detail: { className: String(className) } }));
    } catch (_) {}
}

export function hasScannerDraftForClass(className) {
    const key = scannerDraftKey(className);
    if (!String(className || '').trim()) return false;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const savedAt = Number(parsed?.savedAt || 0);
        if (!isDraftFresh(savedAt)) {
            clearScannerDraftForClass(className);
            return false;
        }
        const attendanceEntries = normalizeDraftAttendanceEntries(parsed?.attendance);
        const timestampEntries = normalizeDraftTimestampEntries(parsed?.timestamps);
        const hasDraft = attendanceEntries.length > 0 || timestampEntries.length > 0;
        if (!hasDraft) {
            clearScannerDraftForClass(className);
        }
        return hasDraft;
    } catch (_) {
        return false;
    }
}

/**
 * Check if a student is in a class
 * @param {string} className - Class name
 * @param {string} studentFacultyNumber - Student faculty number
 * @returns {boolean} True if student is in class
 */
export function isStudentInClass(className, studentFacultyNumber) {
    if (!className || !studentFacultyNumber) return false;

    const stored = loadClassStudentsFromStorage(className);

    if (stored && stored.length > 0) {
        const found = stored.some(student => {
            const facultyNumber = String(resolveStudentFacultyNumber(student) || '').trim();
            return facultyNumber && facultyNumber === String(studentFacultyNumber).trim();
        });

        if (found) return true;
    }

    // Fallback: check assignments set (would need to import from state)
    // This is handled in the main file for now
    return false;
}

/**
 * Initialize attendance state for a class
 * @param {string} className - Class name
 * @param {Array<Object>} students - Array of student objects
 * @returns {Map} Attendance state map
 */
export function initAttendanceStateForClass(className, students) {
    const map = ensureAttendanceState(className);

    (students || []).forEach(student => {
        const facultyNumber = String(resolveStudentFacultyNumber(student) || '').trim();
        if (facultyNumber && !map.has(facultyNumber)) {
            map.set(facultyNumber, 'none');
        }
    });

    return map;
}

/**
 * Derive student ID from QR code payload
 * @param {Object} payload - Parsed QR code payload
 * @returns {string|null} Student faculty number or null
 */
export function deriveStudentIdFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const id = payload.facultyNumber || payload.faculty_number || payload.email || null;
    return id || null;
}

/**
 * Update attendance state for a student
 * @param {string} className - Class name
 * @param {string} studentFacultyNumber - Student faculty number
 * @param {'joining'|'leaving'} mode - Scan mode
 * @param {Function} updateStudentInfoCountFn - Callback to update student info count
 */
export function updateAttendanceState(className, studentFacultyNumber, mode, updateStudentInfoCountFn) {
    if (!className || !studentFacultyNumber) return;

    // Guard: ignore scans for students not assigned to the class
    if (!isStudentInClass(className, studentFacultyNumber)) {
        return;
    }

    const map = ensureAttendanceState(className);
    const current = map.get(studentFacultyNumber) || 'none';
    let next = current;

    if (mode === 'joining') {
        if (current === 'none') {
            next = 'joined';
            setStudentTimestamp(studentFacultyNumber, Date.now(), null);
        }
    } else if (mode === 'leaving') {
        if (current === 'joined') {
            next = 'completed';
            const timestamp = getStudentTimestamp(studentFacultyNumber);
            const joinedAt = timestamp ? timestamp.joined_at : null;
            setStudentTimestamp(studentFacultyNumber, joinedAt, Date.now());
        } else if (current !== 'completed') {
            console.warn('[Attendance] Leaving scan ignored: student not joined yet', {
                className,
                studentFacultyNumber,
                current
            });
        }
    }

    let changed = false;
    if (next !== current) {
        map.set(studentFacultyNumber, next);
        // Update UI dot
        updateAttendanceDot(studentFacultyNumber, next);
        changed = true;

        // When completing a session, only update local state; server update happens on scanner close.
    }
    return { changed, next };
}

/**
 * Handle scanned QR code
 * @param {string} data - Scanned QR code data (JSON string)
 * @param {'joining'|'leaving'} mode - Scan mode
 * @param {string} className - Class name
 * @param {Function} updateStudentInfoCountFn - Callback to update student info count
 */
export function handleScannedCode(data, mode, className, updateStudentInfoCountFn) {
    if (attendanceSaveInProgress) return;
    // Parse JSON payload from student QR (expects facultyNumber, name, email)
    let payload = null;
    try {
        payload = JSON.parse(data);
    } catch (_) {
        console.error('[handleScannedCode] Failed to parse JSON from scanned data');
        showInvalidQrToast();
        return;
    }

    const studentFacultyNumber = deriveStudentIdFromPayload(payload);

    if (studentFacultyNumber) {
        // Resolve active class (fallback if className missing)
        const activeClass = (className || getActiveClassName()).trim();

        if (!activeClass) {
            // Ignoring scan – no active class context
            return;
        } else if (!isStudentInClass(activeClass, studentFacultyNumber)) {
            // Ignoring scan for unassigned student
            return;
        } else {
            const scanKey = `${activeClass}|${studentFacultyNumber}|${mode}`;
            const now = Date.now();
            const lastSeenAt = recentScanTimestamps.get(scanKey) || 0;
            if (now - lastSeenAt < SCAN_DEBOUNCE_MS) {
                return;
            }
            recentScanTimestamps.set(scanKey, now);

            const result = updateAttendanceState(activeClass, studentFacultyNumber, mode, updateStudentInfoCountFn);
            saveScannerDraftForClass(activeClass);
            if (result?.changed) {
                const storedStudents = loadClassStudentsFromStorage(activeClass) || [];
                const info = getStudentInfoForFacultyNumber(studentFacultyNumber, storedStudents);
                const name = info?.full_name || info?.fullName || info?.name || studentFacultyNumber;
                const tone = mode === 'leaving' ? 'error' : 'success';
                showScanToast(name, tone);
            }
        }
    } else {
        showInvalidQrToast();
    }

    // For UX feedback, briefly flash camera border
    const cam = document.getElementById('cameraContainer');
    if (cam) {
        cam.style.boxShadow = '0 0 0 4px rgba(37,99,235,0.25) inset';
        setTimeout(() => { cam.style.boxShadow = 'none'; }, 180);
    }
}

/**
 * Get student attendance count for a class (async, uses cache)
 * @param {string} className - Class name
 * @param {string} studentId - Student ID
 * @param {Function} updateCountFn - Callback to update count display
 * @returns {number} Current count (0 if not cached yet)
 */
export function getStudentAttendanceCountForClass(className, studentId, updateCountFn) {
    const classId = getClassIdByName(className);
    if (!classId) return 0;
    const cache = getAttendanceCountCache(classId);
    if (cache && cache.has(studentId)) return cache.get(studentId);
    
    // Fetch from API and update cache
    fetchClassAttendance(classId).then(data => {
        const map = new Map();
        const list = data.attendances || data.items || [];
        list.forEach(r => {
            if (r.student_id) {
                map.set(String(r.student_id), Number(r.count || r.attendance_count || 0));
            }
        });
        setAttendanceCountCache(classId, map);
        if (updateCountFn) {
            updateCountFn(studentId, className, map.get(String(studentId)) || 0);
        }
    }).catch(() => {});
    
    return 0;
}

function shouldFallbackToLegacyAttendanceSave(error) {
    const status = Number(error?.status || 0);
    return status === 404 || status === 405 || status === 501;
}

function buildAttendanceSessionRecords(attendanceMap, timestamps, storedStudents) {
    const keys = new Set();
    if (attendanceMap && typeof attendanceMap.forEach === 'function') {
        attendanceMap.forEach((_, facultyNumber) => {
            const key = String(facultyNumber || '').trim();
            if (key) keys.add(key);
        });
    }
    if (timestamps && typeof timestamps.forEach === 'function') {
        timestamps.forEach((_, facultyNumber) => {
            const key = String(facultyNumber || '').trim();
            if (key) keys.add(key);
        });
    }

    const records = [];
    keys.forEach((facultyNumber) => {
        const status = attendanceMap?.get(facultyNumber) || 'none';
        const ts = timestamps?.get(facultyNumber) || null;
        const joinedAt = Number.isFinite(ts?.joined_at) ? ts.joined_at : null;
        const leftAt = Number.isFinite(ts?.left_at) ? ts.left_at : null;
        if (status === 'none' && joinedAt === null && leftAt === null) return;

        const info = getStudentInfoForFacultyNumber(facultyNumber, storedStudents);
        const studentIdRaw = info?.id ?? info?.student_id ?? null;
        const studentId = studentIdRaw !== null && studentIdRaw !== undefined
            ? String(studentIdRaw).trim() || null
            : null;

        records.push({
            student_id: studentId,
            faculty_number: facultyNumber,
            status,
            joined_at: joinedAt,
            left_at: leftAt
        });
    });

    return records;
}

/**
 * Open confirmation dialog for closing scanner
 * @param {string} className - Class name
 * @param {Function} onClosed - Callback when scanner is closed
 */
export async function openCloseScannerConfirm(className, onClosed) {
    openConfirmOverlay(
        i18nText('scanner_finish_message', 'Attendance data will be saved.'),
        async () => {
            if (attendanceSaveInProgress) return;
            attendanceSaveInProgress = true;
            try {
                let saveFailed = false;
                const classId = getClassIdByName(className);
                
                if (!classId) {
                    saveFailed = true;
                    logError('closeScannerConfirm', new Error('Missing class ID'), { className });
                } else {
                    const attendanceMap = getAttendanceState(className) || new Map();
                    const storedStudents = loadClassStudentsFromStorage(className) || [];
                    const timestamps = getStudentTimestamps() || new Map();
                    const sessionRecords = buildAttendanceSessionRecords(attendanceMap, timestamps, storedStudents);

                    let persistedTransactionally = false;
                    try {
                        const sessionResult = await saveAttendanceSession(classId, sessionRecords, { className });
                        persistedTransactionally = true;
                    } catch (e) {
                        const fallbackToLegacy = shouldFallbackToLegacyAttendanceSave(e);
                        logError('closeScannerConfirm', e, {
                            className,
                            classId,
                            action: 'saveAttendanceSession',
                            records: sessionRecords.length,
                            fallbackToLegacy
                        });
                        if (!fallbackToLegacy) {
                            saveFailed = true;
                        } else {
                            console.warn('[closeScannerConfirm] saveAttendanceSession unavailable, falling back to legacy endpoints.', {
                                className: String(className || '').trim(),
                                classId,
                                status: e?.status ?? null
                            });
                        }
                    }

                    if (!saveFailed && !persistedTransactionally) {
                        // Legacy fallback for environments where /attendance/finish is not deployed yet.
                        try {
                            const completedIds = [];
                            attendanceMap.forEach((status, facultyNumber) => {
                                if (status !== 'completed') return;
                                const info = getStudentInfoForFacultyNumber(facultyNumber, storedStudents);
                                const apiStudentId = info?.id || info?.student_id || info?.faculty_number || info?.facultyNumber || facultyNumber;
                                completedIds.push(apiStudentId);
                            });
                            if (completedIds.length > 0) {
                                const response = await saveAttendanceData(classId, completedIds);
                                if (!response?.ok) {
                                    saveFailed = true;
                                    logError(
                                        'closeScannerConfirm',
                                        new Error(`Attendance save failed with status ${response?.status ?? 'unknown'}`),
                                        { className, classId, action: 'saveAttendanceData', completedIds: completedIds.length }
                                    );
                                }
                            }
                        } catch (e) {
                            saveFailed = true;
                            logError('closeScannerConfirm', e, { className, classId, action: 'saveAttendanceData' });
                        }

                        if (!saveFailed && timestamps && timestamps.size > 0) {
                            try {
                                const result = await saveStudentTimestamps(classId, timestamps);
                                if (result.failed > 0) {
                                    saveFailed = true;
                                    logError('closeScannerConfirm', new Error(`Failed to save timestamps for ${result.failed} student(s)`), {
                                        className,
                                        classId,
                                        action: 'saveStudentTimestamps',
                                        result
                                    });
                                }
                            } catch (e) {
                                saveFailed = true;
                                logError('closeScannerConfirm', e, { className, classId, action: 'saveStudentTimestamps' });
                            }
                        }
                    }

                    if (!saveFailed) {
                        try {
                            await updateCompletedClassesCount(classId);
                        } catch (e) {
                            logError('closeScannerConfirm', e, { className, classId, action: 'updateCompletedClassesCount' });
                            // Continue with cleanup
                        }
                    }

                }

                if (saveFailed) {
                    // Keep draft + in-memory state so the teacher can retry when network/server is stable.
                    saveScannerDraftForClass(className);
                    showScanToast(
                        i18nText(
                            'scanner_save_failed_keep_draft',
                            'Could not save attendance. Session was kept on this device. Please retry Finish.'
                        ),
                        'error'
                    );
                    return;
                }

                // Save completed successfully, now clear local state and close scanner.
                showScanToast(
                    i18nText('scanner_save_success', 'Attendance saved successfully.'),
                    'success'
                );
                clearAttendanceState(className);
                clearScannerDraftForClass(className);
                const attendanceOverlay = getOverlay('attendanceOverlay');
                if (attendanceOverlay && isOverlayVisible(attendanceOverlay)) {
                    hideOverlay(attendanceOverlay, false);
                }

                // Close scanner with guaranteed cleanup
                try {
                    await closeScanner(() => {
                        clearStudentTimestamps();
                        if (onClosed) {
                            try {
                                onClosed();
                            } catch (e) {
                                logError('closeScannerConfirm', e, { className, action: 'onClosed callback' });
                            }
                        }
                    });
                } catch (e) {
                    logError('closeScannerConfirm', e, { className, action: 'closeScanner' });
                    // Ensure body scroll is restored even if scanner close fails
                    document.body.style.overflow = '';
                    // Still call onClosed if provided
                    if (onClosed) {
                        try {
                            onClosed();
                        } catch (callbackErr) {
                            logError('closeScannerConfirm', callbackErr, { className, action: 'onClosed callback (fallback)' });
                        }
                    }
                }
            } catch (e) {
                // Catch-all for any unexpected errors
                logError('closeScannerConfirm', e, { className, action: 'unexpected error' });
                // Ensure overlays close and state is restored
                document.body.style.overflow = '';
                if (onClosed) {
                    try {
                        onClosed();
                    } catch (callbackErr) {
                        logError('closeScannerConfirm', callbackErr, { className, action: 'onClosed callback (error handler)' });
                    }
                }
            } finally {
                attendanceSaveInProgress = false;
            }
        },
        () => { /* canceled */ },
        {
            okText: i18nText('finish_btn', 'Finish'),
            cancelText: i18nText('cancel_btn', 'Cancel'),
            okClass: 'confirm-accept',
            title: i18nText('scanner_finish_title', 'Finish class?')
        }
    );
}

export async function closeScannerDiscard(className, onClosed) {
    try {
        const resolvedClassName = String(className || '').trim();
        if (resolvedClassName) {
            clearAttendanceState(resolvedClassName);
            clearScannerDraftForClass(resolvedClassName);
        }
        clearStudentTimestamps();
        const attendanceOverlay = getOverlay('attendanceOverlay');
        if (attendanceOverlay && attendanceOverlay.style.visibility === 'visible') {
            hideOverlay(attendanceOverlay, false);
        }
        await closeScanner(() => {
            if (onClosed) {
                try { onClosed(); } catch (e) { logError('closeScannerDiscard', e, { className }); }
            }
        });
    } catch (e) {
        logError('closeScannerDiscard', e, { className, action: 'closeScanner' });
        document.body.style.overflow = '';
        if (onClosed) {
            try { onClosed(); } catch (callbackErr) { logError('closeScannerDiscard', callbackErr, { className, action: 'onClosed callback' }); }
        }
    }
}

export async function openDiscardScannerConfirm(className, onClosed) {
    openConfirmOverlay(
        i18nText(
            'scanner_close_message',
            'Closing the scanner will discard attendance data.'
        ),
        async () => {
            await closeScannerDiscard(className, onClosed);
        },
        null,
        {
            title: i18nText('scanner_close_title', 'Close Scanner'),
            okText: i18nText('confirm_btn', 'Confirm'),
            okClass: 'danger',
            cancelText: i18nText('cancel_btn', 'Cancel')
        }
    );
}

function isOverlayVisible(overlay) {
    return overlay && overlay.style.visibility === 'visible';
}
