/**
 * Export Feature Module
 *
 * Attendance table export to XLSX, run as a background job with one shared
 * dialog (markup: #exportOverlay in teacherHomepage.html, styles:
 * css/exportDialog.css).
 *
 * Jobs are separate from the dialog. A job captures the account, the class id
 * and its display name when it starts; navigation cannot change what it
 * exports. One job per account + class runs at a time (repeated clicks show
 * the running job). Each attempt hands exactly one file to the browser.
 *
 * Dialog states: preparing (table skeleton) -> done ("Download started")
 *                                           -> failed (Try again)
 *                                           -> ready (needs a click: Download)
 * Closing the dialog does not cancel the job. If the job finishes while its
 * dialog is not shown, a discreet notice reports it (with Retry/Download when
 * an action is needed); the dialog is never reopened and focus is not moved.
 *
 * Nothing is persisted: a reload or closing the tab ends a running job.
 */

import { getClassIdByNameFromStorage } from '../storage/classStorage.js';
import { fetchClassAttendanceTimestamps } from '../api/attendanceApi.js';
import { teacherScope } from '../data/cache.js';
import { getAuthToken } from '../auth/authStore.js';
import { showOverlay, hideOverlay, isOverlayVisible } from '../ui/overlays.js';

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
    // A failed load must not be cached: the next attempt tries again
    xlsxLoadPromise.catch(() => { xlsxLoadPromise = null; });
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
 * Attendance entries (scans with times) for a class. A failed request fails
 * the export: an incomplete workbook is never produced silently.
 * @param {string|number} classId
 * @returns {Promise<Array<Object>>}
 */
async function collectAttendanceEntriesForClass(classId) {
    const data = await fetchClassAttendanceTimestamps(classId);
    const timestamps = data?.timestamps;
    if (!Array.isArray(timestamps)) {
        throw new Error('Attendance timestamps response is malformed');
    }
    return timestamps.map((row) => ({
        studentName: row.full_name || row.fullName || '',
        facultyNumber: row.faculty_number || row.facultyNumber || '',
        joinedAt: parseTimestamp(row.joined_at || row.joinedAt),
        leftAt: parseTimestamp(row.left_at || row.leftAt)
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

function exportFileName(className) {
    const safeClass = sanitizeFileNamePart(className, 'class');
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `attendance_export_${safeClass}_${yyyy}-${mm}-${dd}.xlsx`;
}

/**
 * Generate the attendance workbook (same layout as before) as a file blob.
 * @returns {{ blob: Blob, fileName: string }}
 */
function buildAttendanceWorkbook(XLSX, className, entries) {
    const wsData = buildWorksheetData(className, entries);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = ws['!merges'] || [];
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } });
    const sheetName = sanitizeSheetName(`Attendance ${className || ''}`, 'Attendance');
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    if (!bytes || !bytes.byteLength) throw new Error('Workbook generation produced no data');
    return {
        blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        fileName: exportFileName(className)
    };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const URL_RELEASE_MS = 60 * 1000;
const jobs = new Map(); // `${scope}|${classId}` -> job
let attemptSeq = 0;
let sessionGeneration = 0; // bumped on auth loss: older jobs can no longer deliver

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

function tf(key, fallback, params) {
    return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t(key, fallback));
}

/** Still the same signed-in account that started the job? */
function sameSession(job) {
    return job.generation === sessionGeneration && job.scope === teacherScope() && !!getAuthToken();
}

function jobKey(scope, classId) {
    return `${scope}|${classId}`;
}

function releaseFile(job) {
    if (job.fileUrl) {
        const url = job.fileUrl;
        job.fileUrl = null;
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    clearTimeout(job.releaseTimer);
    job.file = null;
}

/** Hand the prepared file to the browser. Returns false if that failed. */
function triggerDownload(job) {
    if (!job.file) return false;
    try {
        if (!job.fileUrl) job.fileUrl = URL.createObjectURL(job.file.blob);
        const a = document.createElement('a');
        a.href = job.fileUrl;
        a.download = job.file.fileName;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // The browser reads the blob once the download starts; free it later
        clearTimeout(job.releaseTimer);
        job.releaseTimer = setTimeout(() => releaseFile(job), URL_RELEASE_MS);
        return true;
    } catch (error) {
        console.error('[Attendance Export] could not start the download', error);
        return false;
    }
}

function setJobState(job, status, extra = {}) {
    Object.assign(job, { status }, extra);
    onJobChanged(job);
}

/** One attempt: library + data in parallel, then the workbook, then one download. */
function runAttempt(job) {
    const attempt = ++attemptSeq;
    job.attempt = attempt;
    job.error = null;
    releaseFile(job);
    setJobState(job, 'preparing');

    const work = Promise.all([
        ensureXlsxLoaded().catch((error) => { throw Object.assign(error, { stage: 'library' }); }),
        collectAttendanceEntriesForClass(job.classId).catch((error) => { throw Object.assign(error, { stage: 'data' }); })
    ]).then(([XLSX, entries]) => {
        try {
            return buildAttendanceWorkbook(XLSX, job.className, sortAttendanceEntries(entries));
        } catch (error) {
            throw Object.assign(error, { stage: 'generate' });
        }
    });

    job.promise = work.then((file) => {
        if (job.attempt !== attempt) return;          // superseded
        if (!sameSession(job)) {                      // logged out / other account
            jobs.delete(job.key);
            return;
        }
        job.file = file;
        if (triggerDownload(job)) setJobState(job, 'done');
        else setJobState(job, 'ready');               // needs an explicit click
    }).catch((error) => {
        if (job.attempt !== attempt) return;
        if (!sameSession(job)) {
            jobs.delete(job.key);
            return;
        }
        console.error(`[Attendance Export] failed (${error?.stage || 'unknown'})`, error);
        setJobState(job, 'failed', { error });
    });
    return job;
}

/**
 * Start (or show) the export of a class.
 * @returns {object|null} the job
 */
function startOrReuse({ classId, className }) {
    const scope = teacherScope();
    const key = jobKey(scope, classId);
    const existing = jobs.get(key);
    if (existing && existing.status === 'preparing') return existing; // no duplicate runs
    const job = existing || {
        key,
        scope,
        generation: sessionGeneration,
        classId: String(classId),
        className,
        status: 'idle',
        file: null,
        fileUrl: null
    };
    job.className = className || job.className;
    jobs.set(key, job);
    return runAttempt(job);
}

// Signed out / session expired in this tab: older jobs may not deliver
document.addEventListener('app:authexpired', () => {
    sessionGeneration += 1;
    jobs.forEach((job) => releaseFile(job));
    jobs.clear();
    closeDialog({ restoreFocus: false });
    dismissNotice();
});

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

let dom = null;
let shownJob = null;      // the job the dialog currently shows (null when closed)
let opener = null;

function bindDom() {
    if (dom) return dom;
    const overlay = document.getElementById('exportOverlay');
    if (!overlay) return null;
    dom = {
        overlay,
        dialog: overlay.querySelector('.exd-dialog'),
        className: overlay.querySelector('#exportClassName'),
        title: overlay.querySelector('#exportStateTitle'),
        text: overlay.querySelector('#exportStateText'),
        live: overlay.querySelector('#exportLive'),
        closeBtn: overlay.querySelector('#exportCloseBtn'),
        failCloseBtn: overlay.querySelector('#exportFailCloseBtn'),
        readyCloseBtn: overlay.querySelector('#exportReadyCloseBtn'),
        doneBtn: overlay.querySelector('#exportDoneBtn'),
        retryBtn: overlay.querySelector('#exportRetryBtn'),
        downloadBtn: overlay.querySelector('#exportDownloadBtn')
    };
    [dom.closeBtn, dom.failCloseBtn, dom.readyCloseBtn, dom.doneBtn].forEach((b) => b?.addEventListener('click', () => closeDialog()));
    dom.retryBtn.addEventListener('click', () => {
        if (!shownJob || shownJob.status === 'preparing') return;
        dom.retryBtn.disabled = true; // no double retry while the state updates
        startOrReuse({ classId: shownJob.classId, className: shownJob.className });
    });
    dom.downloadBtn.addEventListener('click', () => {
        if (!shownJob || shownJob.status !== 'ready') return;
        // A user click: the prepared file, not a new export
        if (triggerDownload(shownJob)) setJobState(shownJob, 'done');
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('app:languagechange', () => { if (shownJob) renderDialog(shownJob, { announce: false }); });
    return dom;
}

const STATE_TEXT = {
    preparing: ['exd_preparing_title', 'Подготвяме таблицата', 'exd_preparing_text', 'Това може да отнеме няколко секунди.'],
    done: ['exd_done_title', 'Изтеглянето започна', 'exd_done_text', 'Проверете изтеглянията в браузъра за файла.'],
    failed: ['exd_failed_title', 'Неуспешно изтегляне на таблицата', 'exd_failed_text', 'Моля, опитайте отново.'],
    ready: ['exd_ready_title', 'Таблицата е готова', 'exd_ready_text', 'Натиснете „Изтегли“, за да я запазите.']
};

function renderDialog(job, { announce = true } = {}) {
    const d = dom;
    const state = job.status === 'idle' ? 'preparing' : job.status;
    const [titleKey, titleFb, textKey, textFb] = STATE_TEXT[state];
    const previous = d.dialog.dataset.state;
    d.dialog.dataset.state = state;
    d.className.textContent = job.className;
    d.title.textContent = t(titleKey, titleFb);
    d.text.textContent = t(textKey, textFb);
    d.dialog.setAttribute('aria-busy', String(state === 'preparing'));
    d.retryBtn.disabled = false;
    if (announce && previous !== state) d.live.textContent = `${t(titleKey, titleFb)}. ${t(textKey, textFb)}`;

    // Keyboard users: focus follows the new state's main action
    if (previous && previous !== state && d.dialog.contains(document.activeElement)) {
        const target = { done: d.doneBtn, failed: d.retryBtn, ready: d.downloadBtn, preparing: d.closeBtn }[state];
        target?.focus({ preventScroll: true });
    }
}

function openDialog(job, openerEl) {
    const d = bindDom();
    if (!d) return;
    const wasOpen = isOverlayVisible(d.overlay);
    shownJob = job;
    if (openerEl) opener = openerEl;
    d.dialog.dataset.state = '';
    d.live.textContent = '';
    renderDialog(job);
    if (!wasOpen) {
        showOverlay(d.overlay, false);
        document.body.style.overflow = 'hidden';
        d.dialog.focus({ preventScroll: true });
    }
}

function closeDialog({ restoreFocus = true } = {}) {
    if (!dom || !isOverlayVisible(dom.overlay)) {
        shownJob = null;
        return;
    }
    const job = shownJob;
    shownJob = null;
    hideOverlay(dom.overlay, true);
    // The file is no longer offered once the dialog is gone: release it soon
    if (job && job.status !== 'preparing') {
        clearTimeout(job.releaseTimer);
        job.releaseTimer = setTimeout(() => releaseFile(job), URL_RELEASE_MS);
    }
    if (restoreFocus) {
        const target = opener;
        if (target && target.isConnected) target.focus({ preventScroll: true });
        else document.getElementById('classesTitle')?.focus({ preventScroll: true });
    }
    opener = null;
}

function onKeydown(e) {
    if (!dom || !isOverlayVisible(dom.overlay)) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(dom.dialog.querySelectorAll('button:not([disabled])')).filter((n) => n.offsetParent !== null);
    if (!items.length) {
        e.preventDefault();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dom.dialog.contains(active) || active === dom.dialog)) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (active === last || !dom.dialog.contains(active))) {
        e.preventDefault();
        first.focus();
    }
}

// ---------------------------------------------------------------------------
// Notice (a job finished while its dialog was not shown)
// ---------------------------------------------------------------------------

let noticeEl = null;
let noticeJob = null;
let noticeTimer = null;

function dismissNotice() {
    clearTimeout(noticeTimer);
    noticeEl?.remove();
    noticeEl = null;
    noticeJob = null;
}

function showNotice(job) {
    dismissNotice();
    const tone = job.status === 'done' ? 'success' : job.status === 'failed' ? 'error' : 'info';
    const box = document.createElement('div');
    box.className = `exd-notice exd-notice--${tone}`;
    box.setAttribute('role', job.status === 'failed' ? 'alert' : 'status');
    const text = document.createElement('p');
    text.className = 'exd-notice-text';
    text.textContent = {
        done: tf('exd_notice_done', 'Таблицата за „{name}“ е готова. Изтеглянето започна.', { name: job.className }),
        failed: tf('exd_notice_failed', 'Неуспешно изтегляне на таблицата за „{name}“.', { name: job.className }),
        ready: tf('exd_notice_ready', 'Таблицата за „{name}“ е готова.', { name: job.className })
    }[job.status];
    box.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'exd-notice-actions';
    if (job.status === 'failed' || job.status === 'ready') {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'exd-notice-action';
        action.textContent = job.status === 'failed' ? t('tp_retry', 'Опитай отново') : t('exd_download', 'Изтегли');
        action.addEventListener('click', () => {
            dismissNotice();
            if (job.status === 'ready') {
                if (triggerDownload(job)) setJobState(job, 'done');
                return;
            }
            // Retry shows the dialog again: the user asked for it
            openDialog(startOrReuse({ classId: job.classId, className: job.className }), document.activeElement);
        });
        actions.appendChild(action);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'exd-notice-close';
    close.setAttribute('aria-label', t('close', 'Затвори'));
    close.innerHTML = '<svg class="tp-icon" aria-hidden="true"><use href="#tp-i-close"/></svg>';
    close.addEventListener('click', dismissNotice);
    actions.appendChild(close);
    box.appendChild(actions);

    document.body.appendChild(box);
    noticeEl = box;
    noticeJob = job;
    requestAnimationFrame(() => box.classList.add('is-shown'));
    // Notices with an action stay until used or dismissed
    if (job.status === 'done') noticeTimer = setTimeout(dismissNotice, 6000);
}

/** Every job state change goes through here. */
function onJobChanged(job) {
    if (shownJob === job && dom && isOverlayVisible(dom.overlay)) {
        renderDialog(job);
        return;
    }
    // Finished in the background: never reopen the dialog or move focus
    if (job.status === 'done' || job.status === 'failed' || job.status === 'ready') showNotice(job);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export a class's attendance table: opens the dialog and starts the export,
 * or shows the export already running for this class.
 * @param {string} className - display name (captured now)
 * @param {object} [opts]
 * @param {string|number} [opts.classId] - stable id (captured now)
 * @param {HTMLElement} [opts.opener] - focus returns here when the dialog closes
 */
export async function handleDownloadAttendanceTable(className, { classId, opener: openerEl = null } = {}) {
    const name = String(className || '').trim();
    const id = classId || (name ? getClassIdByNameFromStorage(name) : null);
    if (!name || !id) {
        // Callers show the error (the discipline menu renders it in Bulgarian)
        throw new Error('No class selected for attendance export.');
    }
    const job = startOrReuse({ classId: id, className: name });
    // This class's notice is superseded by its dialog; other notices stay
    if (noticeJob === job) dismissNotice();
    openDialog(job, openerEl);
    return job;
}
