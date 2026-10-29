import { SERVER_BASE_URL, ENDPOINTS } from './config/api.js';

const AUTH_TOKEN_KEY = 'auth.teacher.token';
const AUTH_EXPIRES_AT_KEY = 'auth.teacher.expiresAt';

function normalizeToken(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(/^Bearer\s+/i, '').trim();
}

function t(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
        }
    } catch (_) {}
    return fallback || key;
}

document.getElementById('unifiedLoginForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();

    const identifierInput = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    if (!identifierInput || !password) {
        showError(t('err_login_required', 'Email/Faculty Number and Password are required.'));
        return;
    }

    // Autodetect based on exact 9 digits
    const isStudent = /^\d{9}$/.test(identifierInput);
    const submitBtn = document.getElementById('loginSubmitBtn');
    submitBtn.disabled = true;

    const loginMessage = t('logging_in', 'Logging in...');
    if (window.LoadingOverlay) window.LoadingOverlay.show(loginMessage);

    try {
        if (isStudent) {
            await handleStudentLogin(identifierInput, password, errorMessage);
        } else {
            await handleTeacherLogin(identifierInput, password, errorMessage);
        }
    } catch (err) {
        console.error('Login request failed:', err);
        showError(t('err_login_network', 'Login failed: Network error or unavailable server.'));
        if (window.LoadingOverlay) window.LoadingOverlay.hide();
    } finally {
        submitBtn.disabled = false;
    }
});

function showError(msg) {
    const errorMessage = document.getElementById('error-message');
    if (!errorMessage) return;
    errorMessage.textContent = msg;
    errorMessage.style.removeProperty('display');
    errorMessage.classList.remove('show');
    void errorMessage.offsetWidth; // Force reflow
    errorMessage.classList.add('show');
}

async function handleStudentLogin(facultyNumber, password, errorMessage) {
    const response = await fetch(SERVER_BASE_URL + ENDPOINTS.studentLogin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyNumber, password })
    });

    if (response.ok) {
        const data = await response.json();
        if (data.loginSuccess) {
            try {
                sessionStorage.removeItem('teacherData');
                localStorage.removeItem('teacherEmail');
                sessionStorage.setItem('studentData', JSON.stringify({ data }));
                // Student token: lets the student page read only this student's attendance
                if (data.token) {
                    sessionStorage.setItem('auth.student.token', String(data.token));
                    sessionStorage.setItem('auth.student.expiresAt', String(Date.now() + Number(data.expiresIn || 0) * 1000));
                }
            } catch (e) {}
            if (window.LoadingOverlay) window.LoadingOverlay.hide();
            window.location.href = 'studentHomepage.html';
        } else {
            showError(t('err_invalid_credentials', 'Invalid credentials'));
            if (window.LoadingOverlay) window.LoadingOverlay.hide();
        }
    } else {
        showError(t('err_invalid_credentials', 'Invalid credentials'));
        if (window.LoadingOverlay) window.LoadingOverlay.hide();
    }
}

async function handleTeacherLogin(email, password, errorMessage) {
    const normalizedEmail = email.toLowerCase();
    const response = await fetch(SERVER_BASE_URL + ENDPOINTS.teacherLogin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password })
    });

    if (response.ok) {
        const data = await response.json();
        const token = normalizeToken(data?.token || data?.accessToken || data?.data?.token || data?.data?.accessToken || '');
        
        if (data.loginSuccess && token) {
            try {
                const now = Date.now();
                const expiresAt = now + (Number(data.expiresIn || 0) * 1000);
                sessionStorage.setItem('teacherData', JSON.stringify({ email: normalizedEmail }));
                sessionStorage.setItem(AUTH_TOKEN_KEY, token);
                sessionStorage.setItem(AUTH_EXPIRES_AT_KEY, String(expiresAt));
                
                ['authToken', 'token', 'accessToken', 'jwt'].forEach((k) => {
                    sessionStorage.removeItem(k);
                    localStorage.removeItem(k);
                });
                try { localStorage.setItem('teacherEmail', normalizedEmail); } catch(_) {}
            } catch (e) {}
            
            if (window.LoadingOverlay) window.LoadingOverlay.hide();
            window.location.href = 'teacherHomepage.html';
        } else {
            const msg = data.message ? `${t('err_login_failed', 'Login failed')}: ${data.message}` : t('err_invalid_credentials', 'Invalid credentials');
            showError(msg);
            if (window.LoadingOverlay) window.LoadingOverlay.hide();
        }
    } else {
        showError(t('err_invalid_credentials', 'Invalid credentials'));
        if (window.LoadingOverlay) window.LoadingOverlay.hide();
    }
}

// Password reveal/hide toggle
document.querySelectorAll('.password-wrapper').forEach(wrapper => {
    const input = wrapper.querySelector('input[type="password"], input[type="text"]');
    const btn = wrapper.querySelector('.toggle-password');
    if (!input || !btn) return;
    const img = btn.querySelector('img');
    const setState = (show) => {
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        if (img) {
            img.src = show ? 'icons/hide.svg' : 'icons/show.svg';
            img.alt = show ? 'Hide password' : 'Show password';
        }
    };
    btn.addEventListener('animationend', () => {
        btn.classList.remove('is-clicking');
    });
    btn.addEventListener('click', () => {
        btn.classList.remove('is-clicking');
        void btn.offsetWidth;
        btn.classList.add('is-clicking');
        setState(input.type === 'password');
    });
});
