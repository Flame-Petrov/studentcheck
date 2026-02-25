// Sliding multi-step registration controller
(function(){
    



    // Debug toggle: set to false to silence internal diagnostic messages.
    const DEBUG = true;
    const track = document.getElementById('slidesTrack');
    const progressBar = document.getElementById('progressBar');

    let backBtn = null;
    const nextBtn = document.getElementById('nextBtn');
    const finishBtn = document.getElementById('finishBtn');
    const actions = document.querySelector('.actions'); // container for navigation buttons

    const firstName = document.getElementById('firstName');
    const middleName = document.getElementById('middleName');
    const lastName = document.getElementById('lastName');

    const email = document.getElementById('email');
    const facultyNumber = document.getElementById('facultyNumber');




    const selectFaculty = document.getElementById('faculty');
    selectFaculty.addEventListener('change', () => {

        errorSlide2_faculty.textContent = "";
        clearError(errorSlide2_specialization);
        setInvalid(selectFaculty, false);
        setInvalid(selectSpecialization, false);

        const faculty = selectFaculty.value;
        const level = selectLevel.value;
        if (!level) {
            resetSpecializations();
            return;
        }

        const hasSpecializations = populateSpecializations(faculty, level);
        if (!hasSpecializations) {
            alert(t('err_specializations_unavailable'));
        }
    });

    const selectLevel = document.getElementById('level');
    selectLevel.addEventListener('change', () => {

        errorSlide2_level.textContent = "";
        clearError(errorSlide2_specialization);
        setInvalid(selectLevel, false);
        setInvalid(selectSpecialization, false);

        const faculty = selectFaculty.value;
        const level = selectLevel.value;

        if(!faculty || !level) {
            resetSpecializations();
            return;
        }

        const hasSpecializations = populateSpecializations(faculty, level);
        if (!hasSpecializations) {
            alert(t('err_specializations_unavailable'));
        }

    });




    function t(key, fallback) {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                return window.i18n.t(key);
            }
        } catch (_) {}
        return fallback || key;
    }

    const selectSpecialization = document.getElementById('specialization');
    selectSpecialization.addEventListener('change', () => {

        errorSlide2_specialization.textContent = "";

    });

    const SPECIALIZATIONS = {
        automation: {
            bachelor: [
                "Automation, information and control technology",
                "Automation, information and control technology - part-time study",
                "Intelligent systems in industry, city and home",
                "Intelligent systems in industry, city and home (in English)"
            ],
            master: [
                "Automation, information and control technology",
                "Embedded control systems",
                "Building automation"
            ],
            phd: [
                "Automation of engineering work and automated design systems",
                "Automation of areas of the intangible sphere",
                "Automation of production",
                "Automated systems for information processing and control",
                "Bioautomation",
                "Electric drive",
                "Electrical measuring equipment",
                "Elements and devices of automation and computing",
                "Information and measuring systems",
                "Methods, converters and devices for measuring and controlling physical, mechanical and geometric quantities",
                "Metrology and metrological assurance",
                "Application of the principles and methods of cybernetics in various fields of science",
                "Robots and manipulators",
                "Artificial Intelligence Systems",
                "Theoretical Electrical Engineering",
                "Theory of Automatic Control",
                "Control Computing Machines and Systems",
                "Devices and Systems for Analytical Measurements and for Environmental Control (incl. Environmental)"
            ]
        },

        // add all faculty specializations later

        economics: {
            bachelor: [
                "Business Management 1",
                "Business Management 2",
                "Industrial Management",
                "Industrial Management in English",
                "Management and Business Information Systems"
            ],
            master: [
                "Business Management",
                "Business Management in English",
                "Senior Management",
                "Industrial Management",
                "Industrial Management in English",
                "Intellectual Property and Innovation",
                "Electricity Management"
            ]
        }
    }

    const selectGroup = document.getElementById('group');
    const selectCourse = document.getElementById('course');








    const password = document.getElementById('password');
    const repeatPassword = document.getElementById('repeatPassword');

    const errorSlide1 = document.getElementById('errorSlide1');

    const errorSlide2_faculty = document.getElementById('errorSlide2_faculty');
    const errorSlide2_level = document.getElementById('errorSlide2_level');
    const errorSlide2_specialization = document.getElementById('errorSlide2_specialization');
    const errorSlide3_group = document.getElementById('errorSlide3_group');
    const errorSlide3_course = document.getElementById('errorSlide3_course');

    const errorSlide4 = document.getElementById('errorSlide4');
    // Removed dedicated errorSlide3 element; requirements list now provides all feedback.

    // Loading overlay handled by shared LoadingOverlay utility

    const slides = Array.from(track.querySelectorAll('.slide'));
    const TOTAL_STEPS = slides.length; // derive dynamically
    let step = 0;




    // Initialize active slide visibility (show only first)
    slides.forEach((sl,i)=> sl.classList.toggle('active', i===0));



    function resetSpecializations() {

        selectSpecialization.innerHTML = "";
        selectSpecialization.appendChild(new Option("", "", true, true));
        selectSpecialization.firstChild.disabled = true;
        selectSpecialization.disabled = true;

    }

    function resetFaculty() {
        selectFaculty.selectedIndex = 0;
        resetSpecializations();
    }

    function resetLevel() {
        selectLevel.selectedIndex = 0;
        resetSpecializations();
    }

    function populateSpecializations(faculty, level) {

        resetSpecializations();

        if(faculty === "" || level === "") {
            console.error("Faculty or level is empty:", faculty, level);
            return false;
        }


        const facultySpecializations = SPECIALIZATIONS[faculty];
        if (!facultySpecializations) {
            console.error("No faculty specializations found for faculty:", faculty);
            return false;
        }

        const list = facultySpecializations[level];

        if (!Array.isArray(list) || list.length === 0) {
            console.error("No specializations found for faculty and level:", faculty, level);
            return false;
        }

        for(const specialization of list){
            selectSpecialization.appendChild(new Option(specialization, specialization));
        }

        selectSpecialization.disabled = list.length === 0;
        if (window.i18n && typeof window.i18n.applyTranslations === 'function') {
            window.i18n.applyTranslations();
        }
        return true;

    }

    function ensureBackButton() {
        if (backBtn && backBtn.isConnected) return backBtn;
        if (!actions) return null;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'backBtn';
        btn.className = 'btn btn-secondary';
        btn.textContent = 'Back';
        btn.addEventListener('click', back);

        actions.prepend(btn);
        backBtn = btn;
        return backBtn;
    }


    function updateUI() {
    // Activate current slide; hide others
    slides.forEach((sl,i)=> sl.classList.toggle('active', i===step));
        const progress = ((step + 1) / TOTAL_STEPS) * 100;
        progressBar.style.width = progress + '%';

        // Create Back button only when needed (steps > 0) to avoid first-paint flicker.
        if (step === 0) {
            if (backBtn && backBtn.parentElement) {
                backBtn.parentElement.removeChild(backBtn);
            }
            backBtn = null;
        } else {
            const dynamicBackBtn = ensureBackButton();
            if (dynamicBackBtn) {
                dynamicBackBtn.disabled = false;
                dynamicBackBtn.textContent = 'Back';
            }
        }
        if (step < TOTAL_STEPS - 1) {
            nextBtn.style.display = 'inline-block';
            finishBtn.classList.add('finish-hidden');
        } else {
            nextBtn.style.display = 'none';
            finishBtn.classList.remove('finish-hidden');
        }
        // On first slide align the lone Continue button to the right
        if (actions) {
            if (step === 0) actions.classList.add('single-right');
            else actions.classList.remove('single-right');
        }
    // Removed automatic contact live validation so slide 2 errors only appear after user clicks Continue.
    }





    // Slide 1: Names (middle name now required)
    function validateSlide1() {
        const a = firstName.value.trim();
        const b = middleName.value.trim();
        const c = lastName.value.trim();
        setInvalid(firstName, !a);
        setInvalid(middleName, !b);
        setInvalid(lastName, !c);
        if (!a || !b || !c) {
            setError(errorSlide1, 'err_fill_all_fields');
            return false;
        }
        clearError(errorSlide1);
        return true;
    }





    function validateEmailFormat(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

    function setInvalid(el, isInvalid) {
        if (!el) return;
        el.classList.toggle('invalid', !!isInvalid);
    }

    function setError(el, key) {
        if (!el) return;
        el.textContent = t(key);
        el.setAttribute('data-i18n-error-key', key);
    }

    function clearError(el) {
        if (!el) return;
        el.textContent = '';
        el.removeAttribute('data-i18n-error-key');
    }



    function validateSlide2(){
        const facultyInvalid = (selectFaculty.value === "" || selectFaculty.selectedIndex === 0);
        setInvalid(selectFaculty, facultyInvalid);
        if(facultyInvalid){
            setError(errorSlide2_faculty, 'err_select_faculty');
            return false;
        }

        clearError(errorSlide2_faculty);

        const levelInvalid = (selectLevel.value === "" || selectLevel.selectedIndex === 0);
        setInvalid(selectLevel, levelInvalid);
        if(levelInvalid){
            setError(errorSlide2_level, 'err_select_level');
            return false;
        }

        clearError(errorSlide2_level);

        const specializationInvalid = (selectSpecialization.value === "" || selectSpecialization.selectedIndex === 0);
        setInvalid(selectSpecialization, specializationInvalid);
        if(specializationInvalid){
            setError(errorSlide2_specialization, 'err_select_specialization');
            return false;
        }

        clearError(errorSlide2_specialization);

        return true;
        
    }

    function validateSlide3() {
        const groupInvalid = (selectGroup.value === "" || selectGroup.selectedIndex === 0);
        setInvalid(selectGroup, groupInvalid);
        if (groupInvalid) {
            setError(errorSlide3_group, 'err_select_group');
            return false;
        }
        const groupNum = Number(selectGroup.value);
        const groupOutOfRange = (!Number.isFinite(groupNum) || groupNum < 37 || groupNum > 42);
        if (groupOutOfRange) {
            setError(errorSlide3_group, 'err_group_invalid');
            setInvalid(selectGroup, true);
            return false;
        }
        clearError(errorSlide3_group);

        const courseInvalid = (selectCourse.value === "" || selectCourse.selectedIndex === 0);
        setInvalid(selectCourse, courseInvalid);
        if (courseInvalid) {
            setError(errorSlide3_course, 'err_select_course');
            return false;
        }
        clearError(errorSlide3_course);

        return true;
    }



    // Slide 4 (index 3): Contact (email + faculty number)
    let contactErrorActivated = false; // becomes true after first failed Continue (or duplicate email server error)
    function validateSlide4() {
        const state = getContactFieldState();
        const { valid, message, normalized, key } = getContactState();
        setInvalid(email, state.emailInvalid);
        setInvalid(facultyNumber, state.facultyInvalid);
        if (!valid) {
            contactErrorActivated = true; // user attempted to proceed
            if (key) {
                setError(errorSlide4, key);
            } else {
                errorSlide4.textContent = message;
            }
            errorSlide4.style.display = 'block';
            return false;
        }
        facultyNumber.value = normalized; // commit normalized value
        if (contactErrorActivated) {
            clearError(errorSlide4);
            errorSlide4.style.display = 'none';
        }
        return true;
    }






    // Unified validation state builder for Contact slide (email, faculty number, and group selection).
    function getContactState() {
        const e = email.value.trim();
        const fRaw = facultyNumber.value.trim();
        // Clean: remove leading/trailing whitespace and collapse internal spaces -> remove entirely
        const f = fRaw.replace(/\s+/g,'');
        const debug = { emailOriginal: email.value, emailTrimmed: e, facultyOriginal: facultyNumber.value, facultyStripped: f };
        if (!e) return { valid:false, message:t('err_email_required'), normalized:f, debug, key: 'err_email_required' };
        if (!validateEmailFormat(e)) return { valid:false, message:t('err_email_invalid'), normalized:f, debug, key: 'err_email_invalid' };
        if (!f) return { valid:false, message:t('err_faculty_required'), normalized:f, debug, key: 'err_faculty_required' };
        if (f.length !== 9) return { valid:false, message:t('err_faculty_length'), normalized:f, debug, key: 'err_faculty_length' };
        // Minimal rule: must contain at least one alphanumeric; allow any printable except spaces.
        if (!/[A-Za-z0-9]/.test(f)) return { valid:false, message:t('err_faculty_letter_digit'), normalized:f, debug, key: 'err_faculty_letter_digit' };
        if (f.length > 50) return { valid:false, message:t('err_faculty_too_long'), normalized:f, debug, key: 'err_faculty_too_long' };
        // If it contains disallowed characters, attempt auto-sanitization (keep letters/digits and - _ . /)
        const sanitized = f.replace(/[^A-Za-z0-9\-_.\/]/g,'');
        if (sanitized.length === 0) return { valid:false, message:t('err_faculty_invalid_chars'), normalized:f, debug, key: 'err_faculty_invalid_chars' };
        debug.sanitized = sanitized;
        return { valid:true, message:'', normalized:sanitized.toUpperCase(), debug, key: '' };
    }

    function getContactFieldState() {
        const e = email.value.trim();
        const fRaw = facultyNumber.value.trim();
        const f = fRaw.replace(/\s+/g,'');
        const sanitized = f.replace(/[^A-Za-z0-9\-_.\/]/g,'');
        const emailInvalid = !e || !validateEmailFormat(e);
        const facultyInvalid = (!f || f.length !== 9 || !/[A-Za-z0-9]/.test(f) || sanitized.length === 0);
        return { emailInvalid, facultyInvalid };
    }

    async function checkEmailAvailability() {
        const emailValue = (email.value || '').trim();
        if (!emailValue) return false;

        nextBtn.disabled = true;
        try {
            // Preferred secure/performant contract: backend existence probe endpoint.
            // If endpoint is missing, defer duplicate detection to final registration response.
            const response = await fetch('https://studentcheck-server.onrender.com/students/check-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ email: emailValue.toLowerCase() })
            });

            if (response.status === 404 || response.status === 405) {
                return true;
            }

            if (!response.ok) {
                setError(errorSlide4, 'err_email_verify');
                errorSlide4.style.display = 'block';
                contactErrorActivated = true;
                return false;
            }

            const data = await response.json();
            const exists = Boolean(data?.exists ?? data?.taken ?? data?.duplicate);
            if (exists) {
                lastDuplicateEmail = emailValue;
                email.classList.add('invalid');
                contactErrorActivated = true;
                setError(errorSlide4, 'err_email_exists');
                errorSlide4.style.display = 'block';
                return false;
            }

            return true;
        } catch (_) {
            // Network/API probe failure: allow continue and rely on server-side validation on submit.
            return true;
        } finally {
            nextBtn.disabled = false;
        }
    }

    async function checkFacultyNumberAvailability() {
        const facultyValue = (facultyNumber.value || '').trim().replace(/\s+/g,'');
        if (!facultyValue) return false;

        nextBtn.disabled = true;
        try {
            // Preferred secure/performant contract: backend existence probe endpoint.
            const response = await fetch('https://studentcheck-server.onrender.com/students/check-faculty-number', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ facultyNumber: facultyValue.toUpperCase() })
            });

            if (response.status === 404 || response.status === 405) {
                return true;
            }

            if (!response.ok) {
                setError(errorSlide4, 'err_faculty_verify');
                errorSlide4.style.display = 'block';
                contactErrorActivated = true;
                return false;
            }

            const data = await response.json();
            const exists = Boolean(data?.exists ?? data?.taken ?? data?.duplicate);
            if (exists) {
                lastDuplicateFaculty = facultyValue;
                facultyNumber.classList.add('invalid');
                contactErrorActivated = true;
                setError(errorSlide4, 'err_faculty_exists');
                errorSlide4.style.display = 'block';
                return false;
            }

            return true;
        } catch (_) {
            return true;
        } finally {
            nextBtn.disabled = false;
        }
    }





    let lastDuplicateEmail = null; // tracks last server-rejected email to clear red state on change
    let lastDuplicateFaculty = null; // tracks last server-rejected faculty number to clear red state on change
    function liveContactValidation() {
        // Only perform live updates if user has already triggered error display OR duplicate email state is active.
        if (step !== 3) return;
        const currentEmail = email.value.trim();
        if (lastDuplicateEmail) {
            if (currentEmail === lastDuplicateEmail) {
                errorSlide4.style.display = 'block';
                return;
            } else {
                email.classList.remove('invalid');
                lastDuplicateEmail = null;
                contactErrorActivated = true; // allow live validation after duplicate cleared
            }
        }
        const currentFaculty = facultyNumber.value.trim().replace(/\s+/g,'');
        if (lastDuplicateFaculty) {
            if (currentFaculty === lastDuplicateFaculty) {
                errorSlide4.style.display = 'block';
                return;
            } else {
                facultyNumber.classList.remove('invalid');
                lastDuplicateFaculty = null;
                contactErrorActivated = true; // allow live validation after duplicate cleared
            }
        }
        if (!contactErrorActivated) return; // user hasn't clicked Continue yet; stay silent
        const { valid, message, key } = getContactState();
        const state = getContactFieldState();
        setInvalid(email, state.emailInvalid);
        setInvalid(facultyNumber, state.facultyInvalid);
        if (valid) {
            clearError(errorSlide4);
            errorSlide4.style.display = 'none';
        } else {
            if (key) {
                setError(errorSlide4, key);
            } else {
                errorSlide4.textContent = message;
            }
            errorSlide4.style.display = 'block';
        }
    }





    // Slide 3 (index 2): Passwords
    function validatePassword() {
        const p1 = password.value;
        const p2 = repeatPassword.value;
        if (!p1 || !p2) return false;
        const lengthOk = p1.length >= 8;
        const letterOk = /[A-Za-z]/.test(p1);
        const numberOk = /\d/.test(p1);
        const matchOk = p1 === p2;
        setInvalid(password, !(lengthOk && letterOk && numberOk));
        setInvalid(repeatPassword, !matchOk);
        return lengthOk && letterOk && numberOk && matchOk;
    }




    // Live password validation so mismatch appears immediately without waiting for Finish
    function livePasswordFeedback() {
        const p1 = password.value;
        const p2 = repeatPassword.value;
        const lengthOk = p1.length >= 8;
        const letterOk = /[A-Za-z]/.test(p1);
        const numberOk = /\d/.test(p1);
        const matchOk = p1 && p2 && p1 === p2;
        const reqLength = document.getElementById('reqLength');
        const reqLetter = document.getElementById('reqLetter');
        const reqNumber = document.getElementById('reqNumber');
        const reqMatch = document.getElementById('reqMatch');
        const setState = (el, ok) => { if (el){ el.classList.toggle('met', ok); el.classList.toggle('unmet', !ok);} };
        setState(reqLength, lengthOk);
        setState(reqLetter, letterOk);
        setState(reqNumber, numberOk);
        setState(reqMatch, matchOk);
    }





    async function next() {
        if (step === 0 && !validateSlide1()) { 
            return; 
        }

        if(step === 1 && !validateSlide2()) {
            return; 
        }

        if (step === 2) {
            if (!validateSlide3()) {
                return;
            }
        }

        if (step === 3) {
            if (!validateSlide4()) {
                return;
            }
            const available = await checkEmailAvailability();
            if (!available) {
                return;
            }
            const facultyAvailable = await checkFacultyNumberAvailability();
            if (!facultyAvailable) {
                return;
            }
            email.classList.remove('invalid');
            facultyNumber.classList.remove('invalid');
        }

        if (step < TOTAL_STEPS - 1) {
            step++;
            updateUI();
            focusFirstInput();
        } else {
        }
    }




    function back() {
        if (step > 0) {
            step--;
            updateUI();
            focusFirstInput();
        }
    }





    function focusFirstInput() {
        // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
    }





    let submitting = false;
    async function finish() {
        if (submitting) return; // guard against double click
        // Re-validate contact & password on final step
        if (!validatePassword()) { alert(t('err_password_requirements')); return; }

        const payload = {
            firstName: firstName.value.trim(),
            middleName: middleName.value.trim(),
            lastName: lastName.value.trim(),
            email: email.value.trim(),
            facultyNumber: facultyNumber.value.trim(),
            password: password.value,
            level: selectLevel.options[selectLevel.selectedIndex].text,
            faculty: selectFaculty.options[selectFaculty.selectedIndex].text,
            specialization: selectSpecialization.options[selectSpecialization.selectedIndex].text,
            group: selectGroup.options[selectGroup.selectedIndex].text,
            course: selectCourse.options[selectCourse.selectedIndex].text,
        };

        try {
            submitting = true;
            finishBtn.disabled = true;
            const originalText = finishBtn.textContent;
            finishBtn.textContent = 'Submitting...';
            LoadingOverlay.show('Submitting...');

            const resp = await fetch('https://studentcheck-server.onrender.com/registration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let data;
            if (!resp.ok) {
                // Try to parse JSON error payload for more detail (e.g. duplicate email)
                try { data = await resp.json(); } catch(_) { data = null; }
                const serverMsg = data && (data.message || data.error || data.detail) || (resp.status + ' ' + resp.statusText);
                if (/duplicate|exists|already/i.test(serverMsg) && /faculty/i.test(serverMsg)) {
                    lastDuplicateFaculty = facultyNumber.value.trim().replace(/\s+/g,'');
                    facultyNumber.classList.add('invalid');
                    contactErrorActivated = true;
                    setError(errorSlide4, 'err_faculty_exists');
                    errorSlide4.style.display = 'block';
                    step = 3;
                    updateUI();
                    return;
                }
                if (/duplicate|exists|already/i.test(serverMsg) && email) {
                    // Prepare duplicate state BEFORE updating UI so live validator preserves the message
                    lastDuplicateEmail = email.value.trim();
                    email.classList.add('invalid');
                    contactErrorActivated = true;
                    setError(errorSlide4, 'err_email_exists');
                    errorSlide4.style.display = 'block';
                    step = 3; // ensure email slide visible
                    updateUI();
                    // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
                    return;
                }
                alert(t('err_registration_failed_prefix') + serverMsg);
                return;
            } else {
                data = await resp.json();
            }
            if (data && (data.registrationSuccess || data.success)) {
                // Optionally store token if provided
                if (data.token) {
                    // Store token ONLY in sessionStorage so closing the tab ends implicit login.
                    try { sessionStorage.setItem('authToken', data.token); } catch (_) {}
                }

                // Persist a minimal student session so the homepage doesn't redirect to login.
                const responseStudent = data.student || data.user || data.data?.student || null;
                const fullNameFromPayload = [payload.firstName, payload.middleName, payload.lastName]
                    .filter(Boolean)
                    .join(' ')
                    .trim();
                const sessionStudent = {
                    full_name: responseStudent?.full_name || responseStudent?.fullName || fullNameFromPayload,
                    faculty_number: responseStudent?.faculty_number || responseStudent?.facultyNumber || payload.facultyNumber,
                    firstName: responseStudent?.firstName || payload.firstName,
                    middleName: responseStudent?.middleName || payload.middleName,
                    lastName: responseStudent?.lastName || payload.lastName,
                    email: responseStudent?.email || payload.email,
                    group: responseStudent?.group || payload.group,
                    course: responseStudent?.course || payload.course,
                    faculty: responseStudent?.faculty || payload.faculty,
                    level: responseStudent?.level || payload.level,
                    specialization: responseStudent?.specialization || payload.specialization
                };
                try {
                    sessionStorage.removeItem('teacherData');
                    localStorage.removeItem('teacherEmail');
                    sessionStorage.setItem('studentData', JSON.stringify({
                        data: { student: sessionStudent, loginSuccess: true }
                    }));
                } catch (_) {}

                window.location.href = 'studentHomepage.html';
            } else {
                if (/duplicate|exists|already/i.test(data.message || '') && /faculty/i.test(data.message || '')) {
                    lastDuplicateFaculty = facultyNumber.value.trim().replace(/\s+/g,'');
                    facultyNumber.classList.add('invalid');
                    contactErrorActivated = true;
                    setError(errorSlide4, 'err_faculty_exists');
                    errorSlide4.style.display = 'block';
                    step = 3; updateUI();
                } else if (/duplicate|exists|already/i.test(data.message || '')) {
                    // Prepare duplicate state BEFORE updating UI so live validator preserves the message
                    lastDuplicateEmail = email.value.trim();
                    email.classList.add('invalid');
                    contactErrorActivated = true;
                    setError(errorSlide4, 'err_email_exists');
                    errorSlide4.style.display = 'block';
                    step = 3; updateUI();
                    // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
                } else {
                    alert(t('err_registration_failed_prefix') + (data.message || t('err_registration_failed_unknown')));
                }
            }
        } catch (e) {
            console.error('Registration request failed:', e);
            alert(t('err_network_unavailable'));
        } finally {
            submitting = false;
            finishBtn.disabled = false;
            finishBtn.textContent = 'Finish';
            LoadingOverlay.hide();
        }
    }





    nextBtn.addEventListener('click', next);
    finishBtn.addEventListener('click', finish);



    // Attach live validation listeners
    password.addEventListener('input', livePasswordFeedback);
    repeatPassword.addEventListener('input', livePasswordFeedback);
    email.addEventListener('input', () => { liveContactValidation(); });





    facultyNumber.addEventListener('input', () => { liveContactValidation(); });



    if (selectGroup) {
        selectGroup.addEventListener('change', () => {
            clearError(errorSlide3_group);
            setInvalid(selectGroup, false);
        });
    }
    if (selectCourse) {
        selectCourse.addEventListener('change', () => {
            clearError(errorSlide3_course);
            setInvalid(selectCourse, false);
        });
    }




    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (step < TOTAL_STEPS - 1) { e.preventDefault(); next(); }
            else { e.preventDefault(); finish(); }
        }
    });



    // Hide contact error initially until user attempts to Continue.
    if (errorSlide4) errorSlide4.style.display = 'none';
    resetSpecializations();
    updateUI();
    focusFirstInput();



    
    // Password reveal/hide: single toggle controls both password fields
    (function(){
        const pwInput = document.getElementById('password');
        const repeatInput = document.getElementById('repeatPassword');
        const pwBtn = document.querySelector('.password-wrapper .toggle-password');
        if (!pwInput || !repeatInput || !pwBtn) return;
        const img = pwBtn.querySelector('img');
        const setState = (show) => {
            pwInput.type = show ? 'text' : 'password';
            repeatInput.type = show ? 'text' : 'password';
            pwBtn.setAttribute('aria-pressed', String(show));
            pwBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            if (img) {
                img.src = show ? 'icons/hide.svg' : 'icons/show.svg';
                img.alt = show ? 'Hide password' : 'Show password';
            }
        };
        pwBtn.addEventListener('click', () => {
            const willShow = pwInput.type === 'password';
            setState(willShow);
        });
    })();




})();
