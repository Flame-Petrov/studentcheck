/**
 * Teacher's class list: cache key + updates after successful mutations.
 *
 * The list is cached per teacher (data/cache.js). Create / rename / delete
 * call the helpers below so the cache matches the server without a refetch,
 * and any response already in flight cannot bring the old list back.
 */

import { cacheKey, teacherScope, readCache, writeCache, updateCache, invalidateCache } from './cache.js';
import { getStoredClassesMap } from '../storage/classStorage.js';

export const CLASSES_MAX_AGE_MS = 30 * 1000;

export function classesKey() {
    return cacheKey(teacherScope(), 'classes');
}

/** [{ id: '12', name: '…' }] from any server shape */
export function normalizeClasses(list) {
    return (Array.isArray(list) ? list : [])
        .filter((c) => c && c.id !== undefined && c.id !== null)
        .map((c) => ({ id: String(c.id), name: String(c.name || '') }));
}

/**
 * Cached list for this teacher: the session cache, else the id→name map kept
 * in localStorage from the last visit — but only when it belongs to the same
 * account (sc.lastAccount is written at login).
 */
export function readCachedClasses() {
    const hit = readCache(classesKey());
    if (hit) return hit;
    try {
        if (localStorage.getItem('sc.lastAccount') !== teacherScope()) return null;
        const map = getStoredClassesMap();
        if (!map || map.size === 0) return null;
        const data = Array.from(map.entries()).map(([id, name]) => ({ id: String(id), name: String(name) }));
        return { data, at: 0 }; // at 0 = always refresh
    } catch (_) {
        return null;
    }
}

/** Statistics depend on classes, rosters and attendance: drop them after a change. */
export function invalidateStatistics() {
    invalidateCache(cacheKey(teacherScope(), 'statistics'));
}

export function upsertCachedClass({ id, name }) {
    invalidateStatistics();
    if (id === undefined || id === null) return;
    const entry = { id: String(id), name: String(name || '') };
    const updated = updateCache(classesKey(), (list) => {
        const next = list.filter((c) => c.id !== entry.id);
        next.push(entry);
        return next;
    });
    if (!updated) writeCache(classesKey(), [entry]);
}

export function renameCachedClass(oldName, newName) {
    invalidateStatistics();
    updateCache(classesKey(), (list) => list.map((c) => (c.name === oldName ? { ...c, name: newName } : c)));
}

export function removeCachedClass(name) {
    invalidateStatistics();
    updateCache(classesKey(), (list) => list.filter((c) => c.name !== name));
}
