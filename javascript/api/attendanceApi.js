/**
 * Attendance API Module
 * 
 * Handles all attendance-related API calls to the server.
 * Pure functions that return promises.
 */

import { SERVER_BASE_URL, ENDPOINTS, getTeacherEmail } from '../config/api.js';
import { serializeTimestamp } from '../utils/helpers.js';
import { logError } from '../utils/helpers.js';

/**
 * Mark attendance for a student
 * @param {number} classId - Class ID
 * @param {string} studentId - Student ID
 * @returns {Promise<Object>} Response data
 */
export async function markAttendance(classId, studentId) {
    const url = SERVER_BASE_URL + ENDPOINTS.attendance;
    const primaryPayload = { class_id: classId, student_id: studentId };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(primaryPayload)
    });
    if (res.ok) return res.json();

    const fallbackPayload = { class_id: classId, faculty_number: String(studentId) };
    const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackPayload)
    });
    if (fallbackRes.ok) return fallbackRes.json();

    throw new Error('Attendance mark failed');
}

/**
 * Fetch class attendance summary
 * @param {number} classId - Class ID
 * @returns {Promise<{attendances: Array}|{items: Array}>} Attendance data
 */
export async function fetchClassAttendance(classId) {
    const res = await fetch(SERVER_BASE_URL + ENDPOINTS.classAttendanceSummary(classId), {
        headers: { 'Accept': 'application/json' }
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
        headers: { 'Accept': 'application/json' }
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
        { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error('Attendance history fetch failed');
    return res.json();
}

/**
 * Save attendance data for multiple students
 * @param {number} classId - Class ID
 * @param {Array<number>} studentIds - Array of student IDs
 * @returns {Promise<Response>} Fetch response
 */
export async function saveAttendanceData(classId, studentIds) {
    const response = await fetch(SERVER_BASE_URL + ENDPOINTS.attendance, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            class_id: classId,
            student_ids: studentIds
        })
    });

    if (response.ok) {
    } else {
        console.error('[saveAttendanceData] Failed to save attendance data. Status:', response.status);
    }

    return response;
}

/**
 * Save student timestamps to database (single student)
 * @param {number} classId - Class ID
 * @param {string} facultyNumber - Faculty number
 * @param {number|null} joinedAt - Join timestamp (ms)
 * @param {number|null} leftAt - Leave timestamp (ms)
 * @returns {Promise<Response>} Fetch response
 * @throws {Error} If the request fails with a non-OK status
 */
export async function saveStudentTimestamp(classId, facultyNumber, joinedAt, leftAt) {
    // Serialize timestamps to ISO strings (undefined if null, which allows field omission)
    const joinedAtSerialized = serializeTimestamp(joinedAt);
    const leftAtSerialized = serializeTimestamp(leftAt);
    
    // Build payload, omitting null/undefined fields
    const payload = {
        class_id: classId,
        faculty_number: facultyNumber
    };
    
    // Only include timestamp fields if they have valid values
    if (joinedAtSerialized !== undefined) {
        payload.joined_at = joinedAtSerialized;
    }
    if (leftAtSerialized !== undefined) {
        payload.left_at = leftAtSerialized;
    }
    
    const response = await fetch(SERVER_BASE_URL + ENDPOINTS.saveStudentTimestamps, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    // Check response status and throw with context if failed
    if (!response.ok) {
        let errorBody = null;
        try {
            errorBody = await response.text();
        } catch (e) {
            // Ignore parse errors for error body
        }
        
        const error = new Error(`Failed to save student timestamp: ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.responseBody = errorBody;
        error.payload = payload;
        throw error;
    }
    
    return response;
}

/**
 * Save multiple student timestamps to database
 * @param {number} classId - Class ID
 * @param {Map<string, {joined_at: number|null, left_at: number|null}>} timestampsMap - Map of faculty_number to timestamp objects
 * @returns {Promise<{success: number, failed: number, errors: Array}>} Summary of save results
 */
export async function saveStudentTimestamps(classId, timestampsMap) {
    const module = 'ATTENDANCE_API';
    const functionName = 'saveStudentTimestamps';
    const endpoint = ENDPOINTS.saveStudentTimestamps;
    
    
    if (!timestampsMap || timestampsMap.size === 0) {
        return { success: 0, failed: 0, errors: [] };
    }
    
    const results = [];
    const errors = [];
    
    // Process each student timestamp
    for (const [facultyNumber, timestamp] of timestampsMap.entries()) {
        const joinedAt = timestamp?.joined_at ?? null;
        const leftAt = timestamp?.left_at ?? null;
        
        // Skip records where both timestamps are null (no attendance data to save)
        if (joinedAt === null && leftAt === null) {
            continue;
        }
        
        try {
            await saveStudentTimestamp(classId, facultyNumber, joinedAt, leftAt);
            results.push({ facultyNumber, status: 'success' });
        } catch (error) {
            const errorContext = {
                module,
                function: functionName,
                action: 'saveStudentTimestamp',
                endpoint,
                studentId: facultyNumber,
                classId,
                status: error.status || 'unknown',
                payloadSummary: {
                    class_id: classId,
                    faculty_number: facultyNumber,
                    has_joined_at: joinedAt !== null,
                    has_left_at: leftAt !== null
                },
                errorMessage: error.message,
                stack: error.stack,
                serverResponseBody: error.responseBody || null
            };
            
            logError(`${module}/${functionName}`, error, errorContext);
            errors.push({ facultyNumber, error, context: errorContext });
            results.push({ facultyNumber, status: 'failed', error });
        }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = errors.length;
    
    
    if (failedCount > 0) {
        console.error(`[${module}] Failed to save timestamps for ${failedCount} student(s):`, errors.map(e => e.facultyNumber));
    }
    
    return {
        success: successCount,
        failed: failedCount,
        errors: errors.map(e => ({
            facultyNumber: e.facultyNumber,
            message: e.error.message,
            status: e.error.status
        }))
    };
}

/**
 * Update completed classes count
 * @param {number} classId - Class ID
 * @returns {Promise<Response>} Fetch response
 */
export async function updateCompletedClassesCount(classId) {
    if (classId === null || classId === undefined || String(classId).trim() === '') {
        throw new Error('Missing classId for updateCompletedClassesCount');
    }

    const teacherEmail = getTeacherEmail();
    const endpointBase = SERVER_BASE_URL + ENDPOINTS.updateCompletedClassesCount;
    const classIdQuery = `class_id=${encodeURIComponent(classId)}`;
    const encodedTeacherEmail = teacherEmail ? encodeURIComponent(teacherEmail) : '';

    const attempts = [
        {
            url: `${endpointBase}?${classIdQuery}`,
            body: { class_id: classId }
        },
        {
            url: `${endpointBase}?${classIdQuery}`,
            body: { classId: classId }
        },
        {
            url: `${endpointBase}?${classIdQuery}`,
            body: { class_id: classId, teacherEmail: teacherEmail || undefined }
        },
        {
            url: `${endpointBase}?${classIdQuery}`,
            body: { classId: classId, teacher_email: teacherEmail || undefined }
        },
        {
            url: `${endpointBase}?${classIdQuery}`,
            body: null
        },
        {
            url: teacherEmail ? `${endpointBase}/${encodedTeacherEmail}?${classIdQuery}` : `${endpointBase}?${classIdQuery}`,
            body: { class_id: classId }
        }
    ];

    const errors = [];

    for (const attempt of attempts) {
        try {
            const response = await fetch(attempt.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: attempt.body ? JSON.stringify(attempt.body) : undefined
            });

            if (response.ok) {
                return response;
            }

            let bodyText = '';
            try {
                bodyText = await response.text();
            } catch (_) {}
            errors.push(`${response.status} ${response.statusText} (${attempt.url}) ${bodyText}`.trim());
        } catch (e) {
            errors.push(`NETWORK_ERROR (${attempt.url}): ${e.message}`);
        }
    }

    throw new Error(`Failed to update completed classes count. Tried: ${errors.join(' | ')}`);
}
