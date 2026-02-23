const serverBaseUrl = 'https://studentcheck-server.onrender.com';
const ENDPOINTS = {
        getStudentClasses: '/get_student_classes',
		getStudentClassesNamesbyIds: '/get_classes_names_by_ids',
		getClassAttendanceSummary: '/attendance/summary',
		getClassIdByName: '/get_class_id_by_name',
	};


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
			window.location.replace('studentLogin.html');
			return;
		}

		parsedData = JSON.parse(rawData);
		studentData = parsedData.data.student;

	}catch(e){
		console.error("Error during extracting data.", e);
		revealPage();
		return;
	}

	if (!studentData) {
		console.error("No student data found in sessionStorage.");
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
	const displayName = studentData.full_name || "Error: No Name Found";
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

			sessionStorage.removeItem('studentData');
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

	var response = await fetch(serverBaseUrl + ENDPOINTS.getStudentClasses + `?student_id=${studentData.id}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});


	if (response.ok) {
		const data = await response.json();


		classNames = data.class_names;

		if(classNames.length > 0){

			classNames.forEach((className) => {
				const classItem = document.createElement('li');
				classItem.className = 'class-list-item';

				const btn = document.createElement('button');
				btn.className = 'class-button';
    			btn.textContent = className;
				
				btn.addEventListener('click', () => {

					openClassDetailsOverlay(className, studentData.id, studentData.faculty_number);

				});

				classItem.appendChild(btn);

				classesList.appendChild(classItem);
			});


		}else{
			classesList.innerHTML = '<p class="no-classes-message">No classes found.</p>';
		}
		
	}else{
		console.error("Error fetching classes:", response.status, response.statusText);
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
	if (classTitle) classTitle.textContent = 'Class Details';
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


	const classId = await getClassIdByName(className);

	const response = await fetch(serverBaseUrl + ENDPOINTS.getClassAttendanceSummary + `?class_id=${encodeURIComponent(classId)}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});

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

		let total_completed_classes_count = data.total_completed_classes_count
			?? data.total_classes_count
			?? data.total_completed
			?? data.total
			?? data.total_started_classes_count
			?? data.started_classes_count
			?? data.total_sessions
			?? data.total_sessions_count
			?? data.completed_classes_count
			?? null;

		// Fallback: infer class total from attendance rows when aggregate field is missing.
		// Typical summaries include per-student count; class total is the max count value.
		if (total_completed_classes_count === null && Array.isArray(list) && list.length > 0) {
			const maxCount = list.reduce((max, item) => {
				const rowCount = Number(
					item?.count
					?? item?.attendance_count
					?? item?.attended_classes_count
					?? item?.completed_classes_count
					?? 0
				);
				return Number.isFinite(rowCount) ? Math.max(max, rowCount) : max;
			}, 0);
			total_completed_classes_count = maxCount;
		}

		const attendanceCountElement = document.getElementById('attendedClassesCount');
		const totalClassesCountElement = document.getElementById('totalClassesCount'); 

		if (attendanceCountElement) attendanceCountElement.textContent = attendance_count;
		if (totalClassesCountElement) {
			totalClassesCountElement.textContent = total_completed_classes_count ?? 0;
		}

	}else{
		console.error("Error fetching attendance count:", response.status, response.statusText);
	}

}

// End of Class Details Overlay functions ========================

async function getClassIdByName(className){
	const response = await fetch(serverBaseUrl + ENDPOINTS.getClassIdByName + `?class_name=${encodeURIComponent(className)}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});

	if(response.ok){
		const data = await response.json();
		

		return data.class_id;
	}
}




