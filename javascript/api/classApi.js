/**
 * Class API Module
 * 
 * Handles all class-related API calls to the server.
 * Pure functions that return promises.
 */

import { SERVER_BASE_URL, ENDPOINTS, getTeacherEmail } from '../config/api.js';
import { saveClassesMap } from '../storage/classStorage.js';
import { saveClassStudents, loadClassStudentsFromStorage } from '../storage/studentStorage.js';

let cachedFetchClassesRoute = null;
const FETCH_CLASSES_ROUTE_KEY = 'fetchClassesRouteKey';

/**
 * Create a new class
 * @param {string} name - Class name
 * @param {Array<string>} studentIds - Array of student IDs
 * @param {string} teacherEmail - Teacher email
 * @returns {Promise<{class_id: number}>} Created class data
 */
export async function createClass(name, studentIds, teacherEmail) {
    const res = await fetch(SERVER_BASE_URL + ENDPOINTS.createClass, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, students: studentIds, teacherEmail })
    });
    if (!res.ok) throw new Error('Class create failed');
    return res.json();
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
    
    const response = await fetch(`${SERVER_BASE_URL + ENDPOINTS.class_students}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classId: numericClassId,
            students: validStudents
        })
    });

    // WORKAROUND: Server may return 200 even on errors, so check response body
    let responseData = null;
    try {
        responseData = await response.json();
    } catch (e) {
        // If response is not JSON, treat as error if status is not OK
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    }
    
    // Check if server returned an error message in the response body (even with 200 status)
    if (responseData && (responseData.error || responseData.message)) {
        const errorMsg = responseData.error || responseData.message;
        if (errorMsg.toLowerCase().includes('error') || errorMsg.toLowerCase().includes('fail')) {
            console.error('[addStudentsToClass] Server returned error in response body', {
                status: response.status,
                error: errorMsg,
                classId: numericClassId
            });
            throw new Error(errorMsg);
        }
    }
    
    if (!response.ok) {
        const errorMessage = responseData?.error || responseData?.message || `HTTP ${response.status}`;
        throw new Error(errorMessage);
    }
    
    // WORKAROUND: Server may not await inserts properly, so we need to wait
    // a bit before verifying the insert was successful. The caller should
    // wait and then verify by fetching the class students again.
    return response;
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

    const response = await fetch(`${SERVER_BASE_URL}/class_students/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
            const errorText = await response.text();
            console.error('[removeStudentFromClass] Error response text:', errorText);
        }
        throw new Error(errorMessage);
    }

    return await response.json();
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

    const response = await fetch(`${SERVER_BASE_URL + ENDPOINTS.updateClass}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classId: Number(classId),
            name: newName,
            teacherEmail
        })
    });

    if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
            // Ignore parse errors
        }
        throw new Error(errorMessage);
    }

    try {
        return await response.json();
    } catch (e) {
        return { success: true };
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

    const response = await fetch(`${SERVER_BASE_URL + ENDPOINTS.deleteClass}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classId: Number(classId),
            teacherEmail
        })
    });

    if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
            // Ignore parse errors
        }
        throw new Error(errorMessage);
    }

    try {
        return await response.json();
    } catch (e) {
        return { success: true };
    }
}
