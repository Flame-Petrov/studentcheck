/**
 * Class API Module
 * 
 * Handles all class-related API calls to the server.
 * Pure functions that return promises.
 */

import { SERVER_BASE_URL, ENDPOINTS, getTeacherEmail } from '../config/api.js';
import { saveClassStudents, loadClassStudentsFromStorage } from '../storage/studentStorage.js';
import { authJsonFetch } from './authFetch.js';
import { clearAuthState, hasAuthHeaderToken } from '../auth/authStore.js';

let cachedFetchClassesRoute = null;
const FETCH_CLASSES_ROUTE_KEY = 'fetchClassesRouteKey';

const AUTH_401_ERRORS = new Set([
    'Missing bearer token',
    'Invalid bearer token format',
    'Invalid or expired token'
]);

function isAuthError(err) {
    const msg = String(err?.body?.error || err?.message || '').trim();
    return err?.status === 401 && AUTH_401_ERRORS.has(msg);
}

function isForbiddenClassOwnership(err) {
    const msg = String(err?.body?.error || err?.message || '').toLowerCase();
    return err?.status === 403 && msg.includes('does not belong to authenticated teacher');
}

function handleMutationApiError(endpoint, err) {
    console.warn('[API_AUTH_FAIL]', {
        endpoint,
        status: err?.status,
        error: err?.body?.error || err?.message,
        hadAuthHeader: Boolean(err?.hadAuthHeader ?? hasAuthHeaderToken())
    });

    if (isAuthError(err)) {
        clearAuthState();
        alert('Session expired. Please log in again.');
        window.location.href = 'teacherLogin.html';
        err.redirectingAuth = true;
        throw err;
    }

    if (isForbiddenClassOwnership(err)) {
        const forbidden = new Error("You don't have permission to modify this class.");
        forbidden.status = 403;
        forbidden.body = err?.body || {};
        throw forbidden;
    }

    throw err;
}

/**
 * Create a new class
 * @param {string} name - Class name
 * @param {Array<string>} studentIds - Array of student IDs
 * @param {string} teacherEmail - Teacher email
 * @returns {Promise<{class_id: number}>} Created class data
 */
export async function createClass(name, studentIds, teacherEmail) {
    try {
        return await authJsonFetch(SERVER_BASE_URL + ENDPOINTS.createClass, {
            method: 'POST',
            body: JSON.stringify({ name, students: studentIds, teacherEmail })
        });
    } catch (err) {
        handleMutationApiError('/classes', err);
    }
}

/**
 * Fetch all classes for a teacher
 * @param {string} teacherEmail - Teacher email
 * @returns {Promise<{classes: Array<{id: number, name: string}>}>} Classes data
 */
export async function fetchClasses(teacherEmail) {
    if (!teacherEmail) {
        throw new Error('Teacher email is required');
    }

    const encoded = encodeURIComponent(teacherEmail);
    const routeBuilders = {
        classes_query_teacherEmail: () => `${SERVER_BASE_URL + ENDPOINTS.createClass}?teacherEmail=${encoded}`,
        classes_query_teacher_email: () => `${SERVER_BASE_URL + ENDPOINTS.createClass}?teacher_email=${encoded}`,
        classes_path_email: () => `${SERVER_BASE_URL + ENDPOINTS.createClass}/${encoded}`,
        get_teacher_classes_teacherEmail: () => `${SERVER_BASE_URL}/get_teacher_classes?teacherEmail=${encoded}`,
        get_teacher_classes_teacher_email: () => `${SERVER_BASE_URL}/get_teacher_classes?teacher_email=${encoded}`,
        get_classes_by_teacher_teacherEmail: () => `${SERVER_BASE_URL}/get_classes_by_teacher?teacherEmail=${encoded}`,
        get_classes_by_teacher_teacher_email: () => `${SERVER_BASE_URL}/get_classes_by_teacher?teacher_email=${encoded}`
    };

    const routeOrder = [
        'get_teacher_classes_teacherEmail',
        'get_teacher_classes_teacher_email',
        'get_classes_by_teacher_teacherEmail',
        'get_classes_by_teacher_teacher_email',
        'classes_query_teacherEmail',
        'classes_query_teacher_email',
        'classes_path_email'
    ];

    const orderedRoutes = [];
    if (!cachedFetchClassesRoute) {
        try {
            const persisted = localStorage.getItem(FETCH_CLASSES_ROUTE_KEY);
            if (persisted && routeBuilders[persisted]) {
                cachedFetchClassesRoute = persisted;
            }
        } catch (_) {}
    }
    if (cachedFetchClassesRoute && routeBuilders[cachedFetchClassesRoute]) {
        orderedRoutes.push(cachedFetchClassesRoute);
    }
    routeOrder.forEach((key) => {
        if (!orderedRoutes.includes(key)) orderedRoutes.push(key);
    });

    const attempts = [];

    for (const routeKey of orderedRoutes) {
        const url = routeBuilders[routeKey]();
        try {
            const result = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!result.ok) {
                attempts.push(`${result.status} ${result.statusText} (${url})`);
                continue;
            }

            const data = await result.json();
            cachedFetchClassesRoute = routeKey;
            try {
                localStorage.setItem(FETCH_CLASSES_ROUTE_KEY, routeKey);
            } catch (_) {}
            // Normalize to { classes: [...] } for all callers
            if (Array.isArray(data)) return { classes: data };
            if (Array.isArray(data?.classes)) return { classes: data.classes };
            if (Array.isArray(data?.data)) return { classes: data.data };
            return { classes: [] };
        } catch (e) {
            attempts.push(`NETWORK_ERROR (${url}): ${e.message}`);
        }
    }

    throw new Error(`Failed to fetch classes. Tried routes: ${attempts.join(' | ')}`);
}

/**
 * Fetch students for a class
 * @param {number} classId - Class ID
 * @param {string} className - Class name (for storage)
 * @returns {Promise<Array<Object>>} Array of student objects
 */
export async function fetchClassStudents(classId, className, retryCount = 0) {
    // Validate classId
    if (!classId) {
        throw new Error('classId is required');
    }
    
    const numericClassId = Number(classId);
    if (isNaN(numericClassId)) {
        throw new Error(`Invalid classId: "${classId}" cannot be converted to a number`);
    }
    
    const result = await fetch(
        `${SERVER_BASE_URL + ENDPOINTS.class_students}?class_id=${encodeURIComponent(numericClassId)}`,
        {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }
    );

    if (result.ok) {
        let data;
        try {
            data = await result.json();
        } catch (e) {
            console.error('[fetchClassStudents] Failed to parse JSON response', {
                classId: numericClassId,
                className,
                error: e.message
            });
            // Return empty array if response is not valid JSON
            return [];
        }
        
        
        const students = data.students || data || [];
        
        // Ensure students is an array
        let studentsArray = Array.isArray(students) ? students : [];
        
        // WORKAROUND: If we just added students and got empty result, retry once after a delay
        // This handles cases where server inserts are still processing (server may not await inserts)
        if (studentsArray.length === 0 && retryCount === 0 && className) {
            const storedStudents = loadClassStudentsFromStorage(className);
            // If we have students in localStorage but server returned empty, server may still be processing
            if (storedStudents && storedStudents.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return fetchClassStudents(classId, className, 1); // Retry once
            }
        }
        
        // Save to localStorage
        if (className) {
            saveClassStudents(className, studentsArray);
        }
        
        return studentsArray;
    } else {
        let errorMessage = `HTTP ${result.status}`;
        try {
            const errorData = await result.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
            // Ignore parse errors
        }
        
        console.error('[fetchClassStudents] Failed to fetch class students', {
            status: result.status,
            statusText: result.statusText,
            errorMessage,
            classId: numericClassId,
            className
        });
        
        throw new Error(`Failed to fetch class students: ${errorMessage}`);
    }
}

/**
 * Add students to a class
 * @param {number} classId - Class ID
 * @param {Array<Object>} students - Array of student objects
 * @returns {Promise<Response>} Fetch response
 * @throws {Error} If the request fails
 */
export async function addStudentsToClass(classId, students) {
    // Validate inputs
    if (!classId || (typeof classId !== 'number' && typeof classId !== 'string')) {
        throw new Error('Invalid classId: must be a number or numeric string');
    }
    
    if (!Array.isArray(students) || students.length === 0) {
        throw new Error('Invalid students: must be a non-empty array');
    }
    
    // Ensure classId is a number
    const numericClassId = Number(classId);
    if (isNaN(numericClassId)) {
        throw new Error(`Invalid classId: "${classId}" cannot be converted to a number`);
    }
    
    // Validate students have faculty_number
    const validStudents = students.filter(s => s.faculty_number || s.facultyNumber);
    if (validStudents.length === 0) {
        throw new Error('Invalid students: no students with faculty_number found');
    }
    
    try {
        return await authJsonFetch(`${SERVER_BASE_URL + ENDPOINTS.class_students}`, {
            method: 'POST',
            body: JSON.stringify({
                classId: numericClassId,
                students: validStudents
            })
        });
    } catch (err) {
        handleMutationApiError('/class_students', err);
    }
}

/**
 * Remove a student from a class
 * @param {number} classId - Class ID
 * @param {string} facultyNumber - Student faculty number
 * @param {string} teacherEmail - Teacher email
 * @returns {Promise<{success: boolean}>} Response data
 */
export async function removeStudentFromClass(classId, facultyNumber, teacherEmail) {
    const requestBody = {
        class_id: classId,
        faculty_number: facultyNumber,
        teacherEmail: teacherEmail
    };

    try {
        return await authJsonFetch(`${SERVER_BASE_URL}/class_students/remove`, {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });
    } catch (err) {
        handleMutationApiError('/class_students/remove', err);
    }
}

/**
 * Rename a class by ID
 * @param {number} classId - Class ID
 * @param {string} newName - New class name
 * @param {string} teacherEmail - Teacher email
 * @returns {Promise<{success: boolean}>} Response data
 */
export async function renameClassById(classId, newName, teacherEmail) {
    if (!classId) {
        throw new Error('classId is required');
    }
    if (!newName) {
        throw new Error('newName is required');
    }
    if (!teacherEmail) {
        throw new Error('teacherEmail is required');
    }

    try {
        return await authJsonFetch(`${SERVER_BASE_URL + ENDPOINTS.updateClass}`, {
            method: 'PUT',
            body: JSON.stringify({
                classId: Number(classId),
                name: newName,
                teacherEmail
            })
        });
    } catch (err) {
        handleMutationApiError('/classes', err);
    }
}
/**
 * Delete a class by ID
 * @param {number} classId - Class ID
 * @param {string} teacherEmail - Teacher email
 * @returns {Promise<{success: boolean}>} Response data
 */
export async function deleteClassById(classId, teacherEmail) {
    if (!classId) {
        throw new Error('classId is required');
    }
    if (!teacherEmail) {
        throw new Error('teacherEmail is required');
    }

    try {
        return await authJsonFetch(`${SERVER_BASE_URL + ENDPOINTS.deleteClass}`, {
            method: 'DELETE',
            body: JSON.stringify({
                classId: Number(classId),
                teacherEmail
            })
        });
    } catch (err) {
        handleMutationApiError('/classes', err);
    }
}
