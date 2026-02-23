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
import { loadClassStudentsFromStorage, getStudentInfoForFacultyNumber } from '../storage/studentStorage.js';
import { fetchClassAttendance, saveStudentTimestamps, updateCompletedClassesCount, saveAttendanceData } from '../api/attendanceApi.js';
import { updateAttendanceDot } from '../ui/attendanceUI.js';
import { getActiveClassName, logError } from '../utils/helpers.js';
import { openConfirmOverlay, getOverlay, hideOverlay } from '../ui/overlays.js';
import { closeScanner } from './scanner.js';

const recentScanTimestamps = new Map();
const SCAN_DEBOUNCE_MS = 1500;

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
            const facultyNumber = (student.faculty_number || '').trim();
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

    students.forEach(student => {
        if (!map.has(student.faculty_number)) {
            map.set(student.faculty_number, 'none');
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
    // Parse JSON payload from student QR (expects facultyNumber, name, email)
    let payload = null;
    try {
        payload = JSON.parse(data);
    } catch (_) {
        console.error('[handleScannedCode] Failed to parse JSON from scanned data');
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
            if (result?.changed) {
                const storedStudents = loadClassStudentsFromStorage(activeClass) || [];
                const info = getStudentInfoForFacultyNumber(studentFacultyNumber, storedStudents);
                const name = info?.full_name || info?.fullName || info?.name || studentFacultyNumber;
                const tone = mode === 'leaving' ? 'error' : 'success';
                showScanToast(name, tone);
            }
        }
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

/**
 * Open confirmation dialog for closing scanner
 * @param {string} className - Class name
 * @param {Function} onClosed - Callback when scanner is closed
 */
export async function openCloseScannerConfirm(className, onClosed) {
    openConfirmOverlay(
        i18nText('scanner_finish_message', 'Attendance data will be saved.'),
        async () => {
            try {
                const classId = getClassIdByName(className);
                
                if (!classId) {
                    logError('closeScannerConfirm', new Error('Missing class ID'), { className });
                    // Still attempt to close scanner even without classId
                } else {
                    // Persist completed attendance in bulk
                    try {
                        const attendanceMap = getAttendanceState(className);
                        const storedStudents = loadClassStudentsFromStorage(className) || [];
                        const completedIds = [];
                        if (attendanceMap) {
                            attendanceMap.forEach((status, facultyNumber) => {
                                if (status !== 'completed') return;
                                const info = getStudentInfoForFacultyNumber(facultyNumber, storedStudents);
                                const apiStudentId = info?.id || info?.student_id || info?.faculty_number || info?.facultyNumber || facultyNumber;
                                completedIds.push(apiStudentId);
                            });
                        }
                        if (completedIds.length > 0) {
                            await saveAttendanceData(classId, completedIds);
                        }
                    } catch (e) {
                        logError('closeScannerConfirm', e, { className, classId, action: 'saveAttendanceData' });
                    }

                    // Safely get timestamps (may be empty map, which is fine)
                    const timestamps = getStudentTimestamps();
                    if (timestamps && timestamps.size > 0) {
                        try {
                            const result = await saveStudentTimestamps(classId, timestamps);
                            if (result.failed > 0) {
                                logError('closeScannerConfirm', new Error(`Failed to save timestamps for ${result.failed} student(s)`), {
                                    className,
                                    classId,
                                    action: 'saveStudentTimestamps',
                                    result
                                });
                            }
                        } catch (e) {
                            logError('closeScannerConfirm', e, { className, classId, action: 'saveStudentTimestamps' });
                            // Continue with cleanup even if save fails
                        }
                    }

                    try {
                        await updateCompletedClassesCount(classId);
                    } catch (e) {
                        logError('closeScannerConfirm', e, { className, classId, action: 'updateCompletedClassesCount' });
                        // Continue with cleanup
                    }

                }

                // Always clear state and close overlays, even if saves failed
                clearAttendanceState(className);
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
        clearAttendanceState(className);
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
        i18nText('scanner_close_message', 'Closing the scanner will discard attendance data.'),
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
