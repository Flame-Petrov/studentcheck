/**
 * Статистика view (teacherHomepage.html#statistics).
 *
 * Two lists under the totals, switched with "По дисциплини | По студенти":
 *
 * По дисциплини — built from data the API already provides:
 *   GET /classes                      -> disciplines + lessons held (completed_classes_count)
 *   GET /attendance/summary?class_id  -> enrolled students + lessons each attended
 *   Totals: disciplines, unique students, lessons held, average attendance.
 *   Per discipline: students, lessons, average attendance, students below 50%.
 *
 * По студенти — GET /statistics/students (one request, metrics computed in
 * javascript/features/studentStats.js): every student's overall rate, and on
 * the student's own page (#statistics/student/<id>, Back returns to the list)
 * rate per discipline, trend by week/month, absence streaks, lateness, early
 * leaving, time in class and the distance to the 50% threshold.
 *
 * A discipline's own page (#statistics/class/<id>, opened from its row) uses
 * the same per-student data: average attendance (same formula as the row),
 * students below 50%, attendance per lesson, trend, and its students (each
 * linking to the student's page).
 *
 * Each lesson there opens the lesson's page (#statistics/class/<id>/lesson/<id>):
 * who was absent, who was present (arrival / leaving time, late, left early)
 * and the enrolled students with no record for it, each linking to the
 * student's page.
 *
 * Same loading rules as the rest of the app: static skeleton in the HTML,
 * cached result shown at once and refreshed when stale, inline error + Retry
 * on a first-load failure, discreet note when a background refresh fails.
 */

import { SERVER_BASE_URL, ENDPOINTS } from '../config/api.js';
import { authHeaders } from '../api/authFetch.js';
import { fetchClasses } from '../api/classApi.js';
import { cacheKey, teacherScope, readCache, isFresh, revalidate } from '../data/cache.js';
import { showLoadError, showStaleNote, hideStaleNote, endBusy, showSkeletonRows } from '../ui/skeleton.js';
import {
    computeStudentStats, trend, trendDirection,
    LOW_ATTENDANCE_PERCENT, LATE_GRACE_MINUTES, EARLY_GRACE_MINUTES
} from './studentStats.js';

const MAX_AGE_MS = 60 * 1000;
const CONCURRENCY = 4;
const MODE_KEY = 'tp.stats.mode';
const TREND_UNIT_KEY = 'tp.stats.trendUnit';
const DETAIL_PREFIX = '#statistics/student/';
const CLASS_PREFIX = '#statistics/class/';
const MINUTE = 60 * 1000;
// Depth of each detail page: going to a smaller depth is going back
const DETAIL_DEPTH = { class: 1, lesson: 2, student: 3 };

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

/** t() with {name} placeholders filled in. */
function tf(key, fallback, params = {}) {
    return Object.entries(params).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
        t(key, fallback)
    );
}

function lang() {
    return window.i18n?.getLanguage?.() === 'en' ? 'en' : 'bg';
}

function readPref(key, allowed, fallback) {
    try {
        const value = sessionStorage.getItem(key);
        return allowed.includes(value) ? value : fallback;
    } catch (_) {
        return fallback;
    }
}

function writePref(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
}

export function statisticsKey() {
    return cacheKey(teacherScope(), 'statistics');
}

function studentStatisticsKey() {
    return cacheKey(teacherScope(), 'statistics-students');
}

async function fetchSummary(classId) {
    const res = await fetch(SERVER_BASE_URL + ENDPOINTS.classAttendanceSummary(classId), {
        headers: authHeaders({ 'Accept': 'application/json' })
    });
    if (!res.ok) {
        const error = new Error(`Attendance summary failed (${res.status})`);
        error.status = res.status;
        throw error;
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
}

async function fetchStudentStatistics() {
    const res = await fetch(SERVER_BASE_URL + ENDPOINTS.statisticsStudents, {
        headers: authHeaders({ 'Accept': 'application/json' })
    });
    if (!res.ok) {
        const error = new Error(`Student statistics failed (${res.status})`);
        error.status = res.status;
        throw error;
    }
    const data = await res.json();
    return {
        courses: Array.isArray(data?.courses) ? data.courses : [],
        lessons: Array.isArray(data?.lessons) ? data.lessons : [],
        students: Array.isArray(data?.students) ? data.students : [],
        records: Array.isArray(data?.records) ? data.records : []
    };
}

/** Run `fn` over `items` with at most `limit` requests in flight. */
async function mapLimited(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

async function computeStatistics() {
    const classes = (await fetchClasses()).classes || [];
    const perClass = await mapLimited(classes, CONCURRENCY, async (cls) => {
        const items = await fetchSummary(cls.id);
        const lessons = Math.max(0, Number(cls.completed_classes_count) || 0);
        const attended = items.map((i) => Math.min(lessons, Math.max(0, Number(i.attendance_count) || 0)));
        const totalAttended = attended.reduce((a, b) => a + b, 0);
        const possible = items.length * lessons;
        return {
            id: String(cls.id),
            name: String(cls.name || ''),
            students: items.length,
            studentIds: items.map((i) => String(i.student_id ?? i.id ?? '')),
            lessons,
            attended: totalAttended,
            possible,
            low: lessons > 0 ? attended.filter((n) => (n / lessons) * 100 < LOW_ATTENDANCE_PERCENT).length : 0
        };
    });

    const unique = new Set();
    perClass.forEach((c) => c.studentIds.forEach((id) => { if (id) unique.add(id); }));
    const attended = perClass.reduce((a, c) => a + c.attended, 0);
    const possible = perClass.reduce((a, c) => a + c.possible, 0);
    return {
        totals: {
            classes: perClass.length,
            students: unique.size,
            lessons: perClass.reduce((a, c) => a + c.lessons, 0),
            average: possible > 0 ? Math.round((attended / possible) * 100) : null
        },
        classes: perClass.map(({ studentIds, ...rest }) => rest)
    };
}

// ---------- shared rendering helpers ----------

const els = {};
let bound = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function pct(value) {
    return value === null || value === undefined ? '—' : `${value}%`;
}

function countText(n, oneKey, oneFallback, manyKey, manyFallback) {
    return (n === 1 ? t(oneKey, oneFallback) : t(manyKey, manyFallback)).replace('{n}', String(n));
}

function chevronIcon() {
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'tp-icon tp-stats-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#tp-i-chevron-right');
    chevron.appendChild(use);
    return chevron;
}

/** "46%" + bar, the figure used by every row. */
function rateFigure(rate, label) {
    const figure = el('div', 'tp-stats-figure');
    const value = el('span', 'tp-stats-pct', pct(rate));
    const bar = el('span', 'tp-stats-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${label}: ${pct(rate)}`);
    const fill = el('span', `tp-stats-fill${rate !== null && rate < LOW_ATTENDANCE_PERCENT ? ' is-low' : ''}`);
    fill.style.width = `${rate ?? 0}%`;
    bar.appendChild(fill);
    figure.append(value, bar);
    return figure;
}

// ---------- По дисциплини ----------

let rendered = false;
let lastData = null;
let loading = null;

function bind() {
    if (bound) return;
    bound = true;
    els.tiles = {
        classes: document.getElementById('statClasses'),
        students: document.getElementById('statStudents'),
        lessons: document.getElementById('statLessons'),
        average: document.getElementById('statAverage')
    };
    els.region = document.getElementById('statsRegion');
    els.status = document.getElementById('statsLoadingStatus');
    els.list = document.getElementById('statsList');
    els.none = document.getElementById('statsNone');
    els.stale = document.getElementById('statsStale');

    els.modeButtons = Array.from(document.querySelectorAll('[data-stats-mode]'));
    els.classesPane = document.getElementById('statsClassesPane');
    els.studentsPane = document.getElementById('statsStudentsPane');
    els.studentList = document.getElementById('statsStudentList');
    els.studentsLoading = document.getElementById('statsStudentsLoading');
    els.studentsNone = document.getElementById('statsStudentsNone');
    els.studentsNoMatch = document.getElementById('statsStudentsNoMatch');
    els.studentsStale = document.getElementById('statsStudentsStale');
    els.search = document.getElementById('statsStudentSearch');
    els.searchStatus = document.getElementById('statsStudentSearchStatus');
    els.sort = document.getElementById('statsStudentSort');
    els.detail = document.getElementById('statsStudentDetail');

    els.modeButtons.forEach((button) => {
        button.addEventListener('click', () => setMode(button.dataset.statsMode));
    });
    els.search?.addEventListener('input', () => renderStudentList());
    if (els.sort) {
        els.sort.value = readPref('tp.stats.sort', ['name', 'rate', 'streak'], 'name');
        els.sort.addEventListener('change', () => {
            writePref('tp.stats.sort', els.sort.value);
            renderStudentList();
        });
    }
    els.studentList?.addEventListener('click', onStudentLinkClick);
    els.list?.addEventListener('click', onClassLinkClick);
    els.detail?.addEventListener('click', onDetailLinkClick);

    document.addEventListener('app:languagechange', () => {
        if (lastData) render(lastData);
        if (studentStats) renderStudentList();
        if (detail) renderCurrentDetail();
    });
}

function render(data) {
    lastData = data;
    const { totals, classes } = data;
    els.tiles.classes.textContent = String(totals.classes);
    els.tiles.students.textContent = String(totals.students);
    els.tiles.lessons.textContent = String(totals.lessons);
    els.tiles.average.textContent = pct(totals.average);

    const fragment = document.createDocumentFragment();
    classes.forEach((c) => {
        const average = c.possible > 0 ? Math.round((c.attended / c.possible) * 100) : null;
        const li = el('li');
        li.dataset.classId = c.id;
        const link = el('a', 'tp-stats-row tp-stats-row--link');
        link.href = `${CLASS_PREFIX}${c.id}`;
        link.dataset.classLink = c.id;

        const main = el('div', 'tp-stats-main');
        main.append(
            el('h3', 'tp-stats-name', c.name),
            el('p', 'tp-stats-meta', `${countText(c.students, 'tp_stats_students_one', '{n} студент', 'tp_stats_students_many', '{n} студенти')} · ${countText(c.lessons, 'tp_stats_lessons_one', '{n} занятие', 'tp_stats_lessons_many', '{n} занятия')}`)
        );

        const figure = rateFigure(average, t('tp_stats_average', 'Средна посещаемост'));
        if (c.low > 0) {
            figure.appendChild(el('span', 'tp-stats-low', countText(c.low, 'tp_stats_low_one', '{n} под 50%', 'tp_stats_low_many', '{n} под 50%')));
        } else if (c.lessons === 0) {
            figure.appendChild(el('span', 'tp-stats-note', t('tp_stats_no_lessons', 'Няма проведени занятия')));
        }

        link.append(main, figure, chevronIcon());
        li.appendChild(link);
        fragment.appendChild(li);
    });
    els.list.replaceChildren(fragment);
    endBusy(els.list);
    els.none.hidden = classes.length > 0;

    if (!rendered) {
        els.region?.removeAttribute('aria-busy');
        els.status?.remove();
        els.status = null;
        rendered = true;
    }
}

function onError(error) {
    console.error('Statistics load failed:', error);
    if (error?.status === 401) {
        document.dispatchEvent(new CustomEvent('app:authexpired'));
        return;
    }
    const retry = () => {
        hideStaleNote(els.stale);
        if (!rendered) showSkeletonRows(els.list, { count: 3 });
        refresh({ force: true });
    };
    if (rendered) {
        showStaleNote(els.stale, retry);
        return;
    }
    els.region?.removeAttribute('aria-busy');
    els.status?.remove();
    els.status = null;
    Object.values(els.tiles).forEach((tile) => { tile.textContent = '—'; });
    showLoadError(els.list, t('tp_stats_error', 'Неуспешно зареждане на статистиката.'), retry);
}

export function refresh({ force = false } = {}) {
    const key = statisticsKey();
    if (!force && rendered && isFresh(readCache(key), MAX_AGE_MS)) return Promise.resolve();
    if (loading) return loading;
    loading = revalidate(key, computeStatistics)
        .then(({ data, current }) => {
            if (!current) return;
            hideStaleNote(els.stale);
            render(data);
        })
        .catch(onError)
        .finally(() => { loading = null; });
    return loading;
}

// ---------- mode switch ----------

let mode = 'classes';

function setMode(next, { persist = true } = {}) {
    mode = next === 'students' ? 'students' : 'classes';
    if (persist) writePref(MODE_KEY, mode);
    els.modeButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.statsMode === mode));
    });
    if (els.classesPane) els.classesPane.hidden = mode !== 'classes';
    if (els.studentsPane) els.studentsPane.hidden = mode !== 'students';
    if (mode === 'students') loadStudents();
}

// ---------- По студенти: data ----------

let studentStats = null;      // computeStudentStats() result
let studentPayload = null;    // the payload it was computed from
let studentsRendered = false;
let studentsLoading = null;

function useStudentPayload(payload) {
    if (payload === studentPayload && studentStats) return;
    studentPayload = payload;
    studentStats = computeStudentStats(payload);
    studentStats.byId = new Map(studentStats.students.map((s) => [s.id, s]));
}

function loadStudents({ force = false } = {}) {
    const key = studentStatisticsKey();
    if (!studentsRendered) {
        const cached = readCache(key);
        if (cached) {
            useStudentPayload(cached.data);
            onStudentsReady();
        }
    }
    if (!force && studentsRendered && isFresh(readCache(key), MAX_AGE_MS)) return Promise.resolve();
    if (studentsLoading) return studentsLoading;
    studentsLoading = revalidate(key, fetchStudentStatistics)
        .then(({ data, current }) => {
            if (!current) return;
            hideStaleNote(els.studentsStale);
            useStudentPayload(data);
            onStudentsReady();
        })
        .catch(onStudentsError)
        .finally(() => { studentsLoading = null; });
    return studentsLoading;
}

function onStudentsReady() {
    renderStudentList();
    if (detail) renderCurrentDetail();
}

function onStudentsError(error) {
    console.error('Student statistics load failed:', error);
    if (error?.status === 401) {
        document.dispatchEvent(new CustomEvent('app:authexpired'));
        return;
    }
    const retry = () => {
        hideStaleNote(els.studentsStale);
        if (!studentsRendered) showSkeletonRows(els.studentList, { count: 3 });
        if (detail && !studentStats) renderDetailLoading();
        loadStudents({ force: true });
    };
    if (studentsRendered) {
        showStaleNote(els.studentsStale, retry);
        return;
    }
    els.studentsLoading?.remove();
    els.studentsLoading = null;
    const message = t('tp_stats_students_error', 'Неуспешно зареждане на студентите.');
    showLoadError(els.studentList, message, retry);
    if (detail) {
        els.detail.replaceChildren(backButton());
        const box = el('div');
        els.detail.appendChild(box);
        showLoadError(box, message, retry);
    }
}

// ---------- По студенти: list ----------

function normalizeSearch(value) {
    return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function sortedStudents() {
    const list = studentStats.students.slice();
    const byName = (a, b) => a.name.localeCompare(b.name, lang() === 'bg' ? 'bg' : 'en');
    const sort = els.sort?.value || 'name';
    if (sort === 'rate') {
        // lowest first; students without lessons last
        list.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || byName(a, b));
    } else if (sort === 'streak') {
        list.sort((a, b) => b.streak.current - a.streak.current || (a.rate ?? 101) - (b.rate ?? 101) || byName(a, b));
    } else {
        list.sort(byName);
    }
    return list;
}

function studentRow(s) {
    const li = el('li');
    const link = el('a', 'tp-stats-row tp-stats-row--link');
    link.href = `${DETAIL_PREFIX}${s.id}`;
    link.dataset.studentId = String(s.id);

    const main = el('div', 'tp-stats-main');
    const metaParts = [];
    if (s.facultyNumber) metaParts.push(s.facultyNumber);
    metaParts.push(countText(s.courses.length, 'tp_stats_courses_one', '{n} дисциплина', 'tp_stats_courses_many', '{n} дисциплини'));
    metaParts.push(countText(s.held, 'tp_stats_lessons_one', '{n} занятие', 'tp_stats_lessons_many', '{n} занятия'));
    main.append(el('h3', 'tp-stats-name', s.name), el('p', 'tp-stats-meta', metaParts.join(' · ')));

    const figure = rateFigure(s.rate, t('tp_stats_overall', 'Обща посещаемост'));
    if (s.held === 0) {
        figure.appendChild(el('span', 'tp-stats-note', t('tp_stats_no_lessons', 'Няма проведени занятия')));
    } else {
        const flags = [];
        if (s.belowCourses > 0) {
            flags.push(countText(s.belowCourses, 'tp_stats_below_courses_one', 'Под 50% в {n} дисциплина', 'tp_stats_below_courses_many', 'Под 50% в {n} дисциплини'));
        }
        if (s.streak.current >= 2) {
            flags.push(tf('tp_stats_streak_badge', '{n} поредни отсъствия', { n: s.streak.current }));
        }
        if (flags.length) figure.appendChild(el('span', 'tp-stats-low tp-stats-flags', flags.join(' · ')));
    }

    link.append(main, figure, chevronIcon());
    li.appendChild(link);
    return li;
}

function renderStudentList() {
    if (!studentStats || !els.studentList) return;
    const query = normalizeSearch(els.search?.value);
    const all = sortedStudents();
    const shown = query
        ? all.filter((s) => normalizeSearch(`${s.name} ${s.facultyNumber}`).includes(query))
        : all;

    const fragment = document.createDocumentFragment();
    shown.forEach((s) => fragment.appendChild(studentRow(s)));
    els.studentList.replaceChildren(fragment);
    endBusy(els.studentList);
    els.studentsNone.hidden = all.length > 0;
    els.studentsNoMatch.hidden = !(all.length > 0 && shown.length === 0);
    if (els.searchStatus) {
        els.searchStatus.textContent = query ? tf('tp_stats_found', '{n} намерени', { n: shown.length }) : '';
    }
    if (!studentsRendered) {
        els.studentsLoading?.remove();
        els.studentsLoading = null;
        studentsRendered = true;
    }
}

function plainClick(event) {
    return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function onStudentLinkClick(event) {
    const link = event.target.closest('a[data-student-id]');
    if (!link || !plainClick(event)) return;
    event.preventDefault();
    listScrollY = window.scrollY;
    listScrollTop = els.studentList.scrollTop;
    history.pushState({ tpView: 'statistics', tpStatsFromList: true }, '', link.getAttribute('href'));
    showStatisticsView({ focus: true });
}

function onClassLinkClick(event) {
    const link = event.target.closest('a[data-class-link]');
    if (!link || !plainClick(event)) return;
    event.preventDefault();
    listScrollY = window.scrollY;
    listScrollTop = els.list.scrollTop;
    history.pushState({ tpView: 'statistics', tpStatsFromList: true }, '', link.getAttribute('href'));
    showStatisticsView({ focus: true });
}

function classNameOf(id) {
    return studentPayload?.courses?.find((c) => String(c.id) === String(id))?.name
        || lastData?.classes?.find((c) => String(c.id) === String(id))?.name
        || '';
}

/**
 * A lesson or a student opened from a discipline's or a lesson's page: Back
 * returns to that page, where the teacher left it.
 */
function onDetailLinkClick(event) {
    if (!detail || detail.kind === 'student' || !plainClick(event)) return;
    const link = event.target.closest('a[data-student-id], a[data-lesson-id]');
    if (!link) return;
    event.preventDefault();
    detailScroll.set(detailKey(detail), window.scrollY);
    const state = { tpView: 'statistics', tpStatsFromList: true };
    if (link.dataset.studentId) {
        if (detail.kind === 'lesson') state.tpStatsFromLesson = true;
        else state.tpStatsFromClass = classNameOf(detail.id);
    }
    history.pushState(state, '', link.getAttribute('href'));
    showStatisticsView({ focus: true });
}

// ---------- По студенти: one student ----------

// { kind: 'student' | 'class' | 'lesson', id, lessonId? } while a detail page is shown
// (for a lesson, id is its discipline)
let detail = null;
let listScrollY = 0;
let listScrollTop = 0;
const detailScroll = new Map(); // detail page -> scroll position when a link on it was opened

function detailKey(d) {
    return d ? `${d.kind}:${d.id}:${d.lessonId ?? ''}` : '';
}

function detailFromLocation() {
    const hash = location.hash;
    if (hash.startsWith(CLASS_PREFIX)) {
        const match = hash.slice(CLASS_PREFIX.length).match(/^(\d+)(?:\/lesson\/(\d+))?/);
        const id = match ? Number(match[1]) : 0;
        if (!(id > 0)) return null;
        const lessonId = match[2] ? Number(match[2]) : 0;
        return lessonId > 0 ? { kind: 'lesson', id, lessonId } : { kind: 'class', id };
    }
    if (!hash.startsWith(DETAIL_PREFIX)) return null;
    const id = Number.parseInt(hash.slice(DETAIL_PREFIX.length), 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { kind: 'student', id };
}

const HEADING_ID = { class: 'statsClassName', lesson: 'statsLessonName', student: 'statsStudentName' };

function renderCurrentDetail() {
    if (!detail) return;
    // A re-render (data arrived, language changed) must not drop keyboard focus
    const active = document.activeElement;
    const focusedId = active && els.detail.contains(active) ? active.id : '';
    const focusLost = !active || active === document.body;
    if (detail.kind === 'class') renderClassDetail(detail.id);
    else if (detail.kind === 'lesson') renderLessonDetail(detail.id, detail.lessonId);
    else renderDetail(detail.id);
    const heading = document.getElementById(HEADING_ID[detail.kind]);
    const target = (focusedId && document.getElementById(focusedId)) || ((focusedId || focusLost) && heading);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
}

function backButton() {
    const button = el('button', 'tp-back');
    button.type = 'button';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'tp-icon tp-back-icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#tp-i-chevron-right');
    icon.appendChild(use);
    const fromClass = history.state?.tpStatsFromClass;
    let label;
    if (detail?.kind === 'class') label = t('tp_cls_back', 'Всички дисциплини');
    else if (detail?.kind === 'lesson') label = tf('tp_stats_back_to', 'Назад към „{name}“', { name: classNameOf(detail.id) });
    else if (history.state?.tpStatsFromLesson) label = t('tp_les_back_to_lesson', 'Назад към занятието');
    else if (fromClass) label = tf('tp_stats_back_to', 'Назад към „{name}“', { name: fromClass });
    else label = t('tp_stats_back', 'Всички студенти');
    button.append(icon, el('span', null, label));
    button.addEventListener('click', () => {
        if (history.state && history.state.tpStatsFromList) {
            history.back();
            return;
        }
        // Opened from a link: a lesson goes up to its discipline, the rest to the list
        const up = detail?.kind === 'lesson' ? `${CLASS_PREFIX}${detail.id}` : '#statistics';
        history.replaceState({ tpView: 'statistics' }, '', up);
        showStatisticsView({ focus: true });
    });
    return button;
}

function renderDetailLoading() {
    els.detail.replaceChildren(backButton());
    const status = el('p', 'sk-status-text', t('tp_stats_students_loading', 'Зареждане на студентите…'));
    status.setAttribute('role', 'status');
    const skeleton = el('div', 'tp-stats-detail-skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = '<span class="sk sk-line" style="--sk-w:55%;height:22px"></span><span class="sk sk-line sk-line--sub" style="--sk-w:35%"></span>';
    els.detail.append(status, skeleton);
    els.detail.setAttribute('aria-busy', 'true');
}

function statTile(label, value, sub) {
    const tile = el('div', 'tp-stat-tile');
    tile.append(el('span', 'tp-stat-label', label), el('span', 'tp-stat-value', value));
    if (sub) tile.appendChild(el('span', 'tp-stat-sub', sub));
    return tile;
}

function timingTiles(timing) {
    const late = timing.arrivals > 0
        ? statTile(
            t('tp_stats_late_title', 'Закъснения'),
            tf('tp_stats_n_of_m', '{n} от {m}', { n: timing.lateCount, m: timing.arrivals }),
            timing.lateCount > 0
                ? tf('tp_stats_avg_min_late', 'средно с {n} мин', { n: timing.lateAvgMinutes })
                : t('tp_stats_never_late', 'не е закъснявал')
        )
        : statTile(t('tp_stats_late_title', 'Закъснения'), '—', t('tp_stats_no_data', 'няма данни'));

    const inClass = timing.inClassLessons > 0
        ? statTile(
            t('tp_stats_inclass_title', 'Време в час'),
            pct(timing.inClassPercent),
            timing.earlyCount > 0
                ? tf('tp_stats_left_early_sub', 'тръгнал по-рано {n} от {m} пъти', { n: timing.earlyCount, m: timing.departures })
                : tf('tp_stats_lessons_with_scans', 'от {n} занятия с излизане', { n: timing.inClassLessons })
        )
        : statTile(t('tp_stats_inclass_title', 'Време в час'), '—', t('tp_stats_no_data', 'няма данни'));
    return [late, inClass];
}

function distanceText(distance) {
    if (!distance) return null;
    if (distance.canMiss !== undefined) {
        if (distance.canMiss === 0) return { text: t('tp_stats_can_miss_zero', 'Още едно отсъствие и пада под 50%.'), low: true };
        return {
            text: countText(distance.canMiss,
                'tp_stats_can_miss_one', 'Може да отсъства още {n} път, без да падне под 50%.',
                'tp_stats_can_miss_many', 'Може да отсъства още {n} пъти, без да падне под 50%.'),
            low: false
        };
    }
    return {
        text: countText(distance.needed,
            'tp_stats_needs_one', 'Под 50%: трябва да присъства на {n} занятие подред, за да стигне 50%.',
            'tp_stats_needs_many', 'Под 50%: трябва да присъства на {n} поредни занятия, за да стигне 50%.'),
        low: true
    };
}

function courseTimingLines(timing) {
    const lines = [];
    if (timing.arrivals > 0) {
        lines.push(timing.lateCount > 0
            ? tf('tp_stats_late_line', 'Закъснял на {n} от {m} занятия, средно с {x} мин', { n: timing.lateCount, m: timing.arrivals, x: timing.lateAvgMinutes })
            : tf('tp_stats_late_none', 'Не е закъснявал ({m} занятия с час на влизане)', { m: timing.arrivals }));
    }
    if (timing.departures > 0) {
        lines.push(timing.earlyCount > 0
            ? tf('tp_stats_early_line', 'Тръгнал по-рано {n} от {m} пъти, средно {x} мин преди края', { n: timing.earlyCount, m: timing.departures, x: timing.earlyAvgMinutes })
            : tf('tp_stats_early_none', 'Не е тръгвал по-рано ({m} занятия с час на излизане)', { m: timing.departures }));
    }
    if (timing.inClassLessons > 0) {
        lines.push(tf('tp_stats_inclass_line', 'Средно {p}% от занятието в час ({m} занятия)', { p: timing.inClassPercent, m: timing.inClassLessons }));
    }
    return lines;
}

function courseCard(course) {
    const li = el('li', 'tp-stats-course');
    const head = el('div', 'tp-stats-row tp-stats-row--flat');
    const main = el('div', 'tp-stats-main');
    main.append(
        el('h4', 'tp-stats-name', course.name),
        el('p', 'tp-stats-meta', course.held > 0
            ? tf('tp_stats_of_lessons', '{a} от {h} занятия', { a: course.attended, h: course.held })
            : t('tp_stats_no_lessons', 'Няма проведени занятия'))
    );
    head.append(main, rateFigure(course.rate, course.name));
    li.appendChild(head);

    if (course.held > 0) {
        const lines = el('ul', 'tp-stats-lines');
        const distance = distanceText(course.distance);
        if (distance) lines.appendChild(el('li', distance.low ? 'is-low' : null, distance.text));
        lines.appendChild(el('li', course.streak.current >= 2 ? 'is-low' : null,
            tf('tp_stats_streak_line', 'Поредни отсъствия: {c} сега, най-много {l}', { c: course.streak.current, l: course.streak.longest })));
        courseTimingLines(course.timing).forEach((line) => lines.appendChild(el('li', null, line)));
        li.appendChild(lines);
    }
    return li;
}

// ----- trend chart: one series (attendance % per period), 50% reference line -----

let trendUnit = readPref(TREND_UNIT_KEY, ['week', 'month'], 'week');

function periodLabel(start, unit, { long = false } = {}) {
    const locale = lang() === 'en' ? 'en-GB' : 'bg-BG';
    const date = new Date(start);
    if (unit === 'month') {
        return date.toLocaleDateString(locale, long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' });
    }
    const day = date.toLocaleDateString(locale, long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' });
    return long ? tf('tp_stats_week_of', 'Седмица от {d}', { d: day }) : day;
}

function trendSection(subject) {
    const section = el('section', 'tp-trend');
    const headingId = `statsTrendTitle-${subject.id}`;
    section.setAttribute('aria-labelledby', headingId);

    const head = el('div', 'tp-trend-head');
    const heading = el('h3', 'tp-stats-subheading', t('tp_stats_trend', 'Тенденция'));
    heading.id = headingId;
    const seg = el('div', 'tp-seg tp-seg--small');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', t('tp_stats_trend_unit', 'Период'));
    [['week', t('tp_stats_weeks', 'Седмици')], ['month', t('tp_stats_months', 'Месеци')]].forEach(([unit, label]) => {
        const button = el('button', 'tp-seg-btn', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(trendUnit === unit));
        button.addEventListener('click', () => {
            if (trendUnit === unit) return;
            trendUnit = unit;
            writePref(TREND_UNIT_KEY, unit);
            const fresh = trendSection(subject);
            section.replaceWith(fresh);
            fresh.querySelector(`.tp-seg-btn[aria-pressed="true"]`)?.focus({ preventScroll: true });
        });
        seg.appendChild(button);
    });
    head.append(heading, seg);
    section.appendChild(head);

    const points = trend(subject.entries, trendUnit);
    if (points.length === 0) {
        section.appendChild(el('p', 'tp-stats-note tp-trend-empty', t('tp_stats_trend_empty', 'Все още няма занятия с дата.')));
        return section;
    }

    const direction = trendDirection(points);
    if (direction) {
        const text = {
            up: t('tp_stats_trend_up', 'Подобрява се спрямо по-ранните периоди'),
            down: t('tp_stats_trend_down', 'Влошава се спрямо по-ранните периоди'),
            flat: t('tp_stats_trend_flat', 'Без съществена промяна')
        }[direction];
        const note = el('p', `tp-trend-direction is-${direction}`);
        const arrow = el('span', 'tp-trend-arrow', direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→');
        arrow.setAttribute('aria-hidden', 'true');
        note.append(arrow, el('span', null, text));
        section.appendChild(note);
    }

    section.style.setProperty('--n', String(points.length));
    const plot = el('div', 'tp-trend-plot');
    const ref = el('div', 'tp-trend-ref');
    ref.appendChild(el('span', 'tp-trend-ref-label', `${LOW_ATTENDANCE_PERCENT}%`));
    const bars = el('ul', 'tp-trend-bars');
    bars.setAttribute('aria-label', t('tp_stats_trend', 'Тенденция'));
    const tip = el('div', 'tp-trend-tip');
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');

    const describe = (p) => `${periodLabel(p.start, trendUnit, { long: true })}: ${tf('tp_stats_of_lessons', '{a} от {h} занятия', { a: p.attended, h: p.held })} (${pct(p.rate)})`;
    const showTip = (button, p) => {
        tip.textContent = describe(p);
        tip.hidden = false;
        const plotBox = plot.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        const center = box.left + box.width / 2 - plotBox.left;
        const half = tip.offsetWidth / 2;
        tip.style.left = `${Math.min(Math.max(center, half), plotBox.width - half)}px`;
        bars.querySelectorAll('.tp-trend-bar.is-active').forEach((b) => b.classList.remove('is-active'));
        button.classList.add('is-active');
    };
    const hideTip = () => {
        tip.hidden = true;
        bars.querySelectorAll('.tp-trend-bar.is-active').forEach((b) => b.classList.remove('is-active'));
    };

    points.forEach((p) => {
        const li = el('li', 'tp-trend-item');
        const button = el('button', 'tp-trend-bar');
        button.type = 'button';
        button.setAttribute('aria-label', describe(p));
        const fill = el('span', `tp-trend-fill${p.rate < LOW_ATTENDANCE_PERCENT ? ' is-low' : ''}${p.rate === 0 ? ' is-zero' : ''}`);
        fill.style.height = `${p.rate}%`;
        button.appendChild(fill);
        button.addEventListener('pointerenter', () => showTip(button, p));
        button.addEventListener('focus', () => showTip(button, p));
        button.addEventListener('click', () => showTip(button, p));
        li.appendChild(button);
        bars.appendChild(li);
    });
    plot.addEventListener('pointerleave', hideTip);
    bars.addEventListener('focusout', (event) => { if (!bars.contains(event.relatedTarget)) hideTip(); });
    plot.append(ref, bars, tip);
    section.appendChild(plot);

    const axis = el('div', 'tp-trend-axis');
    axis.setAttribute('aria-hidden', 'true');
    axis.append(el('span', null, periodLabel(points[0].start, trendUnit)));
    if (points.length > 1) axis.append(el('span', null, periodLabel(points[points.length - 1].start, trendUnit)));
    section.appendChild(axis);
    return section;
}

function renderDetail(id) {
    if (!els.detail) return;
    if (!studentStats) {
        renderDetailLoading();
        return;
    }
    els.detail.removeAttribute('aria-busy');
    const student = studentStats.byId.get(id);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(backButton());

    if (!student) {
        fragment.appendChild(el('p', 'tp-empty', t('tp_stats_student_missing', 'Студентът не е намерен.')));
        els.detail.replaceChildren(fragment);
        return;
    }

    const name = el('h2', 'tp-stats-detail-name', student.name);
    name.id = 'statsStudentName';
    name.tabIndex = -1;
    const metaParts = [];
    if (student.facultyNumber) metaParts.push(tf('tp_stats_fn', 'Фак. № {n}', { n: student.facultyNumber }));
    metaParts.push(countText(student.courses.length, 'tp_stats_courses_one', '{n} дисциплина', 'tp_stats_courses_many', '{n} дисциплини'));
    fragment.append(name, el('p', 'tp-stats-meta', metaParts.join(' · ')));

    const tiles = el('div', 'tp-stat-tiles tp-stat-tiles--detail');
    tiles.append(
        statTile(
            t('tp_stats_overall', 'Обща посещаемост'),
            pct(student.rate),
            student.held > 0 ? tf('tp_stats_of_lessons', '{a} от {h} занятия', { a: student.attended, h: student.held }) : t('tp_stats_no_lessons', 'Няма проведени занятия')
        ),
        statTile(
            t('tp_stats_streak_title', 'Поредни отсъствия'),
            String(student.streak.current),
            tf('tp_stats_streak_sub', 'най-много: {n}', { n: student.streak.longest })
        ),
        ...timingTiles(student.timing)
    );
    if (student.rate !== null && student.rate < LOW_ATTENDANCE_PERCENT) tiles.firstChild.classList.add('is-low');
    if (student.streak.current >= 2) tiles.children[1].classList.add('is-low');
    fragment.appendChild(tiles);

    fragment.appendChild(trendSection(student));

    const coursesHeading = el('h3', 'tp-stats-subheading', t('tp_stats_per_class', 'По дисциплини'));
    coursesHeading.id = 'statsStudentCoursesTitle';
    const courses = el('ul', 'tp-stats-courses');
    courses.setAttribute('aria-labelledby', 'statsStudentCoursesTitle');
    student.courses.forEach((course) => courses.appendChild(courseCard(course)));
    fragment.append(coursesHeading, courses);

    fragment.appendChild(el('p', 'tp-stats-footnote', tf('tp_stats_footnote',
        'Началото и краят на занятието са първото и последното сканиране в него. Закъснение е влизане над {late} мин след началото, ранно тръгване — излизане над {early} мин преди края. Поредните отсъствия са в рамките на една дисциплина.',
        { late: LATE_GRACE_MINUTES, early: EARLY_GRACE_MINUTES })));

    els.detail.replaceChildren(fragment);
}

// ---------- one discipline ----------

/**
 * Discipline numbers from the per-student payload. The average and "below
 * 50%" use the same formula as the discipline's row (attended out of every
 * lesson held, per enrolled student), so the two always agree.
 */
function classStats(classId) {
    const id = Number(classId);
    const course = (studentPayload?.courses || []).find((c) => Number(c.id) === id);
    if (!course) return null;
    const lessons = (studentPayload.lessons || []).filter((l) => l[1] === id);
    const rows = studentStats.students
        .map((s) => ({ student: s, course: s.courses.find((c) => c.id === id) }))
        .filter((r) => r.course);
    const perLesson = new Map(lessons.map((l) => [l[0], { lesson: l, present: 0, recorded: 0 }]));
    const entries = [];
    rows.forEach(({ student }) => student.entries.forEach((e) => {
        if (e.lesson[1] !== id) return;
        entries.push(e);
        const pl = perLesson.get(e.lesson[0]);
        if (!pl) return;
        pl.recorded += 1;
        if (e.record.present) pl.present += 1;
    }));
    const held = lessons.length;
    const attended = rows.reduce((a, r) => a + r.course.attended, 0);
    const possible = rows.length * held;
    const recordedLessons = Array.from(perLesson.values()).filter((p) => p.recorded > 0);
    const dated = Array.from(perLesson.values()).filter((p) => p.lesson[2] !== null).sort((a, b) => b.lesson[2] - a.lesson[2]);
    return {
        id,
        name: String(course.name || ''),
        rows,
        held,
        attended,
        possible,
        average: possible > 0 ? Math.round((attended / possible) * 100) : null,
        low: held > 0 ? rows.filter((r) => (r.course.attended / held) * 100 < LOW_ATTENDANCE_PERCENT).length : 0,
        perLessonAvg: recordedLessons.length ? recordedLessons.reduce((a, p) => a + p.present, 0) / recordedLessons.length : null,
        last: dated[0] || null,
        // newest first; lessons migrated without a date at the end
        lessons: [...dated, ...Array.from(perLesson.values()).filter((p) => p.lesson[2] === null)],
        entries
    };
}

function lessonDate(ms, opts = { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) {
    return new Date(ms).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'bg-BG', opts);
}

function lessonLabel(lesson) {
    return lesson[2] === null ? t('tp_cls_undated', 'Без дата (пренесено занятие)') : lessonDate(lesson[2]);
}

function lessonRow(p, classId) {
    const li = el('li');
    const link = el('a', 'tp-stats-row tp-stats-row--link tp-stats-row--lesson');
    link.href = `${CLASS_PREFIX}${classId}/lesson/${p.lesson[0]}`;
    link.dataset.lessonId = String(p.lesson[0]);
    const main = el('div', 'tp-stats-main');
    main.append(
        el('h4', 'tp-stats-name', lessonLabel(p.lesson)),
        el('p', 'tp-stats-meta', p.recorded > 0
            ? tf('tp_cls_attended_of', '{a} от {h} присъстваха', { a: p.present, h: p.recorded })
            : t('tp_cls_no_records', 'Няма записи за това занятие'))
    );
    const rate = p.recorded > 0 ? Math.round((p.present / p.recorded) * 100) : null;
    link.append(main, rateFigure(rate, t('tp_stats_average', 'Средна посещаемост')), chevronIcon());
    li.appendChild(link);
    return li;
}

function classStudentRow({ student, course }) {
    const li = el('li');
    const link = el('a', 'tp-stats-row tp-stats-row--link');
    link.href = `${DETAIL_PREFIX}${student.id}`;
    link.dataset.studentId = String(student.id);
    const main = el('div', 'tp-stats-main');
    const meta = [];
    if (student.facultyNumber) meta.push(student.facultyNumber);
    meta.push(course.held > 0
        ? tf('tp_stats_of_lessons', '{a} от {h} занятия', { a: course.attended, h: course.held })
        : t('tp_stats_no_lessons', 'Няма проведени занятия'));
    main.append(el('h4', 'tp-stats-name', student.name), el('p', 'tp-stats-meta', meta.join(' · ')));
    const figure = rateFigure(course.rate, student.name);
    const flags = [];
    if (course.below) flags.push(t('tp_cls_below', 'Под 50%'));
    if (course.streak.current >= 2) flags.push(tf('tp_stats_streak_badge', '{n} поредни отсъствия', { n: course.streak.current }));
    if (flags.length) figure.appendChild(el('span', 'tp-stats-low tp-stats-flags', flags.join(' · ')));
    link.append(main, figure, chevronIcon());
    li.appendChild(link);
    return li;
}

function renderClassDetail(id) {
    if (!els.detail) return;
    // The name is known from the list right away; the numbers need the payload
    const known = lastData?.classes?.find((c) => Number(c.id) === Number(id));
    if (!studentStats) {
        renderDetailLoading();
        if (known) {
            const name = el('h2', 'tp-stats-detail-name', known.name);
            name.id = 'statsClassName';
            name.tabIndex = -1;
            els.detail.querySelector('.tp-back')?.after(name);
        }
        return;
    }
    els.detail.removeAttribute('aria-busy');
    const c = classStats(id);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(backButton());
    if (!c) {
        fragment.appendChild(el('p', 'tp-empty', t('tp_cls_missing', 'Дисциплината не е намерена.')));
        els.detail.replaceChildren(fragment);
        return;
    }

    const name = el('h2', 'tp-stats-detail-name', c.name);
    name.id = 'statsClassName';
    name.tabIndex = -1;
    fragment.append(name, el('p', 'tp-stats-meta', `${countText(c.rows.length, 'tp_stats_students_one', '{n} студент', 'tp_stats_students_many', '{n} студенти')} · ${countText(c.held, 'tp_stats_lessons_one', '{n} занятие', 'tp_stats_lessons_many', '{n} занятия')}`));

    const nf = new Intl.NumberFormat(lang() === 'en' ? 'en-GB' : 'bg-BG', { maximumFractionDigits: 1 });
    const tiles = el('div', 'tp-stat-tiles tp-stat-tiles--detail');
    tiles.append(
        statTile(t('tp_stats_average', 'Средна посещаемост'), pct(c.average),
            c.possible > 0 ? tf('tp_cls_presences', '{a} от {p} възможни присъствия', { a: c.attended, p: c.possible }) : t('tp_stats_no_lessons', 'Няма проведени занятия')),
        statTile(t('tp_cls_low_title', 'Под 50%'), String(c.low),
            countText(c.rows.length, 'tp_cls_of_students_one', 'от {n} студент', 'tp_cls_of_students_many', 'от {n} студенти')),
        statTile(t('tp_cls_per_lesson', 'Средно присъстващи'), c.perLessonAvg === null ? '—' : nf.format(c.perLessonAvg),
            t('tp_cls_per_lesson_sub', 'на занятие')),
        statTile(t('tp_cls_last', 'Последно занятие'),
            c.last ? lessonDate(c.last.lesson[2], { day: 'numeric', month: 'long' }) : '—',
            c.last ? tf('tp_cls_attended_of', '{a} от {h} присъстваха', { a: c.last.present, h: c.last.recorded }) : t('tp_cls_no_dated', 'няма занятия с дата'))
    );
    if (c.average !== null && c.average < LOW_ATTENDANCE_PERCENT) tiles.firstChild.classList.add('is-low');
    if (c.low > 0) tiles.children[1].classList.add('is-low');
    fragment.appendChild(tiles);

    fragment.appendChild(trendSection({ id: `class-${c.id}`, entries: c.entries }));

    // Lessons, newest first
    const lessonsHeading = el('h3', 'tp-stats-subheading', t('tp_cls_lessons', 'Занятия'));
    lessonsHeading.id = 'statsClassLessonsTitle';
    fragment.appendChild(lessonsHeading);
    if (c.lessons.length === 0) {
        fragment.appendChild(el('p', 'tp-empty', t('tp_cls_no_lessons', 'Все още няма проведени занятия.')));
    } else {
        const ul = el('ul', 'tp-stats-courses tp-stats-lessons');
        ul.setAttribute('aria-labelledby', 'statsClassLessonsTitle');
        c.lessons.forEach((p) => ul.appendChild(lessonRow(p, c.id)));
        fragment.appendChild(ul);
    }

    // Students, lowest attendance first (each opens the student's page)
    const studentsHeading = el('h3', 'tp-stats-subheading', t('tp_stats_students', 'Студенти'));
    studentsHeading.id = 'statsClassStudentsTitle';
    fragment.appendChild(studentsHeading);
    if (c.rows.length === 0) {
        fragment.appendChild(el('p', 'tp-empty', t('tp_cls_no_students', 'В дисциплината няма записани студенти.')));
    } else {
        const ul = el('ul', 'tp-stats-courses');
        ul.setAttribute('aria-labelledby', 'statsClassStudentsTitle');
        c.rows.slice()
            .sort((a, b) => (a.course.rate ?? 101) - (b.course.rate ?? 101) || a.student.name.localeCompare(b.student.name, lang() === 'bg' ? 'bg' : 'en'))
            .forEach((r) => ul.appendChild(classStudentRow(r)));
        fragment.appendChild(ul);
    }

    fragment.appendChild(el('p', 'tp-stats-footnote', t('tp_cls_footnote',
        'Средната посещаемост и „Под 50%“ са спрямо всички проведени занятия в дисциплината (както в списъка). При всеки студент се броят занятията, за които има запис.')));
    els.detail.replaceChildren(fragment);
}

// ---------- one lesson ----------

function timeOf(ms) {
    return new Date(ms).toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'bg-BG', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Who was present, absent or has no record in one lesson. Lateness and early
 * leaving follow the student pages: measured from the first / last scan of
 * the lesson, beyond the same grace minutes.
 */
function lessonStats(classId, lessonId) {
    const c = classStats(classId);
    if (!c) return null;
    const p = c.lessons.find((x) => x.lesson[0] === lessonId);
    if (!p) return { c, p: null };
    const [, , started, ended] = p.lesson;
    const present = [];
    const absent = [];
    const none = [];
    let arrivals = 0;
    let departures = 0;
    c.rows.forEach(({ student }) => {
        const entry = student.entries.find((e) => e.lesson[0] === lessonId);
        if (!entry) { none.push({ student }); return; }
        const { joined, left } = entry.record;
        if (!entry.record.present) { absent.push({ student, joined, left }); return; }
        const lateMin = joined !== null && started !== null ? Math.max(0, (joined - started) / MINUTE) : null;
        const earlyMin = left !== null && ended !== null ? Math.max(0, (ended - left) / MINUTE) : null;
        if (lateMin !== null) arrivals += 1;
        if (earlyMin !== null) departures += 1;
        present.push({
            student, joined, left,
            late: lateMin !== null && lateMin > LATE_GRACE_MINUTES ? Math.round(lateMin) : null,
            early: earlyMin !== null && earlyMin > EARLY_GRACE_MINUTES ? Math.round(earlyMin) : null
        });
    });
    const collator = new Intl.Collator(lang() === 'en' ? 'en' : 'bg', { sensitivity: 'base' });
    const byName = (a, b) => collator.compare(a.student.name, b.student.name) || a.student.id - b.student.id;
    [present, absent, none].forEach((list) => list.sort(byName));
    return {
        c, p, started, ended, present, absent, none, arrivals, departures,
        late: present.filter((r) => r.late !== null).length,
        early: present.filter((r) => r.early !== null).length
    };
}

const LESSON_STATUS = {
    present: ['tp_les_status_present', 'Присъства'],
    absent: ['tp_les_status_absent', 'Отсъства'],
    none: ['tp_les_status_none', 'Без запис']
};

function lessonStudentRow(item, status) {
    const { student } = item;
    const li = el('li');
    const link = el('a', 'tp-stats-row tp-stats-row--link tp-les-row');
    link.href = `${DETAIL_PREFIX}${student.id}`;
    link.dataset.studentId = String(student.id);
    const main = el('div', 'tp-stats-main');
    const meta = [];
    if (student.facultyNumber) meta.push(student.facultyNumber);
    if (item.joined != null) meta.push(`${t('ahd_joined', 'Влизане')} ${timeOf(item.joined)}`);
    if (item.left != null) meta.push(`${t('ahd_left', 'Излизане')} ${timeOf(item.left)}`);
    main.appendChild(el('h4', 'tp-stats-name', student.name));
    if (meta.length) main.appendChild(el('p', 'tp-stats-meta', meta.join(' · ')));

    const side = el('div', 'tp-les-side');
    const [key, fallback] = LESSON_STATUS[status];
    side.appendChild(el('span', `tp-les-status is-${status}`, t(key, fallback)));
    const flags = [];
    if (item.late != null) flags.push(tf('tp_les_late_flag', 'Закъсня с {n} мин', { n: item.late }));
    if (item.early != null) flags.push(tf('tp_les_early_flag', 'Тръгна {n} мин по-рано', { n: item.early }));
    if (flags.length) side.appendChild(el('span', 'tp-stats-low tp-les-flags', flags.join(' · ')));
    link.append(main, side, chevronIcon());
    li.appendChild(link);
    return li;
}

function lessonSection(fragment, id, title, items, status, emptyText, note) {
    const heading = el('h3', 'tp-stats-subheading', title);
    heading.id = id;
    fragment.appendChild(heading);
    if (note) fragment.appendChild(el('p', 'tp-stats-meta tp-les-note', note));
    if (items.length === 0) {
        fragment.appendChild(el('p', 'tp-empty', emptyText));
        return;
    }
    const ul = el('ul', 'tp-stats-courses tp-les-list');
    ul.setAttribute('aria-labelledby', id);
    ul.dataset.status = status;
    items.forEach((item) => ul.appendChild(lessonStudentRow(item, status)));
    fragment.appendChild(ul);
}

function renderLessonDetail(classId, lessonId) {
    if (!els.detail) return;
    if (!studentStats) {
        renderDetailLoading();
        return;
    }
    els.detail.removeAttribute('aria-busy');
    const s = lessonStats(classId, lessonId);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(backButton());
    if (!s || !s.p) {
        fragment.appendChild(el('p', 'tp-empty', s
            ? t('tp_les_missing', 'Занятието не е намерено.')
            : t('tp_cls_missing', 'Дисциплината не е намерена.')));
        els.detail.replaceChildren(fragment);
        return;
    }
    const { c, p } = s;

    const name = el('h2', 'tp-stats-detail-name', lessonLabel(p.lesson));
    name.id = 'statsLessonName';
    name.tabIndex = -1;
    const meta = [c.name];
    if (s.started !== null) {
        meta.push(s.ended !== null && timeOf(s.ended) !== timeOf(s.started)
            ? `${timeOf(s.started)}–${timeOf(s.ended)}`
            : timeOf(s.started));
    }
    fragment.append(name, el('p', 'tp-stats-meta', meta.join(' · ')));

    const recorded = s.present.length + s.absent.length;
    const rate = recorded > 0 ? Math.round((s.present.length / recorded) * 100) : null;
    const noTimes = t('tp_les_no_times', 'няма записани часове');
    const tiles = el('div', 'tp-stat-tiles tp-stat-tiles--detail');
    tiles.append(
        statTile(t('tp_les_rate', 'Посещаемост'), pct(rate), recorded > 0
            ? tf('tp_cls_attended_of', '{a} от {h} присъстваха', { a: s.present.length, h: recorded })
            : t('tp_cls_no_records', 'Няма записи за това занятие')),
        statTile(t('tp_les_absent_tile', 'Отсъстваха'), String(s.absent.length),
            recorded > 0 ? tf('tp_les_of_recorded', 'от {n} с запис', { n: recorded }) : ''),
        statTile(t('tp_les_late_tile', 'Закъснели'), s.arrivals > 0 ? String(s.late) : '—',
            s.arrivals > 0 ? tf('tp_les_late_sub', 'над {n} мин след началото', { n: LATE_GRACE_MINUTES }) : noTimes),
        statTile(t('tp_les_early_tile', 'Тръгнали по-рано'), s.departures > 0 ? String(s.early) : '—',
            s.departures > 0 ? tf('tp_les_early_sub', 'над {n} мин преди края', { n: EARLY_GRACE_MINUTES }) : noTimes)
    );
    if (rate !== null && rate < LOW_ATTENDANCE_PERCENT) tiles.firstChild.classList.add('is-low');
    if (s.absent.length > 0) tiles.children[1].classList.add('is-low');
    fragment.appendChild(tiles);

    // Absent first: that is the list a teacher acts on
    lessonSection(fragment, 'statsLessonAbsentTitle',
        tf('tp_les_absent_title', 'Отсъстваха ({n})', { n: s.absent.length }), s.absent, 'absent',
        recorded > 0 ? t('tp_les_no_absent', 'Няма отсъстващи.') : t('tp_cls_no_records', 'Няма записи за това занятие'));
    lessonSection(fragment, 'statsLessonPresentTitle',
        tf('tp_les_present_title', 'Присъстваха ({n})', { n: s.present.length }), s.present, 'present',
        recorded > 0 ? t('tp_les_no_present', 'Никой не е присъствал.') : t('tp_cls_no_records', 'Няма записи за това занятие'));
    if (s.none.length > 0) {
        lessonSection(fragment, 'statsLessonNoneTitle',
            tf('tp_les_none_title', 'Без запис ({n})', { n: s.none.length }), s.none, 'none', '',
            t('tp_les_none_note', 'За тях няма сканиране или отбелязано отсъствие в това занятие (например са записани в дисциплината по-късно).'));
    }

    fragment.appendChild(el('p', 'tp-stats-footnote', tf('tp_les_footnote',
        'Началото и краят на занятието са първото и последното сканиране в него. Закъснение е влизане над {late} мин след началото, ранно тръгване — излизане над {early} мин преди края. Часовете са според часовата зона на устройството.',
        { late: LATE_GRACE_MINUTES, early: EARLY_GRACE_MINUTES })));
    els.detail.replaceChildren(fragment);
}

/** Show the overview, a student's, a discipline's or a lesson's page, following location.hash. */
function syncRoute({ focus = false } = {}) {
    const next = detailFromLocation();
    const previous = detail;
    detail = next;
    if (next) {
        document.documentElement.setAttribute('data-stats-detail', '');
        els.detail.hidden = false;
        els.region.hidden = true;
        document.getElementById('statsLoadingStatus')?.setAttribute('hidden', '');
        renderCurrentDetail();
        loadStudents();
        // Back from a deeper page (student -> lesson/discipline, lesson -> discipline):
        // restore the scroll position and focus the row that was opened
        const goingBack = Boolean(previous) && DETAIL_DEPTH[previous.kind] > DETAIL_DEPTH[next.kind];
        if (detailKey(previous) !== detailKey(next)) {
            window.scrollTo(0, goingBack ? (detailScroll.get(detailKey(next)) || 0) : 0);
        }
        if (focus) {
            const row = !goingBack ? null : previous.kind === 'lesson'
                ? els.detail.querySelector(`a[data-lesson-id="${CSS.escape(String(previous.lessonId))}"]`)
                : els.detail.querySelector(`a[data-student-id="${CSS.escape(String(previous.id))}"]`);
            (row || document.getElementById(HEADING_ID[next.kind]) || els.detail.querySelector('.tp-back'))
                ?.focus({ preventScroll: true });
        }
        return;
    }
    document.documentElement.removeAttribute('data-stats-detail');
    els.detail.hidden = true;
    els.detail.replaceChildren();
    els.region.hidden = false;
    document.getElementById('statsLoadingStatus')?.removeAttribute('hidden');
    if (previous) {
        // Back to the list the page was opened from, where the teacher left it
        const fromClasses = previous.kind !== 'student';
        setMode(fromClasses ? 'classes' : 'students');
        window.scrollTo(0, listScrollY);
        const list = fromClasses ? els.list : els.studentList;
        if (list) list.scrollTop = listScrollTop;
        if (focus) {
            const selector = fromClasses ? `a[data-class-link="${CSS.escape(String(previous.id))}"]` : `a[data-student-id="${CSS.escape(String(previous.id))}"]`;
            (list?.querySelector(selector) || document.getElementById('statisticsTitle'))?.focus({ preventScroll: true });
        }
    }
}

/** Called each time the Статистика view is shown or its sub-route changes. */
export function showStatisticsView({ focus = false } = {}) {
    bind();
    if (!rendered) {
        const cached = readCache(statisticsKey());
        if (cached) render(cached.data);
    }
    if (!modeRestored) {
        modeRestored = true;
        setMode(readPref(MODE_KEY, ['classes', 'students'], 'classes'), { persist: false });
    } else if (mode === 'students') {
        loadStudents();
    }
    syncRoute({ focus });
    refresh();
}

let modeRestored = false;

/** Warm the statistics on navigation intent (hover / focus / touch). */
export function prefetchStatistics() {
    if (!teacherScope()) return;
    if (isFresh(readCache(statisticsKey()), MAX_AGE_MS)) return;
    revalidate(statisticsKey(), computeStatistics).catch(() => {});
}
