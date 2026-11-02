/**
 * Per-student attendance metrics for the "По студенти" statistics.
 *
 * Pure functions over the GET /statistics/students payload:
 *   courses:  [{ id, name }]
 *   lessons:  [[lesson_id, course_id, started_at_ms|null, ended_at_ms|null]]  (in the order held)
 *   students: [{ id, full_name, faculty_number, course_ids }]
 *   records:  [[lesson_id, student_id, present 1|0, joined_at_ms|null, left_at_ms|null]]
 *
 * "Held" for a student is the number of lessons they have a record for (a
 * scan or a saved absence), same as the student_course_attendance view.
 *
 * Lesson start/end are not a timetable: the server stores the first and the
 * last scan of the session. Lateness is therefore measured from the first
 * scan, early leaving up to the last scan. Only lessons/records that have the
 * needed timestamps are counted for those metrics.
 */

export const LOW_ATTENDANCE_PERCENT = 50;
/** Arriving more than this many minutes after the first scan counts as late. */
export const LATE_GRACE_MINUTES = 10;
/** Leaving more than this many minutes before the last scan counts as early. */
export const EARLY_GRACE_MINUTES = 10;
/** Shorter scan windows say nothing about time in class; they are skipped. */
export const MIN_LESSON_MINUTES = 15;

const MINUTE = 60 * 1000;

const ratePercent = (attended, held) => (held > 0 ? Math.round((attended / held) * 100) : null);
const isBelow = (attended, held) => held > 0 && attended * 100 < held * LOW_ATTENDANCE_PERCENT;
const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Absences left before the rate drops below the threshold, or attendances in
 * a row needed to get back to it. With a attended out of h held and a 50%
 * threshold: a / (h + k) >= 1/2  <=>  k <= 2a - h;  (a + n) / (h + n) >= 1/2  <=>  n >= h - 2a.
 */
export function thresholdDistance(attended, held, threshold = LOW_ATTENDANCE_PERCENT) {
    if (held === 0) return null;
    const p = threshold / 100;
    if (attended >= p * held) {
        // largest k with attended / (held + k) >= p
        return { canMiss: Math.max(0, Math.floor(attended / p - held + 1e-9)) };
    }
    // smallest n with (attended + n) / (held + n) >= p
    return { needed: Math.ceil((p * held - attended) / (1 - p) - 1e-9) };
}

/** Current (trailing) and longest run of absences in a list of present flags. */
export function absenceStreaks(presentFlags) {
    let current = 0;
    let longest = 0;
    for (const present of presentFlags) {
        current = present ? 0 : current + 1;
        if (current > longest) longest = current;
    }
    return { current, longest };
}

/** Lateness, early leaving and time in class over a set of attendances. */
function timing(entries) {
    const late = [];
    const lateAll = [];
    const early = [];
    const earlyAll = [];
    const shares = [];
    for (const { record, lesson } of entries) {
        if (!record.present) continue;
        const [, , started, ended] = lesson;
        if (record.joined !== null && started !== null) {
            const minutes = Math.max(0, (record.joined - started) / MINUTE);
            lateAll.push(minutes);
            if (minutes > LATE_GRACE_MINUTES) late.push(minutes);
        }
        if (record.left !== null && ended !== null) {
            const minutes = Math.max(0, (ended - record.left) / MINUTE);
            earlyAll.push(minutes);
            if (minutes > EARLY_GRACE_MINUTES) early.push(minutes);
        }
        if (record.joined !== null && record.left !== null && started !== null && ended !== null) {
            const length = ended - started;
            if (length >= MIN_LESSON_MINUTES * MINUTE) {
                shares.push(Math.min(1, Math.max(0, (record.left - record.joined) / length)));
            }
        }
    }
    const share = average(shares);
    return {
        // arrivals with a time: how many, how many late, average minutes late (late ones only)
        arrivals: lateAll.length,
        lateCount: late.length,
        lateAvgMinutes: late.length ? Math.round(average(late)) : null,
        // departures with a time
        departures: earlyAll.length,
        earlyCount: early.length,
        earlyAvgMinutes: early.length ? Math.round(average(early)) : null,
        // average share of the lesson spent in class, over lessons with both scans
        inClassLessons: shares.length,
        inClassPercent: share === null ? null : Math.round(share * 100)
    };
}

function startOfWeek(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d.getTime();
}

function startOfMonth(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Attendance rate per week or month, oldest first; only periods with lessons. */
export function trend(entries, unit = 'week') {
    const bucketOf = unit === 'month' ? startOfMonth : startOfWeek;
    const buckets = new Map();
    for (const { record, lesson } of entries) {
        const started = lesson[2];
        if (started === null) continue;
        const key = bucketOf(started);
        const bucket = buckets.get(key) || { start: key, held: 0, attended: 0 };
        bucket.held += 1;
        if (record.present) bucket.attended += 1;
        buckets.set(key, bucket);
    }
    return Array.from(buckets.values())
        .sort((a, b) => a.start - b.start)
        .map((b) => ({ ...b, rate: ratePercent(b.attended, b.held) }));
}

/**
 * Improving / slipping: the last three periods against everything before
 * them; a change of 10 points or more counts. Null when there is too little data.
 */
export function trendDirection(points) {
    if (points.length < 4) return null;
    const recent = points.slice(-3);
    const before = points.slice(0, -3);
    const sum = (list, key) => list.reduce((a, p) => a + p[key], 0);
    const recentHeld = sum(recent, 'held');
    const beforeHeld = sum(before, 'held');
    if (recentHeld < 2 || beforeHeld < 2) return null;
    const delta = (sum(recent, 'attended') / recentHeld - sum(before, 'attended') / beforeHeld) * 100;
    if (delta >= 10) return 'up';
    if (delta <= -10) return 'down';
    return 'flat';
}

/**
 * @returns {{ courses: Map<number, string>, students: Array<object> }}
 * Each student: { id, name, facultyNumber, courses: [...], held, attended, rate,
 * below, belowCourses, streak: { current, longest }, timing, entries }.
 */
export function computeStudentStats(payload) {
    const courses = new Map((payload?.courses || []).map((c) => [Number(c.id), String(c.name || '')]));
    const lessons = payload?.lessons || [];
    const lessonOrder = new Map();
    const lessonById = new Map();
    lessons.forEach((lesson, index) => {
        lessonOrder.set(lesson[0], index);
        lessonById.set(lesson[0], lesson);
    });

    // student id -> course id -> entries
    const byStudent = new Map();
    for (const row of payload?.records || []) {
        const [lessonId, studentId, present, joined, left] = row;
        const lesson = lessonById.get(lessonId);
        if (!lesson) continue;
        const courseId = lesson[1];
        let perCourse = byStudent.get(studentId);
        if (!perCourse) byStudent.set(studentId, (perCourse = new Map()));
        if (!perCourse.has(courseId)) perCourse.set(courseId, []);
        perCourse.get(courseId).push({
            lesson,
            order: lessonOrder.get(lessonId),
            record: { present: present === 1 || present === true, joined: joined ?? null, left: left ?? null }
        });
    }

    const students = (payload?.students || []).map((s) => {
        const perCourse = byStudent.get(s.id) || new Map();
        const allEntries = [];
        const courseStats = (s.course_ids || []).map((courseId) => {
            const entries = (perCourse.get(courseId) || []).sort((a, b) => a.order - b.order);
            allEntries.push(...entries);
            const held = entries.length;
            const attended = entries.filter((e) => e.record.present).length;
            return {
                id: courseId,
                name: courses.get(courseId) ?? '',
                held,
                attended,
                rate: ratePercent(attended, held),
                below: isBelow(attended, held),
                distance: thresholdDistance(attended, held),
                streak: absenceStreaks(entries.map((e) => e.record.present)),
                timing: timing(entries)
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        allEntries.sort((a, b) => a.order - b.order);
        const held = allEntries.length;
        const attended = allEntries.filter((e) => e.record.present).length;
        return {
            id: s.id,
            name: String(s.full_name || ''),
            facultyNumber: s.faculty_number ? String(s.faculty_number) : '',
            courses: courseStats,
            held,
            attended,
            rate: ratePercent(attended, held),
            below: isBelow(attended, held),
            belowCourses: courseStats.filter((c) => c.below).length,
            // the worst running absence streak in any one discipline
            streak: {
                current: Math.max(0, ...courseStats.map((c) => c.streak.current)),
                longest: Math.max(0, ...courseStats.map((c) => c.streak.longest))
            },
            timing: timing(allEntries),
            entries: allEntries
        };
    });

    return { courses, students };
}
