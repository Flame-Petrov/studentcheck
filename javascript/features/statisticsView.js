/**
 * Статистика view (teacherHomepage.html#statistics).
 *
 * Built from data the API already provides:
 *   GET /classes                      -> disciplines + lessons held (completed_classes_count)
 *   GET /attendance/summary?class_id  -> enrolled students + lessons each attended
 * Totals: disciplines, unique students, lessons held, average attendance.
 * Per discipline: students, lessons, average attendance, students below 50%.
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

const MAX_AGE_MS = 60 * 1000;
// Same threshold as the student page's "low attendance" badge
const LOW_ATTENDANCE_PERCENT = 50;
const CONCURRENCY = 4;

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

export function statisticsKey() {
    return cacheKey(teacherScope(), 'statistics');
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

// ---------- rendering ----------

const els = {};
let bound = false;
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
    document.addEventListener('app:languagechange', () => { if (lastData) render(lastData); });
}

function pct(value) {
    return value === null || value === undefined ? '—' : `${value}%`;
}

function countText(n, oneKey, oneFallback, manyKey, manyFallback) {
    return (n === 1 ? t(oneKey, oneFallback) : t(manyKey, manyFallback)).replace('{n}', String(n));
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
        const li = document.createElement('li');
        li.className = 'tp-stats-row';
        li.dataset.classId = c.id;

        const main = document.createElement('div');
        main.className = 'tp-stats-main';
        const name = document.createElement('h3');
        name.className = 'tp-stats-name';
        name.textContent = c.name;
        const meta = document.createElement('p');
        meta.className = 'tp-stats-meta';
        meta.textContent = `${countText(c.students, 'tp_stats_students_one', '{n} студент', 'tp_stats_students_many', '{n} студенти')} · ${countText(c.lessons, 'tp_stats_lessons_one', '{n} занятие', 'tp_stats_lessons_many', '{n} занятия')}`;
        main.append(name, meta);

        const figure = document.createElement('div');
        figure.className = 'tp-stats-figure';
        const value = document.createElement('span');
        value.className = 'tp-stats-pct';
        value.textContent = pct(average);
        const bar = document.createElement('span');
        bar.className = 'tp-stats-bar';
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', `${t('tp_stats_average', 'Средна посещаемост')}: ${pct(average)}`);
        const fill = document.createElement('span');
        fill.className = `tp-stats-fill${average !== null && average < LOW_ATTENDANCE_PERCENT ? ' is-low' : ''}`;
        fill.style.width = `${average ?? 0}%`;
        bar.appendChild(fill);
        figure.append(value, bar);

        if (c.low > 0) {
            const badge = document.createElement('span');
            badge.className = 'tp-stats-low';
            badge.textContent = countText(c.low, 'tp_stats_low_one', '{n} под 50%', 'tp_stats_low_many', '{n} под 50%');
            figure.appendChild(badge);
        } else if (c.lessons === 0) {
            const note = document.createElement('span');
            note.className = 'tp-stats-note';
            note.textContent = t('tp_stats_no_lessons', 'Няма проведени занятия');
            figure.appendChild(note);
        }

        li.append(main, figure);
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

/** Called each time the Статистика view is shown. */
export function showStatisticsView() {
    bind();
    if (!rendered) {
        const cached = readCache(statisticsKey());
        if (cached) render(cached.data);
    }
    refresh();
}

/** Warm the statistics on navigation intent (hover / focus / touch). */
export function prefetchStatistics() {
    if (!teacherScope()) return;
    if (isFresh(readCache(statisticsKey()), MAX_AGE_MS)) return;
    revalidate(statisticsKey(), computeStatistics).catch(() => {});
}
