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
    hasScannerDraftForClass
} from './features/attendance.js';
import { renderAttendanceForClass } from './ui/attendanceUI.js';
import { handleDownloadAttendanceTable } from './features/export.js';
import { showOverlay, hideOverlay, getOverlay, openConfirmOverlay } from './ui/overlays.js';
import { getActiveClassName, getRawClassNameFromButton } from './utils/helpers.js';

// ===== MAIN INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    if (!bootstrapTeacherAuthState()) {
        clearAuthState();
        alert('Session expired. Please log in again.');
        window.location.href = 'teacherLogin.html';
        return;
    }

    const classList = document.getElementById('classList');
    const addBtn = document.getElementById('addClassBtn');
    const teacherEmail = getTeacherEmail();
    const deletePopup = document.createElement('button');
    deletePopup.id = 'unreadyDeletePopup';
    deletePopup.className = 'unready-delete-popup';
    deletePopup.type = 'button';
    deletePopup.textContent = 'Delete class';
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

    // ===== READY POPUP OVERLAY SETUP =====
    const readyPopupOverlay = getOverlay('readyClassPopupOverlay');
    let readyPopupOverlayInitialized = false;

    function ensureReadyPopupOverlayInitialized() {
        if (readyPopupOverlayInitialized) return;
        readyPopupOverlayInitialized = true;

        const manageBtn = readyPopupOverlay?.querySelector('#manageStudentsBtn');
        const scannerBtn = readyPopupOverlay?.querySelector('#startScannerBtn');
        const downloadBtn = readyPopupOverlay?.querySelector('#downloadAttendanceTableBtn');
        const optionsBtn = readyPopupOverlay?.querySelector('#classOptionsBtn');
        const closeBtn = readyPopupOverlay?.querySelector('#closeReadyPopupBtn');

        if (scannerBtn) {
            scannerBtn.style.position = 'relative';
            if (!scannerBtn.querySelector('.scanner-unsaved-dot')) {
                const dot = document.createElement('span');
                dot.className = 'scanner-unsaved-dot';
                dot.setAttribute('aria-hidden', 'true');
                dot.style.position = 'absolute';
                dot.style.top = '-8px';
                dot.style.right = '14px';
                dot.style.left = 'auto';
                dot.style.transform = 'none';
                dot.style.width = '20px';
                dot.style.height = '20px';
                dot.style.borderRadius = '50%';
                dot.style.background = '#dc2626';
                dot.style.boxShadow = 'none';
                dot.style.display = 'none';
                scannerBtn.appendChild(dot);
            }
        }

        const updateScannerUnsavedDot = () => {
            if (!scannerBtn) return;
            const dot = scannerBtn.querySelector('.scanner-unsaved-dot');
            if (!dot) return;
            const current = getCurrentClass();
            const className = (current.name || (current.button ? getRawClassNameFromButton(current.button) : '') || '').trim();
            dot.style.display = hasScannerDraftForClass(className) ? 'block' : 'none';
        };

        manageBtn?.addEventListener('click', async () => {
            const current = getCurrentClass();
            const className = current.name || (current.button ? getRawClassNameFromButton(current.button) : '');
            closeReadyClassPopup();
            await openManageStudentsOverlay(className.trim());
        });

        scannerBtn?.addEventListener('click', () => {
            const current = getCurrentClass();
            openScannerOverlay(current.name);
            updateScannerUnsavedDot();
        });

        downloadBtn?.addEventListener('click', () => {
            try {
                const resolved = getActiveClassName();
                handleDownloadAttendanceTable(resolved);
            } catch (e) {
                console.error('Download Attendance Table failed unexpectedly:', e);
            }
        });

        optionsBtn?.addEventListener('click', () => {
            const name = getActiveClassName();
            openClassOptionsOverlay(name);
        });

        closeBtn?.addEventListener('click', () => closeAllClassOverlays());
        
        readyPopupOverlay?.addEventListener('click', (e) => {
            if (e.target === readyPopupOverlay) closeReadyClassPopup();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && readyPopupOverlay && isOverlayVisible(readyPopupOverlay)) {
                closeReadyClassPopup();
            }
        });

        document.addEventListener('scannerDraftChanged', () => {
            updateScannerUnsavedDot();
        });

        readyPopupOverlay.dataset.updateScannerUnsavedDotBound = 'true';
        readyPopupOverlay.updateScannerUnsavedDot = updateScannerUnsavedDot;
    }

    function openReadyClassPopup(nameOptional) {
        if (nameOptional) {
            const current = getCurrentClass();
            setCurrentClass(nameOptional, current.id, current.button);
        }

        ensureReadyPopupOverlayInitialized();

        const popup = readyPopupOverlay?.querySelector('.ready-class-popup');
        if (popup) {
            popup.classList.add('buttons-only');
            const actions = popup.querySelector('.ready-class-actions');
            actions?.classList.add('vertical');
            const titleEl = popup.querySelector('#readyClassTitle');
            if (titleEl) {
                const current = getCurrentClass();
                const rawFromBtn = current.button ? getRawClassNameFromButton(current.button) : '';
                const name = (current.name || rawFromBtn || '').trim();
                titleEl.textContent = name || 'Class';
                titleEl.dataset.dynamicTitle = name ? 'true' : 'false';
            }
        }
        
        if (readyPopupOverlay) {
            showOverlay(readyPopupOverlay);
            if (typeof readyPopupOverlay.updateScannerUnsavedDot === 'function') {
                readyPopupOverlay.updateScannerUnsavedDot();
            }
        }
    }

    function closeReadyClassPopup() {
        if (readyPopupOverlay) {
            hideOverlay(readyPopupOverlay);
        }
    }

    // Listen for custom events from student management
    document.addEventListener('openReadyClassPopup', (e) => {
        openReadyClassPopup(e.detail?.className);
    });

    // ===== ATTENDANCE OVERLAY SETUP =====
    const attendanceOverlay = getOverlay('attendanceOverlay');

    function openAttendanceOverlay(className) {
        attendanceOverlay?.addEventListener('click', (e) => {
            if (e.target === attendanceOverlay) closeAttendanceOverlay();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && attendanceOverlay && isOverlayVisible(attendanceOverlay)) {
                closeAttendanceOverlay();
            }
        });

        const current = getCurrentClass();
        const titleEl = attendanceOverlay?.querySelector('#attendanceTitle');
        if (titleEl) {
            titleEl.textContent = 'Attendance';
        }

        const listEl = document.getElementById('attendanceList');
        if (listEl) {
            renderAttendanceForClass(className || current.name, listEl);
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

    async function loadClasses() {
        try {
            const teacherEmail = getTeacherEmail();
            if (!teacherEmail) {
                console.error('Cannot load classes: teacher email not found');
                return;
            }
            
            const data = await fetchClasses(teacherEmail);
            const classes = data.classes || [];
            const classesMap = new Map();
            
            classes.forEach(_class => {
                classesMap.set(_class.id, _class.name);
                setClassId(_class.name, _class.id);
                renderClassItem(_class.name, _class.id, classList, handleClassButtonClickWrapper, loadClassStudents);
            });

            saveClassesMap(classesMap);
            ensureClassesContainerVisible();
        } catch (e) {
            console.error('Failed to load classes:', e);
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
            longPressTimer = window.setTimeout(() => {
                btn.dataset.longPressActive = 'true';
                showDeletePopup(e.clientX, e.clientY, className);
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
    classList?.querySelectorAll('.newClassBtn').forEach(attachNewClassButtonBehavior);
    classList?.querySelectorAll('.newClassBtn').forEach(attachUnreadyDeleteLongPress);
    await loadClasses();
    loadReadyClasses();
    classList?.querySelectorAll('.newClassBtn').forEach(b => updateClassStatusUI(b));
    classList?.querySelectorAll('.newClassBtn').forEach(attachUnreadyDeleteLongPress);

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

    // ===== PAGESHOW HANDLER (bfcache) =====
    window.addEventListener('pageshow', (ev) => {
        try {
            ensureClassesContainerVisible();
            const buttons = Array.from(classList?.querySelectorAll('.newClassBtn') || []);
            buttons.forEach(b => updateClassStatusUI(b));

            const namesInDom = buttons.map(b => {
                const name = (b.dataset.className || b.dataset.originalLabel || b.textContent || '')
                    .replace(/✓\s*Ready/g, '')
                    .trim();
                return name;
            }).filter(Boolean);

            const anyMismatch = namesInDom.some((n) => {
                const btn = buttons.find(b => {
                    const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '')
                        .replace(/✓\s*Ready/g, '')
                        .trim();
                    return btnName === n;
                });
                if (!btn) return true;
                const shouldBeReady = isClassReady(n);
                const isReadyClass = btn.classList.contains('class-ready');
                return shouldBeReady !== isReadyClass;
            });

            if (ev?.persisted || anyMismatch) {
                Array.from(classList?.querySelectorAll('li') || []).forEach(li => {
                    const hasAdd = !!li.querySelector('#addClassBtn');
                    if (!hasAdd) li.remove();
                });
                loadClasses();
                classList?.querySelectorAll('.newClassBtn')?.forEach(b => updateClassStatusUI(b));
            }
        } catch (e) {
            console.warn('pageshow handler error', e);
        }
    });

    // ===== HELPER FUNCTIONS =====
    function isOverlayVisible(overlay) {
        return overlay && overlay.style.visibility === 'visible';
    }
});
