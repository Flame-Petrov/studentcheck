/**
 * Class Creation Feature Module
 * 
 * Handles the 2-slide class creation wizard:
 * Slide 1: Class name input
 * Slide 2: Student selection with search/filter
 */

import { createClass, fetchClasses, addStudentsToClass } from '../api/classApi.js';
import { fetchAllStudents } from '../api/studentApi.js';
import {
    getWizardSelections,
    clearWizardSelections,
    getWizardClassName,
    setWizardClassName,
    getWizardStudentIndex,
    setWizardStudentIndex,
    setClassId,
    setClassReady,
    setClassStudentAssignments,
    ensureClassStudentAssignments
} from '../state/appState.js';
import { showOverlay, hideOverlay, getOverlay, openConfirmOverlay } from '../ui/overlays.js';
import { renderClassItem, updateClassStatusUI, flashReadyBadge, attachNewClassButtonBehavior } from '../ui/classUI.js';
import { getTeacherEmail, SERVER_BASE_URL, ENDPOINTS } from '../config/api.js';
import { saveClassStudents, resolveStudentFacultyNumber } from '../storage/studentStorage.js';
import { getStoredClassesMap, saveClassesMap } from '../storage/classStorage.js';
import { authHeaders } from '../api/authFetch.js';

function i18nText(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback || key;
}

const WIZARD_TOTAL_SLIDES = 2;
let createClassSlideIndex = 0;
let createClassFiltersInitialized = false;
let createClassWizardWired = false;
let createClassSubmitting = false;
let lastValidatedName = '';
let lastValidatedAvailable = false;

// DOM references (cached on first access)
function getCreateClassOverlay() { return getOverlay('createClassOverlay'); }
function getCreateClassSlideTrack() { return document.getElementById('createClassSlidesTrack'); }
function getCreateClassNameInput() { return document.getElementById('createClassNameInput'); }
function getCreateClassErrorName() { return document.getElementById('createClassErrorName'); }
function getCreateClassBackBtn() { return document.getElementById('createClassBackBtn'); }
function getCreateClassNextBtn() { return document.getElementById('createClassNextBtn'); }
function getCreateClassFinishBtn() { return document.getElementById('createClassFinishBtn'); }
function getCreateClassStudentContainer() { return document.getElementById('createClassStudentsBody'); }
function getCreateClassCloseBtn() { return document.getElementById('createClassCloseBtn'); }
function getCreateClassSearchInput() { return document.getElementById('createClassSearchInput'); }

/**
 * Navigate to a specific slide in the wizard
 * @param {number} index - Slide index (0 or 1)
 */
function goToSlide(index) {
    createClassSlideIndex = index;
    const slideTrack = getCreateClassSlideTrack();
    if (!slideTrack) return;
    
    const slides = Array.from(slideTrack.querySelectorAll('.slide'));
    slides.forEach(sl => sl.classList.toggle('active', Number(sl.dataset.index) === index));
    
    const backBtn = getCreateClassBackBtn();
    const nextBtn = getCreateClassNextBtn();
    const finishBtn = getCreateClassFinishBtn();
    
    if (backBtn) {
        backBtn.style.display = index === 0 ? 'none' : 'inline-block';
        backBtn.disabled = index === 0;
    }
    
    if (index < WIZARD_TOTAL_SLIDES - 1) {
        if (nextBtn) nextBtn.style.display = 'inline-block';
        if (finishBtn) finishBtn.classList.add('finish-hidden');
    } else {
        if (nextBtn) nextBtn.style.display = 'none';
        if (finishBtn) finishBtn.classList.remove('finish-hidden');
    }
    
    const actionsContainer = document.getElementById('wizardActions');
    if (actionsContainer) {
        if (index === 0) actionsContainer.classList.add('single-right');
        else actionsContainer.classList.remove('single-right');
    }
    
    const container = getCreateClassStudentContainer();
    if (index === 1 && container && container.dataset.loaded !== 'true') {
        loadStudentsIntoWizard();
    }
    
    // Focus appropriate input
    requestAnimationFrame(() => {
        if (index === 0) {
        // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
        } else if (index === 1) {
            // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
        }
    });
}

/**
 * Handle "Next" button click (validate name and advance)
 */
async function handleWizardNext() {
    const nameInput = getCreateClassNameInput();
    const errorEl = getCreateClassErrorName();
    
    if (!nameInput || !errorEl) return;
    
    const name = nameInput.value.trim();
    if (!name) {
        errorEl.textContent = i18nText('err_name_required', 'Name is required.');
        // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
        return;
    }
    if (name.length > 50) {
        errorEl.textContent = i18nText('err_name_too_long', 'Name must be 50 characters or less.');
        return;
    }

    const teacherEmail = getTeacherEmail();
    const nameTaken = await isClassNameTaken(name, teacherEmail);
    if (nameTaken) {
        const msg = window.i18n?.t ? window.i18n.t('err_class_name_taken') : 'This class name is already used.';
        openConfirmOverlay(
            msg,
            () => {
                if (nameInput) nameInput.value = '';
                setWizardClassName('');
                goToSlide(0);
            },
            null,
            { okText: 'OK', hideCancel: true, title: 'Error' }
        );
        return;
    }

    lastValidatedName = name;
    lastValidatedAvailable = true;
    errorEl.textContent = '';
    setWizardClassName(name);
    goToSlide(1);
}

/**
 * Collect class name from wizard
 * @returns {string} Class name
 */
function collectClassName() {
    return getWizardClassName().trim();
}

function normalizeClassName(name) {
    return (name || '').trim().toLowerCase();
}

async function isClassNameTaken(name, teacherEmail) {
    const normalized = normalizeClassName(name);
    if (!normalized) return false;

    // Check locally stored classes map
    try {
        const storedMap = getStoredClassesMap();
        if (storedMap && storedMap.size > 0) {
            for (const n of storedMap.values()) {
                if (normalizeClassName(n) === normalized) return true;
            }
        }
    } catch (_) {}

    // Check current DOM list
    const buttons = Array.from(document.querySelectorAll('.newClassBtn'));
    for (const btn of buttons) {
        const btnName = (btn.dataset.className || btn.dataset.originalLabel || btn.textContent || '')
            .replace(/✓\s*Ready/g, '')
            .trim();
        if (normalizeClassName(btnName) === normalized) return true;
    }

    // Check server list as final source of truth
    if (teacherEmail) {
        try {
            const classesData = await fetchClasses(teacherEmail);
            const classes = classesData?.classes || [];
            return classes.some(c => normalizeClassName(c.name) === normalized);
        } catch (_) {}
    }

    return false;
}

/**
 * Collect selected student IDs from wizard
 * @returns {Array<string>} Array of student IDs
 */
function collectSelectedStudents() {
    return Array.from(getWizardSelections());
}

/**
 * Submit new class creation
 */
// Guard against double clicks: a second Finish while saving would create a duplicate class
async function submitNewClass() {
    if (createClassSubmitting) return;
    createClassSubmitting = true;
    try {
        await submitNewClassUnguarded();
    } finally {
        createClassSubmitting = false;
    }
}

async function submitNewClassUnguarded() {
    const className = collectClassName();
    if (!className) {
        alert('Class name missing.');
        goToSlide(0);
        return;
    }
    if (className.length > 50) {
        alert('Class name must be 50 characters or less.');
        goToSlide(0);
        return;
    }

    const teacherEmail = getTeacherEmail();
    if (lastValidatedName !== className || !lastValidatedAvailable) {
        const nameTaken = await isClassNameTaken(className, teacherEmail);
        if (nameTaken) {
            const msg = window.i18n?.t ? window.i18n.t('err_class_name_taken') : 'This class name is already used.';
            openConfirmOverlay(
                msg,
                () => {
                    const input = getCreateClassNameInput();
                    if (input) input.value = '';
                    setWizardClassName('');
                    goToSlide(0);
                },
                null,
                { okText: 'OK', hideCancel: true, title: 'Error' }
            );
            return;
        }
        lastValidatedName = className;
        lastValidatedAvailable = true;
    }

    const selectedIds = collectSelectedStudents();
    if (selectedIds.length === 0) {
        if (!confirm('No students selected. Create an empty ready class?')) return;
    }

    const finishBtn = getCreateClassFinishBtn();
    if (finishBtn) {
        finishBtn.disabled = true;
        finishBtn.textContent = i18nText('creating', 'Creating...');
    }

    try {
        const data = await createClass(className, selectedIds, teacherEmail);
        let newClassId = data?.class_id || data?.id || data?.classId;
        if (!newClassId) {
            // Fallback: fetch classes and resolve the ID by name
            const classesData = await fetchClasses(teacherEmail);
            const classes = classesData?.classes || [];
            const match = classes.find(c => (c.name || '').trim() === className.trim());
            if (match) {
                newClassId = match.id;
            }
        }
        if (!newClassId) {
            throw new Error('Class created but classId is missing from server response');
        }
        
        // Update state
        setClassId(className, newClassId);
        setClassReady(className, selectedIds.length > 0);
        setClassStudentAssignments(className, new Set(selectedIds));
        
        // Persist selected students for readiness on reload
        let selectedStudents = [];
        try {
            const wizardIndex = getWizardStudentIndex();
            selectedStudents = selectedIds
                .map(id => {
                    const info = wizardIndex.get(id);
                    if (!info) return null;
                    return {
                        full_name: info.fullName || '',
                        faculty_number: info.facultyNumber || id
                    };
                })
                .filter(Boolean);
            saveClassStudents(className, selectedStudents);
        } catch (_) {}

        // Ensure server has students assigned even if createClass ignores studentIds
        if (selectedStudents.length > 0) {
            try {
                await addStudentsToClass(newClassId, selectedStudents);
            } catch (e) {
                console.warn('[Class Creation] Failed to attach students to class', e);
            }
        }

        // Persist class in local storage map so readiness is restored on refresh
        try {
            const storedMap = getStoredClassesMap() || new Map();
            storedMap.set(newClassId, className);
            saveClassesMap(storedMap);
        } catch (_) {}
        
        // Render class button
        const classList = document.getElementById('classList');
        if (classList) {
            const clickHandler = typeof window.handleClassButtonClickWrapper === 'function'
                ? window.handleClassButtonClickWrapper
                : null;
            const loadStudentsFn = typeof window.loadClassStudents === 'function'
                ? window.loadClassStudents
                : null;
            renderClassItem(className, newClassId, classList, clickHandler, loadStudentsFn);
        }
        
        // Update button UI
        const btn = Array.from(document.querySelectorAll('.newClassBtn')).find(b => {
            const btnName = (b.dataset.className || b.dataset.originalLabel || b.textContent || '').trim();
            return btnName === className;
        });
        if (btn) {
            btn.dataset.classId = newClassId;
            if (typeof window.handleClassButtonClickWrapper === 'function') {
                attachNewClassButtonBehavior(btn, window.handleClassButtonClickWrapper);
            }
            updateClassStatusUI(btn);
            flashReadyBadge(btn);
        }
        
        closeClassCreationWizard();
    } catch (err) {
        console.error('[Class Creation] API failure', err);
        alert('Failed to create class: ' + (err.message || err));
    } finally {
        if (finishBtn) {
            finishBtn.disabled = false;
            finishBtn.textContent = i18nText('finish', 'Finish');
        }
        clearWizardSelections();
        setWizardClassName('');
    }
}

/**
 * Load students into wizard (slide 2)
 */
async function loadStudentsIntoWizard() {
    const container = getCreateClassStudentContainer();
    if (!container) return;
    
    container.innerHTML = '<p class="loading-hint">Loading...</p>';
    
    try {
        await fetchFilteredStudents();
        container.dataset.loaded = 'true';
        ensureCreateClassFiltersInitialized();
    } catch (e) {
        console.error('Wizard student fetch failed', e);
        container.innerHTML = '<p style="color:#b91c1c;">Network error loading students.</p>';
    }
}

/**
 * Render students in wizard with checkboxes
 * @param {Array<Object>} students - Array of student objects
 */
function renderStudentsInWizard(students) {
    const container = getCreateClassStudentContainer();
    if (!container) return;
    
    if (!Array.isArray(students) || students.length === 0) {
        container.innerHTML = '<p class="muted">No students found.</p>';
        return;
    }
    
    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.margin = '0';
    list.style.padding = '0';
    
    const wizardSelections = getWizardSelections();
    const studentIndex = new Map();
    
    students.forEach((s, idx) => {
        const li = document.createElement('li');
        li.className = 'list-item';
        const splitNames = (window.Students?.splitNames || (() => ({ fullName: '' })))(s);
        const facultyNumber = resolveStudentFacultyNumber(s);
        const studentId = facultyNumber || splitNames.fullName || `wizard_${idx}`;
        
        studentIndex.set(studentId, { fullName: splitNames.fullName, facultyNumber: facultyNumber || '' });
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'studentSelect';
        checkbox.id = `wizardStudent_${idx}`;
        
        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = `${splitNames.fullName} ${facultyNumber || ''}`.trim();
        
        li.appendChild(checkbox);
        li.appendChild(label);
        
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                wizardSelections.add(studentId);
                li.classList.add('selected');
            } else {
                wizardSelections.delete(studentId);
                li.classList.remove('selected');
            }
        });
        
        li.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target.tagName === 'LABEL') return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });
        
        if (wizardSelections.has(studentId)) {
            checkbox.checked = true;
            li.classList.add('selected');
        }
        
        list.appendChild(li);
    });
    // Store the index only after it is filled: setWizardStudentIndex copies the entries
    setWizardStudentIndex(studentIndex);
    
    container.innerHTML = '';
    container.appendChild(list);
}

/**
 * Filter students in wizard by search query
 * @param {string} query - Search query
 */
function filterStudentsWizard(query) {
    const container = getCreateClassStudentContainer();
    if (!container) return;
    
    const q = (query || '').trim().toLowerCase();
    const items = container.querySelectorAll('li.list-item');
    
    if (!q) {
        items.forEach(li => li.style.display = '');
        const msgEl = container.querySelector('#wizardNoMatch');
        if (msgEl) msgEl.style.display = 'none';
        return;
    }
    
    const tokens = q.split(/\s+/).filter(Boolean);
    items.forEach(li => {
        const text = li.textContent.toLowerCase();
        const matches = tokens.every(t => text.includes(t));
        li.style.display = matches ? '' : 'none';
    });
    
    // Show/hide "no match" message
    // Fixed: Changed wizardStudentContainer to createClassStudentContainer
    let msgEl = container.querySelector('#wizardNoMatch');
    if (!msgEl) {
        msgEl = document.createElement('p');
        msgEl.id = 'wizardNoMatch';
        msgEl.textContent = i18nText('no_matching_students', 'No matching students.');
        msgEl.style.display = 'none';
        msgEl.style.fontStyle = 'italic';
        msgEl.style.color = '#6b7280';
        container.appendChild(msgEl);
    }
    
    const anyVisible = Array.from(items).some(li => li.style.display !== 'none');
    msgEl.style.display = anyVisible ? 'none' : 'block';
}

/**
 * Filter students by dropdown selects (stub - only uses search for now)
 */
function filterCreateClassStudentsBySelects(levelValue, facultyValue, specializationValue, groupValue, searchInputValue) {
    fetchFilteredStudents({
        level: levelValue,
        faculty: facultyValue,
        specialization: specializationValue,
        group: groupValue,
        search: searchInputValue
    });
}

function getCreateClassFilterBtn() { return document.getElementById('createClassFilterBtn'); }
function getCreateClassFilterPanel() { return document.getElementById('createClassFilterPanel'); }

function updateCreateClassFilterActive() {
    const levelSelect = document.getElementById('createClassFilterLevel');
    const facultySelect = document.getElementById('createClassFilterFaculty');
    const specializationSelect = document.getElementById('createClassFilterSpecialization');
    const groupSelect = document.getElementById('createClassFilterGroup');
    const hasActive = !!(levelSelect?.value || facultySelect?.value || specializationSelect?.value || groupSelect?.value);
    getCreateClassFilterBtn()?.classList.toggle('filter-active', hasActive);
}

function resetCreateClassFilters() {
    const levelSelect = document.getElementById('createClassFilterLevel');
    const facultySelect = document.getElementById('createClassFilterFaculty');
    const specializationSelect = document.getElementById('createClassFilterSpecialization');
    const groupSelect = document.getElementById('createClassFilterGroup');
    const searchInput = getCreateClassSearchInput();

    if (levelSelect) levelSelect.value = '';
    if (facultySelect) facultySelect.value = '';
    if (specializationSelect) specializationSelect.value = '';
    if (groupSelect) groupSelect.value = '';
    if (searchInput) searchInput.value = '';

    getCreateClassFilterPanel()?.classList.add('hidden');
    getCreateClassFilterBtn()?.classList.remove('filter-active');
    getCreateClassFilterBtn()?.classList.remove('panel-open');

    fetchFilteredStudents();
}

function ensureCreateClassFiltersInitialized() {
    if (createClassFiltersInitialized) return;
    createClassFiltersInitialized = true;

    const levelSelect = document.getElementById('createClassFilterLevel');
    const facultySelect = document.getElementById('createClassFilterFaculty');
    const specializationSelect = document.getElementById('createClassFilterSpecialization');
    const groupSelect = document.getElementById('createClassFilterGroup');
    const resetBtn = document.getElementById('createClassResetFiltersBtn');
    const searchInput = getCreateClassSearchInput();
    const filterBtn = getCreateClassFilterBtn();
    const filterPanel = getCreateClassFilterPanel();

    filterBtn?.addEventListener('click', () => {
        const nowHidden = filterPanel?.classList.toggle('hidden');
        filterBtn?.classList.toggle('panel-open', !nowHidden);
    });

    const runFilter = () => {
        updateCreateClassFilterActive();
        filterCreateClassStudentsBySelects(
            levelSelect?.value || '',
            facultySelect?.value || '',
            specializationSelect?.value || '',
            groupSelect?.value || '',
            searchInput?.value || ''
        );
    };

    if (searchInput) {
        if (window.Utils && typeof window.Utils.debounce === 'function') {
            const debounced = window.Utils.debounce((value) => filterCreateClassStudentsBySelects(
                levelSelect?.value || '',
                facultySelect?.value || '',
                specializationSelect?.value || '',
                groupSelect?.value || '',
                value || ''
            ), 250);
            searchInput.addEventListener('input', (e) => debounced(e.target.value));
        } else {
            let debounceTimer = null;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => filterCreateClassStudentsBySelects(
                    levelSelect?.value || '',
                    facultySelect?.value || '',
                    specializationSelect?.value || '',
                    groupSelect?.value || '',
                    e.target.value || ''
                ), 250);
            });
        }
    }

    levelSelect?.addEventListener('change', runFilter);
    facultySelect?.addEventListener('change', runFilter);
    specializationSelect?.addEventListener('change', runFilter);
    groupSelect?.addEventListener('change', runFilter);

    if (resetBtn) {
        resetBtn.addEventListener('click', resetCreateClassFilters);
    }
}

async function fetchFilteredStudents(filters = {}) {
    const container = getCreateClassStudentContainer();
    if (!container) return;

    const {
        level = '',
        faculty = '',
        specialization = '',
        group = '',
        search = ''
    } = filters;

    container.innerHTML = '<p class="loading-hint">Loading...</p>';

    const params = new URLSearchParams();
    if (level) params.append('level', level);
    if (faculty) params.append('faculty', faculty);
    if (specialization) params.append('specialization', specialization);
    if (group) params.append('group', group);
    if (search) params.append('search', search);

    try {
        const url = `${SERVER_BASE_URL + ENDPOINTS.students}${params.toString() ? `?${params.toString()}` : ''}`;
        const result = await fetch(url, { method: 'GET', headers: authHeaders({ 'Accept': 'application/json' }) });
        if (!result.ok) {
            throw new Error(`HTTP ${result.status}`);
        }
        const data = await result.json();
        const students = Array.isArray(data?.students) ? data.students : (Array.isArray(data) ? data : []);
        renderStudentsInWizard(students);
    } catch (e) {
        try {
            const fallback = await fetchAllStudents();
            renderStudentsInWizard(fallback);
        } catch (_) {
            container.innerHTML = '<p style="color:#b91c1c;">Unable to load students.</p>';
        }
    }
}

/**
 * Open class creation wizard
 */
export function openClassCreationWizard() {
    const overlay = getCreateClassOverlay();
    const closeBtn = getCreateClassCloseBtn();
    const backBtn = getCreateClassBackBtn();
    const nextBtn = getCreateClassNextBtn();
    const finishBtn = getCreateClassFinishBtn();
    const searchInput = getCreateClassSearchInput();
    
    if (!overlay) return;
    
    // Wire event listeners only on the first open; re-adding them on every open
    // made one Finish click run submitNewClass several times.
    if (!createClassWizardWired) {
        createClassWizardWired = true;
        closeBtn?.addEventListener('click', closeClassCreationWizard);
        backBtn?.addEventListener('click', () => goToSlide(0));
        nextBtn?.addEventListener('click', handleWizardNext);
        finishBtn?.addEventListener('click', submitNewClass);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeClassCreationWizard();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOverlayVisible(overlay)) {
                closeClassCreationWizard();
            }
        });

        if (searchInput) {
            let debounceTimer = null;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => filterStudentsWizard(e.target.value), 180);
            });
        }
    }

    getCreateClassFilterPanel()?.classList.add('hidden');
    getCreateClassFilterBtn()?.classList.remove('filter-active');
    getCreateClassFilterBtn()?.classList.remove('panel-open');

    showOverlay(overlay);
    goToSlide(0);
    // Avoid auto-focus to prevent mobile keyboard opening unexpectedly
}

/**
 * Close class creation wizard
 */
export function closeClassCreationWizard() {
    const overlay = getCreateClassOverlay();
    if (overlay) {
        hideOverlay(overlay);
    }
    clearWizardSelections();
    setWizardClassName('');
    const nameInput = getCreateClassNameInput();
    if (nameInput) nameInput.value = '';
    const errorEl = getCreateClassErrorName();
    if (errorEl) errorEl.textContent = '';
    resetCreateClassFilters();
}

/**
 * Check if overlay is visible (helper)
 */
function isOverlayVisible(overlay) {
    return overlay && overlay.style.visibility === 'visible';
}
