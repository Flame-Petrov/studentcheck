import { SERVER_BASE_URL } from './config/api.js';
import { el, progressBar, stateBox, retryButton, signInLink } from './ui/index.js';

// A course is flagged "low attendance" when the attended share is below this.
const LOW_ATTENDANCE_THRESHOLD_PERCENT = 50;

const STUDENT_TOKEN_KEY = 'auth.student.token';
const STUDENT_TOKEN_EXPIRES_KEY = 'auth.student.expiresAt';
const SELECTED_COURSE_KEY = 'studentHome.selectedCourse';

const state = {
	student: null,
	courses: [],
	coursesStatus: 'idle', // idle | loading | ready | error | signin
	coursesPromise: null,
	lessons: new Map(), // courseId -> { status: loading|ready|error|signin, items: [] }
	selectedId: null,
	route: null,
	listScrollY: 0,
	// What is currently on screen; lets selection changes update in place
	// instead of rebuilding nodes (which would drop keyboard focus)
	coursesVersion: 0,
	listRenderKey: '',
	detailRenderedId: null
};

// ===== i18n helpers =====

function t(key, fallback) {
	try {
		if (window.i18n && typeof window.i18n.t === 'function') {
			const value = window.i18n.t(key);
			if (value && value !== key) return value;
		}
	} catch (_) {}
	return fallback !== undefined ? fallback : key;
}

function fmt(key, fallback, vars) {
	return t(key, fallback).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
}

function currentLocale() {
	const lang = window.i18n && typeof window.i18n.getLanguage === 'function' ? window.i18n.getLanguage() : 'en';
	return lang === 'bg' ? 'bg-BG' : 'en-GB';
}

function applyStaticTranslations() {
	document.querySelectorAll('[data-i18n]').forEach((el) => {
		if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
		el.textContent = t(el.dataset.i18n, el.dataset.i18nDefault);
	});
	document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
		el.dataset.i18nAttr.split(';').forEach((pair) => {
			const [attr, key] = pair.split(':');
			if (attr && key) el.setAttribute(attr, t(key, key));
		});
	});
}

// ===== Session / student data =====

function deriveDisplayName(loginData) {
	if (!loginData) return null;
	// Try common locations for a name
	const sources = [
		loginData.data?.student,
		loginData.data?.user,
		loginData.data,
	];

	for (const src of sources) {
		if (!src || typeof src !== 'object') continue;
		const first = src.firstName || src.firstname || src.first_name || src.givenName;
		const last = src.lastName || src.lastname || src.last_name || src.familyName;
		const name = src.name || src.fullName || src.full_name;
		if (name) return String(name);
		if (first || last) return [first, last].filter(Boolean).join(' ').trim();
	}
	return null;
}

function resolveStudentData(parsed) {
	if (!parsed || typeof parsed !== 'object') return null;
	const sources = [
		{ candidate: parsed.data?.student, owner: parsed.data },
		{ candidate: parsed.data?.user, owner: parsed.data },
		{ candidate: parsed.student, owner: parsed },
		{ candidate: parsed.user, owner: parsed },
		{ candidate: parsed.data, owner: parsed }
	];
	for (const source of sources) {
		const candidate = source?.candidate;
		if (candidate && typeof candidate === 'object') {
			const resolvedId = candidate.id
				|| candidate.student_id
				|| source?.owner?.id
				|| source?.owner?.student_id
				|| parsed?.id
				|| parsed?.student_id
				|| parsed?.data?.id
				|| parsed?.data?.student_id
				|| null;
			return {
				...candidate,
				id: candidate.id || candidate.student_id || resolvedId || undefined,
				student_id: candidate.student_id || candidate.id || resolvedId || undefined
			};
		}
	}
	return null;
}

function getStudentToken() {
	try {
		const token = sessionStorage.getItem(STUDENT_TOKEN_KEY) || '';
		const expiresAt = Number(sessionStorage.getItem(STUDENT_TOKEN_EXPIRES_KEY) || 0);
		if (token && expiresAt && Date.now() >= expiresAt) {
			sessionStorage.removeItem(STUDENT_TOKEN_KEY);
			sessionStorage.removeItem(STUDENT_TOKEN_EXPIRES_KEY);
			return '';
		}
		return token;
	} catch (_) {
		return '';
	}
}

async function studentFetch(path) {
	const token = getStudentToken();
	if (!token) {
		const err = new Error('Student session has no token');
		err.code = 'signin';
		throw err;
	}
	const response = await fetch(SERVER_BASE_URL + path, {
		headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
	});
	if (response.status === 401) {
		try { sessionStorage.removeItem(STUDENT_TOKEN_KEY); } catch (_) {}
		const err = new Error('Student token rejected');
		err.code = 'signin';
		throw err;
	}
	if (!response.ok) {
		const err = new Error(`Request failed: ${response.status}`);
		err.status = response.status;
		throw err;
	}
	return response.json();
}

// ===== Data =====

function loadCourses(force = false) {
	if (state.coursesPromise && !force) return state.coursesPromise;
	state.coursesStatus = 'loading';
	renderCourses();
	state.coursesPromise = studentFetch('/student/courses')
		.then((data) => {
			state.courses = (Array.isArray(data?.courses) ? data.courses : []).map((c) => ({
				id: Number(c.id),
				name: String(c.name || ''),
				attended: Math.max(0, Number(c.attended) || 0),
				total: Math.max(0, Number(c.total) || 0)
			}));
			// Natural order, so "Course 2" comes before "Course 10"
			const collator = new Intl.Collator(currentLocale(), { numeric: true, sensitivity: 'base' });
			state.courses.sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
			state.coursesStatus = 'ready';
			state.coursesVersion += 1;
		})
		.catch((err) => {
			console.error('[StudentHome] courses load failed', err);
			state.coursesStatus = err.code === 'signin' ? 'signin' : 'error';
			state.coursesPromise = null;
		})
		.finally(() => {
			if (state.route?.view === 'courses') applyRoute(parseRoute());
		});
	return state.coursesPromise;
}

function loadLessons(courseId, force = false) {
	const existing = state.lessons.get(courseId);
	if (existing && !force && existing.status !== 'error') return;
	state.lessons.set(courseId, { status: 'loading', items: [] });
	studentFetch(`/student/courses/${encodeURIComponent(courseId)}/lessons`)
		.then((data) => {
			const items = Array.isArray(data?.lessons) ? data.lessons : [];
			state.lessons.set(courseId, { status: 'ready', items });
		})
		.catch((err) => {
			console.error('[StudentHome] lessons load failed', err);
			state.lessons.set(courseId, { status: err.code === 'signin' ? 'signin' : 'error', items: [] });
		})
		.finally(() => {
			if (state.selectedId === courseId) renderLessonsSection();
		});
}

function courseStats(course) {
	const total = course.total;
	if (!(total > 0)) return { hasData: false };
	const attended = Math.min(course.attended, total);
	const ratio = (attended / total) * 100;
	return {
		hasData: true,
		attended,
		total,
		absences: total - attended,
		ratio,
		pct: Math.round(ratio),
		low: ratio < LOW_ATTENDANCE_THRESHOLD_PERCENT
	};
}

function lessonsCountText(attended, total) {
	return total === 1
		? fmt('sp_x_of_y_lessons_one', '{attended} of {total} lesson', { attended, total })
		: fmt('sp_x_of_y_lessons', '{attended} of {total} lessons', { attended, total });
}

function absencesText(n) {
	return n === 1
		? fmt('sp_absences_one', '{n} absence', { n })
		: fmt('sp_absences', '{n} absences', { n });
}

// ===== Routing =====

function parseRoute() {
	const hash = (location.hash || '').replace(/^#/, '');
	if (hash === 'courses' || hash.startsWith('courses/')) {
		const match = hash.match(/^courses\/(\d+)$/);
		return { view: 'courses', courseId: match ? Number(match[1]) : null };
	}
	if (hash === 'profile') return { view: 'profile' };
	return { view: 'qr' };
}

function routeKey(route) {
	return route.view === 'courses' ? `courses/${route.courseId ?? ''}` : route.view;
}

function isTwoColumn() {
	const listCol = document.querySelector('.sp-course-list-col');
	const detail = document.getElementById('courseDetail');
	if (!listCol || !detail) return false;
	return getComputedStyle(listCol).display !== 'none' && getComputedStyle(detail).display !== 'none';
}

function applyRoute(route, { focus = false } = {}) {
	const previous = state.route;
	state.route = route;

	document.querySelectorAll('.sp-view').forEach((view) => {
		view.hidden = view.dataset.view !== route.view;
	});
	document.querySelectorAll('.sp-tab').forEach((tab) => {
		if (tab.dataset.route === route.view) tab.setAttribute('aria-current', 'page');
		else tab.removeAttribute('aria-current');
	});

	if (route.view === 'courses') {
		if (state.coursesStatus === 'idle') loadCourses();
		if (route.courseId !== null && state.coursesStatus === 'ready'
			&& !state.courses.some((c) => c.id === route.courseId)) {
			// Unknown course (e.g. removed): fall back to the list
			history.replaceState(null, '', '#courses');
			route = { view: 'courses', courseId: null };
			state.route = route;
		}
		if (route.courseId !== null) {
			state.selectedId = route.courseId;
			try { sessionStorage.setItem(SELECTED_COURSE_KEY, String(route.courseId)); } catch (_) {}
		}
		document.getElementById('coursesGrid').dataset.mode = route.courseId !== null ? 'detail' : 'list';
		renderCourses();

		const wasDetail = previous?.view === 'courses' && previous.courseId !== null;
		if (!isTwoColumn()) {
			if (route.courseId !== null && !wasDetail) {
				window.scrollTo(0, 0);
				if (focus) document.getElementById('detailTitle')?.focus({ preventScroll: true });
			} else if (route.courseId === null && wasDetail) {
				// Back to the overview: restore where the student was in the list
				window.scrollTo(0, state.listScrollY);
				document.querySelector(`.sp-course[data-course-id="${state.selectedId}"]`)?.focus({ preventScroll: true });
				return;
			}
		}
	}

	if (focus && (!previous || previous.view !== route.view)) {
		window.scrollTo(0, 0);
		document.querySelector(`.sp-view[data-view="${route.view}"] .sp-title`)?.focus({ preventScroll: true });
	}
}

function selectCourse(courseId) {
	if (isTwoColumn()) {
		// Side-by-side: update the panel in place, without stacking history entries
		history.replaceState(history.state, '', `#courses/${courseId}`);
		applyRoute(parseRoute());
		return;
	}
	state.listScrollY = window.scrollY;
	history.pushState({ spFromList: true }, '', `#courses/${courseId}`);
	applyRoute(parseRoute(), { focus: true });
}

function goBackToList() {
	if (history.state && history.state.spFromList) {
		history.back();
		return;
	}
	history.replaceState(null, '', '#courses');
	applyRoute(parseRoute());
}

// ===== Rendering =====

// el, progressBar, stateBox, retryButton and signInLink now live in ui/.
// retryButton/signInLink take their (translated) label as the first argument.
const retryAction = (onClick) => retryButton(t('sp_retry', 'Try again'), onClick);
const signInAction = () => signInLink(t('log_in', 'Log in'));

function updateCourseSelection() {
	document.querySelectorAll('.sp-course').forEach((btn) => {
		if (Number(btn.dataset.courseId) === state.selectedId) btn.setAttribute('aria-current', 'true');
		else btn.removeAttribute('aria-current');
	});
	if (state.detailRenderedId !== state.selectedId) renderDetail();
}

function renderCourses({ force = false } = {}) {
	const list = document.getElementById('courseList');
	const status = document.getElementById('courseListStatus');
	const grid = document.getElementById('coursesGrid');
	if (!list || !status || !grid) return;

	const renderKey = `${state.coursesStatus}|${state.coursesVersion}`;
	if (!force && state.coursesStatus === 'ready' && renderKey === state.listRenderKey) {
		updateCourseSelection();
		return;
	}
	state.listRenderKey = renderKey;

	list.replaceChildren();
	status.replaceChildren();
	const ready = state.coursesStatus === 'ready' && state.courses.length > 0;
	grid.dataset.empty = ready ? 'false' : 'true';

	if (state.coursesStatus === 'loading' || state.coursesStatus === 'idle') {
		list.setAttribute('aria-busy', 'true');
		for (let i = 0; i < 3; i += 1) {
			const li = el('li');
			li.appendChild(el('span', 'sp-skeleton sp-course-skeleton'));
			list.appendChild(li);
		}
		return;
	}
	list.removeAttribute('aria-busy');

	if (state.coursesStatus === 'signin') {
		status.appendChild(stateBox(t('sp_relogin', 'Log in again to see your attendance.'), signInAction()));
		return;
	}
	if (state.coursesStatus === 'error') {
		status.appendChild(stateBox(t('sp_load_error', "Couldn't load your courses."), retryAction(() => loadCourses(true))));
		return;
	}
	if (state.courses.length === 0) {
		status.appendChild(stateBox(t('sp_no_courses', "You're not enrolled in any courses yet.")));
		return;
	}

	// Side-by-side layout always shows a course; default to the last one viewed, else the first
	if (state.selectedId === null || !state.courses.some((c) => c.id === state.selectedId)) {
		let remembered = null;
		try { remembered = Number(sessionStorage.getItem(SELECTED_COURSE_KEY)); } catch (_) {}
		state.selectedId = state.courses.some((c) => c.id === remembered) ? remembered : state.courses[0].id;
	}

	const fragment = document.createDocumentFragment();
	state.courses.forEach((course) => {
		const stats = courseStats(course);
		const li = el('li');
		const btn = el('button', 'sp-course');
		btn.type = 'button';
		btn.dataset.courseId = String(course.id);
		if (course.id === state.selectedId) btn.setAttribute('aria-current', 'true');

		btn.appendChild(el('span', 'sp-course-name', course.name));
		const row = el('span', 'sp-course-row');
		row.appendChild(el('span', 'sp-course-pct', stats.hasData ? `${stats.pct}%` : '—'));
		row.appendChild(el('span', 'sp-course-count', stats.hasData
			? lessonsCountText(stats.attended, stats.total)
			: t('sp_no_lessons_yet', 'No lessons held yet')));
		btn.appendChild(row);
		const bar = progressBar(stats);
		bar.setAttribute('aria-hidden', 'true');
		btn.appendChild(bar);

		btn.addEventListener('click', () => selectCourse(course.id));
		li.appendChild(btn);
		fragment.appendChild(li);
	});
	list.appendChild(fragment);
	if (force || state.detailRenderedId !== state.selectedId) renderDetail();
}

function renderDetail() {
	const body = document.getElementById('detailBody');
	if (!body) return;
	const course = state.courses.find((c) => c.id === state.selectedId);
	body.replaceChildren();
	state.detailRenderedId = course ? course.id : null;
	if (!course) return;

	const stats = courseStats(course);
	const head = el('div', 'sp-detail-head');
	const title = el('h2', 'sp-detail-title', course.name);
	title.id = 'detailTitle';
	title.tabIndex = -1;
	head.appendChild(title);
	if (stats.hasData && stats.low) head.appendChild(el('span', 'sp-badge', t('sp_low_attendance', 'Low attendance')));
	body.appendChild(head);

	const stats_ = el('div', 'sp-stats');
	const big = el('span', 'sp-big');
	big.appendChild(el('span', 'sp-big-pct', stats.hasData ? `${stats.pct}%` : '—'));
	big.appendChild(el('span', 'sp-big-label', t('sp_attendance_word', 'attendance')));
	stats_.appendChild(big);
	stats_.appendChild(el('p', 'sp-summary', stats.hasData
		? `${lessonsCountText(stats.attended, stats.total)} • ${absencesText(stats.absences)}`
		: t('sp_no_lessons_yet', 'No lessons held yet')));
	body.appendChild(stats_);

	const bar = progressBar(stats, true);
	bar.setAttribute('role', 'progressbar');
	bar.setAttribute('aria-valuemin', '0');
	bar.setAttribute('aria-valuemax', '100');
	bar.setAttribute('aria-label', t('sp_attendance_word', 'attendance'));
	if (stats.hasData) bar.setAttribute('aria-valuenow', String(stats.pct));
	body.appendChild(bar);

	body.appendChild(el('h3', 'sp-section-label', t('sp_lessons', 'Lessons')));
	const lessons = el('div');
	lessons.id = 'detailLessons';
	body.appendChild(lessons);
	renderLessonsSection();
}

// Lessons load after the summary; only this part re-renders when they arrive
function renderLessonsSection() {
	const container = document.getElementById('detailLessons');
	const course = state.courses.find((c) => c.id === state.selectedId);
	if (!container || !course) return;
	container.replaceChildren(renderLessons(course, courseStats(course)));
}

function formatLessonDates(items) {
	const locale = currentLocale();
	const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
	const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
	const labels = items.map((item) => {
		const date = item?.date ? new Date(item.date) : null;
		return date && !Number.isNaN(date.getTime()) ? { day: dayFormat.format(date), time: timeFormat.format(date) } : null;
	});
	// Add the time only when two lessons fall on the same day
	const dayCounts = new Map();
	labels.forEach((l) => { if (l) dayCounts.set(l.day, (dayCounts.get(l.day) || 0) + 1); });
	return labels.map((l) => (l ? (dayCounts.get(l.day) > 1 ? `${l.day}, ${l.time}` : l.day) : '—'));
}

function renderLessons(course, stats) {
	const wrap = el('div');
	if (!stats.hasData) {
		wrap.appendChild(el('p', 'sp-note', t('sp_no_lessons_yet', 'No lessons held yet')));
		return wrap;
	}

	const entry = state.lessons.get(course.id);
	if (!entry) {
		loadLessons(course.id);
	}
	const current = state.lessons.get(course.id);

	if (current.status === 'loading') {
		const list = el('ul', 'sp-lessons');
		list.setAttribute('aria-busy', 'true');
		for (let i = 0; i < Math.min(stats.total, 5); i += 1) {
			const li = el('li');
			li.appendChild(el('span', 'sp-skeleton sp-lesson-skeleton'));
			list.appendChild(li);
		}
		wrap.appendChild(list);
		return wrap;
	}
	if (current.status === 'signin') {
		wrap.appendChild(stateBox(t('sp_relogin', 'Log in again to see your attendance.'), signInAction()));
		return wrap;
	}
	if (current.status === 'error') {
		wrap.appendChild(stateBox(t('sp_lessons_error', "Couldn't load the lessons."), retryAction(() => {
			loadLessons(course.id, true);
			renderLessonsSection();
		})));
		return wrap;
	}

	const items = current.items;
	if (items.length > 0) {
		const names = formatLessonDates(items);
		const list = el('ol', 'sp-lessons');
		items.forEach((item, index) => {
			const li = el('li', 'sp-lesson');
			li.appendChild(el('span', 'sp-lesson-name', names[index]));
			const status = String(item?.status || '');
			let label = status;
			let cls = 'sp-lesson-status';
			if (status === 'present') { label = t('sp_present', 'Present'); cls += ' is-present'; }
			else if (status === 'absent') { label = t('sp_absent', 'Absent'); cls += ' is-absent'; }
			li.appendChild(el('span', cls, label));
			list.appendChild(li);
		});
		wrap.appendChild(list);
	}

	// Lessons held before absences were recorded have no per-lesson entry
	const unrecorded = Math.max(0, stats.total - items.length);
	if (unrecorded > 0) {
		wrap.appendChild(el('p', 'sp-note', unrecorded === 1
			? t('sp_unrecorded_one', '1 earlier lesson has no per-lesson record.')
			: fmt('sp_unrecorded', '{n} earlier lessons have no per-lesson record.', { n: unrecorded })));
	}
	return wrap;
}

function renderQr(student) {
	const qrContainer = document.getElementById('qrContainer');
	if (!qrContainer) return;
	qrContainer.replaceChildren();
	if (typeof kjua !== 'function') {
		qrContainer.appendChild(el('p', 'sp-qr-error', t('sp_qr_unavailable', 'QR code could not be generated.')));
		return;
	}
	// Same payload the teacher scanner expects
	const payload = {
		name: student.full_name,
		facultyNumber: student.faculty_number,
		email: student.email
	};
	Object.keys(payload).forEach((k) => { if (!payload[k]) delete payload[k]; });

	const qr = kjua({
		render: 'svg',
		text: JSON.stringify(payload),
		size: 256,
		quiet: 2,
		level: 'L'
	});
	if (qr) {
		qr.setAttribute('role', 'img');
		qr.setAttribute('aria-label', t('sp_my_qr', 'My QR'));
		qrContainer.appendChild(qr);
	} else {
		qrContainer.appendChild(el('p', 'sp-qr-error', t('sp_qr_unavailable', 'QR code could not be generated.')));
	}
}

function renderProfile(student) {
	const list = document.getElementById('profileDetails');
	if (list) {
		list.replaceChildren();
		const rows = [
			['sp_name', 'Name', student.full_name],
			['sp_faculty_number', 'Faculty number', student.faculty_number],
			['email', 'Email', student.email],
			['faculty', 'Faculty', student.faculty],
			['specialization', 'Specialization', student.specialization],
			['group', 'Group', student.group],
			['course', 'Course', student.course]
		];
		rows.forEach(([key, fallback, value]) => {
			if (value === undefined || value === null || String(value).trim() === '') return;
			const row = el('div', 'sp-profile-row');
			row.appendChild(el('dt', null, t(key, fallback)));
			row.appendChild(el('dd', null, String(value)));
			list.appendChild(row);
		});
	}
	const langValue = document.getElementById('profileLanguageValue');
	if (langValue) {
		const lang = window.i18n?.getLanguage?.() || 'en';
		langValue.textContent = lang === 'bg' ? t('language_bg', 'Bulgarian') : t('language_en', 'English');
	}
}

function renderStudent(student) {
	document.getElementById('studentDisplayName').textContent = student.displayName;
	document.getElementById('studentFacultyNumber').textContent = student.faculty_number || '—';
	renderQr(student);
	renderProfile(student);
}

function renderAll() {
	applyStaticTranslations();
	if (state.student) renderStudent(state.student);
	if (state.route?.view === 'courses') renderCourses({ force: true });
}

// ===== Startup =====

document.addEventListener('DOMContentLoaded', () => {
	let student = null;
	try {
		const raw = sessionStorage.getItem('studentData');
		if (!raw) {
			window.location.replace('index.html');
			return;
		}
		const parsed = JSON.parse(raw);
		student = resolveStudentData(parsed);
		if (student) student.displayName = student.full_name || deriveDisplayName(parsed) || '—';
	} catch (e) {
		console.error('[StudentHome] could not read session data', e);
	}
	if (!student) {
		alert(t('sp_session_incomplete', 'Your session data is incomplete. Please log in again.'));
		window.location.replace('index.html');
		return;
	}
	state.student = student;

	// Move the shared language button into the header
	const langDisplay = document.getElementById('languageCornerDisplay');
	const langSlot = document.getElementById('spHeaderLang');
	if (langDisplay && langSlot) langSlot.appendChild(langDisplay);

	document.getElementById('detailBack')?.addEventListener('click', goBackToList);
	document.getElementById('profileLanguageBtn')?.addEventListener('click', () => {
		window.i18n?.openLanguageMenu?.();
	});
	document.getElementById('logoutBtn')?.addEventListener('click', () => {
		if (window.clearSessionData) window.clearSessionData();
		else sessionStorage.removeItem('studentData');
		window.location.replace('index.html');
	});

	document.addEventListener('app:languagechange', renderAll);

	const onNavigate = () => {
		const route = parseRoute();
		if (state.route && routeKey(route) === routeKey(state.route)) return;
		applyRoute(route, { focus: true });
	};
	window.addEventListener('popstate', onNavigate);
	window.addEventListener('hashchange', onNavigate);

	renderAll();
	applyRoute(parseRoute());
});
