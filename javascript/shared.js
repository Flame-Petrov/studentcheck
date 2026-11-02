// Shared navbar logo click handler
// Uses ONLY sessionStorage so login dies with the tab/window.
(function(){
  function handleLogoClick() {
    // If the NavMenu is ready, toggle it.
    if (window.NavMenu && typeof window.NavMenu.toggle === 'function' && window.NavMenu.isReady()) {
      window.NavMenu.toggle();
      return;
    }
    // Otherwise, the menu is still initializing. Do nothing to prevent an
    // unexpected redirect. The click will be ignored until the menu is ready.
  }

  window.handleLogoClick = handleLogoClick;
})();

// Best-effort health ping while the app tab is open.
(function(){
  const minMs = 5 * 60 * 1000;
  const maxMs = 10 * 60 * 1000;
  let timerId = null;

  function nextDelayMs() {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  async function ping() {
    try {
      const { SERVER_BASE_URL, ENDPOINTS } = await import('./config/api.js');
      const url = SERVER_BASE_URL + ENDPOINTS.health;
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (res && res.ok === true) {
        // Health endpoint responded OK.
      }
    } catch (_) {
      // Ignore failures; this ping is best-effort only.
    } finally {
      timerId = setTimeout(ping, nextDelayMs());
    }
  }

  timerId = setTimeout(ping, nextDelayMs());
  window.addEventListener('beforeunload', () => {
    if (timerId) clearTimeout(timerId);
  });
})();

// Pending feedback on the action itself (no blocking overlay): the form stays
// visible, the submit button shows a spinner + label, and after 10s a
// "server is waking up (N sec)" note appears under it.
// Usage: PendingAction.start(button, 'Logging in...'); ... PendingAction.stop();
// (LoadingOverlay.show(msg, { button }) / hide() remain as aliases.)
(function(){
  let current = null;

  function tOr(key, fallback) {
    const t = window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t : null;
    const value = t ? t(key) : '';
    return value && value !== key ? value : fallback;
  }

  function formatWakingText(seconds) {
    const template = tOr('server_waking_up', 'Server is waking up ... ({sec} sec)');
    return template.replace('{sec}', String(seconds));
  }

  function start(button, message) {
    stop();
    if (!button) return;
    const label = document.createElement('span');
    label.className = 'btn-pending-label';
    label.textContent = message || tOr('loading', 'Loading...');
    const spinner = document.createElement('span');
    spinner.className = 'btn-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const original = Array.from(button.childNodes);
    const width = button.getBoundingClientRect().width;
    button.style.minWidth = width ? `${Math.ceil(width)}px` : '';
    button.replaceChildren(spinner, label);
    button.disabled = true;
    button.dataset.pending = 'true';
    button.setAttribute('aria-busy', 'true');

    const note = document.createElement('p');
    note.className = 'pending-note';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    (button.closest('.actions') || button).after(note);

    const startedAt = Date.now();
    current = { button, original, note, interval: null };
    current.timeout = setTimeout(() => {
      const tick = () => {
        note.textContent = formatWakingText(Math.max(0, Math.floor((Date.now() - startedAt) / 1000) - 10));
      };
      tick();
      current.interval = setInterval(tick, 1000);
    }, 10000);
  }

  function stop({ keepDisabled = false } = {}) {
    if (!current) return;
    const { button, original, note, timeout, interval } = current;
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
    note.remove();
    if (button.dataset.pending) {
      button.replaceChildren(...original);
      delete button.dataset.pending;
      button.removeAttribute('aria-busy');
      button.style.minWidth = '';
      if (!keepDisabled) button.disabled = false;
    }
    current = null;
  }

  window.PendingAction = { start, stop };
  window.LoadingOverlay = {
    show: (message, opts = {}) => start(opts.button || document.querySelector('form [type="submit"]'), message),
    hide: () => stop()
  };
})();

// Language switcher + translations
(function(){
  const LANGUAGE_KEY = 'language';
  // A page can choose its own default with <html data-default-lang="bg">;
  // a saved choice in localStorage always wins.
  const DEFAULT_LANG = (document.documentElement.getAttribute('data-default-lang') || 'en').toLowerCase();
  const BRAND_LOGO_SRC = 'images/new_main_logo.png';
  const BRAND_LOGO_ALT = 'Home';

  // Wipe every token and cached roster/class entry on logout so the next
  // person on a shared device sees nothing; only the language choice survives.
  function clearSessionData() {
    try {
      const language = localStorage.getItem(LANGUAGE_KEY);
      sessionStorage.clear();
      localStorage.clear();
      if (language) localStorage.setItem(LANGUAGE_KEY, language);
    } catch (_) {}
  }

  const translations = {
    en: {
      language_change_title: 'Change Language',
      language_en: 'English',
      language_bg: 'Bulgarian',
      language_label: 'Language',
      brand_label: 'E-Trek',
      home_title: 'Join as',
      email_or_faculty: 'Email or Faculty Number',
      enter_email_or_faculty: 'Email or faculty number',
      role_student: 'Student',
      role_teacher: 'Teacher',
      student_login_title: 'Student Log in',
      teacher_login_title: 'Teacher Log in',
      faculty_number: 'Faculty Number',
      password: 'Password',
      log_in: 'Log in',
      logging_in: 'Logging in...',
      server_waking_up: 'Server is waking up ... ({sec} sec)',
      no_account_register_html: 'Don’t have an account? <a href="registration.html">Register here</a>',
      email: 'Email',
      enter_email: 'Enter your email',
      enter_password: 'Enter your password',
      // Student page
      sp_home: 'Home',
      sp_main_nav: 'Main navigation',
      sp_academic_info: 'Academic information',
      sp_settings: 'Settings',
      sp_profile_loading: 'Loading your profile…',
      sp_not_provided: 'Not provided',
      // Teacher page shell
      tp_nav_payments: 'Payments',
      tp_nav_statistics: 'Statistics',
      scanner_eyebrow: 'Attendance scanning',
      scanner_instruction: "Place the student's QR code inside the frame.",
      scanner_mode_label: 'Scan mode',
      scanner_finish: 'Finish',
      scanner_show_attendance: 'Show attendance',
      scanner_status_loading: 'Loading scanner…',
      scanner_status_permission: 'Waiting for camera permission…',
      scanner_status_starting: 'Starting camera…',
      scanner_status_active: 'Camera active',
      scanner_status_error: 'Camera unavailable',
      scanner_err_denied_title: 'No permission for the camera',
      scanner_err_denied_text: 'Allow camera access in your browser settings and try again.',
      scanner_err_busy_title: 'The camera is busy',
      scanner_err_busy_text: 'Close other apps or tabs that use the camera and try again.',
      scanner_err_unavailable_title: 'No camera found',
      scanner_err_unavailable_text: 'Connect a camera or open this page on a device with a camera.',
      scanner_err_library_title: 'The scanner did not load',
      scanner_err_library_text: 'Check your internet connection and try again.',
      scanner_err_failed_title: 'The camera could not start',
      scanner_err_failed_text: 'Try again. If it keeps failing, reload the page.',
      scanner_fb_idle_title: 'No students scanned yet.',
      scanner_fb_idle_detail: 'Scans stay in the current session until you press “Finish”.',
      scanner_fb_entry: 'Entry recorded',
      scanner_fb_exit: 'Exit recorded',
      scanner_fb_session: 'recorded in the current session',
      scanner_fb_dup_entry: 'Entry already recorded',
      scanner_fb_dup_exit: 'Exit already recorded',
      scanner_fb_no_entry: 'No entry recorded',
      scanner_fb_no_entry_detail: 'scan the entry first',
      scanner_fb_not_in_class: 'The student is not in this class',
      scanner_fb_not_recorded: 'The scan was not recorded.',
      scanner_fb_invalid: 'Invalid QR code',
      scanner_fb_invalid_detail: 'This is not a StudentCheck student QR code.',
      scanner_fb_saving: 'Saving attendance…',
      scanner_fb_saving_detail: 'Do not close the page.',
      scanner_fb_save_failed: 'Attendance not saved',
      scanner_fb_save_failed_detail: 'The session is kept on this device. Press “Finish” again.',
      tp_add_students_desc: 'Choose the students for this class.',
      tp_selected_count: 'Selected: {n}',
      tp_adding: 'Adding…',
      tp_add_students_error: 'Could not add the students. Please try again.',
      tp_no_students_yet: 'There are no registered students yet.',
      tp_no_student_results: 'No students match your search.',
      tp_students_loading: 'Loading students…',
      tp_filters: 'Filters',
      tp_search_student: 'Search for a student',
      tp_stats_students: 'Students',
      tp_stats_lessons: 'Lessons held',
      tp_stats_average: 'Average attendance',
      tp_stats_per_class: 'By class',
      tp_stats_loading: 'Loading statistics…',
      tp_stats_error: 'Could not load the statistics.',
      tp_stats_empty: 'You have no classes yet.',
      tp_stats_students_one: '{n} student',
      tp_stats_students_many: '{n} students',
      tp_stats_lessons_one: '{n} lesson',
      tp_stats_lessons_many: '{n} lessons',
      tp_stats_low_one: '{n} below 50%',
      tp_stats_low_many: '{n} below 50%',
      tp_stats_no_lessons: 'No lessons held yet',
      tp_stats_mode_classes: 'By class',
      tp_stats_mode_students: 'By student',
      tp_stats_per_student: 'By student',
      tp_stats_student_search: 'Search students',
      tp_stats_student_search_label: 'Search students',
      tp_stats_sort_label: 'Sort',
      tp_stats_sort_name: 'By name',
      tp_stats_sort_rate: 'Lowest attendance',
      tp_stats_sort_streak: 'Absences in a row',
      tp_stats_students_loading: 'Loading students…',
      tp_stats_students_none: 'No students are enrolled yet.',
      tp_stats_students_nomatch: 'No students found.',
      tp_stats_students_error: 'Could not load the students.',
      tp_stats_found: '{n} found',
      tp_stats_courses_one: '{n} class',
      tp_stats_courses_many: '{n} classes',
      tp_stats_below_courses_one: 'Below 50% in {n} class',
      tp_stats_below_courses_many: 'Below 50% in {n} classes',
      tp_stats_streak_badge: '{n} absences in a row',
      tp_stats_back: 'All students',
      tp_stats_fn: 'Faculty no. {n}',
      tp_stats_overall: 'Overall attendance',
      tp_stats_of_lessons: '{a} of {h} lessons',
      tp_stats_n_of_m: '{n} of {m}',
      tp_stats_streak_title: 'Absences in a row',
      tp_stats_streak_sub: 'longest: {n}',
      tp_stats_late_title: 'Late arrivals',
      tp_stats_avg_min_late: '{n} min late on average',
      tp_stats_never_late: 'never late',
      tp_stats_inclass_title: 'Time in class',
      tp_stats_left_early_sub: 'left early {n} of {m} times',
      tp_stats_lessons_with_scans: 'over {n} lessons with a leaving scan',
      tp_stats_no_data: 'no data',
      tp_stats_can_miss_zero: 'One more absence takes them below 50%.',
      tp_stats_can_miss_one: 'Can miss {n} more lesson without falling below 50%.',
      tp_stats_can_miss_many: 'Can miss {n} more lessons without falling below 50%.',
      tp_stats_needs_one: 'Below 50%: needs to attend {n} lesson to reach 50%.',
      tp_stats_needs_many: 'Below 50%: needs to attend {n} lessons in a row to reach 50%.',
      tp_stats_streak_line: 'Absences in a row: {c} now, {l} at most',
      tp_stats_late_line: 'Late for {n} of {m} lessons, by {x} min on average',
      tp_stats_late_none: 'Never late ({m} lessons with an arrival time)',
      tp_stats_early_line: 'Left early {n} of {m} times, {x} min before the end on average',
      tp_stats_early_none: 'Never left early ({m} lessons with a leaving time)',
      tp_stats_inclass_line: 'In class for {p}% of the lesson on average ({m} lessons)',
      tp_stats_trend: 'Trend',
      tp_stats_trend_unit: 'Period',
      tp_stats_weeks: 'Weeks',
      tp_stats_months: 'Months',
      tp_stats_trend_up: 'Improving compared with earlier periods',
      tp_stats_trend_down: 'Slipping compared with earlier periods',
      tp_stats_trend_flat: 'No significant change',
      tp_stats_trend_empty: 'No dated lessons yet.',
      tp_stats_week_of: 'Week of {d}',
      tp_stats_student_missing: 'Student not found.',
      tp_stats_footnote: 'A lesson\'s start and end are its first and last scan. Arriving more than {late} min after the start counts as late, leaving more than {early} min before the end as leaving early. Absences in a row are counted within one class.',
      tp_nav_chat: 'Chat',
      tp_search_label: 'Search classes',
      tp_search_placeholder: 'Search classes...',
      tp_new_class: 'New class',
      tp_no_results: 'No classes match your search.',
      tp_results_count: 'Classes found: {n}',
      tp_skip_to_content: 'Skip to content',
      tp_export_pending: 'Downloading the attendance table…',
      tp_export_success: 'Attendance table downloaded.',
      tp_export_error: 'Could not download the attendance table. Please try again.',
      tp_action_unavailable: 'This action is not available yet.',
      tp_action_error: 'This action could not be completed. Please try again.',
      tp_scanner_draft: 'unsaved scan in progress',
      tp_loading: 'Loading…',
      tp_load_error: 'Could not load this. Please try again.',
      tp_retry: 'Try again',
      tp_refresh_failed: 'Could not refresh the data.',
      tp_classes_loading: 'Loading your classes…',
      tp_classes_error: 'Could not load your classes.',
      tp_classes_empty: 'You have no classes yet. Create the first one with “New class”.',
      tp_students_error: 'Could not load the students.',
      tp_history_error: 'Could not load the attendance history.',
      session_expired: 'Session expired. Please log in again.',
      sp_nav_qr: 'QR code',
      sp_nav_courses: 'Courses',
      sp_nav_profile: 'Profile',
      sp_my_qr: 'My QR',
      sp_fac_no: 'Fac. No.',
      sp_courses_title: 'Courses',
      sp_attendance_word: 'attendance',
      sp_low_attendance: 'Low attendance',
      sp_lessons: 'Lessons',
      sp_x_of_y_lessons: '{attended} of {total} lessons',
      sp_x_of_y_lessons_one: '{attended} of {total} lesson',
      sp_absences: '{n} absences',
      sp_absences_one: '{n} absence',
      sp_present: 'Present',
      sp_absent: 'Absent',
      sp_no_lessons_yet: 'No lessons held yet',
      sp_no_courses: 'You\'re not enrolled in any courses yet.',
      sp_load_error: 'Couldn\'t load your courses.',
      sp_lessons_error: 'Couldn\'t load the lessons.',
      sp_retry: 'Try again',
      sp_relogin: 'Log in again to see your attendance.',
      sp_unrecorded: '{n} earlier lessons have no per-lesson record.',
      sp_unrecorded_one: '1 earlier lesson has no per-lesson record.',
      sp_qr_unavailable: 'QR code could not be generated.',
      sp_session_incomplete: 'Your session data is incomplete. Please log in again.',
      sp_name: 'Name',
      sp_faculty_number: 'Faculty number',
      sp_language: 'Language',
      create_account_title: 'Create your account',
      first_name: 'First name',
      middle_name: 'Middle name',
      last_name: 'Last name',
      faculty: 'Faculty',
      level: 'Level',
      specialization: 'Specialization',
      group: 'Group',
      course: 'Course',
      faculty_number_label: 'Faculty number',
      repeat_password: 'Repeat password',
      password_req_length: 'At least 8 characters',
      password_req_letter: 'Contains a letter',
      password_req_number: 'Contains a number',
      password_req_match: 'Passwords match',
      already_have_account_html: 'Already have an account? <a href="index.html">Log in</a>',
      back: 'Back',
      continue: 'Continue',
      finish: 'Finish',
      student_home_title: 'Student Home',
      welcome_prefix: 'Welcome, ',
      faculty_number_prefix: 'Faculty Number: ',
      classes: 'Classes',
      details: 'Details',
      class_details: 'Class Details',
      attended_classes: 'Attended classes:',
      total_classes: 'Total classes:',
      log_out: 'Log out',
      students: 'Students',
      reset: 'Reset',
      add_students: 'Add Students',
      close: 'Close',
      attendance_history: 'Attendance History',
      joined_label: 'Joined',
      left_label: 'Left',
      no_attendance_records: 'No attendance records.',
      student_info_title: 'Student Info',
      full_name_label: 'Full Name',
      attended_classes_label: 'Attended Classes',
      remove_from_class: 'Remove from Class',
      billing_page: 'Billing Page',
      confirm_delete_class: 'Are you sure you want to delete this class?',
      confirm_remove_student_prefix: 'Are you sure you want to remove',
      confirm_remove_student_suffix: 'from the class?',
      this_student: 'this student',
      create_class: 'Create Class',
      name: 'Name',
      add: 'Add',
      class_ready: 'Class Ready',
      manage_students: 'Manage Students',
      start_scanner: 'Start Scanner',
      finish_class: 'Finish Class',
      download_attendance_table: 'Download Attendance Table',
      options: 'Options',
      start_scanning: 'Start Scanning',
      joining: 'Joining',
      leaving: 'Leaving',
      show_attendance: 'Show Attendance',
      attendance: 'Attendance',
      new_class: '+ New Class',
      search_placeholder: 'Search...',
      search_students_placeholder: 'Search students...',
      any: 'Any',
      bachelor: 'Bachelor',
      master: 'Master',
      phd: 'PhD',
      no_classes_found: 'No classes found.',
      student_no_classes: "You're not added to any class yet.",
      err_specializations_unavailable: 'Error: Specializations are not available for the selected faculty and level.',
      err_fill_all_fields: 'Please fill out every field.',
      err_select_faculty: 'Please, select your faculty.',
      err_select_level: 'Please, select your level.',
      err_select_specialization: 'Please, select your specialization.',
      err_select_group: 'Please, select your group.',
      err_select_course: 'Please, select your course.',
      err_email_required: 'Email is required.',
      err_email_invalid: 'Enter a valid email address.',
      err_faculty_required: 'Faculty number is required.',
      err_faculty_length: 'Faculty number must be exactly 9 characters.',
      err_faculty_letter_digit: 'Faculty number needs a letter or digit.',
      err_faculty_too_long: 'Faculty number too long (max 50).',
      err_faculty_invalid_chars: 'Faculty number invalid characters only.',
      err_group_invalid: 'Please select your group (37–42).',
      err_email_verify: 'Unable to verify email right now. Please try again.',
      err_email_exists: 'This email is already registered. Please, try again with a different one.',
      err_faculty_verify: 'Unable to verify faculty number right now. Please try again.',
      err_faculty_exists: 'This faculty number is already registered. Please, try again with a different one.',
      toast_class_renamed: 'Class was renamed.',
      toast_student_removed: 'Student removed.',
      toast_student_added: 'Successfully added student.',
      toast_students_added: 'Successfully added students.',
      already_in_badge: 'Already in',
      err_class_name_taken: 'This class name is already used.',
      err_password_requirements: 'Please meet all password requirements before finishing.',
      err_registration_failed_prefix: 'Registration failed: ',
      err_registration_failed_unknown: 'Unknown error',
      err_network_unavailable: 'Network error or server unavailable.',
      err_login_required: 'Email and Password are required.',
      err_login_failed: 'Login failed',
      err_invalid_credentials: 'Invalid credentials',
      err_login_network: 'Login failed: Network error or unavailable server.',
      err_login_failed_response: 'Login failed: response is not OK',
      class_options_title: 'Class Options',
      class_name_placeholder: 'Class name',
      rename_btn: 'Rename',
      delete_class_btn: 'Delete Class',
      add_btn: 'Add',
      finish_btn: 'Finish',
      cancel_btn: 'Cancel',
      confirm_btn: 'Confirm',
      scanner_finish_title: 'Finish class?',
      scanner_finish_message: 'Attendance data will be saved.',
      scanner_close_title: 'Close Scanner',
      scanner_close_message: 'Closing the scanner will discard attendance data.',
      unsaved_scanner_notice_title: 'Unsaved Attendances',
      unsaved_scanner_notice_message: 'There are unsaved attendances for this class. Please finish or discard the scanner session when done.',
      unsaved_scanner_notice_ok_btn: 'I understand',
      discard: 'Discard',
      no_students_found: 'No students found.',
      no_students_in_class: 'No students in this class.',
      no_students_assigned: 'No students assigned to this class.',
      no_matching_students: 'No matching students.',
      err_name_required: 'Name is required.',
      err_name_too_long: 'Name must be 50 characters or less.',
      creating: 'Creating...',
      submitting: 'Submitting...',
      err_load_students: 'Unable to load students. Please check your connection and try again.',
      err_no_students_db: 'No students available in the database.',
      total_attendance_tooltip: 'Total sessions attended',
      attendance_count_label: 'Attended',
      class_ready_badge: '✓ Ready',
      billing_title: 'Billing',
      billing_current_plan: 'Current plan',
      billing_subscription_status: 'Subscription status',
      billing_renews_on: 'Renews on',
      billing_manage: 'Manage billing',
      billing_opening: 'Opening...',
      billing_upgrade: 'Upgrade',
      billing_starting: 'Starting...',
      billing_err_portal: 'Unable to open billing portal. Please try again.',
      billing_err_checkout: 'Unable to start checkout. Please try again.',
      billing_err_status: 'Unable to load billing status.',
      billing_upgrade_not_configured: 'Upgrade is not configured yet.',
      current_language_label: 'Current',
      support_chat_title: 'Support',
      support_chat_open: '<img src="images/message-square-lines-svgrepo-com.svg" alt="" class="support-chat-icon" style="width: 32px; height: 32px; max-width: 100%;" />',
      support_chat_open_aria: 'Open Chat',
      support_chat_placeholder: 'Ask a question...',
      support_chat_send: 'Send',
      support_chat_welcome: 'Hello! I am the StudentCheck support assistant. How can I help you today?',
      support_chat_error_network: 'Network error. Please try again later.',
      support_chat_error_overloaded: 'The AI service is overloaded. Please try again in a moment.',
      support_chat_error_rate_limit: 'The AI\'s limit of 20 request per day is reached.',
      support_chat_cooldown: 'Please wait {sec}s...'
    },
    bg: {
      support_chat_title: 'Поддръжка',
      support_chat_open: '<img src="images/message-square-lines-svgrepo-com.svg" alt="" class="support-chat-icon" style="width: 32px; height: 32px; max-width: 100%;" />',
      support_chat_open_aria: 'Отвори чат',
      support_chat_placeholder: 'Задайте въпрос...',
      support_chat_send: 'Изпрати',
      support_chat_welcome: 'Здравей! Аз съм асистентът за поддръжка на StudentCheck. С какво мога да помогна днес?',
      support_chat_error_network: 'Мрежова грешка. Моля, опитайте отново по-късно.',
      support_chat_error_overloaded: 'AI услугата е претоварена. Моля, опитайте отново след малко.',
      support_chat_error_rate_limit: 'Лимитът на AI от 20 заявки на ден е достигнат.',
      support_chat_cooldown: 'Моля, изчакайте {sec} сек...',
      language_label: 'Език',
      brand_label: 'E-Trek',
      language_change_title: 'Промяна на езика',
      language_en: 'Английски',
      language_bg: 'Български',
      home_title: 'Влез като',
      email_or_faculty: 'Имейл или факултетен номер',
      enter_email_or_faculty: 'Имейл или фак. номер',
      role_student: 'Студент',
      role_teacher: 'Преподавател',
      student_login_title: 'Вход за студент',
      teacher_login_title: 'Вход за преподавател',
      faculty_number: 'Факултетен номер',
      password: 'Парола',
      log_in: 'Вход',
      logging_in: 'Влизане...',
      server_waking_up: 'Сървърът се събужда ... ({sec} сек)',
      no_account_register_html: 'Нямате акаунт? <a href="registration.html">Регистрация</a>',
      email: 'Имейл',
      enter_email: 'Въведете имейл',
      enter_password: 'Въведете парола',
      // Student page
      sp_home: 'Начало',
      sp_main_nav: 'Основна навигация',
      sp_academic_info: 'Академична информация',
      sp_settings: 'Настройки',
      sp_profile_loading: 'Зареждане на профила…',
      sp_not_provided: 'Не е посочено',
      // Teacher page shell
      tp_nav_payments: 'Плащания',
      tp_nav_statistics: 'Статистика',
      scanner_eyebrow: 'Сканиране на присъствия',
      scanner_instruction: 'Поставете QR кода на студента в рамката.',
      scanner_mode_label: 'Режим на сканиране',
      scanner_finish: 'Приключи',
      scanner_show_attendance: 'Покажи присъствията',
      scanner_status_loading: 'Зареждане на скенера…',
      scanner_status_permission: 'Изчакване на разрешение за камерата…',
      scanner_status_starting: 'Стартиране на камерата…',
      scanner_status_active: 'Камерата е активна',
      scanner_status_error: 'Камерата не е налична',
      scanner_err_denied_title: 'Нямате разрешение за камерата',
      scanner_err_denied_text: 'Разрешете достъпа до камерата от настройките на браузъра и опитайте отново.',
      scanner_err_busy_title: 'Камерата е заета',
      scanner_err_busy_text: 'Затворете други приложения или раздели, които използват камерата, и опитайте отново.',
      scanner_err_unavailable_title: 'Няма открита камера',
      scanner_err_unavailable_text: 'Свържете камера или отворете страницата на устройство с камера.',
      scanner_err_library_title: 'Скенерът не се зареди',
      scanner_err_library_text: 'Проверете връзката с интернет и опитайте отново.',
      scanner_err_failed_title: 'Камерата не можа да стартира',
      scanner_err_failed_text: 'Опитайте отново. Ако проблемът продължи, презаредете страницата.',
      scanner_fb_idle_title: 'Все още няма сканирани студенти.',
      scanner_fb_idle_detail: 'Записите остават в текущата сесия, докато не натиснете „Приключи“.',
      scanner_fb_entry: 'Влизането е отбелязано',
      scanner_fb_exit: 'Излизането е отбелязано',
      scanner_fb_session: 'записано в текущата сесия',
      scanner_fb_dup_entry: 'Влизането вече е отбелязано',
      scanner_fb_dup_exit: 'Излизането вече е отбелязано',
      scanner_fb_no_entry: 'Няма отбелязано влизане',
      scanner_fb_no_entry_detail: 'сканирайте първо при влизане',
      scanner_fb_not_in_class: 'Студентът не е в тази дисциплина',
      scanner_fb_not_recorded: 'Сканирането не е записано.',
      scanner_fb_invalid: 'Невалиден QR код',
      scanner_fb_invalid_detail: 'Кодът не е QR код на студент от StudentCheck.',
      scanner_fb_saving: 'Запазване на присъствията…',
      scanner_fb_saving_detail: 'Не затваряйте страницата.',
      scanner_fb_save_failed: 'Присъствията не са запазени',
      scanner_fb_save_failed_detail: 'Сесията е запазена на това устройство. Опитайте „Приключи“ отново.',
      tp_add_students_desc: 'Избери студентите за дисциплината.',
      tp_selected_count: 'Избрани: {n}',
      tp_adding: 'Добавяне…',
      tp_add_students_error: 'Неуспешно добавяне на студентите. Опитайте отново.',
      tp_no_students_yet: 'Все още няма регистрирани студенти.',
      tp_no_student_results: 'Няма студенти, отговарящи на търсенето.',
      tp_students_loading: 'Зареждане на студентите…',
      tp_filters: 'Филтри',
      tp_search_student: 'Търси студент',
      tp_stats_students: 'Студенти',
      tp_stats_lessons: 'Проведени занятия',
      tp_stats_average: 'Средна посещаемост',
      tp_stats_per_class: 'По дисциплини',
      tp_stats_loading: 'Зареждане на статистиката…',
      tp_stats_error: 'Неуспешно зареждане на статистиката.',
      tp_stats_empty: 'Все още нямате дисциплини.',
      tp_stats_students_one: '{n} студент',
      tp_stats_students_many: '{n} студенти',
      tp_stats_lessons_one: '{n} занятие',
      tp_stats_lessons_many: '{n} занятия',
      tp_stats_low_one: '{n} под 50%',
      tp_stats_low_many: '{n} под 50%',
      tp_stats_no_lessons: 'Няма проведени занятия',
      tp_stats_mode_classes: 'По дисциплини',
      tp_stats_mode_students: 'По студенти',
      tp_stats_per_student: 'По студенти',
      tp_stats_student_search: 'Търси студент',
      tp_stats_student_search_label: 'Търси студент',
      tp_stats_sort_label: 'Подреди',
      tp_stats_sort_name: 'По име',
      tp_stats_sort_rate: 'Най-ниска посещаемост',
      tp_stats_sort_streak: 'Поредни отсъствия',
      tp_stats_students_loading: 'Зареждане на студентите…',
      tp_stats_students_none: 'Все още нямате записани студенти.',
      tp_stats_students_nomatch: 'Няма намерени студенти.',
      tp_stats_students_error: 'Неуспешно зареждане на студентите.',
      tp_stats_found: '{n} намерени',
      tp_stats_courses_one: '{n} дисциплина',
      tp_stats_courses_many: '{n} дисциплини',
      tp_stats_below_courses_one: 'Под 50% в {n} дисциплина',
      tp_stats_below_courses_many: 'Под 50% в {n} дисциплини',
      tp_stats_streak_badge: '{n} поредни отсъствия',
      tp_stats_back: 'Всички студенти',
      tp_stats_fn: 'Фак. № {n}',
      tp_stats_overall: 'Обща посещаемост',
      tp_stats_of_lessons: '{a} от {h} занятия',
      tp_stats_n_of_m: '{n} от {m}',
      tp_stats_streak_title: 'Поредни отсъствия',
      tp_stats_streak_sub: 'най-много: {n}',
      tp_stats_late_title: 'Закъснения',
      tp_stats_avg_min_late: 'средно с {n} мин',
      tp_stats_never_late: 'не е закъснявал',
      tp_stats_inclass_title: 'Време в час',
      tp_stats_left_early_sub: 'тръгнал по-рано {n} от {m} пъти',
      tp_stats_lessons_with_scans: 'от {n} занятия с излизане',
      tp_stats_no_data: 'няма данни',
      tp_stats_can_miss_zero: 'Още едно отсъствие и пада под 50%.',
      tp_stats_can_miss_one: 'Може да отсъства още {n} път, без да падне под 50%.',
      tp_stats_can_miss_many: 'Може да отсъства още {n} пъти, без да падне под 50%.',
      tp_stats_needs_one: 'Под 50%: трябва да присъства на {n} занятие, за да стигне 50%.',
      tp_stats_needs_many: 'Под 50%: трябва да присъства на {n} поредни занятия, за да стигне 50%.',
      tp_stats_streak_line: 'Поредни отсъствия: {c} сега, най-много {l}',
      tp_stats_late_line: 'Закъснял на {n} от {m} занятия, средно с {x} мин',
      tp_stats_late_none: 'Не е закъснявал ({m} занятия с час на влизане)',
      tp_stats_early_line: 'Тръгнал по-рано {n} от {m} пъти, средно {x} мин преди края',
      tp_stats_early_none: 'Не е тръгвал по-рано ({m} занятия с час на излизане)',
      tp_stats_inclass_line: 'Средно {p}% от занятието в час ({m} занятия)',
      tp_stats_trend: 'Тенденция',
      tp_stats_trend_unit: 'Период',
      tp_stats_weeks: 'Седмици',
      tp_stats_months: 'Месеци',
      tp_stats_trend_up: 'Подобрява се спрямо по-ранните периоди',
      tp_stats_trend_down: 'Влошава се спрямо по-ранните периоди',
      tp_stats_trend_flat: 'Без съществена промяна',
      tp_stats_trend_empty: 'Все още няма занятия с дата.',
      tp_stats_week_of: 'Седмица от {d}',
      tp_stats_student_missing: 'Студентът не е намерен.',
      tp_stats_footnote: 'Началото и краят на занятието са първото и последното сканиране в него. Закъснение е влизане над {late} мин след началото, ранно тръгване — излизане над {early} мин преди края. Поредните отсъствия са в рамките на една дисциплина.',
      tp_nav_chat: 'Чат',
      tp_search_label: 'Търси дисциплина',
      tp_search_placeholder: 'Търси дисциплина...',
      tp_new_class: 'Нова дисциплина',
      tp_no_results: 'Няма дисциплини, които отговарят на търсенето.',
      tp_results_count: 'Намерени дисциплини: {n}',
      tp_skip_to_content: 'Към съдържанието',
      tp_export_pending: 'Изтегляне на таблицата…',
      tp_export_success: 'Таблицата с присъствия е изтеглена.',
      tp_export_error: 'Неуспешно изтегляне на таблицата. Опитайте отново.',
      tp_action_unavailable: 'Тази функция все още не е налична.',
      tp_action_error: 'Действието не може да бъде изпълнено. Опитайте отново.',
      tp_scanner_draft: 'има незапазено сканиране',
      tp_loading: 'Зареждане…',
      tp_load_error: 'Неуспешно зареждане. Опитайте отново.',
      tp_retry: 'Опитай отново',
      tp_refresh_failed: 'Не успяхме да обновим данните.',
      tp_classes_loading: 'Зареждане на дисциплините…',
      tp_classes_error: 'Неуспешно зареждане на дисциплините.',
      tp_classes_empty: 'Все още нямате дисциплини. Създайте първата с „Нова дисциплина“.',
      tp_students_error: 'Неуспешно зареждане на студентите.',
      tp_history_error: 'Неуспешно зареждане на историята на присъствията.',
      session_expired: 'Сесията изтече. Моля, влезте отново.',
      sp_nav_qr: 'QR код',
      sp_nav_courses: 'Дисциплини',
      sp_nav_profile: 'Профил',
      sp_my_qr: 'Моят QR',
      sp_fac_no: 'Фак. №',
      sp_courses_title: 'Дисциплини',
      sp_attendance_word: 'посещаемост',
      sp_low_attendance: 'Ниска посещаемост',
      sp_lessons: 'Занятия',
      sp_x_of_y_lessons: '{attended} от {total} занятия',
      sp_x_of_y_lessons_one: '{attended} от {total} занятие',
      sp_absences: '{n} отсъствия',
      sp_absences_one: '{n} отсъствие',
      sp_present: 'Присъствие',
      sp_absent: 'Отсъствие',
      sp_no_lessons_yet: 'Все още няма проведени занятия',
      sp_no_courses: 'Все още не сте добавени към дисциплина.',
      sp_load_error: 'Дисциплините не можаха да се заредят.',
      sp_lessons_error: 'Занятията не можаха да се заредят.',
      sp_retry: 'Опитай отново',
      sp_relogin: 'Влезте отново, за да видите посещаемостта си.',
      sp_unrecorded: '{n} по-ранни занятия нямат запис по занятие.',
      sp_unrecorded_one: '1 по-ранно занятие няма запис по занятие.',
      sp_qr_unavailable: 'QR кодът не можа да се генерира.',
      sp_session_incomplete: 'Данните за сесията са непълни. Моля, влезте отново.',
      sp_name: 'Име',
      sp_faculty_number: 'Факултетен номер',
      sp_language: 'Език',
      create_account_title: 'Създай акаунт',
      first_name: 'Име',
      middle_name: 'Бащино име',
      last_name: 'Фамилия',
      faculty: 'Факултет',
      level: 'Степен',
      specialization: 'Специалност',
      group: 'Група',
      course: 'Курс',
      faculty_number_label: 'Факултетен номер',
      repeat_password: 'Повтори паролата',
      password_req_length: 'Поне 8 символа',
      password_req_letter: 'Съдържа буква',
      password_req_number: 'Съдържа число',
      password_req_match: 'Паролите съвпадат',
      already_have_account_html: 'Вече имате акаунт? <a href="index.html">Вход</a>',
      back: 'Назад',
      continue: 'Продължи',
      finish: 'Завърши',
      student_home_title: 'Студентска начална страница',
      welcome_prefix: 'Добре дошли, ',
      faculty_number_prefix: 'Факултетен номер: ',
      classes: 'Дисциплини',
      details: 'Детайли',
      class_details: 'Детайли за дисциплината',
      attended_classes: 'Посетени занятия:',
      total_classes: 'Общо занятия:',
      log_out: 'Изход',
      students: 'Студенти',
      reset: 'Нулирай',
      add_students: 'Добави студенти',
      close: 'Затвори',
      attendance_history: 'История на присъствия',
      joined_label: 'Влязъл',
      left_label: 'Излязъл',
      no_attendance_records: 'Няма записи за присъствие.',
      student_info_title: 'Информация за студента',
      full_name_label: 'Три имена',
      attended_classes_label: 'Посетени занятия',
      remove_from_class: 'Премахни от дисциплината',
      billing_page: 'Страница за плащане',
      confirm_delete_class: 'Сигурни ли сте, че искате да изтриете тази дисциплина?',
      confirm_remove_student_prefix: 'Сигурни ли сте, че искате да премахнете',
      confirm_remove_student_suffix: 'от дисциплината?',
      this_student: 'този студент',
      create_class: 'Създай дисциплина',
      name: 'Име',
      add: 'Добави',
      add_btn: 'Добави',
      finish_btn: 'Завърши',
      cancel_btn: 'Отказ',
      confirm_btn: 'Потвърди',
      class_ready: 'Готово',
      manage_students: 'Управление на студенти',
      start_scanner: 'Стартирай скенер',
      finish_class: 'Завърши дисциплината',
      download_attendance_table: 'Изтегли таблица с присъствия',
      options: 'Опции',
      start_scanning: 'Стартирай сканиране',
      joining: 'Влизане',
      leaving: 'Излизане',
      show_attendance: 'Покажи присъствия',
      attendance: 'Присъствия',
      new_class: '+ Нова дисциплина',
      search_placeholder: 'Търси...',
      search_students_placeholder: 'Търси студенти...',
      any: 'Всички',
      bachelor: 'Бакалавър',
      master: 'Магистър',
      phd: 'Докторант',
      no_classes_found: 'Няма намерени дисциплини.',
      student_no_classes: 'Все още не сте добавени към нито една дисциплина.',
      err_specializations_unavailable: 'Грешка: Няма налични специализации за избрания факултет и степен.',
      err_fill_all_fields: 'Моля, попълнете всички полета.',
      err_select_faculty: 'Моля, изберете факултет.',
      err_select_level: 'Моля, изберете степен.',
      err_select_specialization: 'Моля, изберете специалност.',
      err_select_group: 'Моля, изберете група.',
      err_select_course: 'Моля, изберете курс.',
      err_email_required: 'Имейлът е задължителен.',
      err_email_invalid: 'Въведете валиден имейл адрес.',
      err_faculty_required: 'Факултетният номер е задължителен.',
      err_faculty_length: 'Факултетният номер трябва да е точно 9 символа.',
      err_faculty_letter_digit: 'Факултетният номер трябва да съдържа буква или цифра.',
      err_faculty_too_long: 'Факултетният номер е твърде дълъг (макс. 50).',
      err_faculty_invalid_chars: 'Факултетният номер съдържа само невалидни символи.',
      err_group_invalid: 'Моля, изберете група (37–42).',
      err_email_verify: 'Неуспешна проверка на имейла. Опитайте отново.',
      err_email_exists: 'Този имейл вече е регистриран. Моля, опитайте с друг.',
      err_faculty_verify: 'Неуспешна проверка на факултетния номер. Опитайте отново.',
      err_faculty_exists: 'Този факултетен номер вече е регистриран. Моля, опитайте с друг.',
      toast_class_renamed: 'Дисциплината беше преименуван.',
      toast_student_removed: 'Студентът е премахнат.',
      toast_student_added: 'Успешно добавен студент.',
      toast_students_added: 'Успешно добавени студенти.',
      already_in_badge: 'Добавен',
      err_class_name_taken: 'Това име на клас вече е използвано.',
      err_password_requirements: 'Моля, изпълнете всички изисквания за паролата.',
      scanner_finish_title: 'Завърши дисциплината?',
      scanner_finish_message: 'Данните за присъствията ще бъдат записани.',
      scanner_close_title: 'Затвори скенера',
      scanner_close_message: 'Затварянето на скенера ще изтрие данните за присъствията.',
      err_registration_failed_prefix: 'Неуспешна регистрация: ',
      err_registration_failed_unknown: 'Неизвестна грешка',
      err_network_unavailable: 'Мрежова грешка или сървърът е недостъпен.',
      err_login_required: 'Имейлът и паролата са задължителни.',
      err_login_failed: 'Неуспешен вход',
      err_invalid_credentials: 'Невалидни данни',
      err_login_network: 'Неуспешен вход: Мрежова грешка или недостъпен сървър.',
      err_login_failed_response: 'Неуспешен вход: неуспешен отговор от сървъра',
      class_options_title: 'Опции на клас',
      class_name_placeholder: 'Име на клас',
      rename_btn: 'Преименувай',
      delete_class_btn: 'Изтрий клас',
      add_btn: 'Добави',
      finish_btn: 'Завърши',
      cancel_btn: 'Отказ',
      confirm_btn: 'Потвърди',
      scanner_finish_title: 'Да завършим ли дисциплината?',
      scanner_finish_message: 'Данните за присъствието ще бъдат запазени.',
      scanner_close_title: 'Затваряне на скенера',
      scanner_close_message: 'Затварянето на скенера ще изтрие данните за присъствието.',
      unsaved_scanner_notice_title: 'Незапазени присъствия',
      unsaved_scanner_notice_message: 'Има незапазени присъствия за тази дисциплина. Моля, завършете или откажете сесията на сканиране.',
      unsaved_scanner_notice_ok_btn: 'Разбирам',
      discard: 'Откажи',
      no_students_found: 'Няма намерени студенти.',
      no_students_in_class: 'Няма студенти в тази дисциплина.',
      no_students_assigned: 'Няма назначени студенти в тази дисциплина.',
      no_matching_students: 'Няма съответстващи студенти.',
      err_name_required: 'Името е задължително.',
      err_name_too_long: 'Името трябва да е 50 символа или по-малко.',
      creating: 'Създаване...',
      submitting: 'Изпращане...',
      err_load_students: 'Неуспешно зареждане на студентите. Проверете връзката си и опитайте отново.',
      err_no_students_db: 'Няма налични студенти в базата данни.',
      total_attendance_tooltip: 'Общо посетени занятия',
      attendance_count_label: 'Посетени',
      class_ready_badge: '✓ Готово',
      billing_title: 'Плащания',
      billing_current_plan: 'Текущ план',
      billing_subscription_status: 'Статус на абонамент',
      billing_renews_on: 'Подновяване на',
      billing_manage: 'Управление на плащания',
      billing_opening: 'Отваряне...',
      billing_upgrade: 'Надграждане',
      billing_starting: 'Стартиране...',
      billing_err_portal: 'Неуспешно отваряне на портала за плащания. Опитайте отново.',
      billing_err_checkout: 'Неуспешно стартиране на плащането. Опитайте отново.',
      billing_err_status: 'Неуспешно зареждане на статуса на плащанията.',
      billing_upgrade_not_configured: 'Надграждането все още не е конфигурирано.',
      current_language_label: 'Текущ'
    }
  };

  function getLanguage() {
    return localStorage.getItem(LANGUAGE_KEY) || DEFAULT_LANG;
  }

  function setLanguage(lang) {
    localStorage.setItem(LANGUAGE_KEY, lang);
    applyTranslations();
    // Pages that render text from JS re-render on this event
    document.dispatchEvent(new CustomEvent('app:languagechange', { detail: { lang } }));
  }

  function t(key) {
    const lang = getLanguage();
    return (translations[lang] && translations[lang][key]) || translations.en[key] || key;
  }

  function openLanguageMenu() {
    const overlay = document.getElementById('langOverlay');
    if (!overlay) return;

    const updateLangButtons = () => {
      const titleEl = document.getElementById('langTitle');
      if (titleEl) titleEl.textContent = t('language_change_title');
      const enBtn = overlay.querySelector('[data-lang="en"]');
      const bgBtn = overlay.querySelector('[data-lang="bg"]');
      if (enBtn) enBtn.innerHTML = `<img src="icons/united-kingdom.svg" alt="" class="lang-flag" /> ${t('language_en')}`;
      if (bgBtn) bgBtn.innerHTML = `<img src="icons/bulgaria.svg" alt="" class="lang-flag" /> ${t('language_bg')}`;
      const current = getLanguage();
      if (enBtn) enBtn.classList.toggle('active', current === 'en');
      if (bgBtn) bgBtn.classList.toggle('active', current === 'bg');
    };

    updateLangButtons();
    overlay.classList.add('visible');
  }

  function applyEntry(entry) {
    const nodes = document.querySelectorAll(entry.selector);
    if (!nodes || nodes.length === 0) return;
    const value = t(entry.key);
    nodes.forEach((el) => {
      if (entry.selector === '#readyClassTitle' && el.dataset.dynamicTitle === 'true') {
        return;
      }
      if (entry.html) {
        el.innerHTML = value;
        return;
      }
      if (entry.attr) {
        el.setAttribute(entry.attr, value);
        return;
      }
      el.textContent = value;
    });
  }

  function updateModeLabels() {
    const labels = document.querySelectorAll('#scannerOverlay .mode-label');
    if (labels.length >= 2) {
      labels[0].textContent = t('joining');
      labels[1].textContent = t('leaving');
    }
  }

  function updateSelectOptions() {
    const lang = getLanguage();
    const optionMap = {
      bachelor: t('bachelor') || 'Bachelor',
      master: t('master') || 'Master',
      phd: t('phd') || 'PhD'
    };
    const emptyOptionBySelectId = {
      specialization: '',
      filterLevel: t('level') || 'Level',
      createClassFilterLevel: t('level') || 'Level',
      addStudentsFilterLevel: t('level') || 'Level',
      filterFaculty: t('faculty') || 'Faculty',
      createClassFilterFaculty: t('faculty') || 'Faculty',
      addStudentsFilterFaculty: t('faculty') || 'Faculty',
      filterSpecialization: t('specialization') || 'Specialization',
      createClassFilterSpecialization: t('specialization') || 'Specialization',
      addStudentsFilterSpecialization: t('specialization') || 'Specialization',
      filterGroup: t('group') || 'Group',
      createClassFilterGroup: t('group') || 'Group',
      addStudentsFilterGroup: t('group') || 'Group'
    };
    const localizedOptionMap = {
      economics: { en: 'Economics', bg: 'Икономика' },
      Economics: { en: 'Economics', bg: 'Икономика' },
      'Business Management': { en: 'Business Management', bg: 'Бизнес управление' },
      'Business Management 1': { en: 'Business Management 1', bg: 'Бизнес управление 1' },
      'Business Management 2': { en: 'Business Management 2', bg: 'Бизнес управление 2' },
      'Business Management in English': { en: 'Business Management in English', bg: 'Бизнес управление (английски)' },
      'Industrial Management': { en: 'Industrial Management', bg: 'Индустриален мениджмънт' },
      'Industrial Management in English': { en: 'Industrial Management in English', bg: 'Индустриален мениджмънт (английски)' },
      'Management and Business Information Systems': { en: 'Management and Business Information Systems', bg: 'Мениджмънт и бизнес информационни системи' },
      'Electricity Management': { en: 'Electricity Management', bg: 'Електроенергийно управление' },
      'Intellectual Property and Innovation': { en: 'Intellectual Property and Innovation', bg: 'Интелектуална собственост и иновации' },
      'Senior Management': { en: 'Senior Management', bg: 'Висш мениджмънт' }
    };
    document.querySelectorAll('select').forEach(select => {
      Array.from(select.options).forEach(opt => {
        if (opt.value === '') {
          const label = emptyOptionBySelectId[select.id] || t('any') || 'Any';
          opt.textContent = label;
          return;
        }
        if (optionMap.hasOwnProperty(opt.value)) {
          opt.textContent = optionMap[opt.value];
          return;
        }
        const mapping = localizedOptionMap[opt.value] || localizedOptionMap[opt.textContent];
        if (mapping) {
          opt.textContent = lang === 'bg' ? mapping.bg : mapping.en;
        }
      });
    });
  }

  // Generic markup translations: data-i18n="key" (text) and
  // data-i18n-attr="attr:key;attr:key". Only replaces text when a translation exists.
  function applyDataI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const value = t(key);
      if (value && value !== key) el.textContent = value;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
        const [attr, key] = pair.split(':');
        if (!attr || !key) return;
        const value = t(key);
        if (value && value !== key) el.setAttribute(attr, value);
      });
    });
  }

  function applyTranslations() {
    const lang = getLanguage();
    document.documentElement.lang = lang;
    applyDataI18n();
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

    const pages = {
      'index.html': [
        { selector: '#homeTitle', key: 'log_in' },
        { selector: '#identifierLabel', key: 'email_or_faculty' },
        { selector: '#loginIdentifier', key: 'enter_email_or_faculty', attr: 'placeholder' },
        { selector: '#passwordLabel', key: 'password' },
        { selector: '#password', key: 'enter_password', attr: 'placeholder' },
        { selector: '#loginSubmitBtn', key: 'log_in' },
        { selector: '#registerPrompt', key: 'no_account_register_html', html: true },
        { selector: '#error-message', key: 'err_login_failed' }
      ],
      'studentlogin.html': [
        { selector: '#loginTitle', key: 'student_login_title' },
        { selector: 'label[for="facultyNumber"]', key: 'faculty_number' },
        { selector: 'label[for="password"]', key: 'password' },
        { selector: '#studentLoginForm .btn.btn-primary', key: 'log_in' },
        { selector: '.muted', key: 'no_account_register_html', html: true },
        { selector: '#error-message', key: 'err_login_failed' }
      ],
      'teacherlogin.html': [
        { selector: '#teacherLoginTitle', key: 'teacher_login_title' },
        { selector: 'label[for="email"]', key: 'email' },
        { selector: '#email', key: 'enter_email', attr: 'placeholder' },
        { selector: 'label[for="password"]', key: 'password' },
        { selector: '#password', key: 'enter_password', attr: 'placeholder' },
        { selector: '#teacherLoginForm .btn.btn-primary', key: 'log_in' },
        { selector: '#error-message', key: 'err_login_failed' }
      ],
      'registration.html': [
        { selector: '#signupTitle', key: 'create_account_title' },
        { selector: 'label[for="firstName"]', key: 'first_name' },
        { selector: 'label[for="middleName"]', key: 'middle_name' },
        { selector: 'label[for="lastName"]', key: 'last_name' },
        { selector: 'label[for="faculty"]', key: 'faculty' },
        { selector: 'label[for="level"]', key: 'level' },
        { selector: 'label[for="specialization"]', key: 'specialization' },
        { selector: 'label[for="group"]', key: 'group' },
        { selector: 'label[for="course"]', key: 'course' },
        { selector: 'label[for="email"]', key: 'email' },
        { selector: 'label[for="facultyNumber"]', key: 'faculty_number_label' },
        { selector: 'label[for="password"]', key: 'password' },
        { selector: 'label[for="repeatPassword"]', key: 'repeat_password' },
        { selector: '#reqLength', key: 'password_req_length' },
        { selector: '#reqLetter', key: 'password_req_letter' },
        { selector: '#reqNumber', key: 'password_req_number' },
        { selector: '#reqMatch', key: 'password_req_match' },
        { selector: '#backBtn', key: 'back' },
        { selector: '#nextBtn', key: 'continue' },
        { selector: '#finishBtn', key: 'finish' }
      ],
      'teacherhomepage.html': [
        { selector: '#overlayTitle', key: 'students' },
        { selector: '#resetFiltersBtn', key: 'reset' },
        { selector: '#searchAddStudentsOverlayBtn', key: 'add_students' },
        { selector: '#closeOverlayBtn', key: 'close' },
        { selector: '#attendanceHistoryTitle', key: 'attendance_history' },
        { selector: '#attendanceHistoryBackBtn', key: 'back' },
        { selector: '#classWizardTitle', key: 'create_class' },
        { selector: 'label[for="createClassNameInput"]', key: 'name' },
        { selector: '#createClassResetFiltersBtn', key: 'reset' },
        { selector: '#createClassBackBtn', key: 'back' },
        { selector: '#createClassNextBtn', key: 'continue' },
        { selector: '#createClassFinishBtn', key: 'finish' },
        { selector: '#manageStudentsTitle', key: 'manage_students' },
        { selector: '#backToReadyBtn', key: 'back' },
        { selector: '#addStudentManageBtn', key: 'add_students' },
        { selector: '#addStudentsTitle', key: 'add_students' },
        { selector: '#addStudentsResetFiltersBtn', key: 'reset' },
        { selector: '#classAddStudentsOverlayBtn:not([data-pending])', key: 'add' },
        { selector: '#addStudentsDesc', key: 'tp_add_students_desc' },
        { selector: '#addStudentsBackBtn', key: 'back' },
        { selector: '#closeAddStudentsClassBtn', key: 'close', attr: 'aria-label' },
        { selector: '#addStudentsFilterToggleLabel', key: 'tp_filters' },
        { selector: '#addStudentsFilterToggle', key: 'tp_filters', attr: 'aria-label' },
        { selector: '#addStudentsSearchInput', key: 'tp_search_student', attr: 'aria-label' },
        { selector: '#readyClassTitle', key: 'class_ready' },
        { selector: '#manageStudentsBtn .tp-action-label', key: 'manage_students' },
        { selector: '#startScannerBtn .tp-action-label', key: 'start_scanner' },
        { selector: '#downloadAttendanceTableBtn .tp-action-label', key: 'download_attendance_table' },
        { selector: '#classOptionsBtn .tp-action-label', key: 'options' },
        { selector: '#closeReadyPopupBtn', key: 'close', attr: 'aria-label' },
        { selector: '#scannerStopBtn', key: 'scanner_show_attendance' },
        { selector: '#scannerCloseBtn', key: 'scanner_finish' },
        { selector: '#closeScannerBtn', key: 'close', attr: 'aria-label' },
        { selector: '#scannerEyebrow', key: 'scanner_eyebrow' },
        { selector: '#scannerInstruction', key: 'scanner_instruction' },
        { selector: '#scannerModeGroup', key: 'scanner_mode_label', attr: 'aria-label' },
        { selector: '#scannerRetryBtn', key: 'tp_retry' },
        { selector: '#attendanceTitle', key: 'attendance' },
        { selector: '#classesTitle', key: 'classes' },
        { selector: '#addClassBtnLabel', key: 'tp_new_class' },
        { selector: '#classSearchLabel', key: 'tp_search_label' },
        { selector: '#classSearchInput', key: 'tp_search_placeholder', attr: 'placeholder' },
        { selector: '#createClassSearchInput', key: 'search_students_placeholder', attr: 'placeholder' },
        { selector: '#addStudentsSearchInput', key: 'search_placeholder', attr: 'placeholder' },
        { selector: '#overlaySearchInput', key: 'search_placeholder', attr: 'placeholder' },
        { selector: '#scannerDiscardBtn', key: 'cancel_btn' },
        { selector: '#classListNone', key: 'tp_classes_empty' },
        { selector: '#classListStatus', key: 'tp_classes_loading' },
        { selector: '#billingTitle', key: 'billing_title' },
        { selector: '#billingSection .billing-row:nth-of-type(1) .billing-label', key: 'billing_current_plan' },
        { selector: '#billingSection .billing-row:nth-of-type(2) .billing-label', key: 'billing_subscription_status' },
        { selector: '#billingSection .billing-row:nth-of-type(3) .billing-label', key: 'billing_renews_on' },
        { selector: '#manageBillingBtn:not([data-pending])', key: 'billing_manage' },
        { selector: '#upgradeBillingBtn:not([data-pending])', key: 'billing_upgrade' },
        { selector: '#billingLoadingStatus', key: 'tp_loading' }
      ],
      'billing.html': [
        { selector: '#billingTitle', key: 'billing_title' },
        { selector: '.billing-row:nth-of-type(1) .billing-label', key: 'billing_current_plan' },
        { selector: '.billing-row:nth-of-type(2) .billing-label', key: 'billing_subscription_status' },
        { selector: '.billing-row:nth-of-type(3) .billing-label', key: 'billing_renews_on' },
        { selector: '#manageBillingBtn', key: 'billing_manage' },
        { selector: '#upgradeBillingBtn', key: 'billing_upgrade' }
      ]
    };

    // Teacher shell (javascript/ui/teacherShell.js) + support chat: applied on
    // every page that mounts them, not tied to one file name.
    const shell = [
      { selector: '#tpNavClasses', key: 'classes' },
      { selector: '#tpNavPayments', key: 'tp_nav_payments' },
      { selector: '#tpNavStatistics', key: 'tp_nav_statistics' },
      { selector: '#tpNavChat', key: 'tp_nav_chat' },
      { selector: '#statisticsTitle', key: 'tp_nav_statistics' },
      { selector: '#statClassesLabel', key: 'classes' },
      { selector: '#statStudentsLabel', key: 'tp_stats_students' },
      { selector: '#statLessonsLabel', key: 'tp_stats_lessons' },
      { selector: '#statAverageLabel', key: 'tp_stats_average' },
      { selector: '#statsPerClassTitle', key: 'tp_stats_per_class' },
      { selector: '#statsLoadingStatus', key: 'tp_stats_loading' },
      { selector: '#statsNone', key: 'tp_stats_empty' },
      { selector: '#statsModeClasses', key: 'tp_stats_mode_classes' },
      { selector: '#statsModeStudents', key: 'tp_stats_mode_students' },
      { selector: '#statsPerStudentTitle', key: 'tp_stats_per_student' },
      { selector: '#statsStudentSearchLabel', key: 'tp_stats_student_search_label' },
      { selector: '#statsStudentSearch', key: 'tp_stats_student_search', attr: 'placeholder' },
      { selector: '#statsStudentSortLabel', key: 'tp_stats_sort_label' },
      { selector: '#statsSortName', key: 'tp_stats_sort_name' },
      { selector: '#statsSortRate', key: 'tp_stats_sort_rate' },
      { selector: '#statsSortStreak', key: 'tp_stats_sort_streak' },
      { selector: '#statsStudentsLoading', key: 'tp_stats_students_loading' },
      { selector: '#statsStudentsNone', key: 'tp_stats_students_none' },
      { selector: '#statsStudentsNoMatch', key: 'tp_stats_students_nomatch' },
      { selector: '#tpNav', key: 'sp_main_nav', attr: 'aria-label' },
      { selector: '#tpSkipLink', key: 'tp_skip_to_content' },
      { selector: '#chatTitle', key: 'tp_nav_chat' },
      { selector: '#chatInput', key: 'support_chat_placeholder', attr: 'placeholder' },
      { selector: '#chatInput', key: 'support_chat_placeholder', attr: 'aria-label' },
      { selector: '#sendChatBtn', key: 'support_chat_send' },
      { selector: '#chatHistoryContainer .chat-message.model:first-child', key: 'support_chat_welcome' }
    ];

    (pages[page] || []).forEach(applyEntry);
    shell.forEach(applyEntry);

    if (page === 'registration.html') {
      const errorEls = document.querySelectorAll('[data-i18n-error-key]');
      errorEls.forEach((el) => {
        const key = el.getAttribute('data-i18n-error-key');
        if (key) el.textContent = t(key);
      });
    }
    updateSelectOptions();
    if (page === 'teacherhomepage.html') {
      updateModeLabels();
    }
    updateLanguageCornerDisplay();
    updateNavClusterLabels();
  }

  function updateNavClusterLabels() {
    const brandLabel = document.getElementById('navControlBrandLabel');
    const brandBtn = document.getElementById('navControlBrandBtn');
    const brandBtnImg = brandBtn ? brandBtn.querySelector('img') : null;
    const languageLabel = document.getElementById('navControlLanguageLabel');
    const logoutLabel = document.getElementById('navMenuLogoutLabel');
    const logoutBtn = document.getElementById('navMenuLogoutBtn');
    const floatingBillingBtn = document.getElementById('floatingBillingBtn');
    if (brandLabel) brandLabel.textContent = t('brand_label') || 'E-Trek';
    if (brandBtn) brandBtn.setAttribute('aria-label', BRAND_LOGO_ALT);
    if (brandBtnImg) {
      brandBtnImg.setAttribute('src', BRAND_LOGO_SRC);
      brandBtnImg.setAttribute('alt', BRAND_LOGO_ALT);
    }
    if (languageLabel) languageLabel.textContent = t('language_label') || 'Language';
    if (logoutLabel) logoutLabel.textContent = t('log_out') || 'Log out';
    if (logoutBtn) logoutBtn.setAttribute('aria-label', t('log_out') || 'Log out');
    if (floatingBillingBtn) floatingBillingBtn.setAttribute('aria-label', t('billing_page') || 'Billing Page');
  }

  function refreshNavbarLogoButton() {
    const logoBtn = document.querySelector('.navbar-logo');
    if (!logoBtn) return;

    logoBtn.type = 'button';
    logoBtn.setAttribute('aria-label', BRAND_LOGO_ALT);
    // Pages that draw their own logo mark (inline SVG) opt out of the image swap
    if (logoBtn.dataset.customLogo === 'true') return;

    let logoImg = logoBtn.querySelector('img');
    if (!logoImg) {
      logoImg = document.createElement('img');
      logoBtn.replaceChildren(logoImg);
    }
    logoImg.setAttribute('src', BRAND_LOGO_SRC);
    logoImg.setAttribute('alt', BRAND_LOGO_ALT);
  }

  function updateLanguageCornerDisplay() {
    const textEl = document.querySelector('#languageCornerDisplay .language-corner-text');
    if (!textEl) return;
    const lang = (getLanguage() || 'en').toUpperCase();
    textEl.textContent = lang;
  }

  function ensureNavControlCluster(btn) {
    const logoBtn = document.querySelector('.navbar-logo');
    if (!logoBtn) return;

    let shell = document.getElementById('navMenuShell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'navMenuShell';
      shell.className = 'nav-menu-shell';
      shell.innerHTML = `
        <div id="navMenuBackdrop" class="nav-menu-backdrop"></div>
        <aside id="navControlCluster" class="nav-menu-panel" aria-hidden="true">
          <div class="nav-menu-content">
            <div class="nav-menu-item nav-menu-item-brand">
              <button id="navControlBrandBtn" class="nav-control-brand-btn" type="button" aria-label="Home">
                <img src="images/new_main_logo.png" alt="Home">
              </button>
              <span id="navControlBrandLabel" class="nav-control-label nav-control-label-brand">E-Trek</span>
            </div>
            <div class="nav-menu-item nav-menu-item-language" id="navMenuLanguageRow"></div>
            <div class="nav-menu-spacer" aria-hidden="true"></div>
            <div class="nav-menu-item nav-menu-item-logout" id="navMenuLogoutRow">
              <button id="navMenuLogoutBtn" class="nav-menu-logout-btn" type="button" aria-label="Log out">
                <img src="icons/logout.svg" alt="" class="nav-menu-logout-icon">
              </button>
              <span id="navMenuLogoutLabel" class="nav-control-label nav-control-label-language">Log out</span>
            </div>
          </div>
        </aside>
      `;
      document.body.appendChild(shell);
    }

    const languageRow = document.getElementById('navMenuLanguageRow');
    if (!languageRow) return;
    if (!languageRow.contains(btn)) languageRow.prepend(btn);

    let languageLabel = document.getElementById('navControlLanguageLabel');
    if (!languageLabel) {
      languageLabel = document.createElement('span');
      languageLabel.id = 'navControlLanguageLabel';
      languageLabel.className = 'nav-control-label nav-control-label-language';
      languageLabel.textContent = 'Language';
      languageRow.appendChild(languageLabel);
    }

    const panel = document.getElementById('navControlCluster');
    const backdrop = document.getElementById('navMenuBackdrop');
    const brandBtn = document.getElementById('navControlBrandBtn');
    const logoutBtn = document.getElementById('navMenuLogoutBtn');
    const logoutRow = document.getElementById('navMenuLogoutRow');
    if (!panel || !backdrop) return;

    function hasActiveProfileSession() {
      try {
        const hasStudent = !!sessionStorage.getItem('studentData');
        const hasTeacher = !!sessionStorage.getItem('teacherData');
        return hasStudent || hasTeacher;
      } catch (_) {
        return false;
      }
    }

    function resolveHomepageBySession() {
      try {
        if (sessionStorage.getItem('teacherData')) return 'teacherHomepage.html';
        if (sessionStorage.getItem('studentData')) return 'studentHomepage.html';
      } catch (_) {}
      return 'index.html';
    }

    function syncLogoutVisibility() {
      if (!logoutBtn || !logoutRow) return;
      const visible = hasActiveProfileSession();
      logoutRow.style.display = visible ? 'grid' : 'none';
      logoutBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
      logoutBtn.tabIndex = visible ? 0 : -1;
    }

    logoBtn.setAttribute('aria-controls', 'navControlCluster');
    logoBtn.setAttribute('aria-expanded', 'false');

    function closeMenu() {
      shell.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      logoBtn.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      syncLogoutVisibility();
      shell.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      logoBtn.setAttribute('aria-expanded', 'true');
    }

    function toggleMenu() {
      if (shell.classList.contains('open')) closeMenu();
      else openMenu();
    }

    if (!shell.dataset.bound) {
      backdrop.addEventListener('click', closeMenu);
      if (brandBtn) {
        brandBtn.addEventListener('click', () => {
          const destination = resolveHomepageBySession();
          closeMenu();
          const currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
          if (currentPage !== destination.toLowerCase()) {
            window.location.href = destination;
          }
        });
      }
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          clearSessionData();
          closeMenu();
          window.location.replace('index.html');
        });
      }
      panel.addEventListener('click', (e) => {
        const selected = e.target && e.target.closest
          ? e.target.closest('button, a, input, select, textarea, [tabindex]')
          : null;
        if (!selected) return;
        requestAnimationFrame(() => {
          closeMenu();
          if (typeof selected.focus === 'function') {
            selected.focus({ preventScroll: true });
          }
        });
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
      });
      shell.dataset.bound = 'true';
    }

    syncLogoutVisibility();

    window.NavMenu = {
      open: openMenu,
      close: closeMenu,
      toggle: toggleMenu,
      isReady: () => !!document.getElementById('navMenuShell')
    };
  }

  function ensureLanguageUI() {
    let btn = document.getElementById('langToggleBtn');
    if (btn) {
      ensureNavControlCluster(btn);
      updateNavClusterLabels();
      return;
    }
    btn = document.createElement('button');
    btn.id = 'langToggleBtn';
    btn.className = 'lang-toggle-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Change language');
    btn.innerHTML = '<img src="icons/globe-earth.svg" alt="" class="lang-toggle-icon" />';

    const overlay = document.createElement('div');
    overlay.id = 'langOverlay';
    overlay.className = 'lang-overlay';
    overlay.innerHTML = `
      <div class="lang-popup" role="dialog" aria-modal="true">
        <h2 id="langTitle"></h2>
        <div class="lang-actions">
          <button type="button" class="lang-btn" data-lang="en">🇬🇧</button>
          <button type="button" class="lang-btn" data-lang="bg">🇧🇬</button>
        </div>
      </div>
    `;

    ensureNavControlCluster(btn);
    document.body.appendChild(overlay);

    btn.addEventListener('click', openLanguageMenu);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('visible');
    });

    overlay.querySelectorAll('.lang-btn').forEach(b => {
      b.addEventListener('click', () => {
        const lang = b.getAttribute('data-lang');
        setLanguage(lang);
        overlay.classList.remove('visible');
      });
    });
  }

  function ensureLanguageCornerDisplay() {
    let display = document.getElementById('languageCornerDisplay');
    if (display && display.dataset.interactive) return;

    if (!display) {
      display = document.createElement('div');
      display.id = 'languageCornerDisplay';
      display.className = 'language-corner-display';
      display.setAttribute('aria-live', 'polite');
      display.innerHTML = `
        <span class="language-corner-glyph" aria-hidden="true">🌐</span>
        <span class="language-corner-text"></span>
      `;
      document.body.appendChild(display);
    }

    display.setAttribute('role', 'button');
    display.setAttribute('tabindex', '0');
    display.dataset.interactive = 'true';

    const playClickAnimation = () => {
      display.classList.remove('is-clicking');
      void display.offsetWidth;
      display.classList.add('is-clicking');
    };

    display.addEventListener('animationend', () => {
      display.classList.remove('is-clicking');
    });

    display.addEventListener('click', () => {
      playClickAnimation();
      openLanguageMenu();
    });
    display.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        playClickAnimation();
        openLanguageMenu();
      }
    });
  }

  function ensureFloatingBillingButton() {
    let btn = document.getElementById('floatingBillingBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'floatingBillingBtn';
      btn.className = 'billing-fab';
      btn.type = 'button';
      btn.innerHTML = '<span class="billing-fab-glyph" aria-hidden="true">$</span>';
      document.body.appendChild(btn);

      // Open the billing page (plan, status, Stripe portal)
      btn.addEventListener('click', () => {
        window.location.href = 'teacherHomepage.html#payments';
      });
    }

    function hasTeacherSession() {
      try { return !!sessionStorage.getItem('teacherData'); } catch (_) { return false; }
    }
    const isBillingPage = window.location.pathname.toLowerCase().includes('billing.html')
      || document.body.classList.contains('tp-app');
    btn.style.display = (hasTeacherSession() && !isBillingPage) ? 'flex' : 'none';
  }

  function init() {
    refreshNavbarLogoButton();
    ensureLanguageUI();
    ensureLanguageCornerDisplay();
    ensureFloatingBillingButton();
    applyTranslations();
  }

  // shared.js is the last classic script in <body>: the markup above it is
  // parsed, so translate it now (before first paint where possible) instead of
  // waiting for the module scripts and DOMContentLoaded.
  try { applyTranslations(); } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.i18n = { t, setLanguage, getLanguage, applyTranslations, openLanguageMenu };
  window.clearSessionData = clearSessionData;

  // Called by the login page right before storing a new session. Cached
  // classes/rosters/students are kept per device; never reuse them for a
  // different account.
  window.prepareSessionFor = function prepareSessionFor(accountScope) {
    try {
      const previous = localStorage.getItem('sc.lastAccount');
      const legacyTeacher = (localStorage.getItem('teacherEmail') || '').trim().toLowerCase();
      const switched = previous
        ? previous !== accountScope
        : (legacyTeacher && accountScope !== `teacher:${legacyTeacher}`);
      if (switched) clearSessionData();
      localStorage.setItem('sc.lastAccount', accountScope);
    } catch (_) {}
  };
})();
