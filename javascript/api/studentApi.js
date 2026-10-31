/**
 * Student API Module
 * 
 * Handles all student-related API calls to the server.
 * Pure functions that return promises.
 */

import { SERVER_BASE_URL, ENDPOINTS } from '../config/api.js';
import { setAllStudents, getAllStudents } from '../state/appState.js';
import { authHeaders } from './authFetch.js';

/**
 * Fetch all students from the database
 * @returns {Promise<Array<Object>>} Array of student objects
 */
// Shared request + freshness: "forceRefresh" callers within a minute of a
// successful load reuse it instead of downloading every student again.
const ALL_STUDENTS_FRESH_MS = 60 * 1000;
let allStudentsFetchedAt = 0;
let allStudentsInflight = null;

export async function fetchAllStudents(options = {}) {
    const { forceRefresh = false } = options;
    if (forceRefresh && Date.now() - allStudentsFetchedAt < ALL_STUDENTS_FRESH_MS) {
        const fresh = getAllStudents();
        if (Array.isArray(fresh) && fresh.length > 0) return fresh;
    }
    if (allStudentsInflight) return allStudentsInflight;
    if (!forceRefresh) {
        // Check shared state cache first
        const cached = getAllStudents();
        if (cached && Array.isArray(cached) && cached.length > 0) {
            return cached;
        }
        
        // Check localStorage as fallback before fetching
        try {
            const stored = localStorage.getItem('allStudents');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setAllStudents(parsed);
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('[fetchAllStudents] Failed to load from localStorage:', e);
        }
    }

    allStudentsInflight = requestAllStudents().finally(() => { allStudentsInflight = null; });
    return allStudentsInflight;
}

async function requestAllStudents() {
    try {
        const result = await fetch(`${SERVER_BASE_URL + ENDPOINTS.students}`, {
            method: 'GET',
            headers: authHeaders({ 'Accept': 'application/json' })
        });

        if (result.ok) {
            const data = await result.json();
            
            const students = data.students || data || [];
            
            const finalStudents = Array.isArray(students) ? students : [];
            
            // CRITICAL: Store in shared state for use across modules
            setAllStudents(finalStudents);
            allStudentsFetchedAt = Date.now();
            
            // Also cache in localStorage for persistence across page loads
            try {
                localStorage.setItem('allStudents', JSON.stringify(finalStudents));
            } catch (e) {
                console.warn('[fetchAllStudents] Failed to cache in localStorage:', e);
            }
            
            return finalStudents;
        } else {
            console.error('[fetchAllStudents] Server returned error:', result.status, result.statusText);
            throw new Error(`Failed to fetch students: ${result.status} ${result.statusText}`);
        }
    } catch (e) {
        console.error('[fetchAllStudents] Fetch error:', e);
        throw e; // Re-throw to allow caller to handle
    }
}
