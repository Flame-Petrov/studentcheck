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
    setStudentTimestamp
} from '../state/appState.js';
import { loadClassStudentsFromStorage } from '../storage/studentStorage.js';
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

function t(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

function showUnsavedAttendanceNotice() {
    const isBg = (() => {
        try {
            return (localStorage.getItem('language') || 'en') === 'bg';
        } catch (_) {
            return false;
        }
    })();
    const title = isBg
        ? 'Незапазени присъствия'
        : t('unsaved_scanner_notice_title', 'Unsaved Attendances');
    const message = isBg
        ? 'Има незапазени присъствия за тази дисциплина. Моля, завършете или откажете сесията на сканиране.'
        : t('unsaved_scanner_notice_message', 'There are unsaved attendances for this class. Please finish or discard the scanner session when done.');
    openConfirmOverlay(
        message,
        () => {},
        null,
        {
            title,
            okText: t('confirm_btn', 'OK'),
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
    const sources = [
        'https://unpkg.com/html5-qrcode@latest/minified/html5-qrcode.min.js',
        'https://unpkg.com/html5-qrcode@latest/html5-qrcode.min.js',
        'https://cdn.jsdelivr.net/npm/html5-qrcode@latest/minified/html5-qrcode.min.js',
        'https://cdn.jsdelivr.net/npm/html5-qrcode@latest/html5-qrcode.min.js'
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
    const classStudents = loadClassStudentsFromStorage(className);
    initAttendanceStateForClass(className, classStudents);

    // Initialize student timestamps
    classStudents.forEach(student => {
        setStudentTimestamp(student.faculty_number, null, null);
    });

    return ensureHtml5QrcodeLoaded().then((Html5Qrcode) => {
        const container = document.getElementById('qr-reader');
        if (!container) {
            throw new Error('QR container not found');
        }

        const html5QrCode = new Html5Qrcode('qr-reader');
        setHtml5QrCode(html5QrCode);

        const onScanSuccess = (decodedText, decodedResult) => {
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

        const onScanError = (errorMessage, error) => {
            // Ignore frequent decode errors
            return;
        };

        return html5QrCode.start(
            { facingMode: 'environment' },
            {
                fps: 24,
                qrbox: { width: 220, height: 220 },
                aspectRatio: 1.0,
                disableFlip: true
            },
            onScanSuccess,
            onScanError
        ).catch((e) => {
            console.error('Scanner initialization error:', e);
            if (container) {
                container.innerHTML = '<p style="color:#b91c1c; text-align:center;">Unable to start camera scanner.</p>';
            }
        });
    });
}

/**
 * Close scanner overlay
 * @param {Function} onClosed - Callback when closed
 * @returns {Promise<void>} Close promise
 */
export function closeScanner(onClosed) {
    const finish = () => {
        if (typeof scannerLifecycleCleanup === 'function') {
            scannerLifecycleCleanup();
            scannerLifecycleCleanup = null;
        }
        activeScannerClassName = '';
        const scannerOverlay = getOverlay('scannerOverlay');
        if (scannerOverlay) hideOverlay(scannerOverlay);
        stopAllCameraTracks();
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
    const finishBtn = scannerOverlay.querySelector('#scannerCloseBtn');
    bindCloseButton(closeBtn, 'closeScannerDiscardRequested');
    bindCloseButton(finishBtn, 'closeScannerRequested');
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && scannerOverlay.style.visibility === 'visible') {
            e.stopPropagation();
            e.preventDefault();
        }
    });
    
    const radios = scannerOverlay.querySelectorAll('input[name="scanMode"]');
    radios.forEach(r => r.addEventListener('change', (ev) => {
        const mode = ev.target.value === 'leaving' ? 'leaving' : 'joining';
        setScanMode(mode);
    }));
    
    const stopBtn = scannerOverlay.querySelector('#scannerStopBtn');
    stopBtn?.addEventListener('click', () => {
        const event = new CustomEvent('openAttendanceOverlay', { detail: { className: className || current.name } });
        document.dispatchEvent(event);
    });
    
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
    bindScannerLifecyclePersistence(activeScannerClassName);
    
    initializeScanner('joining', className || current.name, (decodedText, mode, clsName) => {
        handleScannedCode(decodedText, mode, clsName, null);
    }).then(() => {
        if (restored) {
            showUnsavedAttendanceNotice();
        }
    });
}
