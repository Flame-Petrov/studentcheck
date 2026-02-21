# REFACTORING PROPOSAL: teacherHomepage.js

## A) CURRENT SYSTEM OVERVIEW

### Execution Flow Summary

**Startup Sequence (DOMContentLoaded):**
1. Initialize DOM references (`classList`, `addBtn`)
2. Load `teacherEmail` from localStorage
3. Define API endpoints and helper functions
4. Initialize shared state (Maps, Sets)
5. Attach event listeners to pre-existing buttons
6. Call `loadClasses()` → fetches classes from server, renders buttons
7. Call `loadReadyClasses()` → restores ready state from localStorage
8. Attach "New Class" button handler
9. Attach "Add Students" overlay button handler
10. Register `pageshow` event handler for bfcache restoration

**Runtime Flow Patterns:**
- **Class Creation:** User clicks "New Class" → wizard opens → name input → student selection → class created
- **Class Interaction:** Click class button → ready popup OR add students overlay
- **Scanner Flow:** Start scanner → QR scan → attendance state update → close → save data
- **Student Management:** Manage students → view info → attendance history → add/remove

### Call Graph (Key Paths)

```
DOMContentLoaded
├── loadClasses() → renderClassItem() → attachNewClassButtonBehavior()
├── loadReadyClasses() → updateClassStatusUI()
├── addBtn click → openClassCreationWizard()
│   └── submitNewClass() → apiCreateClass() → renderClassItem()
└── class button click → handleClassButtonClick()
    ├── openReadyClassPopup() → [Manage/Scanner/Download/Options]
    └── openAddStudentsPopup() → addStudentsFromDatabase()
```

### Global/Shared State Map

**Constants:**
- `serverBaseUrl`: API base URL
- `ENDPOINTS`: API endpoint paths
- `teacherEmail`: Current teacher email

**State Variables:**
- `classIdByName`: Map<className, classId>
- `attendanceCountCache`: Map<classId, Map<studentId, count>>
- `readyClasses`: Set<className>
- `classStudentAssignments`: Map<className, Set<studentId>>
- `currentClassButton`, `currentClassName`, `currentClassId`: Current selection
- `wizardSelections`: Set<studentId>
- `studentTimestamps`: Map<faculty_number, {joined_at, left_at}>
- `attendanceState`: Map<className, Map<studentId, state>>
- `attendanceDotIndex`: Map<studentId, HTMLElement>
- Various overlay DOM references

**Hardware/Network Boundaries:**
- Network: API calls to `serverBaseUrl`
- Storage: localStorage for classes, students, ready state
- Camera: getUserMedia via html5-qrcode
- File: Browser download API for XLSX export

**External Dependencies:**
- `window.Students`: fetchAll(), splitNames(), idForStudent()
- `window.Utils`: debounce(), textIncludesTokens()
- `window.Html5Qrcode`: QR scanning library
- `window.XLSX`: Excel generation library

---

## B) PROPOSED FILE STRUCTURE

```
javascript/
├── teacherHomepage.js          # Main orchestrator (minimal, ~200 lines)
├── config/
│   └── api.js                  # API configuration
├── state/
│   └── appState.js             # Shared state management
├── api/
│   ├── classApi.js             # Class API calls
│   ├── attendanceApi.js         # Attendance API calls
│   └── studentApi.js            # Student API calls
├── storage/
│   ├── classStorage.js          # Class localStorage operations
│   └── studentStorage.js        # Student localStorage operations
├── ui/
│   ├── overlays.js              # Overlay show/hide management
│   ├── classUI.js               # Class button rendering
│   ├── studentUI.js              # Student list rendering
│   └── attendanceUI.js          # Attendance overlay rendering
├── features/
│   ├── classCreation.js         # Class creation wizard
│   ├── classManagement.js       # Class rename/delete/options
│   ├── scanner.js                # QR scanner functionality
│   ├── attendance.js             # Attendance tracking logic
│   ├── studentManagement.js     # Student add/remove/info
│   └── export.js                 # Attendance export
└── utils/
    └── helpers.js                # Pure utility functions
```

### File Responsibilities

**teacherHomepage.js (Main)**
- Entry point (DOMContentLoaded)
- DOM reference initialization
- Event listener wiring
- Module coordination
- ~200 lines

**config/api.js**
- `SERVER_BASE_URL`, `ENDPOINTS` constants
- `getTeacherEmail()` helper

**state/appState.js**
- All shared state (Maps, Sets, current selections)
- Getters/setters for state access
- State mutation functions

**api/*.js**
- Pure API call functions
- No state management
- Return promises

**storage/*.js**
- localStorage read/write operations
- Key generation helpers
- Data serialization/deserialization

**ui/*.js**
- DOM rendering functions
- UI update functions
- No business logic

**features/*.js**
- Feature-specific business logic
- Orchestrate API, storage, UI calls
- Event handlers for feature flows

**utils/helpers.js**
- Pure utility functions
- No side effects

---

## C) REFACTOR PLAN

### Extraction Order

**Phase 1: Foundation**
1. `config/api.js` - No dependencies
2. `utils/helpers.js` - No dependencies  
3. `state/appState.js` - No dependencies

**Phase 2: Storage**
4. `storage/classStorage.js` - Depends on config
5. `storage/studentStorage.js` - No dependencies

**Phase 3: API**
6. `api/classApi.js` - Depends on config
7. `api/attendanceApi.js` - Depends on config
8. `api/studentApi.js` - Depends on config

**Phase 4: UI**
9. `ui/overlays.js` - No dependencies
10. `ui/classUI.js` - Depends on state, features
11. `ui/studentUI.js` - Depends on window.Students
12. `ui/attendanceUI.js` - Depends on state, storage, features

**Phase 5: Features**
13. `features/attendance.js` - Depends on state, storage, api, ui
14. `features/scanner.js` - Depends on attendance, ui
15. `features/classCreation.js` - Depends on api, state, ui
16. `features/classManagement.js` - Depends on api, state, storage, ui
17. `features/studentManagement.js` - Depends on api, state, storage, ui
18. `features/export.js` - Depends on storage, window.XLSX

**Phase 6: Main File**
19. Refactor `teacherHomepage.js` to orchestrate modules
20. Wire all dependencies
21. Fix known bugs during extraction

### Risk Mitigation

- **Circular Dependencies:** Dependency graph is acyclic
- **Shared State:** Centralized in appState.js with explicit accessors
- **DOM References:** Passed as parameters or cached in main file
- **Event Listeners:** Idempotent initialization functions
- **Async Timing:** Maintain existing async/await patterns
- **Browser Compatibility:** No new APIs introduced

---

## D) KNOWN BUGS TO FIX DURING REFACTOR

1. **Line 46:** `ENDPOINTS.classAttendanceSummary(classId)` undefined - Fix endpoint reference
2. **Line 2719:** `Array.fro,` typo - Fix to `Array.from`
3. **Line 2149:** `!classStudents.length === 0` logic error - Fix condition
4. **Line 3274:** `loadClassStudents(className)` missing classId parameter - Fix signature
5. **Line 662:** Missing `await` in `saveStudentTimestampsToDatabase` - Add await
6. **Line 1322:** Wrong variable `wizardStudentContainer` - Fix to `createClassStudentContainer`
7. **Line 1941:** Unused parameter in `loadClassStudentsFromStorage` - Remove or use

---

## E) VERIFICATION CHECKLIST

### Functional Tests
- [ ] Class creation wizard works end-to-end
- [ ] Class rename/delete works
- [ ] Student add/remove works
- [ ] Scanner scans QR codes and updates attendance
- [ ] Attendance export generates XLSX file
- [ ] All overlays open/close correctly
- [ ] Data persists after page reload
- [ ] Ready state persists correctly

### Code Quality
- [ ] No circular dependencies
- [ ] All imports resolve correctly
- [ ] No global variable leaks
- [ ] State access through appState.js only
- [ ] All functions have clear responsibilities

---

## APPROVAL REQUIRED

Please review the proposed structure and confirm:
1. File organization is acceptable
2. Responsibilities are clear
3. Naming conventions are appropriate
4. Any adjustments needed before extraction begins

**Once approved, I will proceed with controlled extraction maintaining 100% behavioral parity.**
