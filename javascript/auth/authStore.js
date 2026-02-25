const AUTH_TOKEN_KEY = 'auth.teacher.token';
const AUTH_EXPIRES_AT_KEY = 'auth.teacher.expiresAt';

const LEGACY_TOKEN_KEYS = ['authToken', 'token', 'accessToken', 'jwt'];

function safeParseNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

export function saveAuthState({ token, expiresAt, teacher } = {}) {
    if (!token) throw new Error('Cannot save auth state without token');
    const normalizedToken = String(token).trim();
    if (!normalizedToken) throw new Error('Cannot save auth state without token');

    try {
        sessionStorage.setItem(AUTH_TOKEN_KEY, normalizedToken);
        sessionStorage.setItem(AUTH_EXPIRES_AT_KEY, String(safeParseNumber(expiresAt)));
        LEGACY_TOKEN_KEYS.forEach((legacyKey) => sessionStorage.removeItem(legacyKey));
        LEGACY_TOKEN_KEYS.forEach((legacyKey) => localStorage.removeItem(legacyKey));
        if (teacher && typeof teacher === 'object') {
            sessionStorage.setItem('teacherData', JSON.stringify(teacher));
            const email = String(teacher.email || '').trim().toLowerCase();
            if (email) localStorage.setItem('teacherEmail', email);
        }
    } catch (_) {}
}

export function getAuthToken() {
    try {
        const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
        return token ? String(token).trim() : '';
    } catch (_) {
        return '';
    }
}

export function getAuthExpiresAt() {
    try {
        return safeParseNumber(sessionStorage.getItem(AUTH_EXPIRES_AT_KEY));
    } catch (_) {
        return 0;
    }
}

export function isAuthExpired() {
    const expiresAt = getAuthExpiresAt();
    if (!expiresAt) return false;
    return Date.now() >= expiresAt;
}

export function clearAuthState() {
    try {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_EXPIRES_AT_KEY);
        LEGACY_TOKEN_KEYS.forEach((legacyKey) => sessionStorage.removeItem(legacyKey));
        LEGACY_TOKEN_KEYS.forEach((legacyKey) => localStorage.removeItem(legacyKey));
        sessionStorage.removeItem('teacherData');
        localStorage.removeItem('teacherEmail');
    } catch (_) {}
}

export function bootstrapTeacherAuthState() {
    const token = getAuthToken();
    if (!token) {
        clearAuthState();
        return false;
    }
    if (isAuthExpired()) {
        clearAuthState();
        return false;
    }
    return true;
}

export function hasAuthHeaderToken() {
    return Boolean(getAuthToken());
}

