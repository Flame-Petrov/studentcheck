/**
 * "Данни за студента" dialog (markup: #studentInfoOverlay in
 * teacherHomepage.html, styles: css/studentDetailsDialog.css).
 *
 * One dialog with two views switched in place: details and attendance
 * history. Opening history keeps the details state, and there is never a
 * second backdrop or a second active dialog. The "Управление на студенти"
 * dialog is hidden (not destroyed) meanwhile and comes back with its search,
 * filters, scroll position and focus.
 *
 * Data (each part independent; a failure in one keeps the others):
 *   identity    the roster row the dialog was opened from (no request);
 *               only when fields are missing, the class roster is loaded
 *   attendance  the course-level summary (attendanceSummaryStore), shared
 *               with the roster table: same numbers in both places
 *   history     GET /attendance/history (scans with times), cached per
 *               account + class + student, shown at once when cached and
 *               refreshed in the background
 *
 * A session token guards every async result: a late response never reaches
 * another student's dialog.
 */

import { ensureRoster } from '../data/rosterStore.js';
import {
    readAttendanceSummary, isAttendanceSummaryFresh, loadAttendanceSummary,
    attendanceCountFor, attendanceVersion
} from '../data/attendanceSummaryStore.js';
import { fetchStudentAttendanceHistory } from '../api/attendanceApi.js';
import { cacheKey, teacherScope, readCache, revalidate } from '../data/cache.js';
import { showOverlay, hideOverlay, getOverlay, isOverlayVisible, openConfirmOverlay } from '../ui/overlays.js';
import { showStaleNote, hideStaleNote } from '../ui/skeleton.js';

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

function tf(key, fallback, params) {
    return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t(key, fallback));
}

function plural(n, oneKey, oneFb, manyKey, manyFb) {
    return n === 1 ? tf(oneKey, oneFb, { n }) : tf(manyKey, manyFb, { n });
}

function lang() {
    return window.i18n?.getLanguage?.() === 'en' ? 'en' : 'bg';
}

// ---------------------------------------------------------------------------

let deps = null;
let dom = null;
let session = 0;

const state = {
    open: false,
    view: 'details',
    classId: null,
    className: '',
    student: null,          // { id, openKey, facultyNumber, name, email, group }
    identityStatus: 'ready', // ready | loading | error
    summary: null,
    attendanceStatus: 'loading', // loading | ready | error
    history: null,          // [{ joinAt, leaveAt }]
    historyStatus: 'idle',  // idle | loading | ready | error
    removing: false,
    removeError: '',
    opener: null
};

function bindDom() {
    if (dom) return dom;
    const overlay = getOverlay('studentInfoOverlay');
    if (!overlay) return null;
    const q = (s) => overlay.querySelector(s);
    dom = {
        overlay,
        dialog: q('.sdd-dialog'),
        identity: q('#studentDetailsIdentity'),
        name: q('#studentDetailsName'),
        fn: q('#studentDetailsFn'),
        group: q('#studentDetailsGroup'),
        email: q('#studentDetailsEmail'),
        identityError: q('#studentDetailsIdentityError'),
        att: q('#studentDetailsAttendance'),
        attText: q('#studentDetailsAttText'),
        historyBtn: q('#studentDetailsHistoryBtn'),
        remove: q('#studentDetailsRemoveBtn'),
        removeLabel: q('#studentDetailsRemoveLabel'),
        removeError: q('#studentDetailsRemoveError'),
        closeX: q('#studentDetailsCloseX'),
        closeBtn: q('#studentDetailsCloseBtn'),
        histBack: q('#attendanceHistoryBackBtn'),
        histClose: q('#closeAttendanceHistoryBtn'),
        histCount: q('#attendanceHistoryCount'),
        histStudent: q('#attendanceHistoryStudent'),
        histList: q('#attendanceHistoryList'),
        histStale: q('#attendanceHistoryStale'),
        live: q('#studentDetailsLive')
    };
    dom.closeX.addEventListener('click', () => closeDetails());
    dom.closeBtn.addEventListener('click', () => closeDetails());
    dom.histClose.addEventListener('click', () => closeDetails());
    dom.histBack.addEventListener('click', () => showView('details', { focus: dom.historyBtn }));
    dom.historyBtn.addEventListener('click', () => showView('history'));
    dom.remove.addEventListener('click', confirmRemove);
    dom.overlay.addEventListener('click', (e) => { if (e.target === dom.overlay) closeDetails(); });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('app:languagechange', () => { if (state.open) renderAll(); });
    return dom;
}

// ---------- rendering ----------

function setField(dd, value, { pending, emptyText }) {
    const valueEl = dd.querySelector('.sdd-value');
    dd.classList.toggle('is-pending', pending);
    dd.classList.toggle('is-empty', !pending && !value);
    const text = pending ? '' : (value || emptyText);
    if (valueEl.textContent !== text) valueEl.textContent = text;
}

function renderIdentity() {
    const s = state.student || {};
    const pending = state.identityStatus === 'loading';
    setField(dom.name, s.name, { pending: pending && !s.name, emptyText: s.facultyNumber || '—' });
    setField(dom.fn, s.facultyNumber, { pending: pending && !s.facultyNumber, emptyText: '—' });
    setField(dom.group, s.group, { pending: pending && !s.group, emptyText: '—' });
    setField(dom.email, s.email, { pending: pending && !s.email, emptyText: t('sdd_email_missing', 'Не е посочен') });
    if (pending) dom.identity.setAttribute('aria-busy', 'true');
    else dom.identity.removeAttribute('aria-busy');
    const showError = state.identityStatus === 'error';
    dom.identityError.hidden = !showError;
    if (showError) {
        dom.identityError.replaceChildren(document.createTextNode(t('sdd_identity_error', 'Част от данните не можаха да се заредят.') + ' '));
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sdd-link';
        retry.textContent = t('tp_retry', 'Опитай отново');
        retry.addEventListener('click', () => loadIdentity(session));
        dom.identityError.appendChild(retry);
    }
}

function confirmedCount() {
    return attendanceCountFor(state.summary, { id: state.student?.id, facultyNumber: state.student?.facultyNumber });
}

function attendanceText(count) {
    return plural(count, 'sdd_att_one', '{n} посетено занятие', 'sdd_att_many', '{n} посетени занятия');
}

function renderAttendance() {
    const panel = dom.att;
    let kind;
    let text;
    const count = confirmedCount();
    if (state.summary && count !== null) {
        kind = count > 0 ? 'count' : 'zero';
        text = attendanceText(count);
    } else if (state.attendanceStatus === 'loading') {
        kind = 'loading';
        text = t('sdd_att_loading', 'Зареждане на присъствията…');
    } else if (state.attendanceStatus === 'error') {
        kind = 'error';
        text = t('sdd_att_error', 'Присъствията не можаха да се заредят.');
    } else {
        kind = 'unavailable';
        text = t('sdd_att_unavailable', 'Няма данни за присъствията');
    }
    panel.dataset.state = kind;
    if (kind === 'loading') panel.setAttribute('aria-busy', 'true');
    else panel.removeAttribute('aria-busy');
    dom.attText.replaceChildren(document.createTextNode(text));
    if (kind === 'error') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sdd-link';
        retry.textContent = t('tp_retry', 'Опитай отново');
        retry.addEventListener('click', () => {
            state.attendanceStatus = 'loading';
            renderAttendance();
            loadAttendance(session);
        });
        dom.attText.append(' ', retry);
    }
}

function renderRemove() {
    dom.remove.disabled = state.removing || !state.classId || !state.student?.facultyNumber;
    dom.remove.setAttribute('aria-busy', String(state.removing));
    const label = state.removing ? t('sdd_removing', 'Премахване…') : t('sdd_remove', 'Премахни от дисциплината');
    if (dom.removeLabel.textContent !== label) dom.removeLabel.textContent = label;
    dom.removeError.hidden = !state.removeError;
    if (state.removeError) {
        dom.removeError.replaceChildren(document.createTextNode(state.removeError + ' '));
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sdd-link';
        retry.textContent = t('tp_retry', 'Опитай отново');
        // Already confirmed once: retry the same removal directly
        retry.addEventListener('click', () => performRemove(session));
        dom.removeError.appendChild(retry);
    }
}

// ---------- attendance history (timeline) ----------
//
// One record = one lesson the student attended with a scan time; the server
// returns its joined_at / left_at together, so they are never paired by us.
// Times are UTC ISO strings, shown — and grouped by date — in the browser's
// local time, like everywhere else in the app (scanner, export).

function localeTag() {
    return lang() === 'en' ? 'en-GB' : 'bg-BG';
}

function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDay(ms) {
    return new Date(ms).toLocaleDateString(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(ms) {
    const d = new Date(ms);
    if (lang() === 'en') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Records grouped by local date, newest date first, newest record first. */
function groupRecords(records) {
    const groups = new Map();
    records.forEach((rec) => {
        const anchor = rec.joinAt ?? rec.leaveAt;
        const key = anchor === null || anchor === undefined ? 'unknown' : dayKey(anchor);
        if (!groups.has(key)) groups.set(key, { key, anchor, records: [] });
        groups.get(key).records.push(rec);
    });
    const list = Array.from(groups.values());
    list.forEach((g) => g.records.sort((a, b) => (b.joinAt ?? b.leaveAt ?? 0) - (a.joinAt ?? a.leaveAt ?? 0)));
    // newest date first; records without a valid date at the end
    list.sort((a, b) => (a.key === 'unknown') - (b.key === 'unknown') || (b.anchor ?? 0) - (a.anchor ?? 0));
    return list;
}

function timeCell(ms, invalid, groupKey) {
    const td = document.createElement('td');
    td.className = 'ahd-time';
    if (ms === null || ms === undefined) {
        // Explicitly unavailable — never an invented time
        td.classList.add('is-missing');
        const dash = document.createElement('span');
        dash.setAttribute('aria-hidden', 'true');
        dash.textContent = '—';
        const sr = document.createElement('span');
        sr.className = 'tp-visually-hidden';
        sr.textContent = invalid ? t('ahd_invalid', 'Невалиден час') : t('ahd_missing', 'Няма запис');
        td.append(dash, sr);
        return td;
    }
    td.textContent = formatTime(ms);
    // Exit (or entry) on another date than the group: say which
    if (groupKey !== 'unknown' && dayKey(ms) !== groupKey) {
        const other = document.createElement('span');
        other.className = 'ahd-other-day';
        // full month name: a short numeric form ("13.03") reads like a time
        other.textContent = new Date(ms).toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' });
        td.append(' ', other);
    }
    return td;
}

function groupSection(group, index) {
    const section = document.createElement('section');
    section.className = 'ahd-group';
    const headingId = `ahdDate-${index}`;
    section.setAttribute('aria-labelledby', headingId);
    const marker = document.createElement('span');
    marker.className = 'ahd-marker';
    marker.setAttribute('aria-hidden', 'true');
    const h3 = document.createElement('h3');
    h3.className = 'ahd-date';
    h3.id = headingId;
    h3.textContent = group.key === 'unknown' ? t('ahd_unknown_date', 'Неизвестна дата') : formatDay(group.anchor);

    const table = document.createElement('table');
    table.className = 'ahd-table';
    table.setAttribute('aria-labelledby', headingId);
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    [['ahd_joined', 'Влизане'], ['ahd_left', 'Излизане']].forEach(([key, fb]) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = t(key, fb);
        hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = document.createElement('tbody');
    group.records.forEach((rec) => {
        const tr = document.createElement('tr');
        tr.append(timeCell(rec.joinAt, rec.joinInvalid, group.key), timeCell(rec.leaveAt, rec.leaveInvalid, group.key));
        tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    section.append(marker, h3, table);
    return section;
}

function historySkeleton() {
    const frag = document.createDocumentFragment();
    [[2, '38%'], [1, '46%']].forEach(([rows, w]) => {
        const section = document.createElement('div');
        section.className = 'ahd-group ahd-group--skel';
        section.setAttribute('aria-hidden', 'true');
        const marker = document.createElement('span');
        marker.className = 'ahd-marker';
        const date = document.createElement('span');
        date.className = 'sk ahd-sk ahd-sk--date';
        date.style.setProperty('--sk-w', w);
        const grid = document.createElement('div');
        grid.className = 'ahd-skel-grid';
        grid.innerHTML = `<span class="ahd-skel-label">${t('ahd_joined', 'Влизане')}</span><span class="ahd-skel-label">${t('ahd_left', 'Излизане')}</span>`
            + '<span class="ahd-skel-cell"><span class="sk ahd-sk"></span></span><span class="ahd-skel-cell"><span class="sk ahd-sk"></span></span>'.repeat(rows);
        section.append(marker, date, grid);
        frag.appendChild(section);
    });
    return frag;
}

function renderHistory() {
    if (!dom) return;
    const s = state.student || {};
    dom.histStudent.textContent = s.name || s.facultyNumber || '';
    const list = dom.histList;
    const records = state.history;

    // Subtitle: the number of records (a placeholder until they are known)
    const countEl = dom.histCount;
    if (records === null) {
        countEl.classList.toggle('is-pending', state.historyStatus === 'loading');
        countEl.querySelector('.ahd-count-text').textContent = '';
    } else {
        countEl.classList.remove('is-pending');
        countEl.querySelector('.ahd-count-text').textContent =
            plural(records.length, 'ahd_records_one', '{n} запис за присъствие', 'ahd_records_many', '{n} записа за присъствие');
    }

    if (records === null && state.historyStatus === 'loading') {
        list.setAttribute('aria-busy', 'true');
        if (!list.querySelector('.ahd-group--skel')) list.replaceChildren(historySkeleton());
        return;
    }
    list.removeAttribute('aria-busy');

    if (records === null && state.historyStatus === 'error') {
        const box = document.createElement('div');
        box.className = 'ahd-state ahd-state--error';
        box.setAttribute('role', 'alert');
        box.append(document.createTextNode(t('tp_history_error', 'Неуспешно зареждане на историята на присъствията.') + ' '));
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sdd-link';
        retry.textContent = t('tp_retry', 'Опитай отново');
        retry.addEventListener('click', () => loadHistory(session));
        box.appendChild(retry);
        list.replaceChildren(box);
        return;
    }

    const frag = document.createDocumentFragment();
    const count = confirmedCount();
    const untimed = count !== null ? Math.max(0, count - (records || []).length) : 0;
    if (!records || records.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'ahd-state';
        empty.textContent = t('no_attendance_records', 'Няма записани присъствия.');
        frag.appendChild(empty);
    } else {
        const timeline = document.createElement('div');
        timeline.className = 'ahd-timeline';
        groupRecords(records).forEach((group, i) => timeline.appendChild(groupSection(group, i)));
        frag.appendChild(timeline);
    }
    // Attendance the summary counts but history cannot list (no scan times,
    // e.g. migrated data): said explicitly instead of silently missing
    if (untimed > 0) {
        const note = document.createElement('p');
        note.className = 'ahd-note';
        note.textContent = plural(untimed, 'sdd_hist_untimed_one', '+ {n} присъствие без записан час (пренесени данни)', 'sdd_hist_untimed_many', '+ {n} присъствия без записан час (пренесени данни)');
        frag.appendChild(note);
    }
    const scroll = list.scrollTop;
    list.replaceChildren(frag);
    list.scrollTop = scroll; // a quiet refresh keeps the reading position
}

function renderAll() {
    renderIdentity();
    renderAttendance();
    renderRemove();
    if (state.view === 'history') renderHistory();
}

function announce(text) {
    if (dom?.live) dom.live.textContent = text;
}

// ---------- data ----------

function needsIdentity(s) {
    return !s || !s.name || !s.facultyNumber;
}

function loadIdentity(token) {
    if (!state.classId) {
        state.identityStatus = 'error';
        renderIdentity();
        return Promise.resolve();
    }
    state.identityStatus = 'loading';
    renderIdentity();
    return ensureRoster(state.classId, state.className, { rethrow: true })
        .then((list) => {
            if (token !== session) return;
            const match = (list || []).map((x) => deps.normalizeStudent(x)).find((r) =>
                (state.student?.id && r.id === state.student.id) ||
                (state.student?.facultyNumber && r.facultyNumber === state.student.facultyNumber) ||
                (state.student?.openKey && (r.openKey === state.student.openKey || r.id === state.student.openKey)));
            if (match) state.student = { ...match, ...pickDefined(state.student) };
            state.identityStatus = match ? 'ready' : 'error';
            renderAll();
        })
        .catch((error) => {
            if (token !== session) return;
            console.error('[studentDetails] identity load failed', error);
            state.identityStatus = 'error';
            renderAll();
        });
}

function pickDefined(obj) {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => { if (v) out[k] = v; });
    return out;
}

function loadAttendance(token) {
    if (!state.classId) {
        state.attendanceStatus = 'error';
        renderAttendance();
        return Promise.resolve();
    }
    return loadAttendanceSummary(state.classId)
        .then(({ data, current }) => {
            if (token !== session) return;
            if (current) {
                state.summary = data;
                state.attendanceStatus = 'ready';
                const count = confirmedCount();
                if (count !== null) announce(attendanceText(count));
            } else if (!state.summary) {
                return loadAttendance(token); // invalidated while in flight: ask again
            }
            renderAttendance();
            if (state.view === 'history') renderHistory();
        })
        .catch((error) => {
            if (token !== session) return;
            console.error('[studentDetails] attendance load failed', error);
            // Older totals stay if we have them
            if (!state.summary) state.attendanceStatus = 'error';
            renderAttendance();
        });
}

function historyKey() {
    const sid = state.student?.id || state.student?.facultyNumber || '';
    return cacheKey(teacherScope(), 'attendance-history', `${state.classId}:${sid}:v${attendanceVersion(state.classId)}`);
}

async function fetchHistory(classId, student) {
    const numericId = /^\d+$/.test(String(student?.id || '')) ? String(student.id) : null;
    const data = await fetchStudentAttendanceHistory(classId, { studentId: numericId, facultyNumber: numericId ? null : student?.facultyNumber });
    const raw = data?.records ?? data?.sessions ?? data?.history ?? null;
    if (!Array.isArray(raw)) throw new Error('Attendance history response is malformed');
    const parse = (v) => {
        if (v === null || v === undefined || v === '') return { ms: null, invalid: false };
        const n = typeof v === 'number' ? v : Date.parse(v);
        return Number.isFinite(n) ? { ms: n, invalid: false } : { ms: null, invalid: true };
    };
    return raw.map((r) => {
        const j = parse(r.joined_at ?? r.joinedAt);
        const l = parse(r.left_at ?? r.leftAt);
        return { joinAt: j.ms, leaveAt: l.ms, joinInvalid: j.invalid, leaveInvalid: l.invalid };
    });
}

function loadHistory(token) {
    if (!state.classId || (!state.student?.id && !state.student?.facultyNumber)) {
        state.historyStatus = 'error';
        renderHistory();
        return Promise.resolve();
    }
    const key = historyKey();
    const cached = readCache(key);
    if (cached && state.history === null) state.history = cached.data;
    state.historyStatus = 'loading';
    hideStaleNote(dom.histStale);
    renderHistory();
    const classId = state.classId;
    const student = { ...state.student };
    return revalidate(key, () => fetchHistory(classId, student))
        .then(({ data }) => {
            if (token !== session) return;
            state.history = data;
            state.historyStatus = 'ready';
            renderHistory();
        })
        .catch((error) => {
            if (token !== session) return;
            console.error('[studentDetails] history load failed', error);
            state.historyStatus = 'error';
            // Records on screen stay; a discreet note offers a retry
            if (state.history !== null) showStaleNote(dom.histStale, () => loadHistory(session));
            renderHistory();
        });
}

// ---------- views, focus ----------

function showView(view, { focus } = {}) {
    state.view = view;
    dom.dialog.dataset.view = view;
    dom.dialog.setAttribute('aria-labelledby', view === 'history' ? 'attendanceHistoryTitle' : 'studentDetailsTitle');
    if (view === 'history') {
        dom.histList.scrollTop = 0;
        renderHistory();
        loadHistory(session);
        dom.dialog.focus({ preventScroll: true });
    } else {
        (focus || dom.dialog).focus({ preventScroll: true });
    }
}

function onKeydown(e) {
    if (!dom || !state.open || !isOverlayVisible(dom.overlay)) return;
    const confirm = document.getElementById('confirmOverlay');
    if (confirm && confirm.style.visibility === 'visible') return;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (state.view === 'history') showView('details', { focus: dom.historyBtn });
        else closeDetails();
        return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(dom.dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dom.dialog || !dom.dialog.contains(active))) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (active === last || !dom.dialog.contains(active))) {
        e.preventDefault();
        first.focus();
    }
}

function closeDetails({ toParent = true, removedKey = null } = {}) {
    if (!state.open) return;
    session += 1;
    state.open = false;
    hideOverlay(dom.overlay, false);
    const opener = state.opener;
    state.opener = null;
    if (toParent) deps.returnToParent({ opener, removedKey, className: state.className });
}

// ---------- remove from class ----------

function confirmRemove() {
    if (state.removing || !state.student) return;
    const token = session;
    const name = state.student.name || t('this_student', 'този студент');
    openConfirmOverlay(
        `${t('confirm_remove_student_prefix', 'Сигурни ли сте, че искате да премахнете')} ${name} ${t('confirm_remove_student_suffix', 'от дисциплината?')}`,
        () => performRemove(token),
        () => { if (token === session) dom.remove.focus({ preventScroll: true }); }
    );
}

async function performRemove(token) {
    if (token !== session || state.removing) return;
    // Bound to the ids captured when the dialog opened
    const target = { classId: state.classId, className: state.className, studentId: state.student?.id || null, facultyNumber: state.student?.facultyNumber };
    state.removing = true;
    state.removeError = '';
    renderRemove();
    try {
        await deps.removeStudent(target);
    } catch (error) {
        if (error?.redirectingAuth) return;
        console.error('[studentDetails] remove failed', error);
        if (token === session) {
            state.removing = false;
            state.removeError = error?.status === 403
                ? t('sdd_remove_forbidden', 'Нямате права да променяте тази дисциплина.')
                : t('sdd_remove_error', 'Студентът не беше премахнат. Опитайте отново.');
            renderRemove();
        } else {
            deps.toast?.(t('sdd_remove_error', 'Студентът не беше премахнат. Опитайте отново.'), 'error');
        }
        return;
    }
    // Confirmed by the server: the parent roster was updated by removeStudent()
    deps.toast?.(t('toast_student_removed', 'Студентът е премахнат'), 'success');
    if (token === session) {
        state.removing = false;
        closeDetails({ removedKey: target.studentId || target.facultyNumber });
    }
}

// ---------- public ----------

/**
 * @param {object} callbacks
 * @param {(student) => object} callbacks.normalizeStudent - roster entry -> { id, openKey, facultyNumber, name, email, group }
 * @param {(target) => Promise} callbacks.removeStudent - removes the enrollment; throws on failure
 * @param {(info) => void} callbacks.returnToParent - show the roster again ({ opener, removedKey })
 * @param {(message, tone) => void} [callbacks.toast]
 */
export function initStudentDetailsDialog(callbacks) {
    if (deps) return;
    deps = callbacks;
    bindDom();
}

/**
 * Open the dialog for a student of a class.
 * @param {object} opts
 * @param {object} opts.student - known identity (roster row); fields may be missing
 * @param {string|number} opts.classId
 * @param {string} opts.className
 * @param {HTMLElement} [opts.opener] - focus returns here (via the parent) on close
 */
export function openStudentDetails({ student, classId, className, opener = null }) {
    const d = bindDom();
    if (!d) return;
    session += 1;
    const token = session;
    Object.assign(state, {
        open: true,
        view: 'details',
        classId: classId ? String(classId) : null,
        className: className || '',
        student: { ...(student || {}) },
        identityStatus: 'ready',
        summary: null,
        attendanceStatus: 'loading',
        history: null,
        historyStatus: 'idle',
        removing: false,
        removeError: '',
        opener
    });

    // Cached totals first; a request only when they are missing or stale
    const cached = readAttendanceSummary(state.classId);
    if (cached) {
        state.summary = cached.data;
        state.attendanceStatus = 'ready';
    }
    d.dialog.dataset.view = 'details';
    d.dialog.setAttribute('aria-labelledby', 'studentDetailsTitle');
    d.live.textContent = '';
    if (needsIdentity(state.student)) state.identityStatus = 'loading';
    renderAll();

    showOverlay(d.overlay, false);
    document.body.style.overflow = 'hidden';
    d.dialog.focus({ preventScroll: true });

    if (state.identityStatus === 'loading') loadIdentity(token);
    if (!cached || !isAttendanceSummaryFresh(state.classId)) loadAttendance(token);
}

export function isStudentDetailsOpen() {
    return state.open;
}

/** Another module hid every class overlay. */
export function onStudentDetailsHidden() {
    if (!state.open) return;
    session += 1;
    state.open = false;
}
