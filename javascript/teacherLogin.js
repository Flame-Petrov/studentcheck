// Loading overlay now handled by shared LoadingOverlay utility

document.getElementById('teacherLoginForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    function t(key, fallback) {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                return window.i18n.t(key);
            }
        } catch (_) {}
        return fallback || key;
    }

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const errorMessage = document.getElementById('error-message');

    const normalizedEmail = (email || '').trim().toLowerCase();
    const teacherData = { email: normalizedEmail, password };

    if (!email || !password) {
        if (errorMessage) {
            errorMessage.textContent = t('err_login_required', 'Email and Password are required.');
            // Ensure inline styles don't keep it hidden
            errorMessage.style.removeProperty('display');
            errorMessage.classList.remove('show');
            // force reflow to restart animation if same message repeats
            void errorMessage.offsetWidth;
            errorMessage.classList.add('show');
        }
        return;
    }

    const form = document.getElementById('teacherLoginForm');
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const t0 = performance.now();
    const loginMessage = window.i18n && typeof window.i18n.t === 'function'
        ? window.i18n.t('logging_in')
        : 'Logging in...';
    LoadingOverlay.show(loginMessage);
    try {
        const response = await fetch("https://studentcheck-server.onrender.com/teacherLogin", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(teacherData)
        });
        const t1 = performance.now();
            if (response.ok) {
            const data = await response.json();
            if (data.loginSuccess) {
                try {
                    // Store minimal teacher session data in sessionStorage only (normalized email).
                    sessionStorage.setItem('teacherData', JSON.stringify({ email: teacherData.email }));
                    if (data.token) {
                        sessionStorage.setItem('authToken', data.token);
                    }
                    // Also remember last teacher email for reload fallbacks
                    try { localStorage.setItem('teacherEmail', teacherData.email); } catch(_) {}
                } catch (e) {
                    console.warn('Failed to persist teacher session data in sessionStorage:', e);
                }
                if (errorMessage) {
                    errorMessage.textContent = '';
                    errorMessage.classList.remove('show');
                    errorMessage.style.removeProperty('display');
                }
                
                // Ensure any loading overlay is stopped before navigating
                LoadingOverlay.hide();
                window.location.href = 'teacherHomepage.html';
            } else {
                LoadingOverlay.hide();
                if (errorMessage) {
                errorMessage.textContent = t('err_login_failed', 'Login failed');
                if (data.message) {
                    errorMessage.textContent = `${t('err_login_failed', 'Login failed')}: ${data.message}`;
                } else if (!data.loginSuccess) {
                    errorMessage.textContent = t('err_invalid_credentials', 'Invalid credentials');
                }
                    errorMessage.style.removeProperty('display');
                    errorMessage.classList.remove('show');
                    void errorMessage.offsetWidth;
                    errorMessage.classList.add('show');
                }
                // Do not show loading overlay for wrong credentials
            }
        } else {
            LoadingOverlay.hide();
            if (errorMessage) {
            errorMessage.textContent = t('err_invalid_credentials', 'Invalid credentials');
                errorMessage.style.removeProperty('display');
                errorMessage.classList.remove('show');
                void errorMessage.offsetWidth;
                errorMessage.classList.add('show');
            }
            // Do not show loading overlay for wrong credentials
        }
    } catch (err) {
        LoadingOverlay.hide();
        console.error('Login request failed:', err);
        if (errorMessage) {
        errorMessage.textContent = t('err_login_network', 'Login failed: Network error or unavailable server.');
            errorMessage.style.removeProperty('display');
            errorMessage.classList.remove('show');
            void errorMessage.offsetWidth;
            errorMessage.classList.add('show');
        }
        // Do not show loading overlay for errors
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
});

// Password reveal/hide toggle (supports multiple fields)
document.querySelectorAll('.password-wrapper').forEach(wrapper => {
    const input = wrapper.querySelector('input[type="password"], input[type="text"]');
    const btn = wrapper.querySelector('.toggle-password');
    if (!input || !btn) return;
    const img = btn.querySelector('img');
    const setState = (show) => {
        // show=true -> reveal text
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        if (img) {
            img.src = show ? 'icons/hide.svg' : 'icons/show.svg';
            img.alt = show ? 'Hide password' : 'Show password';
        }
    };
    btn.addEventListener('click', () => {
        const willShow = input.type === 'password';
        setState(willShow);
    });
});
