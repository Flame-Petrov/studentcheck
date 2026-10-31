/**
 * Export Feature Module
 * 
 * Handles attendance table export to XLSX format.
 */

import { getActiveClassName } from '../utils/helpers.js';
import { getClassIdByNameFromStorage } from '../storage/classStorage.js';
import { loadClassStudentsFromStorage } from '../storage/studentStorage.js';
import { fetchClassStudents } from '../api/classApi.js';
import { fetchClassAttendanceTimestamps } from '../api/attendanceApi.js';

// Cache for XLSX load promise
let xlsxLoadPromise = null;

/**
 * Ensure XLSX library is loaded
 * @returns {Promise<Object>} XLSX library object
 */
function ensureXlsxLoaded() {
    if (window.XLSX && window.XLSX.utils) return Promise.resolve(window.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;
    const sources = [
        'javascript/xlsx.full.min.js',
        '/javascript/xlsx.full.min.js',
        './xlsx.full.min.js',
        '/xlsx.full.min.js',
        'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
        'https://unpkg.com/xlsx/dist/xlsx.full.min.js',
        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    ];
    xlsxLoadPromise = new Promise((resolve, reject) => {
        let i = 0;
        const tryNext = () => {
            if (i >= sources.length) {
                console.error('[Attendance Export] Failed to load XLSX library from all sources.');
                reject(new Error('XLSX load failure'));
                return;
            }
            const src = sources[i++];
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                if (window.XLSX) {
                    resolve(window.XLSX);
                } else {
                    tryNext();
                }
            };
            script.onerror = () => {
                script.remove();
                tryNext();
            };
            document.head.appendChild(script);
        };
        tryNext();
    });
    return xlsxLoadPromise;
}

/**
 * Format timestamp to "HH:MM"
 * @param {number} ms - Timestamp in milliseconds
 * @returns {string} Time string
 */
function formatTime(ms) {
    if (!ms && ms !== 0) return '';
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
}

/**
 * Format timestamp to "YYYY-MM-DD"
 * @param {number} ms - Timestamp in milliseconds
 * @returns {string} Date string
 */
function formatDate(ms) {
    if (!ms && ms !== 0) return '';
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function parseTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        // Bulgarian locale format: "DD.MM.YYYY г., HH:mm:ss"
        const bgMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*г\.,?\s*(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (bgMatch) {
            const day = Number(bgMatch[1]);
            const month = Number(bgMatch[2]) - 1;
            const year = Number(bgMatch[3]);
            const hours = Number(bgMatch[4]);
            const minutes = Number(bgMatch[5]);
            const seconds = Number(bgMatch[6] || '0');
            const ms = new Date(year, month, day, hours, minutes, seconds).getTime();
            return Number.isNaN(ms) ? null : ms;
        }
        if (/^\d+$/.test(trimmed)) {
            const numeric = Number(trimmed);
            return Number.isFinite(numeric) ? numeric : null;
        }
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeFileNamePart(value, fallback = 'class') {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    return (cleaned || fallback).slice(0, 80);
}

function sanitizeSheetName(value, fallback = 'Attendance') {
    const cleaned = String(value || '')
        .replace(/[:\\\/\?\*\[\]]/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    return (cleaned || fallback).slice(0, 31);
}

/**
 * Collect attendance entries for a class
 * @param {string} className - Class name
 * @returns {Array<Object>} Array of attendance entries
 */
async function collectAttendanceEntriesForClass(className, knownClassId) {
    const classId = knownClassId || getClassIdByNameFromStorage(className);
    if (!classId) return [];

    try {
        const data = await fetchClassAttendanceTimestamps(classId);
        const timestamps = data?.timestamps || [];
        if (!Array.isArray(timestamps) || timestamps.length === 0) {
            return [];
        }

        return timestamps.map((row) => ({
            studentName: row.full_name || row.fullName || '',
            facultyNumber: row.faculty_number || row.facultyNumber || '',
            joinedAt: parseTimestamp(row.joined_at || row.joinedAt),
            leftAt: parseTimestamp(row.left_at || row.leftAt)
        }));
    } catch (e) {
        console.warn('[Attendance Export] Failed to fetch timestamps, falling back to local data.', e);
    }

    // Fallback to local class roster if server timestamps are unavailable
    let students = loadClassStudentsFromStorage(className);
    if (!students || students.length === 0) {
        students = await fetchClassStudents(classId, className);
    }

    if (!students || students.length === 0) {
        return [];
    }

    return students.map((s) => ({
        studentName: s.fullName || s.full_name || '',
        facultyNumber: s.facultyNumber || s.faculty_number || '',
        joinedAt: null,
        leftAt: null
    }));
}

/**
 * Sort attendance entries by join time, then name
 * @param {Array<Object>} entries - Attendance entries
 * @returns {Array<Object>} Sorted entries
 */
function sortAttendanceEntries(entries) {
    entries.sort((a, b) => {
        const aDate = new Date(a.joinedAt);
        const bDate = new Date(b.joinedAt);
        const diff = aDate - bDate;
        if (diff !== 0) return diff;
        return (a.studentName || '').localeCompare(b.studentName || '');
    });
    return entries;
}

/**
 * Build worksheet data array
 * @param {string} className - Class name
 * @param {Array<Object>} entries - Attendance entries
 * @returns {Array<Array>} Worksheet data (rows)
 */
function buildWorksheetData(className, entries) {
    const title = `Class: ${String(className || '').trim() || 'N/A'}`;
    const header = [
        'Student Name',
        'Faculty Number',
        'Joined At',
        'Left At',
        'Date'
    ];
    return [
        [title],
        [],
        header,
        ...entries.map(e => [
        e.studentName,
        e.facultyNumber,
        formatTime(e.joinedAt),
        formatTime(e.leftAt),
        formatDate(e.joinedAt ?? e.leftAt)
    ])
    ];
}

/**
 * Generate and download attendance XLSX file
 * @param {string} className - Class name
 * @param {Array<Object>} entries - Attendance entries
 */
async function generateAndDownloadAttendanceXlsx(className, entries) {
    const XLSX = await ensureXlsxLoaded().catch(err => {
        console.error('[Attendance Export] XLSX load failed. Cannot generate .xlsx.', err);
        return null;
    });
    if (!XLSX) {
        throw new Error('Unable to load XLSX library. Attendance export failed.');
    }
    const wsData = buildWorksheetData(className, entries);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = ws['!merges'] || [];
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } });
    const sheetName = sanitizeSheetName(`Attendance ${className || ''}`, 'Attendance');
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const safeClass = sanitizeFileNamePart(className, 'class');
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const filename = `attendance_export_${safeClass}_${yyyy}-${mm}-${dd}.xlsx`;
    XLSX.writeFile(wb, filename);
}

/**
 * Handle download attendance table
 * @param {string} className - Class name (optional)
 */
export async function handleDownloadAttendanceTable(className, { classId } = {}) {
    const resolvedNow = getActiveClassName();
    const targetClass = (className || resolvedNow || '').trim();
    if (!targetClass) {
        // Callers show the error (the discipline menu renders it in Bulgarian)
        throw new Error('No class selected for attendance export.');
    }
    const entries = await collectAttendanceEntriesForClass(targetClass, classId);
    const sorted = sortAttendanceEntries(entries);
    await generateAndDownloadAttendanceXlsx(targetClass, sorted);
}
