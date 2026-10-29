import { SERVER_BASE_URL, ENDPOINTS } from './config/api.js';


function deriveDisplayName(loginData) {
	if (!loginData) return null;
	// Try common locations for a name
	const sources = [
		loginData.data?.student,
		loginData.data?.user,
		loginData.data,
	];

	for (const src of sources) {
		if (!src || typeof src !== 'object') continue;
		const first = src.firstName || src.firstname || src.first_name || src.givenName;
		const last = src.lastName || src.lastname || src.last_name || src.familyName;
		const name = src.name || src.fullName || src.full_name;
		if (name) return String(name);
		if (first || last) return [first, last].filter(Boolean).join(' ').trim();
	}
	return null;
}

function resolveStudentData(parsed) {
	if (!parsed || typeof parsed !== 'object') return null;
	const sources = [
		{ candidate: parsed.data?.student, owner: parsed.data },
		{ candidate: parsed.data?.user, owner: parsed.data },
		{ candidate: parsed.student, owner: parsed },
		{ candidate: parsed.user, owner: parsed },
		{ candidate: parsed.data, owner: parsed }
	];
	for (const source of sources) {
		const candidate = source?.candidate;
		if (candidate && typeof candidate === 'object') {
			const resolvedId = candidate.id
				|| candidate.student_id
				|| source?.owner?.id
				|| source?.owner?.student_id
				|| parsed?.id
				|| parsed?.student_id
				|| parsed?.data?.id
				|| parsed?.data?.student_id
				|| null;
			return {
				...candidate,
				id: candidate.id || candidate.student_id || resolvedId || undefined,
				student_id: candidate.student_id || candidate.id || resolvedId || undefined
			};
		}
	}
	return null;
}

document.addEventListener('DOMContentLoaded', () => {
	const revealPage = () => {
		try {
			document.body.classList.remove('page-loading');
		} catch (_) {}
	};

	var rawData = null;
	var parsedData = null;
	var studentData = null;

	var nameElement = null;
	var facultyNumberElement = null;

	try{

		rawData = sessionStorage.getItem('studentData');

		if (!rawData) {
			// No session data: send user back to login
			window.location.replace('index.html');
			return;
		}

		parsedData = JSON.parse(rawData);
		studentData = resolveStudentData(parsedData);

	}catch(e){
		console.error("Error during extracting data.", e);
		revealPage();
		return;
	}

	if (!studentData) {
		console.error("No student data found in sessionStorage.");
		alert('Your session data is incomplete. Please log in again.');
		window.location.replace('index.html');
		revealPage();
		return;
	}
	
	try{

		nameElement = document.getElementById('studentDisplayName');
		facultyNumberElement = document.getElementById('studentFacultyNumber');

	}catch(e){
		console.error("Error during initializing page elements.", e);
		revealPage();
		return;
	}

	if(nameElement == null || facultyNumberElement == null){
		console.error("Essential page elements are missing.");
		revealPage();
		return;
	}

	// Determine a reasonable display name
	const displayName = studentData.full_name || deriveDisplayName(parsedData) || "Error: No Name Found";
	const facultyNumber = studentData.faculty_number || '---';

	if (nameElement) nameElement.textContent = displayName;
	if (facultyNumberElement) facultyNumberElement.textContent = facultyNumber;



	const classesBtn = document.getElementById('viewClassesBtn');
	if(classesBtn){
		classesBtn.addEventListener('click', async () => {

			openViewClassesOverlay();

			await loadClassesForStudent(studentData);

		});
	}


	const logoutBtn = document.getElementById('logoutBtn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', () => {

			if (window.clearSessionData) window.clearSessionData();
			else sessionStorage.removeItem('studentData');
			// Redirect to the landing page after logout
			window.location.replace('index.html');

		});
	}else{
		console.error("Error: Unable to load logout button.");
	}


	const viewClassesOverlay = document.getElementById('view-classes-overlay');
	const overlayBackground = document.querySelector('.overlay-background');
	if (overlayBackground) {
		overlayBackground.addEventListener('click', () => {
			const classDetailsOverlay = document.getElementById('class-details-overlay');
			if (classDetailsOverlay && classDetailsOverlay.style.display === 'block') {
				closeClassDetailsOverlay();
				return;
			}
			if (viewClassesOverlay && viewClassesOverlay.style.display === 'block') {
				closeViewClassesOverlay();
			}
		});
	}




	const closeClassDetailsOverlayBtn = document.getElementById('closeClassDetailsOverlayBtn');
	if(closeClassDetailsOverlayBtn){
		closeClassDetailsOverlayBtn.addEventListener('click', () => {

			closeClassDetailsOverlay();
			
		});
	}else{
		console.error("Error: Unable to load close class details overlay button.");
	}







	const qrContainer = document.getElementById('qrContainer');
	if (qrContainer && typeof kjua === 'function') {
		qrContainer.innerHTML = '';

		// Build compact payload with short keys to reduce size
		const payload = {
			name: studentData.full_name,
			facultyNumber: studentData.faculty_number,
			email: studentData.email
		};

		// remove empty fields
		Object.keys(payload).forEach(k => { if (!payload[k]) delete payload[k]; });

		let qrData = JSON.stringify(payload);

			let kjuaData = kjua({
					render: 'svg',
					text: qrData,
					size: 256,
					quiet: 2,
					level: 'L'
			});
		
		if (kjuaData) {
			// Ensure the QR code is responsive and cannot exceed container bounds
			kjuaData.style.maxWidth = '100%';
			kjuaData.style.height = 'auto';
			
			// Create a flex context so it sits neatly in the page flow
			qrContainer.style.display = 'flex';
			qrContainer.style.justifyContent = 'center';
			qrContainer.style.position = 'relative';
			qrContainer.style.zIndex = '1'; // Force below chat overlays

			qrContainer.appendChild(kjuaData);
		} else {
			displayErrorInQRContainer(qrContainer, 'Unable to generate QR code');
		}

	} else if (qrContainer) {
		displayErrorInQRContainer(qrContainer, 'QR library not loaded');
	}

	revealPage();

});

function displayErrorInQRContainer(qrContainer, message) {
	qrContainer.innerHTML = '';
	var errorParagraph = document.createElement('p');
	errorParagraph.style.color = 'red';
	errorParagraph.textContent = message;
	qrContainer.appendChild(errorParagraph);
}






// View Classes Overlay function =================================

function openViewClassesOverlay() {


	const overlay = document.getElementById('view-classes-overlay');
	const overlayBackground = document.querySelector('.overlay-background');

	overlay.style.display = 'block';
	overlayBackground.style.visibility = 'visible';

}

function closeViewClassesOverlay() {
	const overlay = document.getElementById('view-classes-overlay');
	const overlayBackground = document.querySelector('.overlay-background');

	overlay.style.display = 'none';
	overlayBackground.style.visibility = 'hidden';
}

async function loadClassesForStudent(studentData) {


	const classesList = document.getElementById('classesList');
	classesList.innerHTML = ''; // Clear previous list

	let classNames = [];

	const studentId = studentData?.id || studentData?.student_id || null;
	const facultyNumber = studentData?.faculty_number || studentData?.facultyNumber || null;
	const requestUrls = [];
	if (studentId) {
		requestUrls.push(SERVER_BASE_URL + ENDPOINTS.getStudentClasses + `?student_id=${encodeURIComponent(studentId)}`);
	}
	if (facultyNumber) {
		requestUrls.push(SERVER_BASE_URL + ENDPOINTS.getStudentClasses + `?faculty_number=${encodeURIComponent(facultyNumber)}`);
	}
	if (requestUrls.length === 0) {
		classesList.innerHTML = '<p class="no-classes-message">Unable to load classes. Missing student identifier.</p>';
		return;
	}
	try {
		let response = null;
		for (const url of requestUrls) {
			const attempt = await fetch(url, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});
			if (attempt.ok) {
				response = attempt;
				break;
			}
			response = attempt;
		}


		if (response && response.ok) {
			const data = await response.json();


			classNames = Array.isArray(data?.class_names) ? data.class_names : [];

			if(classNames.length > 0){

				classNames.forEach((className) => {
					const classItem = document.createElement('li');
					classItem.className = 'class-list-item';

					const btn = document.createElement('button');
					btn.className = 'class-button';
    				btn.textContent = className;
				
					btn.addEventListener('click', () => {

						openClassDetailsOverlay(className, studentId, studentData.faculty_number);

					});

					classItem.appendChild(btn);

					classesList.appendChild(classItem);
				});


			}else{
				classesList.innerHTML = '<p class="no-classes-message">You\'re not added to any class yet.</p>';
			}
			
		} else if (response && (response.status === 400 || response.status === 404)) {
			// Gracefully handle missing student_id / no classes
			classesList.innerHTML = '<p class="no-classes-message">You\'re not added to any class yet.</p>';
		} else {
			console.error("Error fetching classes:", response.status, response.statusText);
			classesList.innerHTML = '<p class="no-classes-message">Unable to load classes right now. Please try again.</p>';
		}
	} catch (e) {
		console.error("Error fetching classes:", e);
		classesList.innerHTML = '<p class="no-classes-message">Network error while loading classes. Please try again.</p>';
	}

}

// End of View Classes Overlay function ==========================




// Class Details Overlay functions ===============================

function openClassDetailsOverlay(className, studentId, facultyNumber) {
	closeViewClassesOverlay();

	const overlay = document.getElementById('class-details-overlay');
	const background = document.querySelector('.overlay-background');

	overlay.style.display = 'block';
	background.style.visibility = 'visible';
	
	const classTitle = document.getElementById('classDetailsOverlayTitle');
	if (classTitle) classTitle.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('class_details') : 'Class Details';
	const classNameEl = document.getElementById('classDetailsOverlayClassName');
	if (classNameEl) classNameEl.textContent = className || '';

	loadAttendedClassesCount(className, studentId, facultyNumber);

}

function closeClassDetailsOverlay(){
	const overlay = document.getElementById('class-details-overlay');
	const background = document.querySelector('.overlay-background');

	overlay.style.display = 'none';
	background.style.visibility = 'hidden';

	openViewClassesOverlay();

}

async function loadAttendedClassesCount(className, studentId, facultyNumber){
	let classMeta = null;
	try {
		classMeta = await getClassMetaByName(className);
	} catch (e) {
		console.error('[ClassDetails] loadAttendedClassesCount:getClassMetaByName failed', e);
	}
	const classId = classMeta?.class_id ?? classMeta?.id ?? null;
	let total_completed_classes_count = classMeta?.completed_classes_count
		?? classMeta?.total_completed_classes_count
		?? null;
	const normalizeCount = (value) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
	};
	total_completed_classes_count = normalizeCount(total_completed_classes_count);

	if (!classId) {
		console.error("Error resolving class ID for class:", className);
		console.error('[ClassDetails] loadAttendedClassesCount:abort_missing_classId');
		const attendanceCountElement = document.getElementById('attendedClassesCount');
		const totalClassesCountElement = document.getElementById('totalClassesCount');
		if (attendanceCountElement) attendanceCountElement.textContent = '0';
		if (totalClassesCountElement) totalClassesCountElement.textContent = '0';
		return;
	}

	// Always prefer authoritative class-record value when available.
	// Metadata endpoint may return stale/derived counters.
	const classRecordCompletedCount = await fetchCompletedClassesCountFromClassRecord(classId);
	if (classRecordCompletedCount !== null && classRecordCompletedCount !== undefined) {
		total_completed_classes_count = normalizeCount(classRecordCompletedCount);
	}
	const summaryUrl = SERVER_BASE_URL + ENDPOINTS.classAttendanceSummary(classId);
	let response = null;
	try {
		response = await fetch(summaryUrl, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (e) {
		console.error('[ClassDetails] summary request failed', e);
		const attendanceCountElement = document.getElementById('attendedClassesCount');
		const totalClassesCountElement = document.getElementById('totalClassesCount');
		if (attendanceCountElement) attendanceCountElement.textContent = '0';
		if (totalClassesCountElement) totalClassesCountElement.textContent = String(total_completed_classes_count ?? 0);
		return;
	}
	if(response.ok){
		
		const data = await response.json();

		const list = data.attendances || data.items || data.summary || data.attendance_summary || data.records || [];
		const studentKey = String(studentId || '').trim();
		const facultyKey = String(facultyNumber || '').trim();
		let attendance_count = 0;

		if (Array.isArray(list)) {
			const row = list.find((item) => {
				const id = String(item?.student_id ?? item?.studentId ?? item?.id ?? '').trim();
				const fac = String(item?.faculty_number ?? item?.facultyNumber ?? '').trim();
				return (studentKey && id === studentKey) || (facultyKey && fac === facultyKey);
			});
			if (row) {
				const countVal = Number(row.count ?? row.attendance_count ?? row.attended_classes_count ?? 0);
				attendance_count = Number.isFinite(countVal) ? countVal : 0;
			}
		}

		// Derive class total from summary rows when class-level counter is missing/stale.
		let derivedTotalFromRows = null;
		if (Array.isArray(list) && list.length > 0) {
			const maxFromRows = list.reduce((max, item) => {
				const val = Number(item?.count ?? item?.attendance_count ?? item?.attended_classes_count ?? 0);
				return Number.isFinite(val) && val > max ? val : max;
			}, 0);
			derivedTotalFromRows = Number.isFinite(maxFromRows) ? maxFromRows : null;
		}

		// Only fallback to summary-level aggregate if class-record value is unavailable.
		if (total_completed_classes_count === null || total_completed_classes_count === undefined || total_completed_classes_count === 0) {
			total_completed_classes_count = data.total_completed_classes_count
				?? data.total_classes_count
				?? data.total_completed
				?? data.total
				?? data.total_started_classes_count
				?? data.started_classes_count
				?? data.total_sessions
				?? data.total_sessions_count
				?? data.completed_classes_count
				?? derivedTotalFromRows
				?? 0;
		}
		total_completed_classes_count = normalizeCount(total_completed_classes_count) ?? 0;
		// Sanity floor: total classes cannot be lower than this student's attended classes.
		if (total_completed_classes_count < attendance_count) {
			total_completed_classes_count = attendance_count;
		}

		const attendanceCountElement = document.getElementById('attendedClassesCount');
		const totalClassesCountElement = document.getElementById('totalClassesCount'); 

		if (attendanceCountElement) attendanceCountElement.textContent = attendance_count;
		if (totalClassesCountElement) {
			totalClassesCountElement.textContent = total_completed_classes_count ?? 0;
		}

	}else{
		console.error("Error fetching attendance count:", response.status, response.statusText);
		console.error('[ClassDetails] loadAttendedClassesCount:summary_fetch:failed', {
			status: response.status,
			statusText: response.statusText
		});
	}

}

// End of Class Details Overlay functions ========================

async function getClassMetaByName(className){
	const url = SERVER_BASE_URL + ENDPOINTS.getClassIdByName + `?class_name=${encodeURIComponent(className)}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});
	if(response.ok){
		const payload = await response.json();
		return payload;
	}
	console.warn('[ClassDetails] getClassMetaByName:failed', { className });
	return null;
}

async function fetchCompletedClassesCountFromClassRecord(classId) {
	const id = encodeURIComponent(classId);
	const attempts = [
		`${SERVER_BASE_URL + ENDPOINTS.createClass}?class_id=${id}`
	];
	for (const url of attempts) {
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: { 'Content-Type': 'application/json' }
			});
			if (!response.ok) continue;
			const data = await response.json();
			const record = Array.isArray(data)
				? data[0]
				: (
					data?.class
					|| (Array.isArray(data?.classes) ? data.classes[0] : null)
					|| (Array.isArray(data?.rows) ? data.rows[0] : null)
					|| (Array.isArray(data?.items) ? data.items[0] : null)
					|| (Array.isArray(data?.data) ? data.data[0] : data?.data)
					|| data
				);
			const value = record?.completed_classes_count;
			if (value !== null && value !== undefined) {
				const parsed = Number(value);
				return Number.isFinite(parsed) ? parsed : 0;
			}
		} catch (_) {}
	}

	console.warn('[ClassDetails] fetchCompletedClassesCountFromClassRecord:not_found', { classId });
	return null;
}

async function getClassIdByName(className){
	const classMeta = await getClassMetaByName(className);
	return classMeta?.class_id ?? classMeta?.id ?? null;
}
