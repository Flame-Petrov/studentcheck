/**
 * Attendance totals per class (GET /attendance/summary?class_id=...), cached
 * per account + class id with the shared stale-while-revalidate cache.
 *
 *   readAttendanceSummary(classId)   -> { data, at } | null  (cached, maybe stale)
 *   loadAttendanceSummary(classId)   -> Promise<{ data, current }> (shares in-flight requests)
 *   invalidateAttendanceSummary(id)     after saving attendance / changing the roster
 *
 * data = { byId: { [student_id]: count }, byFacultyNumber: { [fn]: count } }.
 * A student missing from both maps has no confirmed total (shown as
 * unavailable, never as 0).
 */

import { fetchClassAttendance } from '../api/attendanceApi.js';
import { cacheKey, teacherScope, readCache, isFresh, revalidate, invalidateCache } from './cache.js';

export const ATTENDANCE_SUMMARY_MAX_AGE_MS = 60 * 1000;

export function attendanceSummaryKey(classId) {
    return cacheKey(teacherScope(), 'attendance-summary', String(classId));
}

function normalizeSummary(payload) {
    const items = Array.isArray(payload?.items) ? payload.items
        : Array.isArray(payload?.attendance) ? payload.attendance
            : [];
    const byId = {};
    const byFacultyNumber = {};
    items.forEach((row) => {
        const raw = row?.attendance_count ?? row?.count;
        const count = Number(raw);
        if (raw === null || raw === undefined || !Number.isFinite(count)) return;
        const id = String(row?.student_id ?? '').trim();
        const fn = String(row?.faculty_number ?? row?.facultyNumber ?? '').trim();
        if (id) byId[id] = count;
        if (fn) byFacultyNumber[fn] = count;
    });
    return { byId, byFacultyNumber };
}

export function readAttendanceSummary(classId) {
    if (!classId) return null;
    return readCache(attendanceSummaryKey(classId));
}

export function isAttendanceSummaryFresh(classId) {
    return isFresh(readAttendanceSummary(classId), ATTENDANCE_SUMMARY_MAX_AGE_MS);
}

export function loadAttendanceSummary(classId) {
    return revalidate(attendanceSummaryKey(classId), async () => normalizeSummary(await fetchClassAttendance(classId)));
}

/**
 * Per-class attendance version, bumped whenever its attendance or roster
 * changes. Caches derived from attendance (e.g. a student's history) put it
 * in their key, so they can never serve data from before the change — also
 * after a reload (kept in sessionStorage, scoped to the account).
 */
function versionKey(classId) {
    return cacheKey(teacherScope(), 'attendance-version', String(classId));
}

export function attendanceVersion(classId) {
    if (!classId) return 0;
    try {
        return Number(sessionStorage.getItem(versionKey(classId))) || 0;
    } catch (_) {
        return 0;
    }
}

export function invalidateAttendanceSummary(classId) {
    if (!classId) return;
    invalidateCache(attendanceSummaryKey(classId));
    try {
        sessionStorage.setItem(versionKey(classId), String(attendanceVersion(classId) + 1));
    } catch (_) {}
}

/** Confirmed total for a student, or null when the summary has none. */
export function attendanceCountFor(summary, { id, facultyNumber } = {}) {
    if (!summary) return null;
    const byId = id ? summary.byId?.[String(id)] : undefined;
    if (byId !== undefined) return byId;
    const byFn = facultyNumber ? summary.byFacultyNumber?.[String(facultyNumber)] : undefined;
    return byFn !== undefined ? byFn : null;
}
