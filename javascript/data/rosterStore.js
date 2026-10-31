/**
 * Class rosters, loaded on demand (not one request per class card on load).
 *
 * Rosters are kept where the existing features read them
 * (storage/studentStorage.js, localStorage "<class>:students"); this module
 * adds freshness and shares in-flight requests:
 *   ensureRoster(id, name)  -> students (fetches when missing or stale)
 *   prefetchRoster(id, name)   warm it when the user is likely to need it
 */

import { fetchClassStudents } from '../api/classApi.js';
import { loadClassStudentsFromStorage } from '../storage/studentStorage.js';
import { setClassReady } from '../state/appState.js';
import { canPrefetch } from './prefetch.js';

const ROSTER_MAX_AGE_MS = 60 * 1000;
const fetchedAt = new Map();
const inflight = new Map();

/** True when a roster for this class is already stored (possibly stale). */
export function hasStoredRoster(className) {
    return Array.isArray(loadClassStudentsFromStorage(className));
}

export function ensureRoster(classId, className, { maxAgeMs = ROSTER_MAX_AGE_MS } = {}) {
    const id = String(classId || '');
    if (!id || !className) return Promise.resolve(loadClassStudentsFromStorage(className) || []);
    const stored = loadClassStudentsFromStorage(className);
    if (stored && Date.now() - (fetchedAt.get(id) || 0) < maxAgeMs) return Promise.resolve(stored);
    if (inflight.has(id)) return inflight.get(id);

    const promise = fetchClassStudents(id, className)
        .then((students) => {
            const list = Array.isArray(students) ? students : [];
            fetchedAt.set(id, Date.now());
            setClassReady(className, list.length > 0);
            return list;
        })
        .catch((error) => {
            if (stored) return stored; // keep working with what we have
            throw error;
        })
        .finally(() => inflight.delete(id));
    inflight.set(id, promise);
    return promise;
}

export function prefetchRoster(classId, className) {
    if (!canPrefetch()) return;
    ensureRoster(classId, className).catch(() => {});
}

/** After a successful change to a class's students. */
export function markRosterChanged(classId) {
    fetchedAt.delete(String(classId || ''));
}
