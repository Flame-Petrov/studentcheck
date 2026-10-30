/**
 * Attendance API Module
 * 
 * Handles all attendance-related API calls to the server.
 * Pure functions that return promises.
 */

import { SERVER_BASE_URL, ENDPOINTS } from '../config/api.js';
import { serializeTimestamp } from '../utils/helpers.js';
import { authHeaders } from './authFetch.js';

/**
 * Fetch class attendance summary
 * @param {number} classId - Class ID
 * @returns {Promise<{attendances: Array}|{items: Array}>} Attendance data
 */
export async function fetchClassAttendance(classId) {
    const res = await fetch(SERVER_BASE_URL + ENDPOINTS.classAttendanceSummary(classId), {
        headers: authHeaders({ 'Accept': 'application/json' })
    });
    if (!res.ok) throw new Error('Attendance summary fetch failed');
    return res.json();
}

/**
 * Fetch attendance timestamps for a class
 * @param {number} classId - Class ID
 * @returns {Promise<{timestamps: Array}>} Attendance timestamps data
 */
export async function fetchClassAttendanceTimestamps(classId) {
    const res = await fetch(SERVER_BASE_URL + ENDPOINTS.attendanceTimestamps(classId), {
        headers: authHeaders({ 'Accept': 'application/json' })
    });
    if (!res.ok) throw new Error('Attendance timestamps fetch failed');
    return res.json();
}

/**
 * Fetch attendance history for a student in a class
 * @param {number} classId - Class ID
 * @param {Object} options - Student identifiers
 * @param {string|number} [options.studentId] - Student ID
 * @param {string|number} [options.facultyNumber] - Faculty number
 * @returns {Promise<Object>} Attendance history data
 */
export async function fetchStudentAttendanceHistory(classId, { studentId, facultyNumber } = {}) {
    const res = await fetch(
        SERVER_BASE_URL + ENDPOINTS.attendanceHistory(classId, studentId, facultyNumber),
        { headers: authHeaders({ 'Accept': 'application/json' }) }
    );
    if (!res.ok) throw new Error('Attendance history fetch failed');
    return res.json();
}

/**
 * Save attendance session in a single request (attendance + timestamps).
 * Backend should persist records transactionally.
 * @param {number} classId - Class ID
 * @param {Array<Object>} records - Session records
 * @param {Object} [options] - Optional metadata
 * @param {string} [options.className] - Class name
 * @returns {Promise<{ok:boolean,status:number,data:any}>} Result object
 */
export async function saveAttendanceSession(classId, records, { className, sessionId } = {}) {
    const payload = {
        class_id: classId,
        class_name: String(className || '').trim() || undefined,
        session_id: sessionId || undefined,
        records: Array.isArray(records)
            ? records.map((record) => {
                const joinedAt = serializeTimestamp(record?.joined_at ?? null);
                const leftAt = serializeTimestamp(record?.left_at ?? null);
                const normalized = {
                    student_id: record?.student_id !== null && record?.student_id !== undefined
                        ? String(record.student_id).trim() || undefined
                        : undefined,
                    faculty_number: record?.faculty_number !== null && record?.faculty_number !== undefined
                        ? String(record.faculty_number).trim() || undefined
                        : undefined,
                    status: record?.status ? String(record.status) : undefined
                };
                if (joinedAt !== undefined) normalized.joined_at = joinedAt;
                if (leftAt !== undefined) normalized.left_at = leftAt;
                return normalized;
            }).filter((record) => record.student_id || record.faculty_number)
            : []
    };

    const response = await fetch(SERVER_BASE_URL + ENDPOINTS.finishAttendanceSession, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
    });

    let bodyText = '';
    let data = null;
    try {
        bodyText = await response.text();
        data = bodyText ? JSON.parse(bodyText) : null;
    } catch (_) {
        data = bodyText || null;
    }

    if (!response.ok) {
        const error = new Error(`Attendance session save failed: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.responseBody = bodyText || null;
        error.payload = payload;
        throw error;
    }

    return {
        ok: true,
        status: response.status,
        data
    };
}
