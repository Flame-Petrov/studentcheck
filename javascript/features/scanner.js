/**
 * Scanner Feature Module
 * 
 * Handles QR code scanner initialization and management.
 * Manages camera access and QR code scanning.
 */

import {
    getCurrentScanMode,
    setCurrentScanMode,
    getHtml5QrCode,
    setHtml5QrCode,
    getLastScanAt,
    setLastScanAt,
    getCurrentClass,
    clearStudentTimestamps,
    setStudentTimestamp,
    getStudentTimestamp
} from '../state/appState.js';
import { loadClassStudentsFromStorage, resolveStudentFacultyNumber } from '../storage/studentStorage.js';
import {
    initAttendanceStateForClass,
    handleScannedCode,
    saveScannerDraftForClass,
    restoreScannerDraftForClass
} from './attendance.js';
import { showOverlay, hideOverlay, getOverlay, openConfirmOverlay } from '../ui/overlays.js';

// Cache for html5-qrcode load promise
let html5qrcodeLoadPromise = null;
let scannerLifecycleCleanup = null;
let activeScannerClassName = '';

// One id per opening of the dialog: a camera start that finishes after the
// dialog was closed (or reopened for another class) is stopped at once and
// never touches the UI.
let scannerSessionId = 0;
// The previous camera start, so a new one only begins after it has settled
let lastCameraStart = Promise.resolve();
// Session whose camera start is in progress (no duplicate start per session)
let startingSession = null;
let feedbackTimer = null;

function t(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

// ---------- Camera viewport status (placeholder -> live preview) ----------

const CAMERA_STATUS = {
    loading: ['scanner_status_loading', 'Зареждане на скенера…'],
    permission: ['scanner_status_permission', 'Изчакване на разрешение за камерата…'],
    starting: ['scanner_status_starting', 'Стартиране на камерата…'],
    active: ['scanner_status_active', 'Камерата е активна'],
    error: ['scanner_status_error', 'Камерата не е налична'],
};

const CAMERA_ERRORS = {
    denied: ['scanner_err_denied_title', 'Нямате разрешение за камерата', 'scanner_err_denied_text', 'Разрешете достъпа до камерата от настройките на браузъра и опитайте отново.'],
    busy: ['scanner_err_busy_title', 'Камерата е заета', 'scanner_err_busy_text', 'Затворете други приложения или раздели, които използват камерата, и опитайте отново.'],
    unavailable: ['scanner_err_unavailable_title', 'Няма открита камера', 'scanner_err_unavailable_text', 'Свържете камера или отворете страницата на устройство с камера.'],
    library: ['scanner_err_library_title', 'Скенерът не се зареди', 'scanner_err_library_text', 'Проверете връзката с интернет и опитайте отново.'],
    failed: ['scanner_err_failed_title', 'Камерата не можа да стартира', 'scanner_err_failed_text', 'Опитайте отново. Ако проблемът продължи, презаредете страницата.'],
};

let cameraState = 'loading';
let cameraErrorKind = null;

function setCameraState(state, errorKind = null) {
    cameraState = state;
    cameraErrorKind = errorKind;
    const viewport = document.getElementById('cameraContainer');
    if (!viewport) return;
    viewport.dataset.state = state;
    const [key, fallback] = CAMERA_STATUS[state] || CAMERA_STATUS.loading;
    const statusText = document.getElementById('scannerStatusText');
    if (statusText) statusText.textContent = t(key, fallback);
    const errorBox = document.getElementById('scannerCameraError');
    if (errorBox) {
        errorBox.hidden = state !== 'error';
        if (state === 'error') {
            const [tk, tf, dk, df] = CAMERA_ERRORS[errorKind] || CAMERA_ERRORS.failed;
            document.getElementById('scannerCameraErrorTitle').textContent = t(tk, tf);
            document.getElementById('scannerCameraErrorText').textContent = t(dk, df);
        }
    }
}

/** Map a getUserMedia / html5-qrcode error to a reason we can explain. */
function classifyCameraError(error) {
    const text = `${error?.name || ''} ${error?.message || ''} ${typeof error === 'string' ? error : ''}`;
    if (/NotAllowed|PermissionDenied|Permission denied|SecurityError/i.test(text)) return 'denied';
    if (/NotReadable|TrackStart|AbortError|Could not start video source|in use/i.test(text)) return 'busy';
    if (/NotFound|DevicesNotFound|Overconstrained|no camera|Requested device not found|not supported|secure context/i.test(text)) return 'unavailable';
    return 'failed';
}

async function cameraPermissionState() {
    try {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return null;
        return await navigator.permissions.query({ name: 'camera' });
    } catch (_) {
        return null;
    }
}

/** Resolves once the preview video is really producing frames. */
function waitForPreviewFrames(timeoutMs = 6000) {
    return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
            const video = document.querySelector('#qr-reader video');
            if (video && video.readyState >= 2 && video.videoWidth > 0) { resolve(true); return; }
            if (Date.now() - started > timeoutMs) { resolve(false); return; }
            setTimeout(check, 60);
        };
        check();
    });
}

// ---------- Feedback panel ----------

const FEEDBACK_IDLE = ['scanner_fb_idle_title', 'Все още няма сканирани студенти.', 'scanner_fb_idle_detail', 'Записите остават в текущата сесия, докато не натиснете „Приключи“.'];

function setFeedback(tone, title, detail) {
    const box = document.getElementById('scannerFeedback');
    if (!box) return;
    box.dataset.tone = tone;
    const titleEl = document.getElementById('scannerFeedbackTitle');
    const detailEl = document.getElementById('scannerFeedbackDetail');
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail || '';
    // Full text on hover when the fixed-height panel clamps it
    box.title = [title, detail].filter(Boolean).join(' — ');
}

function resetFeedback() {
    clearTimeout(feedbackTimer);
    setFeedback('idle', t(FEEDBACK_IDLE[0], FEEDBACK_IDLE[1]), t(FEEDBACK_IDLE[2], FEEDBACK_IDLE[3]));
}

function studentLine({ name, facultyNumber }) {
    return [name, facultyNumber].filter(Boolean).join(' · ');
}

function renderScanFeedback(detail) {
    const overlay = getOverlay('scannerOverlay');
    if (!overlay || overlay.style.visibility !== 'visible') return;
    const joining = detail.mode !== 'leaving';
    switch (detail.kind) {
        case 'accepted': {
            setFeedback('success',
                joining ? t('scanner_fb_entry', 'Влизането е отбелязано') : t('scanner_fb_exit', 'Излизането е отбелязано'),
                `${studentLine(detail)} — ${t('scanner_fb_session', 'записано в текущата сесия')}`);
            const viewport = document.getElementById('cameraContainer');
            if (viewport) {
                viewport.classList.add('sc-hit');
                setTimeout(() => viewport.classList.remove('sc-hit'), 450);
            }
            break;
        }
        case 'duplicate':
            setFeedback('warning',
                joining ? t('scanner_fb_dup_entry', 'Влизането вече е отбелязано') : t('scanner_fb_dup_exit', 'Излизането вече е отбелязано'),
                studentLine(detail));
            break;
        case 'no-entry':
            setFeedback('warning', t('scanner_fb_no_entry', 'Няма отбелязано влизане'),
                `${studentLine(detail)} — ${t('scanner_fb_no_entry_detail', 'сканирайте първо при влизане')}`);
            break;
        case 'not-in-class':
            setFeedback('error', t('scanner_fb_not_in_class', 'Студентът не е в тази дисциплина'),
                studentLine(detail) || t('scanner_fb_not_recorded', 'Сканирането не е записано.'));
            break;
        default:
            setFeedback('error', t('scanner_fb_invalid', 'Невалиден QR код'),
                t('scanner_fb_invalid_detail', 'Кодът не е QR код на студент от StudentCheck.'));
    }
}

function renderSaveState({ state }) {
    const finishBtn = document.getElementById('scannerCloseBtn');
    const discardBtn = document.getElementById('scannerDiscardBtn');
    const saving = state === 'pending';
    // Only the actions that cannot run safely while saving
    [finishBtn, discardBtn].forEach((btn) => {
        if (!btn) return;
        btn.disabled = saving;
        btn.setAttribute('aria-busy', String(saving && btn === finishBtn));
    });
    if (state === 'pending') {
        setFeedback('pending', t('scanner_fb_saving', 'Запазване на присъствията…'), t('scanner_fb_saving_detail', 'Не затваряйте страницата.'));
    } else if (state === 'failed') {
        setFeedback('error', t('scanner_fb_save_failed', 'Присъствията не са запазени'),
            t('scanner_fb_save_failed_detail', 'Сесията е запазена на това устройство. Опитайте „Приключи“ отново.'));
    }
}

document.addEventListener('scanner:feedback', (e) => renderScanFeedback(e.detail || {}));
document.addEventListener('scanner:saving', (e) => renderSaveState(e.detail || {}));
document.addEventListener('app:languagechange', () => {
    const overlay = getOverlay('scannerOverlay');
    if (!overlay) return;
    setCameraState(cameraState, cameraErrorKind);
    if (document.getElementById('scannerFeedback')?.dataset.tone === 'idle') resetFeedback();
});

function showUnsavedAttendanceNotice() {
    const title = t('unsaved_scanner_notice_title', 'Unsaved Attendances');
    const message = t('unsaved_scanner_notice_message', 'There are unsaved attendances for this class. Please finish or discard the scanner session when done.');
    const okText = t('unsaved_scanner_notice_ok_btn', 'I understand');
    openConfirmOverlay(
        message,
        () => {},
        null,
        {
            title,
            okText,
            okClass: 'confirm-accept',
            hideCancel: true,
            popupClass: 'unsaved-scanner-popup'
        }
    );
}

function bindScannerLifecyclePersistence(className) {
    const cls = String(className || '').trim();
    if (!cls) return;
    const persist = () => { saveScannerDraftForClass(cls); };
    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') persist();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', persist);
    scannerLifecycleCleanup = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', persist);
    };
}

function resolveActiveScannerClassName() {
    const overlay = getOverlay('scannerOverlay');
    const fromOverlay = String(overlay?.dataset?.activeClassName || '').trim();
    if (fromOverlay) return fromOverlay;
    const fromState = String(getCurrentClass().name || '').trim();
    if (fromState) return fromState;
    return String(activeScannerClassName || '').trim();
}

/**
 * Stop all camera tracks (safety cleanup)
 */
export function stopAllCameraTracks() {
    try {
        const videos = document.querySelectorAll('#qr-reader video, #cameraContainer video, video');
        videos.forEach(v => {
            try {
                const s = v.srcObject;
                if (s && typeof s.getTracks === 'function') {
                    s.getTracks().forEach(t => {
                        try { t.stop(); } catch (_) { }
                    });
                }
                v.srcObject = null;
            } catch (_) { }
        });
    } catch (_) { }
}

/**
 * Stop media tracks held by html5-qrcode (best-effort)
 * @param {Object} html5QrCode - Html5Qrcode instance
 */
function stopHtml5QrCodeStream(html5QrCode) {
    if (!html5QrCode) return;
    try {
        const track = typeof html5QrCode.getRunningTrack === 'function'
            ? html5QrCode.getRunningTrack()
            : null;
        if (track && typeof track.stop === 'function') track.stop();
    } catch (_) {}
    try {
        const stream = html5QrCode._localMediaStream || html5QrCode._mediaStream;
        if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach(t => {
                try { t.stop(); } catch (_) { }
            });
        }
    } catch (_) {}
}

/**
 * Ensure html5-qrcode library is loaded
 * @returns {Promise<Object>} Html5Qrcode constructor
 */
function ensureHtml5QrcodeLoaded() {
    if (window.Html5Qrcode) return Promise.resolve(window.Html5Qrcode);
    if (html5qrcodeLoadPromise) return html5qrcodeLoadPromise;
    // Self-hosted, pinned copy: loading '@latest' from a CDN let any new upstream
    // release run on the teacher page (where the login token lives).
    const sources = [
        'javascript/vendor/html5-qrcode-2.3.8.min.js'
    ];
    html5qrcodeLoadPromise = new Promise((resolve, reject) => {
        const tryNext = (i) => {
            if (i >= sources.length) {
                reject(new Error('Failed to load html5-qrcode library'));
                return;
            }
            const script = document.createElement('script');
            script.src = sources[i];
            script.async = true;
            script.onload = () => resolve(window.Html5Qrcode);
            script.onerror = () => { script.remove(); tryNext(i + 1); };
            document.head.appendChild(script);
        };
        tryNext(0);
    }).catch((error) => {
        html5qrcodeLoadPromise = null; // let Retry load it again
        throw error;
    });
    return html5qrcodeLoadPromise;
}

/**
 * Handle radio button change for scan mode
 * @param {'joining'|'leaving'} mode - Scan mode
 */
export function handleRadioChange(mode) {
    setCurrentScanMode(mode);
    const cam = document.getElementById('cameraContainer');
    if (cam) cam.setAttribute('data-mode', mode);
}

/**
 * Initialize scanner with QR code reader
 * @param {'joining'|'leaving'} mode - Scan mode
 * @param {string} className - Class name
 * @param {Function} onScanCallback - Callback for scanned codes
 * @returns {Promise<void>} Initialization promise
 */
export function initializeScanner(mode, className, onScanCallback) {
    const classStudents = loadClassStudentsFromStorage(className) || [];
    initAttendanceStateForClass(className, classStudents);

    // Initialize student timestamps only for students that don't already have one.
    // Skipping existing entries preserves timestamps restored from a saved draft
    // (e.g. when the scanner is re-opened after adding a new student mid-session).
    classStudents.forEach(student => {
        const facultyNumber = String(resolveStudentFacultyNumber(student) || '').trim();
        if (facultyNumber && !getStudentTimestamp(facultyNumber)) {
            setStudentTimestamp(facultyNumber, null, null);
        }
    });

    return startCamera(scannerSessionId, className, onScanCallback);
}

/**
 * Start the camera for one dialog session. Every await re-checks the session:
 * a start that finishes after the dialog closed is stopped and its stream
 * released; it never updates the (closed) dialog.
 */
function startCamera(sessionId, className, onScanCallback) {
    if (startingSession === sessionId) return lastCameraStart; // no duplicate initialisation
    startingSession = sessionId;
    const isCurrent = () => sessionId === scannerSessionId;

    const run = async () => {
        await lastCameraStart.catch(() => {}); // the previous start has settled
        if (!isCurrent()) return;
        setCameraState('loading');

        let Html5Qrcode;
        try {
            Html5Qrcode = await ensureHtml5QrcodeLoaded();
        } catch (error) {
            if (isCurrent()) setCameraState('error', 'library');
            return;
        }
        if (!isCurrent()) return;
        const container = document.getElementById('qr-reader');
        if (!container) return;

        // "Waiting for permission" only while the browser is really asking
        const permission = await cameraPermissionState();
        if (!isCurrent()) return;
        setCameraState(permission && permission.state === 'granted' ? 'starting' : 'permission');
        if (permission && permission.state !== 'granted') {
            permission.onchange = () => {
                if (isCurrent() && cameraState === 'permission' && permission.state === 'granted') setCameraState('starting');
            };
        }

        container.replaceChildren();
        const html5QrCode = new Html5Qrcode('qr-reader', { verbose: false });
        setHtml5QrCode(html5QrCode);

        const onScanSuccess = (decodedText) => {
            if (!isCurrent()) return;
            const now = Date.now();
            const lastScan = getLastScanAt();
            if (now - lastScan > 300) {
                setLastScanAt(now);
                if (onScanCallback) {
                    const liveMode = getCurrentScanMode();
                    onScanCallback(decodedText, liveMode, className);
                }
            }
        };

        try {
            await html5QrCode.start(
                { facingMode: 'environment' },
                { fps: 24, aspectRatio: 1.0, disableFlip: true },
                onScanSuccess,
                () => {} // frequent decode misses
            );
        } catch (error) {
            console.error('Scanner initialization error:', error);
            try { html5QrCode.clear(); } catch (_) {}
            stopHtml5QrCodeStream(html5QrCode);
            if (getHtml5QrCode() === html5QrCode) setHtml5QrCode(null);
            if (isCurrent()) setCameraState('error', classifyCameraError(error));
            return;
        }

        if (!isCurrent()) {
            // Closed while the camera was starting: release it now
            await stopScannerInstance(html5QrCode);
            return;
        }
        setCameraState('starting');
        await waitForPreviewFrames();
        if (!isCurrent()) return;
        setCameraState('active');
    };

    lastCameraStart = run().finally(() => {
        if (startingSession === sessionId) startingSession = null;
    });
    return lastCameraStart;
}

async function stopScannerInstance(html5QrCode) {
    if (!html5QrCode) return;
    stopHtml5QrCodeStream(html5QrCode);
    try { await html5QrCode.stop(); } catch (_) {}
    try { html5QrCode.clear(); } catch (_) {}
    stopHtml5QrCodeStream(html5QrCode);
    if (getHtml5QrCode() === html5QrCode) setHtml5QrCode(null);
    stopAllCameraTracks();
}

/** Retry after a camera/library error (same dialog session). */
export function retryScannerCamera() {
    const className = resolveActiveScannerClassName();
    if (!className || startingSession === scannerSessionId) return;
    startCamera(scannerSessionId, className, (decodedText, mode, clsName) => {
        handleScannedCode(decodedText, mode, clsName, null);
    });
}

/**
 * Close scanner overlay
 * @param {Function} onClosed - Callback when closed
 * @returns {Promise<void>} Close promise
 */
export function closeScanner(onClosed) {
    // Any camera start still in flight belongs to a closed dialog now
    scannerSessionId += 1;
    const finish = () => {
        if (typeof scannerLifecycleCleanup === 'function') {
            scannerLifecycleCleanup();
            scannerLifecycleCleanup = null;
        }
        activeScannerClassName = '';
        const scannerOverlay = getOverlay('scannerOverlay');
        if (scannerOverlay) {
            delete scannerOverlay.dataset.activeClassName;
            hideOverlay(scannerOverlay);
        }
        stopAllCameraTracks();
        setCameraState('loading');
        try {
            if (typeof onClosed === 'function') onClosed();
        } catch (_) { }
    };

    try {
        const html5QrCode = getHtml5QrCode();
        if (html5QrCode) {
            stopHtml5QrCodeStream(html5QrCode);
            return html5QrCode.stop().then(() => {
                stopHtml5QrCodeStream(html5QrCode);
                stopAllCameraTracks();
                html5QrCode.clear();
                setHtml5QrCode(null);
                finish();
            }).catch(() => {
                try {
                    html5QrCode.clear();
                } catch (_) { }
                stopHtml5QrCodeStream(html5QrCode);
                stopAllCameraTracks();
                setHtml5QrCode(null);
                finish();
            });
        }
        stopAllCameraTracks();
        finish();
        return Promise.resolve();
    } catch (_) {
        // If stop throws (e.g., scanner never started), still finish cleanly.
        setHtml5QrCode(null);
        stopAllCameraTracks();
        finish();
        return Promise.resolve();
    }
}

/**
 * Set scan mode
 * @param {'joining'|'leaving'} mode - Scan mode
 */
export function setScanMode(mode) {
    setCurrentScanMode(mode);
    const cam = document.getElementById('cameraContainer');
    if (cam) cam.setAttribute('data-mode', mode);
}

/**
 * Open scanner overlay and start scanning
 * @param {string} className - Class name
 */
export function openScannerOverlay(className) {
    const scannerOverlay = getOverlay('scannerOverlay');
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    const current = getCurrentClass();
    
    if (!scannerOverlay) return;
    
    activeScannerClassName = (className || current.name || '').trim();
    scannerOverlay.dataset.activeClassName = activeScannerClassName;
    // New dialog session: the viewport starts as the dark placeholder
    scannerSessionId += 1;
    setCameraState('loading');
    resetFeedback();
    renderSaveState({ state: 'idle' });
    const restored = restoreScannerDraftForClass(activeScannerClassName);
    if (!restored) {
        clearStudentTimestamps();
    }
    
    const bindCloseButton = (btn, eventName) => {
        if (!btn || btn.dataset.closeBound === 'true') return;
        btn.dataset.closeBound = 'true';
        const fire = (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.dispatchEvent(new CustomEvent(eventName));
        };
        btn.addEventListener('touchend', (e) => {
            btn.dataset.touchHandled = 'true';
            fire(e);
        }, { passive: false });
        btn.addEventListener('click', (e) => {
            if (btn.dataset.touchHandled === 'true') {
                btn.dataset.touchHandled = 'false';
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            fire(e);
        });
    };

    const closeBtn = scannerOverlay.querySelector('#closeScannerBtn');
    const discardBtn = scannerOverlay.querySelector('#scannerDiscardBtn');
    const finishBtn = scannerOverlay.querySelector('#scannerCloseBtn');
    // × minimizes the scanner (saves draft, stops camera) without discarding data
    bindCloseButton(closeBtn, 'minimizeScannerRequested');
    bindCloseButton(discardBtn, 'closeScannerDiscardRequested');
    bindCloseButton(finishBtn, 'closeScannerRequested');
    
    if (scannerOverlay.dataset.escapeBound !== 'true') {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && scannerOverlay.style.visibility === 'visible') {
                e.stopPropagation();
                e.preventDefault();
            }
        });
        scannerOverlay.dataset.escapeBound = 'true';
    }
    
    const radios = scannerOverlay.querySelectorAll('input[name="scanMode"]');
    radios.forEach(r => {
        if (r.dataset.modeBound === 'true') return;
        r.dataset.modeBound = 'true';
        r.addEventListener('change', (ev) => {
            const mode = ev.target.value === 'leaving' ? 'leaving' : 'joining';
            setScanMode(mode);
        });
    });
    
    const retryBtn = scannerOverlay.querySelector('#scannerRetryBtn');
    if (retryBtn && retryBtn.dataset.retryBound !== 'true') {
        retryBtn.dataset.retryBound = 'true';
        retryBtn.addEventListener('click', retryScannerCamera);
    }

    const stopBtn = scannerOverlay.querySelector('#scannerStopBtn');
    if (stopBtn && stopBtn.dataset.stopBound !== 'true') {
        stopBtn.dataset.stopBound = 'true';
        stopBtn.addEventListener('click', () => {
            const activeClassName = resolveActiveScannerClassName();
            const event = new CustomEvent('openAttendanceOverlay', { detail: { className: activeClassName } });
            document.dispatchEvent(event);
        });
    }
    
    // Close button handlers are delegated on the overlay (see above)
    
    if (readyPopupOverlay) hideOverlay(readyPopupOverlay);
    
    const titleEl = scannerOverlay.querySelector('#scannerTitle');
    if (titleEl) {
        const displayName = (className || current.name || '').trim();
        titleEl.textContent = displayName;
    }
    
    setScanMode('joining');
    const joinRadio = scannerOverlay.querySelector('#scanJoin');
    const leaveRadio = scannerOverlay.querySelector('#scanLeave');
    if (joinRadio) joinRadio.checked = true;
    if (leaveRadio) leaveRadio.checked = false;
    
    showOverlay(scannerOverlay);
    scannerOverlay.querySelector('.sc-dialog')?.focus({ preventScroll: true });
    bindScannerLifecyclePersistence(activeScannerClassName);
    
    initializeScanner('joining', activeScannerClassName, (decodedText, mode, clsName) => {
        handleScannedCode(decodedText, mode, clsName, null);
    }).then(() => {
        if (restored) {
            showUnsavedAttendanceNotice();
        }
    });
}
