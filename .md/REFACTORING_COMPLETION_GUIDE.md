# Refactoring Completion Guide

## Status: ~70% Complete

### ✅ Completed Modules

**Foundation:**
- `config/api.js` - API configuration ✅
- `utils/helpers.js` - Utility functions ✅
- `state/appState.js` - State management ✅

**Storage:**
- `storage/classStorage.js` - Class storage ✅
- `storage/studentStorage.js` - Student storage ✅

**API:**
- `api/classApi.js` - Class API calls ✅
- `api/attendanceApi.js` - Attendance API calls ✅
- `api/studentApi.js` - Student API calls ✅

**UI:**
- `ui/overlays.js` - Overlay management ✅
- `ui/classUI.js` - Class button rendering ✅
- `ui/studentUI.js` - Student list rendering ✅
- `ui/attendanceUI.js` - Attendance overlay rendering ✅

**Features:**
- `features/export.js` - Attendance export ✅
- `features/attendance.js` - Attendance tracking ✅
- `features/scanner.js` - QR scanner ✅

### ⏳ Remaining Modules

**Features (Need Extraction):**
1. `features/classCreation.js` - Class creation wizard (lines ~1084-1302)
2. `features/classManagement.js` - Class rename/delete/options (lines ~919-1064)
3. `features/studentManagement.js` - Student add/remove/info (lines ~1348-1867)

**Main File:**
- `teacherHomepage.js` - Needs refactoring to orchestrate all modules

## Next Steps

### Step 1: Extract Remaining Feature Modules

#### A. Create `features/classCreation.js`

Extract from original file:
- `openClassCreationWizard()` (line ~1098)
- `closeWizard()` (line ~1123)
- `goToSlide()` (line ~1129)
- `handleWizardNext()` (line ~1157)
- `submitNewClass()` (line ~1174)
- `loadStudentsIntoWizard()` (line ~1260)
- `renderStudentsInWizard()` (line ~1274)
- `filterStudentsWizard()` (line ~1303)
- `ensureCreateClassFiltersInitialized()` (line ~2345)

**Dependencies:**
- Import from: `api/classApi.js`, `state/appState.js`, `ui/overlays.js`, `ui/studentUI.js`, `api/studentApi.js`

**Public API:**
```javascript
export function initializeClassCreationWizard(overlay, callbacks)
export function openClassCreationWizard()
export function closeClassCreationWizard()
```

#### B. Create `features/classManagement.js`

Extract from original file:
- `ensureClassOptionsOverlay()` (line ~921)
- `openClassOptionsOverlay()` (line ~951)
- `renameClass()` (line ~963)
- `deleteClassCompletely()` (line ~1021)
- `onSaveClassOptions()` (line ~1049)
- `onDeleteClassFromOptions()` (line ~1058)

**Dependencies:**
- Import from: `api/classApi.js`, `state/appState.js`, `storage/classStorage.js`, `storage/studentStorage.js`, `ui/classUI.js`, `ui/overlays.js`

**Public API:**
```javascript
export function initializeClassOptions(overlay, callbacks)
export function openClassOptionsOverlay(className)
export function renameClass(oldName, newName)
export function deleteClass(name)
```

#### C. Create `features/studentManagement.js`

Extract from original file:
- `renderManageStudentsForClass()` (line ~1356)
- `openManageStudentsOverlay()` (line ~1473)
- `openStudentInfoOverlay()` (line ~1624)
- `buildStudentInfoContent()` (line ~1542)
- `removeStudentFromClass()` (line ~1682)
- `openAttendanceHistoryOverlay()` (line ~1829)
- `renderAttendanceHistoryList()` (line ~1752)
- `openAddStudentsToClass()` (line ~2072)
- `renderAddStudentsList()` (line ~2105)
- `finalizeAddStudentsToClass()` (line ~2415)

**Dependencies:**
- Import from: `api/classApi.js`, `api/attendanceApi.js`, `api/studentApi.js`, `storage/studentStorage.js`, `state/appState.js`, `ui/overlays.js`, `ui/studentUI.js`, `features/attendance.js`

**Public API:**
```javascript
export function initializeManageStudents(overlay, callbacks)
export function openManageStudentsOverlay(className)
export function renderManageStudentsForClass(className)
export function openStudentInfoOverlay(studentId, className)
export function openAttendanceHistoryOverlay(className, studentId)
export function removeStudentFromClass(facultyNumber, className)
export function openAddStudentsToClass(className)
export function finalizeAddStudentsToClass(className, selectedIds)
```

### Step 2: Refactor Main File (`teacherHomepage.js`)

The main file should:
1. Import all modules
2. Initialize DOM references
3. Wire event listeners
4. Call module initialization functions
5. Coordinate module interactions

**Structure:**
```javascript
// Imports
import { SERVER_BASE_URL, ENDPOINTS, getTeacherEmail } from './config/api.js';
import { /* state functions */ } from './state/appState.js';
// ... all other imports

// DOMContentLoaded handler
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get DOM references
    const classList = document.getElementById('classList');
    const addBtn = document.getElementById('addClassBtn');
    
    // 2. Get teacher email
    const teacherEmail = getTeacherEmail();
    
    // 3. Initialize modules
    // 4. Load initial data
    // 5. Wire event listeners
    // 6. Handle pageshow event
});
```

### Step 3: Fix Known Bugs

1. **Line 2719:** `Array.fro,` → `Array.from` (in student selection code)
2. **Line 2149:** `!classStudents.length === 0` → `classStudents.length === 0`
3. **Line 662:** Add `await` in `saveStudentTimestampsToDatabase` (already fixed in attendanceApi.js)
4. **Line 1322:** `wizardStudentContainer` → `createClassStudentContainer`

### Step 4: Update HTML File

Update `teacherHomepage.html` to use ES6 modules:

```html
<script type="module" src="javascript/teacherHomepage.js"></script>
```

Or if using a bundler, ensure all modules are properly imported.

### Step 5: Testing

Test each feature:
1. Class creation wizard
2. Class rename/delete
3. Student add/remove
4. Scanner functionality
5. Attendance tracking
6. Export functionality

## Module Dependency Graph

```
teacherHomepage.js (main)
├── config/api.js
├── state/appState.js
├── utils/helpers.js
├── storage/classStorage.js → config/api.js
├── storage/studentStorage.js
├── api/classApi.js → config/api.js, storage/classStorage.js
├── api/attendanceApi.js → config/api.js
├── api/studentApi.js → config/api.js
├── ui/overlays.js
├── ui/classUI.js → state/appState.js, utils/helpers.js
├── ui/studentUI.js
├── ui/attendanceUI.js → state/appState.js, storage/studentStorage.js
├── features/export.js → utils/helpers.js, storage/*, api/*
├── features/attendance.js → state/appState.js, storage/*, api/*, ui/attendanceUI.js
├── features/scanner.js → state/appState.js, storage/*, features/attendance.js, ui/overlays.js
├── features/classCreation.js → api/*, state/appState.js, ui/*
├── features/classManagement.js → api/*, state/appState.js, storage/*, ui/*
└── features/studentManagement.js → api/*, state/appState.js, storage/*, ui/*, features/attendance.js
```

## Notes

- All modules use ES6 `export`/`import` syntax
- State access should go through `appState.js` getters/setters
- DOM references should be passed as parameters or cached in main file
- Event listeners should be attached in initialization functions (idempotent)
- Maintain original async/await patterns
- Fix bugs during extraction, not after

## Completion Checklist

- [ ] Extract `features/classCreation.js`
- [ ] Extract `features/classManagement.js`
- [ ] Extract `features/studentManagement.js`
- [ ] Refactor `teacherHomepage.js` main file
- [ ] Fix all known bugs
- [ ] Update HTML to use modules
- [ ] Test all functionality
- [ ] Verify no behavior changes
- [ ] Update documentation
