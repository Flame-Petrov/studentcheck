/**
 * Teacher Homepage - Main Orchestration File
 * 
 * This file coordinates all feature modules and handles:
 * - DOM initialization and event wiring
 * - Class loading and rendering
 * - Lifecycle management (DOMContentLoaded, pageshow)
 * 
 * All business logic is delegated to feature modules.
 */

// ===== IMPORTS =====
import { initTeacherShell } from './ui/teacherShell.js';
import { initClassesView, loadClasses as loadClassList } from './features/classesView.js';
import { showBillingView, prefetchBilling, onBillingPageRestored } from './features/billingView.js';
import { ensureRoster, hasStoredRoster, prefetchRoster } from './data/rosterStore.js';
import { canPrefetch, whenIdle, prefetchUrl } from './data/prefetch.js';
import { clearAllCaches } from './data/cache.js';
import { initClassSearch } from './features/classSearch.js';
import { getTeacherEmail, SERVER_BASE_URL, ENDPOINTS } from './config/api.js';
import { bootstrapTeacherAuthState, clearAuthState } from './auth/authStore.js';
import { fetchClasses } from './api/classApi.js';
import { fetchAllStudents } from './api/studentApi.js';
import { fetchClassStudents } from './api/classApi.js';
import {
    getCurrentClass,
    setCurrentClass,
    clearCurrentClass,
    isClassReady,
    setClassReady,
    setClassId,
    getClassIdByName,
    getClassStudentAssignments,
    ensureClassStudentAssignments
} from './state/appState.js';
import { getStoredClassesMap, saveClassesMap, getClassIdByNameFromStorage } from './storage/classStorage.js';
import { loadClassStudentsFromStorage, addNewStudentsToStorage } from './storage/studentStorage.js';
import { renderClassItem, updateClassStatusUI, attachNewClassButtonBehavior, ensureClassesContainerVisible } from './ui/classUI.js';
import { openClassCreationWizard, closeClassCreationWizard } from './features/classCreation.js';
import { openClassOptionsOverlay, closeClassOptionsOverlay, renameClass, deleteClass } from './features/classManagement.js';
import { openManageStudentsOverlay, openStudentInfoOverlay, openAddStudentsToClass, finalizeAddStudentsToClass, closeAllClassOverlays } from './features/studentManagement.js';
import { openScannerOverlay, closeScanner, setScanMode } from './features/scanner.js';
import {
    openCloseScannerConfirm,
    openDiscardScannerConfirm,
    getStudentAttendanceCountForClass,
    hasScannerDraftForClass,
    saveScannerDraftForClass
} from './features/attendance.js';
import { renderAttendanceForClass } from './ui/attendanceUI.js';
import { handleDownloadAttendanceTable } from './features/export.js';
import { showOverlay, hideOverlay, getOverlay, openConfirmOverlay } from './ui/overlays.js';
import { createDisciplineActionsModal } from './ui/disciplineActionsModal.js';
import { getActiveClassName, getRawClassNameFromButton } from './utils/helpers.js';

function i18nText(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

// ===== MAIN INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    if (!bootstrapTeacherAuthState()) {
        clearAuthState();
        alert('Session expired. Please log in again.');
        window.location.href = 'index.html';
        return;
    }

    // ===== SESSION REJECTED BY THE SERVER =====
    let authExpiredHandled = false;
    document.addEventListener('app:authexpired', () => {
        if (authExpiredHandled) return;
        authExpiredHandled = true;
        clearAllCaches();
        clearAuthState();
        alert(i18nText('session_expired', 'Session expired. Please log in again.'));
        window.location.replace('index.html');
    });

    // ===== SHELL + VIEW ROUTER (Дисциплини / Плащания in one document) =====
    // The frame stays mounted; views switch in place via the History API, so
    // direct links (teacherHomepage.html#payments), refresh, Back/Forward and
    // "open in new tab" all keep working.
    const VIEWS = {
        classes: { titleKey: 'classes', fallback: 'Дисциплини', heading: 'classesTitle' },
        payments: { titleKey: 'billing_title', fallback: 'Плащания', heading: 'billingTitle' }
    };
    const viewFromLocation = () => (location.hash === '#payments' ? 'payments' : 'classes');
    let currentView = null;
    const scrollByView = {};

    const shell = initTeacherShell({
        onNavigate: (view) => goToView(view),
        onIntent: (view) => { if (view === 'payments') prefetchBilling(); }
    });

    function setDocumentTitle(view) {
        const v = VIEWS[view];
        document.title = `${i18nText(v.titleKey, v.fallback)} · StudentCheck`;
    }

    async function leaveView(view) {
        if (view !== 'classes') return;
        // A route change must not leave dialogs of the old view on top
        if (typeof closeReadyClassPopup === 'function') closeReadyClassPopup();
        const scanner = getOverlay('scannerOverlay');
        if (scanner && scanner.style.visibility === 'visible') {
            // Keep the scan as a draft and release the camera
            const current = getCurrentClass();
            saveScannerDraftForClass(current.name);
            await closeScanner();
        }
    }

    function enterView(view) {
        if (view === 'payments') showBillingView();
        else loadClassList();
    }

    function applyView(view, { focus = false, restoreScroll = false } = {}) {
        const previous = currentView;
        if (previous && previous !== view) {
            scrollByView[previous] = window.scrollY;
            leaveView(previous);
        }
        currentView = view;
        document.documentElement.setAttribute('data-view', view);
        shell.setActive(view);
        setDocumentTitle(view);
        const skip = document.getElementById('tpSkipLink');
        if (skip) skip.setAttribute('href', `#${VIEWS[view].heading}`);
        enterView(view);
        if (previous && previous !== view) {
            window.scrollTo(0, restoreScroll ? (scrollByView[view] || 0) : 0);
            if (focus) document.getElementById(VIEWS[view].heading)?.focus({ preventScroll: true });
        }
    }

    function goToView(view) {
        if (!VIEWS[view]) return;
        if (view === currentView) {
            document.getElementById(VIEWS[view].heading)?.focus({ preventScroll: true });
            return;
        }
        const url = view === 'payments' ? '#payments' : `${location.pathname}${location.search}`;
        history.pushState({ tpView: view }, '', url);
        applyView(view, { focus: true });
    }

    window.addEventListener('popstate', () => {
        const view = viewFromLocation();
        if (view !== currentView) applyView(view, { focus: true, restoreScroll: true });
    });
    document.addEventListener('app:languagechange', () => setDocumentTitle(currentView));

    const classList = document.getElementById('classList');
    initClassSearch({
        input: document.getElementById('classSearchInput'),
        list: classList,
        empty: document.getElementById('classListEmpty'),
        status: document.getElementById('classSearchStatus')
    });
    const addBtn = document.getElementById('addClassBtn');
    const teacherEmail = getTeacherEmail();
    const deletePopup = document.createElement('button');
    deletePopup.id = 'unreadyDeletePopup';
    deletePopup.className = 'unready-delete-popup';
    deletePopup.type = 'button';
    deletePopup.textContent = i18nText('delete_class_btn', 'Delete class');
    deletePopup.style.display = 'none';
    document.body.appendChild(deletePopup);

    let deletePopupClassName = '';
    let longPressTimer = null;
    let suppressNextClick = false;

    function isDeletePopupVisible() {
        return deletePopup.style.display !== 'none';
    }

    function hideDeletePopup() {
        deletePopup.style.display = 'none';
        deletePopupClassName = '';
        document.body.classList.remove('delete-popup-active');
    }

    function showDeletePopup(x, y, className) {
        deletePopupClassName = className;
        deletePopup.style.display = 'block';
        document.body.classList.add('delete-popup-active');
        deletePopup.style.left = `${x}px`;
        deletePopup.style.top = `${y}px`;
        const rect = deletePopup.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width - 8;
        const maxTop = window.innerHeight - rect.height - 8;
        const left = Math.max(8, Math.min(x, maxLeft));
        const top = Math.max(8, Math.min(y, maxTop));
        deletePopup.style.left = `${left}px`;
        deletePopup.style.top = `${top}px`;
    }

    deletePopup.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = deletePopupClassName;
        hideDeletePopup();
        if (name) {
            await deleteClass(name);
        }
    });

    const dismissDeletePopup = (e) => {
        if (!isDeletePopupVisible()) return;
        if (e.target === deletePopup) return;
        suppressNextClick = true;
        e.preventDefault();
        e.stopPropagation();
        hideDeletePopup();
    };

    document.addEventListener('pointerdown', dismissDeletePopup, true);
    document.addEventListener('click', (e) => {
        if (suppressNextClick) {
            e.preventDefault();
            e.stopPropagation();
            suppressNextClick = false;
            return;
        }
        dismissDeletePopup(e);
    }, true);
    
    if (!teacherEmail) {
        console.error('No teacher email found in localStorage for session.');
    }

    // ===== DISCIPLINE ACTIONS MODAL (primary entry point of a discipline card) =====
    // ui/disciplineActionsModal.js renders the dialog; the handlers below connect
    // its rows to the existing flows, always for the selected discipline's id.
    function findCardById(id) {
        if (!id) return null;
        return document.querySelector(`.tp-card[data-class-id="${CSS.escape(String(id))}"]`);
    }

    function resolveDiscipline(nameOptional) {
        const current = getCurrentClass();
        const fromButton = current.button ? getRawClassNameFromButton(current.button) : '';
        const name = (nameOptional || current.name || fromButton || '').trim();
        const sameAsCurrent = !nameOptional || nameOptional.trim() === (current.name || '').trim();
        const id = (sameAsCurrent && current.id) || getClassIdByName(name) || getClassIdByNameFromStorage(name) || '';
        return { id: id ? String(id) : '', name };
    }

    // The existing flows read the "current class" from app state; point it at d.
    function selectDiscipline(d) {
        const current = getCurrentClass();
        setCurrentClass(d.name, d.id, findCardById(d.id) || current.button);
    }

    const disciplineModal = createDisciplineActionsModal({
        root: getOverlay('readyClassPopupOverlay'),
        onManageStudents: (d) => {
            selectDiscipline(d);
            return openManageStudentsOverlay(d.name);
        },
        onStartScanner: (d) => {
            // The scanner asks for the camera only now, after the user chose it
            selectDiscipline(d);
            openScannerOverlay(d.name);
        },
        // The scanner checks scans against the class roster: make sure it is loaded
        prepare: {
            scanner: (d) => ensureRoster(d.id, d.name),
        },
        onExportAttendance: async (d) => {
            selectDiscipline(d);
            await handleDownloadAttendanceTable(d.name, { classId: d.id });
        },
        onOptions: (d) => {
            selectDiscipline(d);
            openClassOptionsOverlay(d.name);
        },
    });

    const updateScannerUnsavedDot = () => {
        const d = disciplineModal.getDiscipline();
        disciplineModal.setScannerDraft(!!d && hasScannerDraftForClass(d.name));
    };
    document.addEventListener('scannerDraftChanged', updateScannerUnsavedDot);

    function openReadyClassPopup(nameOptional) {
        const discipline = resolveDiscipline(nameOptional);
        if (!discipline.name) return;
        selectDiscipline(discipline);
        disciplineModal.open(discipline, { opener: findCardById(discipline.id) || getCurrentClass().button });
        updateScannerUnsavedDot();
        // Likely next steps: the roster (manage students / scanner) and the scanner library
        prefetchRoster(discipline.id, discipline.name);
        if (canPrefetch()) prefetchUrl('javascript/vendor/html5-qrcode-2.3.8.min.js', 'script');
    }

    function closeReadyClassPopup() {
        disciplineModal.close({ restoreFocus: false, immediate: true });
    }

    // Listen for custom events from student management
    document.addEventListener('openReadyClassPopup', (e) => {
        openReadyClassPopup(e.detail?.className);
    });

    // ===== ATTENDANCE OVERLAY SETUP =====
    const attendanceOverlay = getOverlay('attendanceOverlay');
    let attendanceOverlayInitialized = false;

    function openAttendanceOverlay(className) {
        if (!attendanceOverlayInitialized) {
            attendanceOverlay?.addEventListener('click', (e) => {
                if (e.target === attendanceOverlay) closeAttendanceOverlay();
            });

            document.getElementById('closeAttendanceBtn')?.addEventListener('click', () => closeAttendanceOverlay());

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && attendanceOverlay && isOverlayVisible(attendanceOverlay)) {
                    closeAttendanceOverlay();
                }
            });
            attendanceOverlayInitialized = true;
        }

        const current = getCurrentClass();
        const resolvedClassName = (className || current.name || '').trim();
        const titleEl = attendanceOverlay?.querySelector('#attendanceTitle');
        if (titleEl) {
            titleEl.textContent = i18nText('attendance', 'Attendance');
        }

        const listEl = document.getElementById('attendanceList');
        if (listEl) {
            renderAttendanceForClass(resolvedClassName, listEl);
        }

        if (attendanceOverlay) {
            showOverlay(attendanceOverlay, false);
        }
    }

    function closeAttendanceOverlay() {
        if (attendanceOverlay) {
            hideOverlay(attendanceOverlay, false);
        }
    }

    // Listen for custom events
    document.addEventListener('openAttendanceOverlay', (e) => {
        openAttendanceOverlay(e.detail?.className);
    });

    // ===== SCANNER CLOSE HANDLER =====
    document.addEventListener('closeScannerRequested', async () => {
        const current = getCurrentClass();
        await openCloseScannerConfirm(current.name, () => {
            closeReadyClassPopup();
            openReadyClassPopup(current.name);
        });
    });

    document.addEventListener('closeScannerDiscardRequested', async () => {
        const current = getCurrentClass();
        await openDiscardScannerConfirm(current.name, () => {
            closeReadyClassPopup();
            openReadyClassPopup(current.name);
        });
    });

    // Minimize: save draft, stop camera, return to class popup — no server save, no data loss
    document.addEventListener('minimizeScannerRequested', async () => {
        const current = getCurrentClass();
        saveScannerDraftForClass(current.name);
        await closeScanner(() => {
            closeReadyClassPopup();
            openReadyClassPopup(current.name);
        });
    });

    // ===== CLASS LIST DRAFT BADGE =====
    function updateClassDraftBadges() {
        const buttons = document.querySelectorAll('.newClassBtn');
        buttons.forEach(btn => {
            const className = (btn.dataset.className || btn.dataset.originalLabel || '').trim();
            if (!className) return;
            const hasDraft = hasScannerDraftForClass(className);
            let dot = btn.querySelector('.class-draft-dot');
            if (hasDraft) {
                if (!dot) {
                    dot = document.createElement('span');
                    dot.className = 'class-draft-dot';
                    dot.setAttribute('aria-hidden', 'true');
                    btn.appendChild(dot);
                }
            } else if (dot) {
                dot.remove();
            }
        });
    }

    document.addEventListener('scannerDraftChanged', () => {
        updateClassDraftBadges();
    });

    // ===== CLASS LOADING =====
    async function loadClassStudents(className, classId) {
        try {
            const resolvedClassId = classId
                || getClassIdByName(className)
                || getClassIdByNameFromStorage(className);
            if (!resolvedClassId) {
                console.warn('Failed to load class students: classId is missing');
                return;
            }
            const students = await fetchClassStudents(resolvedClassId);
            if (students && students.length > 0) {
                addNewStudentsToStorage(className, students);
                setClassReady(className, true);
                const btn = Array.from(document.querySelectorAll('.newClassBtn')).find(b => {
                    const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '')
                        .replace(/✓\s*Ready/g, '')
                        .trim();
                    return btnName === className;
                });
                if (btn) updateClassStatusUI(btn);
            }
        } catch (e) {
            console.error('Failed to load class students:', e);
        }
    }

    function loadReadyClasses() {
        const storedClassesMap = getStoredClassesMap();
        if (!storedClassesMap) {
            console.error('[loadReadyClasses] No stored classes map found.');
            return;
        }

        for (const [id, name] of storedClassesMap.entries()) {
            const storedClass = loadClassStudentsFromStorage(name);
            if (storedClass && storedClass.length > 0) {
                setClassReady(name, true);
            }
        }

        // Update UI for existing buttons
        classList?.querySelectorAll('.newClassBtn').forEach(b => updateClassStatusUI(b));
    }

    // ===== CLASS BUTTON CLICK HANDLER =====
    async function handleClassButtonClickWrapper(buttonEl) {
        // Robustly resolve the clicked button element
        const btn = buttonEl?.closest?.('.newClassBtn') || buttonEl;
        
        // Read dataset attributes - these must be present
        const className = btn.dataset.className || getRawClassNameFromButton(btn);
        const classIdFromDataset = btn.dataset.classId;
        
        // CRITICAL: Require dataset.classId - do not proceed without it
        if (!classIdFromDataset) {
            const errorContext = {
                module: 'teacherHomepage',
                function: 'handleClassButtonClickWrapper',
                action: 'resolveClassDataset',
                errorMessage: 'Missing data-class-id on class button',
                className,
                clickedElement: btn?.outerHTML?.slice(0, 200),
                allDatasetKeys: Object.keys(btn.dataset || {})
            };
            console.error('[UI_ERROR]', errorContext);
            // Do not proceed - abort opening overlays
            alert('Error: Class ID not found. Please refresh the page.');
            return;
        }
        
        // Validate that className matches if we have state fallback
        const classIdFromState = getClassIdByName(className);
        if (classIdFromState && String(classIdFromState) !== String(classIdFromDataset)) {
            console.warn('[Class Open] Dataset classId does not match state classId', {
                className,
                classIdFromDataset,
                classIdFromState,
                warning: 'Using dataset value, but mismatch detected'
            });
        }
        
        // Use dataset classId exclusively
        const classId = classIdFromDataset;
        
        setCurrentClass(className, classId, btn);
        
        const currentAfterSet = getCurrentClass();
        
        // Ensure dataset is complete (defensive)
        if (!btn.dataset.className) btn.dataset.className = className;
        if (!btn.dataset.originalLabel) btn.dataset.originalLabel = className;

        openReadyClassPopup(className);
    }

    // Expose handlers for class creation module to attach new buttons
    window.handleClassButtonClickWrapper = handleClassButtonClickWrapper;
    window.loadClassStudents = loadClassStudents;

    // ===== EVENT LISTENERS =====
    addBtn?.addEventListener('click', () => {
        openClassCreationWizard();
    });

    function attachUnreadyDeleteLongPress(btn) {
        if (!btn || btn.dataset.longPressBound === 'true') return;
        btn.dataset.longPressBound = 'true';

        btn.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            const className = btn.dataset.className || getRawClassNameFromButton(btn);
            if (!className || isClassReady(className)) return;
            const classId = btn.dataset.classId;
            const { clientX, clientY } = e;
            longPressTimer = window.setTimeout(async () => {
                btn.dataset.longPressActive = 'true';
                // Rosters load on demand now: only offer "delete" once we know
                // the class really has no students.
                if (!hasStoredRoster(className)) {
                    try { await ensureRoster(classId, className); } catch (_) { return; }
                    if (isClassReady(className)) return;
                }
                showDeletePopup(clientX, clientY, className);
            }, 600);
        });

        const clearLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };
        btn.addEventListener('pointerup', clearLongPress);
        btn.addEventListener('pointercancel', clearLongPress);
        btn.addEventListener('pointerleave', clearLongPress);

        btn.addEventListener('click', (e) => {
            if (btn.dataset.longPressActive === 'true') {
                e.preventDefault();
                e.stopPropagation();
                btn.dataset.longPressActive = 'false';
            }
        });
    }

    // ===== LEGACY STUDENT SELECTION OVERLAY (for not-ready classes) =====
    // This is handled by openAddStudentsToClass in studentManagement.js
    // No additional wiring needed here

    // ===== CLEANUP LEGACY STORAGE =====
    (function cleanupLegacyClassStorage() {
        try {
            if (!teacherEmail) return;
            const normEmail = (teacherEmail || '').trim().toLowerCase();
            const keyList = `teacher:classes:${normEmail}`;
            const keyAssignments = `teacher:classes:${normEmail}:assignments`;
            localStorage.removeItem(keyList);
            localStorage.removeItem(keyAssignments);
        } catch (e) {
            console.warn('Legacy storage cleanup failed', e);
        }
    })();

    // ===== INITIAL LOAD =====
    // Cached classes render at once (no waiting for the network); the list is
    // refreshed in the background and reconciled by id.
    initClassesView({
        onOpen: handleClassButtonClickWrapper,
        onRendered: () => {
            loadReadyClasses();
            classList?.querySelectorAll('.newClassBtn').forEach((b) => {
                updateClassStatusUI(b);
                attachUnreadyDeleteLongPress(b);
            });
            updateClassDraftBadges();
        }
    });
    applyView(viewFromLocation());
    if (currentView === 'payments') {
        // Opened on Плащания: warm the class list once the page is idle
        whenIdle(() => loadClassList());
    } else if (canPrefetch()) {
        whenIdle(() => prefetchBilling(), 4000);
    }

    if (classList) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((m) => {
                m.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;
                    const btns = node.matches?.('.newClassBtn')
                        ? [node]
                        : Array.from(node.querySelectorAll?.('.newClassBtn') || []);
                    btns.forEach(attachUnreadyDeleteLongPress);
                });
            });
        });
        observer.observe(classList, { childList: true, subtree: true });
    }

    // ===== PAGESHOW (back/forward cache) =====
    // A restored page keeps its content; refresh quietly instead of rebuilding.
    window.addEventListener('pageshow', (ev) => {
        if (!ev.persisted) return;
        if (!bootstrapTeacherAuthState()) {
            document.dispatchEvent(new CustomEvent('app:authexpired'));
            return;
        }
        const view = viewFromLocation();
        if (view !== currentView) applyView(view);
        else if (view === 'classes') loadClassList();
        onBillingPageRestored();
        updateClassDraftBadges();
    });

    // ===== HELPER FUNCTIONS =====
    function isOverlayVisible(overlay) {
        return overlay && overlay.style.visibility === 'visible';
    }
});
