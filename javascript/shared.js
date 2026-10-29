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

// Reusable loading/submitting overlay with long-wait timer
// Usage: LoadingOverlay.show('Logging in...'); ... LoadingOverlay.hide();
(function(){
  let longWaitTimeout = null;
  let longWaitInterval = null;
  let startMs = 0;

  function tOr(key, fallback) {
    const t = window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t : null;
    return t ? t(key) : fallback;
  }

  function formatWakingText(seconds) {
    const template = tOr('server_waking_up', 'Server is waking up ... ({sec} sec)');
    return template.replace('{sec}', String(seconds));
  }

  function ensureOverlay(message){
    if (document.getElementById('loginOverlay')) {
      const txt = document.querySelector('#loginOverlay .loading-text');
      if (txt) txt.textContent = message || 'Loading...';
      return document.getElementById('loginOverlay');
    }
    const overlay = document.createElement('div');
    overlay.id = 'loginOverlay';
    overlay.className = 'loading-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="loading-box" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <div class="loading-text"></div>
      </div>
      <div class="overlay-long-wait" id="overlayLongWait" aria-live="polite" role="status" style="display:none"></div>
    `;
    document.body.appendChild(overlay);
    const txt = overlay.querySelector('.loading-text');
    if (txt) txt.textContent = message || 'Loading...';
    return overlay;
  }

  function show(message){
    const overlay = ensureOverlay(message);
    document.body.setAttribute('aria-busy', 'true');
    startMs = Date.now();
    // Clear any previous timers just in case
    clearTimers();
    const longWaitEl = overlay.querySelector('#overlayLongWait');
    // After 10s, show long-wait message and start 1s counter
    longWaitTimeout = setTimeout(() => {
      if (longWaitEl) {
        longWaitEl.style.display = 'block';
        longWaitEl.textContent = formatWakingText(0);
      }
      longWaitInterval = setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000) - 10);
        if (longWaitEl) longWaitEl.textContent = formatWakingText(elapsed);
      }, 1000);
    }, 10000);
  }

  function hide(){
    clearTimers();
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.remove();
    document.body.removeAttribute('aria-busy');
  }

  function clearTimers(){
    if (longWaitTimeout) { clearTimeout(longWaitTimeout); longWaitTimeout = null; }
    if (longWaitInterval) { clearInterval(longWaitInterval); longWaitInterval = null; }
  }

  window.LoadingOverlay = { show, hide };
})();

// Language switcher + translations
(function(){
  const LANGUAGE_KEY = 'language';
  const DEFAULT_LANG = 'en';
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
      enter_email_or_faculty: 'Enter your email or faculty number',
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
      enter_email_or_faculty: 'Въведете имейл или факултетен номер',
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

  function applyTranslations() {
    const lang = getLanguage();
    document.documentElement.lang = lang;
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
        { selector: '#classAddStudentsOverlayBtn', key: 'add' },
        { selector: '#readyClassTitle', key: 'class_ready' },
        { selector: '#manageStudentsBtn', key: 'manage_students' },
        { selector: '#startScannerBtn', key: 'start_scanner' },
        { selector: '#downloadAttendanceTableBtn', key: 'download_attendance_table' },
        { selector: '#classOptionsBtn', key: 'options' },
        { selector: '#scannerTitle', key: 'start_scanning' },
        { selector: '#scannerStopBtn', key: 'show_attendance' },
        { selector: '#scannerCloseBtn', key: 'finish_class' },
        { selector: '#attendanceTitle', key: 'attendance' },
        { selector: '#classesTitle', key: 'classes' },
        { selector: '#openSupportChatBtn', key: 'support_chat_open', html: true },
        { selector: '#openSupportChatBtn', key: 'support_chat_open_aria', attr: 'aria-label' },
        { selector: '#supportChatTitle', key: 'support_chat_title' },
        { selector: '#supportChatLanguageBtn', key: 'language_change_title' },
        { selector: '#closeSupportChatBtn', key: 'close', attr: 'aria-label' },
        { selector: '#chatInput', key: 'support_chat_placeholder', attr: 'placeholder' },
        { selector: '#sendChatBtn', key: 'support_chat_send' },
        { selector: '#chatHistoryContainer .chat-message.model:first-child', key: 'support_chat_welcome' },
        { selector: '#addClassBtn', key: 'new_class' },
        { selector: '#createClassSearchInput', key: 'search_students_placeholder', attr: 'placeholder' },
        { selector: '#addStudentsSearchInput', key: 'search_placeholder', attr: 'placeholder' },
        { selector: '#overlaySearchInput', key: 'search_placeholder', attr: 'placeholder' },
        { selector: '#scannerDiscardBtn', key: 'discard' }
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

    (pages[page] || []).forEach(applyEntry);

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
        window.location.href = 'billing.html';
      });
    }

    function hasTeacherSession() {
      try { return !!sessionStorage.getItem('teacherData'); } catch (_) { return false; }
    }
    const isBillingPage = window.location.pathname.toLowerCase().includes('billing.html');
    btn.style.display = (hasTeacherSession() && !isBillingPage) ? 'flex' : 'none';
  }

  function init() {
    refreshNavbarLogoButton();
    ensureLanguageUI();
    ensureLanguageCornerDisplay();
    ensureFloatingBillingButton();
    applyTranslations();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.i18n = { t, setLanguage, getLanguage, applyTranslations, openLanguageMenu };
  window.clearSessionData = clearSessionData;
})();
