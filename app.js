// ==========================================================
// College Attendance Management System - Main App Controller
// ==========================================================

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
window.addEventListener('faceauth-storage-error', () => toast('Could not save changes to browser storage. Check available storage and try again.', 'danger'));

function getClassSectionLabel(cls) {
  if (!cls) return '';
  return String(cls.label || `${cls.department || ''}-${cls.section || ''}`).trim();
}

function getStudentSectionLabel(student) {
  if (!student) return '';
  const section = String(student.section || '').trim();
  if (!section) return '—';
  if (section.toLowerCase() === 'unassigned') return 'Unassigned';
  const context = getVisibleStudentContext(student);
  if (!student.department && context.sectionClass) return getClassSectionLabel(context.sectionClass);
  const knownLabel = getMyClasses().find(cls =>
    String(cls.department || '').toLowerCase() === String(student.department || '').toLowerCase() &&
    (!cls.year || !student.year || cls.year === student.year) &&
    getClassSectionLabel(cls).toLowerCase() === section.toLowerCase()
  );
  if (knownLabel) return getClassSectionLabel(knownLabel);
  const linkedClass = getMyClasses().find(cls =>
    String(cls.department || '').toLowerCase() === String(student.department || '').toLowerCase() &&
    (!cls.year || !student.year || cls.year === student.year) &&
    (cls.studentIds || []).some(id => String(id) === String(student.id))
  );
  if (linkedClass) return getClassSectionLabel(linkedClass);

  return section.toLowerCase().startsWith(String(student.department || '').toLowerCase())
    ? section
    : 'Unassigned';
}

function getVisibleStudentContext(student) {
  const sectionClass = getTermClasses().find(cls => (cls.studentIds || []).map(String).includes(String(student?.id))) ||
    getTermClasses().find(cls => String(cls.section || cls.label || '').toLowerCase() === String(student?.section || '').toLowerCase());
  return { department: student?.department || sectionClass?.department || '', year: student?.year || sectionClass?.year || '', sectionClass };
}

// Application Global State
let currentTeacher = null;
let activeSession = null;
let activeAttendanceMode = 'camera';
let cameraConsentResolver = null;
let cameraConsentRequest = null;
let liveStream = null;
let liveLoop = null;
let regStream = null;
let regCaptures = [];
let editFaceStream = null;
let editFaceCaptures = [];
let uploadedProfilePhoto = '';
let facultyIdCard = null;
let cropSourceImage = null;
let cropZoom = 1;
let cropPan = { x: 0, y: 0 };
let cropDragPoint = null;
let soundEnabled = true;
let selectedClassForRoster = null;
let selectedClassForReport = null;
let selectedStudentForEdit = null;
const studentDirectoryState = { department: '', year: '', section: '', search: '', quick: 'all', selectedOnly: false, page: 1, pageSize: 25, sort: 'default', direction: 'asc', group: false, groupDepartmentYear: true, selected: new Set(), allMatching: false, lastSelectedIndex: null, longPressTimer: null };
let studentDirectoryMatchingIds = [];
let studentDirectoryPageIds = [];
let studentDirectoryReady = false;
let studentEditDrawerId = null;
let studentEditDrawerReturnFocus = null;
let studentEditOriginalValues = null;
let studentEditDirty = false;
let studentEditSaveKeepOpen = false;
let studentImportPreviewRows = [];
let studentImportErrors = [];
let studentDirectoryBulkRunning = false;
let studentDirectoryStorageError = false;
let registrationClassId = null;
let pendingSetupClassId = null;
let activeReportFilter = 'all';
let activeReportRange = { min: null, max: null };
let reportFiltersInitialized = false;
const appViewHistory = [];

// Audio Synthesizer (Web Audio API)
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function playChime() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    // Pleasant dual-tone academic chime
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.18); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880.00, now);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.18); // D6

    gainNode.gain.setValueAtTime(0.18, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  } catch (e) {
    console.warn('Audio chime unavailable:', e);
  }
}

// Toast Notifications
function toast(message, tone = 'ok') {
  const t = $('#toast');
  if (!t) return;
  const icon = tone === 'danger' ? '⚠️' : tone === 'warn' ? '🔔' : '✅';
  const item = document.createElement('div');
  item.className = `toast-item ${tone}`;
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = icon;
  const text = document.createElement('span');
  text.textContent = String(message ?? '');
  item.append(mark, text);
  t.append(item);
  t.hidden = false;
  setTimeout(() => { item.remove(); if (!t.children.length) t.hidden = true; }, 3200);
}

// View Routing
function show(viewName, { recordHistory = true } = {}) {
  if (viewName === 'faculty' && !isFacultyHod()) { toast('Faculty role management is available to HOD accounts.', 'warn'); viewName = 'dashboard'; }
  if (['register', 'student-edit'].includes(viewName) && !isFacultyHod()) { toast('Student profile management is available to HOD accounts.', 'warn'); viewName = 'students'; }
  const currentView = $$('.view.active').find(view => view.id.startsWith('v-') && view.id !== 'v-login');
  const currentName = currentView?.id.slice(2);
  if (currentName === 'live' && viewName !== 'live' && activeSession) {
    if (!confirm('Leave this attendance session? Its unsubmitted attendance will be lost.')) return false;
    activeSession = null;
  }
  if (recordHistory && currentName && currentName !== viewName) appViewHistory.push(currentName);

  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $('#v-' + viewName);
  if (target) target.classList.add('active');

  $$('.sidebar-nav .nav-item').forEach(a => {
    a.classList.toggle('on', a.dataset.nav === viewName || (viewName === 'live' && a.dataset.nav === 'setup'));
  });

  if (viewName !== 'live') stopLiveCamera();
  if (viewName !== 'register') stopRegCamera();

  const renderers = {
    dashboard: renderDashboard,
    students: renderStudents,
    'student-edit': renderStudentDirectory,
    register: renderStudentRegistration,
    'class-roster': renderClassRoster,
    setup: renderSetup,
    history: renderHistory,
    reports: renderReports,
    settings: renderSettings,
    subjects: renderSubjects,
    'audit-log': renderAuditLog
    ,faculty: renderFaculty
    ,defaulters: renderDefaulters
  };

  if (renderers[viewName]) renderers[viewName]();
  syncAppBackButtons();
  if (location.hash !== `#${viewName}`) history.pushState(null, '', `#${viewName}`);
  return true;
}

function applyMinLimitLabels() {
  document.querySelectorAll('[data-min-limit]').forEach(node => { node.textContent = String(getMinAttendance()); });
  document.querySelectorAll('[data-warning-limit]').forEach(node => { node.textContent = String(getWarningThreshold()); });
}

const showBeforeLimitLabels = show;
function showWithMinLimitLabels(...args) {
  const result = showBeforeLimitLabels(...args);
  applyMinLimitLabels();
  return result;
}
show = showWithMinLimitLabels;
window.addEventListener('DOMContentLoaded', applyMinLimitLabels);

window.addEventListener('hashchange', () => {
  const viewName = location.hash.slice(1);
  if ($('#shell').hidden || !$('#v-' + viewName)) return;
  show(viewName, { recordHistory: false });
});

function syncAppBackButtons() {
  $$('[data-app-back]').forEach(button => {
    button.disabled = appViewHistory.length === 0;
    button.title = button.disabled ? 'You are at the first page.' : 'Return to the previous page.';
  });
}

function goBackInApp() {
  const previous = appViewHistory[appViewHistory.length - 1] || 'dashboard';
  if (show(previous, { recordHistory: false }) && appViewHistory.length) appViewHistory.pop();
  syncAppBackButtons();
}

$$('[data-app-back]').forEach(button => button.addEventListener('click', goBackInApp));

// Camera Management
function requestCameraConsent() {
  if (cameraConsentRequest) return cameraConsentRequest;
  const dialog = $('#camera-consent-dialog');
  cameraConsentRequest = new Promise(resolve => {
    cameraConsentResolver = resolve;
    dialog.showModal();
  }).finally(() => { cameraConsentRequest = null; });
  return cameraConsentRequest;
}

$('#camera-consent-allow').onclick = () => $('#camera-consent-dialog').close('allow');
$('#camera-consent-cancel').onclick = () => $('#camera-consent-dialog').close('cancel');
$('#camera-consent-dialog').addEventListener('close', () => {
  if (!cameraConsentResolver) return;
  const resolve = cameraConsentResolver;
  cameraConsentResolver = null;
  resolve($('#camera-consent-dialog').returnValue === 'allow');
});

async function startCamera(videoElement) {
  const consented = await requestCameraConsent();
  if (!consented) return null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' }
    });
    videoElement.srcObject = stream;
    return stream;
  } catch (err) {
    const message = err.name === 'NotAllowedError' || err.name === 'SecurityError'
      ? 'Camera permission was denied. Allow camera access in your browser settings, then select Start Camera.'
      : 'No available camera was found. Connect a camera, then select Start Camera.';
    toast(message, 'warn');
    return null;
  }
}

function stopLiveCamera() {
  if (liveLoop) { clearInterval(liveLoop); liveLoop = null; }
  if (liveStream) {
    liveStream.getTracks().forEach(t => t.stop());
    liveStream = null;
  }
  const video = $('#live-video');
  if (video) video.srcObject = null;
  const offOverlay = $('#cam-off');
  if (offOverlay) offOverlay.hidden = false;
  const toggleBtn = $('#cam-toggle');
  if (toggleBtn) toggleBtn.textContent = '🎥 Start Camera';
}

function stopRegCamera() {
  if (regStream) {
    regStream.getTracks().forEach(t => t.stop());
    regStream = null;
  }
  const video = $('#reg-video');
  if (video) video.srcObject = null;
  const off = $('#reg-cam-off');
  if (off) off.hidden = false;
  const btn = $('#reg-cam');
  if (btn) btn.textContent = '🎥 Start Camera';
  updateCaptureControls();
}

function captureFrameBlob(videoElement) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, 'image/jpeg', 0.9);
  });
}

// ==========================================================
// 1. AUTHENTICATION & FACULTY PORTAL LOGIN
// ==========================================================
async function enterFacultyPortal(teacher) {
  teacher = DB.teachers.find(item => String(item.id) === String(teacher?.id));
  if (!teacher) return;
  appViewHistory.length = 0;
  selectedClassForRoster = null;
  selectedClassForReport = null;
  activeSession = null;
  reportFiltersInitialized = false;
  if (studentDirectoryState?.selected) studentDirectoryState.selected.clear();
  const termChange = DB.syncActiveTermByDate();
  if (termChange) DB.pendingTermActivation = termChange;
  if (DB.pendingTermActivation) {
    const changed = DB.pendingTermActivation; DB.pendingTermActivation = null;
    DB.selectedTermId = DB.selectedTermId && DB.terms.some(term => term.id === DB.selectedTermId) ? DB.selectedTermId : changed.term.id;
    DB.save();
    toast(`Semester ${changed.term.semester} is now active.`);
    promptCarryForwardTerm(changed.previous, changed.term);
  }
  currentTeacher = teacher;
  DB.teacher = teacher;
  DB.save();

  $('#t-name').textContent = teacher.name;
  $('#t-role').textContent = `${teacher.designation || 'Faculty'} · ${teacher.department || 'CSE'}`;
  $('#faculty-nav').hidden = !isFacultyHod(teacher);
  $('#hod-subject-summary').hidden = !isFacultyHod(teacher);
  const initials = teacher.name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase();
  $('#t-avatar').textContent = initials || 'TC';

  $('#v-login').classList.remove('active');
  $('#shell').hidden = false;
  show('dashboard');
  toast(`Welcome back, ${teacher.name}`);
}

function promptCarryForwardTerm(previous, next) {
  if (!previous || !next || !confirm('Carry forward sections and subjects from the previous term?')) return;
  const visibleClassIds = new Set(getMyClasses().filter(cls => String(cls.termId || '') === String(previous.id)).map(cls => String(cls.id)));
  const oldClasses = DB.classes.filter(cls => visibleClassIds.has(String(cls.id)));
  const visibleSubjectIds = new Set(oldClasses.map(cls => String(cls.subjectId || '')).filter(Boolean));
  const oldSubjects = DB.subjects.filter(subject => visibleSubjectIds.has(String(subject.id)) && String(subject.termId || '') === String(previous.id));
  const subjectIds = new Map();
  oldSubjects.forEach(subject => {
    const copy = { ...JSON.parse(JSON.stringify(subject)), id: `subject-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, termId: next.id, facultyId: '' };
    subjectIds.set(String(subject.id), copy.id); DB.subjects.push(copy);
  });
  oldClasses.forEach(cls => {
    const copy = { ...JSON.parse(JSON.stringify(cls)), id: `class-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, termId: next.id };
    copy.subjectId = subjectIds.get(String(cls.subjectId || '')) || '';
    DB.classes.push(copy);
  });
  [...subjectIds.values()].forEach(syncSubjectFaculty);
  DB.save();
}

async function executeFacultyLogin(id, password) {
  const errBox = $('#l-err');
  if (errBox) errBox.hidden = true;

  const btn = $('#l-btn');
  const demoBtn = $('#quick-demo-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying credentials...'; }
  if (demoBtn) { demoBtn.disabled = true; demoBtn.textContent = 'Logging in as Professor...'; }

  const res = await FaceAPI.login(id, password);

  if (btn) { btn.disabled = false; btn.textContent = 'Sign In to Faculty Portal'; }
  if (demoBtn) demoBtn.disabled = false;
  renderDemoLoginLabel();

  if (!res.ok) {
    if (errBox) {
      errBox.textContent = res.error || 'Authentication failed.';
      errBox.hidden = false;
    }
    toast(res.error || 'Authentication failed', 'danger');
    return;
  }

  await enterFacultyPortal(res.teacher);
}

function renderDemoLoginLabel() {
  const button = $('#quick-demo-btn');
  const teacher = DB.teachers.find(item => item.role === 'hod' && String(item.department || '').trim().toUpperCase() === 'CSE') || DB.teachers.find(item => item.role === 'hod');
  if (!button || !teacher) return;
  button.innerHTML = `<span class="demo-bolt">⚡</span><div class="demo-btn-text"><b>1-Click ${escapeHtml(teacher.department || '')} HOD Demo Login (${escapeHtml(teacher.name || 'HOD')})</b><small>Teacher ID: ${escapeHtml(teacher.id)} · ${escapeHtml(teacher.designation || 'HOD')}</small></div>`;
}

// Wire direct button and form click handlers
if ($('#quick-demo-btn')) {
  $('#quick-demo-btn').hidden = window.FACEAUTH_ENABLE_DEMO === false;
  renderDemoLoginLabel();
  $('#quick-demo-btn').onclick = async () => {
    const res = await FaceAPI.demoLogin();
    if (res.ok) await enterFacultyPortal(res.teacher);
    else toast(res.error || 'Demo login unavailable', 'danger');
  };
}

if ($('#l-btn')) {
  $('#l-btn').onclick = () => {
    const id = $('#l-id').value.trim();
    const pw = $('#l-pw').value;
    executeFacultyLogin(id, pw);
  };
}

$('#login-form').onsubmit = e => {
  e.preventDefault();
  const id = $('#l-id').value.trim();
  const pw = $('#l-pw').value;
  executeFacultyLogin(id, pw);
};

$('#show-signup').onclick = () => {
  $('#login-box').hidden = true;
  $('#signup-box').hidden = false;
};

$('#show-login').onclick = () => {
  $('#signup-box').hidden = true;
  $('#login-box').hidden = false;
};

$('#su-id-card').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  const preview = $('#su-id-card-preview');
  const image = $('#su-id-card-image');
  if (!file) { facultyIdCard = null; preview.hidden = true; return; }
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
    event.target.value = '';
    facultyIdCard = null;
    preview.hidden = true;
    toast('Choose a JPG, PNG, or PDF faculty ID card.', 'warn');
    return;
  }
  if (file.size > 1024 * 1024) {
    event.target.value = '';
    facultyIdCard = null;
    preview.hidden = true;
    toast('Faculty ID card must be 1 MB or smaller.', 'warn');
    return;
  }

  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
    facultyIdCard = { name: file.name, type: file.type, data };
    $('#su-id-card-name').textContent = file.name;
    image.hidden = file.type === 'application/pdf';
    if (!image.hidden) image.src = data;
    preview.hidden = false;
  } catch {
    event.target.value = '';
    facultyIdCard = null;
    preview.hidden = true;
    toast('Could not read the faculty ID card. Try another file.', 'danger');
  }
});

$('#su-id-card-remove').onclick = () => {
  facultyIdCard = null;
  $('#su-id-card').value = '';
  $('#su-id-card-preview').hidden = true;
  $('#su-id-card-image').removeAttribute('src');
};

$('#signup-form').addEventListener('reset', () => {
  facultyIdCard = null;
  $('#su-msg').textContent = '';
  $('#su-msg').hidden = true;
  $('#su-id-card-preview').hidden = true;
  $('#su-id-card-image').hidden = true;
  $('#su-id-card-image').removeAttribute('src');
  $('#su-id-card-name').textContent = '';
});

$('#signup-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('#su-name').value.trim();
  const email = $('#su-email').value.trim();
  const dept = $('#su-dept').value;
  const designation = $('#su-desig').value.trim();
  const pw = $('#su-pw').value;
  const confirmPw = $('#su-confirm').value;
  const msgBox = $('#su-msg');
  msgBox.hidden = true;

  if (pw !== confirmPw) {
    msgBox.textContent = 'Passwords do not match.';
    msgBox.hidden = false;
    return;
  }

  const res = await FaceAPI.registerTeacher({ name, email, department: dept, designation, role: 'faculty', password: pw, facultyIdCard });
  if (!res.ok) {
    msgBox.textContent = res.error || 'Registration failed.';
    msgBox.hidden = false;
    return;
  }

  toast(`Faculty account created! Your Teacher ID is ${res.teacher.id}`);
  facultyIdCard = null;
  $('#su-id-card').value = '';
  $('#su-id-card-preview').hidden = true;
  $('#su-id-card-image').removeAttribute('src');
  await enterFacultyPortal(res.teacher);
};

$('#logout').onclick = async () => {
  await FaceAPI.logout();
  appViewHistory.length = 0;
  stopLiveCamera();
  stopRegCamera();
  activeSession = null;
  selectedClassForRoster = null;
  selectedClassForReport = null;
  if (studentDirectoryState?.selected) studentDirectoryState.selected.clear();
  currentTeacher = null;
  $('#shell').hidden = true;
  $('#v-login').classList.add('active');
  toast('Signed out successfully');
};

$('#btn-reset-demo').onclick = () => {
  if (confirm('Reset all classes, students, and attendance records back to the initial university demo dataset?')) {
    DB.resetToDemo();
    toast('Dataset reset to official demo state');
    show('dashboard');
  }
};

$$('.sidebar-nav .nav-item').forEach(btn => {
  btn.onclick = event => {
    event.preventDefault();
    show(btn.dataset.nav);
  };
});

// Sound Chime Toggle
$('#audio-toggle').onclick = () => {
  soundEnabled = !soundEnabled;
  $('#audio-toggle').textContent = soundEnabled ? '🔊' : '🔇';
  toast(soundEnabled ? 'Audio Chime Enabled' : 'Audio Chime Muted');
};

const applyTheme = dark => {
  document.body.classList.toggle('dark-theme', dark);
  localStorage.setItem('faceauth-dark-mode', dark ? '1' : '0');
};
$('#theme-toggle').onclick = () => applyTheme(!document.body.classList.contains('dark-theme'));
applyTheme(localStorage.getItem('faceauth-dark-mode') === '1');

// ==========================================================
// 2. DASHBOARD VIEW CONTROLLER
// ==========================================================
function renderDashboard() {
  renderGlobalTermSelector();
  const teacher = DB.teacher;
  const hr = new Date().getHours();
  const timeGreeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  $('#greet').textContent = `${timeGreeting}, ${teacher.name}`;

  const now = new Date();
  $('#current-date-time').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  // Calculate Overall College Metrics
  const termStudents = getTermStudents();
  const totalStudents = termStudents.length;
  const totalSections = getSectionGroups().length;
  const departmentNames = new Set([
    ...getTermClasses().map(item => item.department),
    ...termStudents.map(item => item.department)
  ].map(name => String(name || '').trim().toUpperCase()).filter(Boolean));
  const totalSessions = getVisibleHistory().length;

  let totalPresentCount = 0;
  let totalStudentSessions = 0;
  let defaultersCount = 0;

  termStudents.forEach(student => {
    const stats = calculateVisibleAttendance(student.id);
    if (stats.total > 0) {
      totalPresentCount += stats.attended;
      totalStudentSessions += stats.total;
    }
    if (stats.status === 'warning' || stats.status === 'critical') {
      defaultersCount++;
    }
  });

  const overallPercent = totalStudentSessions > 0
    ? `${Math.round((totalPresentCount / totalStudentSessions) * 100)}%`
    : '—';
  const facultyClasses = isFacultyHod() ? [] : getTermClasses();
  const facultySubjects = new Set(facultyClasses.filter(cls => cls.subjectId || cls.code || cls.subject).map(cls => String(cls.subjectId || cls.code || cls.subject).trim().toLowerCase()));

  $('#stats').innerHTML = `
    ${!isFacultyHod() ? `<div class="stat-tile"><b>${facultyClasses.length}</b><span>Assigned Classes</span></div><div class="stat-tile"><b>${facultySubjects.size}</b><span>Subjects Teaching</span></div>` : ''}
    <div class="stat-tile"><b>${departmentNames.size}</b><span>No. of Departments</span></div>
    <div class="stat-tile"><b>${totalSections}</b><span>No. of Sections</span></div>
    <div class="stat-tile"><b>${totalStudents}</b><span>Registered Students</span></div>
    <div class="stat-tile"><b>${totalSessions}</b><span>Conducted Lectures</span></div>
    <div class="stat-tile"><b>${overallPercent}</b><span>Average Attendance</span></div>
    <button class="stat-tile ${defaultersCount > 0 ? 'alert' : ''} stat-tile-button" id="dashboard-defaulters-tile" type="button"><b>${defaultersCount}</b><span>Defaulters (&lt;${getMinAttendance()}%)</span></button>
  `;
  $('#dashboard-defaulters-tile').onclick = () => show('defaulters');
  // Render Today's Classes
  renderTodaySchedule();

  // Render Recent Sessions
  renderRecentDashboardHistory();

  // Render Defaulters Summary Alert
  renderDashboardDefaulters(defaultersCount);
  renderRecognitionReviewQueue();
  renderHodSubjectSummary();
}

function renderHodSubjectSummary() {
  const body = $('#hod-subject-summary-body'); if (!body || !isFacultyHod()) return;
  const subjects = getTermSubjects();
  body.innerHTML = subjects.map(subject => {
    const classes = getTermClasses().filter(cls => String(cls.subjectId || '') === String(subject.id));
    const students = [...new Map(classes.flatMap(cls => getSectionStudents(cls)).map(student => [String(student.id), student])).values()];
    const owners = [...new Set(classes.map(item => String(item.teacherId || '')).filter(Boolean))].map(id => DB.teachers.find(item => String(item.id) === id)?.name).filter(Boolean);
    const stats = classes.flatMap(cls => getSectionStudents(cls).map(student => calculateSectionAttendance(student.id, cls))).filter(item => item.total > 0);
    const attended = stats.reduce((sum, item) => sum + item.attended, 0), total = stats.reduce((sum, item) => sum + item.total, 0);
    return `<tr><td>${escapeHtml(subject.code)} · ${escapeHtml(subject.name)}</td><td>${escapeHtml(owners.join(', ') || 'Unassigned')}</td><td>${students.length}</td><td>${total ? Math.round(attended / total * 100) + '%' : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No subjects for this term.</td></tr>';
}

function renderRecognitionReviewQueue() {
  const host = $('#recognition-review-queue'); if (!host) return;
  const queue = (DB.reviewQueue || []).filter(item => (activeSession && String(activeSession.id) === String(item.sessionId)) || getVisibleHistory().some(session => String(session.id) === String(item.sessionId)));
  host.innerHTML = queue.length ? queue.map(item => {
    const student = getVisibleStudents().find(person => String(person.id) === String(item.studentId));
    return `<article class="subject-master-row"><div><b>${escapeHtml(student?.name || 'Unknown student')}</b><p class="muted">${escapeHtml(student?.roll || '')} · Confidence ${Math.round(Number(item.score) * 100)}% · ${escapeHtml(item.at || '')}</p></div><div><button type="button" class="btn-xs" data-review-accept="${escapeHtml(item.id)}">Accept</button><button type="button" class="btn-xs" data-review-reject="${escapeHtml(item.id)}">Reject</button></div></article>`;
  }).join('') : '<p class="muted">No low-confidence matches need review.</p>';
}
$('#recognition-review-queue')?.addEventListener('click', event => {
  const accept = event.target.closest('[data-review-accept]')?.dataset.reviewAccept;
  const reject = event.target.closest('[data-review-reject]')?.dataset.reviewReject;
  const item = DB.reviewQueue.find(entry => entry.id === (accept || reject)); if (!item || (!activeSession || String(activeSession.id) !== String(item.sessionId)) && !getVisibleHistory().some(session => String(session.id) === String(item.sessionId))) return;
  if (accept) {
    const session = activeSession && String(activeSession.id) === String(item.sessionId) ? activeSession : null;
    if (session) session.present[item.studentId] = { status: 'present', method: 'reviewed face match', score: item.score, time: new Date().toLocaleTimeString() };
    else return toast('This review belongs to a session that is no longer open.');
  }
  DB.reviewQueue = DB.reviewQueue.filter(entry => entry.id !== item.id); DB.auditLog.push({ action: accept ? 'recognition approved' : 'recognition rejected', studentId: String(item.studentId), sessionId: String(item.sessionId), by: String(DB.teacher?.id || 'unknown'), at: new Date().toISOString(), reason: 'Low-confidence recognition review' }); DB.save(); renderRecognitionReviewQueue(); if (activeSession) renderLiveRoster();
});

function renderGlobalTermSelector() {
  const select = $('#global-term-select');
  if (!select) return;
  const active = DB.terms.find(term => term.status === 'active') || DB.terms[0];
  const current = DB.getCurrentTerm();
  if (!DB.terms.some(term => term.id === DB.selectedTermId)) DB.selectedTermId = current?.id || active?.id || '';
  select.innerHTML = DB.terms.map(term => {
    const label = term.id === active?.id ? 'Active' : term.startDate > localDateIso() ? 'Upcoming' : 'Past';
    return `<option value="${escapeHtml(term.id)}">${escapeHtml(term.academicYear)} · ${escapeHtml(term.semester)} · ${label}</option>`;
  }).join('');
  select.value = DB.selectedTermId;
  select.onchange = () => {
    DB.selectedTermId = select.value; DB.save();
    renderDashboard(); renderHistory(); renderReports(); renderDefaulters(); renderStudents();
  };
}
function localDateIso(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

function renderTodaySchedule() {
  const container = $('#today-classes');
  const scheduleButton = $('#schedule-class-btn');
  if (scheduleButton) scheduleButton.disabled = !getTermClasses().length;
  const assignments = getTermClasses();
  if (!assignments.length) {
    container.innerHTML = `<p class="muted">No sections yet. Add a department section, then schedule its lecture days and time.</p>`;
    return;
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayShort = dayNames[new Date().getDay()];
  const todayLong = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const dayBadge = $('#today-day-badge');
  if (dayBadge) dayBadge.textContent = `${todayLong} Timetable`;

  const scheduledToday = assignments.filter(cls => (cls.days || []).includes(todayShort));
  if (!scheduledToday.length) {
    container.innerHTML = `<p class="muted">No lectures scheduled for today. Use “Schedule Section” to add one.</p>`;
    return;
  }

  container.innerHTML = scheduledToday.map(cls => {
    const enrolledCount = getSectionStudents(cls).length;
    const daysStr = (cls.days || []).join(', ');

    return `
      <div class="schedule-card" style="border-left: 4px solid var(--emerald-600);">
        <div class="schedule-head">
          <div>
            <div style="display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.35rem;">
              <span class="badge ok">${cls.label}</span>
              <span class="badge" style="background: var(--canvas);">${daysStr}</span>
            </div>
            <div class="schedule-subject">${escapeHtml(cls.subject || 'Subject not assigned')} · ${cls.department} Department · ${cls.year}</div>
            <div class="schedule-meta">${cls.room || 'Room TBA'} · ${cls.time || 'Time TBA'}</div>
          </div>
          <span class="muted" style="font-size: 0.8rem; white-space: nowrap;">${enrolledCount} enrolled</span>
        </div>
        <div class="schedule-actions">
          <button class="btn btn-secondary btn-block" onclick="openClassRosterById('${cls.id}')">Student List</button>
          <button class="btn btn-secondary btn-block" onclick="openScheduleModal('${cls.id}')">Edit Schedule</button>
          <button class="btn primary btn-block" onclick="openAttendanceSetupForSection('${cls.id}')">⚡ Take Attendance</button>
        </div>
      </div>
    `;
  }).join('');
}

function fillScheduleEditor() {
  const cls = getTermClasses().find(item => String(item.id) === String($('#schedule-class-select').value));
  $$('input[name="schedule-day"]').forEach(input => {
    input.checked = Boolean(cls && (cls.days || []).includes(input.value));
  });
  $('#schedule-time').value = cls?.time || '';
  $('#schedule-room').value = cls?.room || '';
  $('#schedule-msg').hidden = true;
}

window.openScheduleModal = classId => {
  const select = $('#schedule-class-select');
  const assignments = getTermClasses();
  select.innerHTML = assignments.map(cls =>
    `<option value="${escapeHtml(cls.id)}">${escapeHtml(getClassSectionLabel(cls))} · ${escapeHtml(cls.department)} Department · ${escapeHtml(cls.year)} · ${escapeHtml(cls.subject || 'Choose subject')}</option>`
  ).join('');
  if (!assignments.length) return;
  const selected = assignments.find(cls => String(cls.id) === String(classId));
  if (classId && !selected) { toast('You do not have access to that section.', 'danger'); return; }
  select.value = String(selected?.id || assignments[0].id);
  fillScheduleEditor();
  $('#schedule-modal').showModal();
};

$('#schedule-class-btn').onclick = () => openScheduleModal();
$('#schedule-class-select').onchange = fillScheduleEditor;
$('#schedule-modal-close').onclick = () => $('#schedule-modal').close();
$('#schedule-cancel').onclick = () => $('#schedule-modal').close();

$('#schedule-form').onsubmit = async event => {
  event.preventDefault();
  const cls = getTermClasses().find(item => String(item.id) === String($('#schedule-class-select').value));
  if (!cls) return;
  const days = $$('input[name="schedule-day"]:checked').map(input => input.value);
  if (!days.length) {
    $('#schedule-msg').textContent = 'Select at least one day for this section.';
    $('#schedule-msg').hidden = false;
    return;
  }

  const result = await FaceAPI.updateClass(cls.id, {
    days,
    time: $('#schedule-time').value.trim(),
    room: $('#schedule-room').value.trim()
  });
  if (!result.ok) {
    $('#schedule-msg').textContent = result.error || 'Could not save this schedule.';
    $('#schedule-msg').hidden = false;
    return;
  }

  $('#schedule-modal').close();
  renderDashboard();
  renderSetup();
  toast(`${getClassSectionLabel(cls)} schedule saved.`);
};

$('#remove-class-schedule').onclick = async () => {
  const cls = getTermClasses().find(item => String(item.id) === String($('#schedule-class-select').value));
  if (!cls) return;
  const result = await FaceAPI.updateClass(cls.id, { days: [], time: '' });
  if (!result.ok) {
    $('#schedule-msg').textContent = result.error || 'Could not remove this schedule.';
    $('#schedule-msg').hidden = false;
    return;
  }
  $('#schedule-modal').close();
  renderDashboard();
  renderSetup();
  toast(`${getClassSectionLabel(cls)} removed from the schedule.`);
};

function renderRecentDashboardHistory() {
  const container = $('#dash-recent-history');
  const recent = getVisibleHistory().slice(0, 4);

  if (!recent.length) {
    container.innerHTML = `<p class="muted">No attendance sessions recorded yet.</p>`;
    return;
  }

  container.innerHTML = recent.map(h => {
    const total = (h.present || 0) + (h.absent || 0);
    const rate = total > 0 ? Math.round((h.present / total) * 100) : null;
    const badgeTone = rate === null ? '' : rate >= getMinAttendance() ? 'ok' : rate >= getWarningThreshold() ? 'warn' : 'danger';
    return `
      <div class="compact-history-item" onclick="openSessionModal('${h.id}')" style="cursor: pointer;">
        <div>
          <b>${h.subject}</b> (${h.section || h.classLabel})
          <div class="muted" style="font-size: 0.78rem;">${h.date} · ${h.time || ''} · ${h.present} Present, ${h.absent} Absent</div>
        </div>
        <span class="badge ${badgeTone}">${rate === null ? 'No data yet' : `${rate}%`}</span>
      </div>
    `;
  }).join('');
}

function renderDashboardDefaulters(defaultersCount) {
  const roster = getDefaulterRows(false).slice(0, 5);
  const container = $('#dash-defaulters-summary');
  if (defaultersCount === 0) {
    container.innerHTML = `
      <div class="card" style="background: var(--status-ok-bg); border-color: var(--status-ok-border);">
        <b style="color: var(--status-ok-text);">✅ All Students Compliant</b>
        <p class="muted" style="margin-top: 0.2rem; font-size: 0.82rem;">Every student currently meets or exceeds the minimum attendance threshold of ${getMinAttendance()}%.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="defaulter-banner">
      <b>⚠️ ${defaultersCount} Student${defaultersCount === 1 ? '' : 's'} on Defaulter Watch</b>
      <p style="margin: 0.35rem 0 0.7rem; font-size: 0.84rem; color: var(--text-main);">
        Students falling below ${getMinAttendance()}% attendance are at risk of detention under university academic guidelines.
      </p>
      <ol class="dash-defaulter-top">${roster.map(entry => `<li><button type="button" data-open-defaulter="${escapeHtml(entry.student.id)}">${escapeHtml(entry.student.name || 'Unnamed student')}</button><span>${entry.stats.percent}%</span></li>`).join('')}</ol>
      <button class="btn btn-secondary btn-xs" data-view-defaulters>View all &rarr;</button>
    </div>
  `;
  container.querySelector('[data-view-defaulters]').onclick = () => show('defaulters');
  container.querySelectorAll('[data-open-defaulter]').forEach(button => button.onclick = () => openStudentProfileById(button.dataset.openDefaulter));
}

const defaulterState = { sort: 'percent', direction: 'asc', selected: new Set(), subjectMode: false };
let visibleDefaulterRows = [];
function getDefaulterRows(subjectMode = defaulterState.subjectMode) {
  return getTermStudents().map(student => {
    const context = getVisibleStudentContext(student);
    const stats = calculateVisibleAttendance(student.id);
    const needed = calcAttendanceBuffer(stats.attended, stats.total, getMinAttendance(), getWarningThreshold());
    const subjects = getTermSubjects().filter(subject => {
      if (subject.department !== context.department || subject.year !== context.year) return false;
      const cls = getTermClasses().find(item => item.department === context.department && item.year === context.year && getClassSectionLabel(item) === getStudentSectionLabel(student) && (item.studentIds || []).map(String).includes(String(student.id)));
      if (!cls) return false;
      const sessions = getSectionSessions(cls).filter(session => filterSessionsBySubject([session], subject.id).length);
      const total = sessions.filter(session => (session.studentIds || []).map(String).includes(String(student.id))).length;
      const attended = sessions.filter(session => (session.presentIds || []).map(String).includes(String(student.id))).length;
      return total > 0 && attended / total * 100 < getMinAttendance();
    });
    return { student, context, stats, needed, subjects };
  }).filter(entry => defaulterState.subjectMode ? entry.subjects.length > 0 : entry.stats.percent !== null && entry.stats.percent < getMinAttendance());
}

function renderDefaulters() {
  const term = $('#def-filter-term');
  term.innerHTML = DB.terms.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.academicYear)} · Semester ${escapeHtml(item.semester)}</option>`).join('');
  term.value = DB.selectedTermId || '';
  const visibleStudents = getTermStudents();
  $('#def-filter-department').innerHTML = '<option value="">All departments</option>' + [...new Set(visibleStudents.map(item => getVisibleStudentContext(item).department).filter(Boolean))].map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  $('#def-filter-year').innerHTML = '<option value="">All years</option>' + [...new Set(visibleStudents.map(item => getVisibleStudentContext(item).year).filter(Boolean))].map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  $('#def-filter-section').innerHTML = '<option value="">All sections</option>' + [...new Set(visibleStudents.map(getStudentSectionLabel).filter(Boolean))].map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  $('#def-filter-subject').innerHTML = '<option value="">All subjects</option>' + getTermSubjects().map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join('');
  $('#def-subject-mode').checked = defaulterState.subjectMode;
  $('#defaulters-print-college').textContent = COLLEGE_CONFIG.name;
  const activeTerm = DB.terms.find(item => item.id === DB.selectedTermId);
  $('#defaulters-print-term').textContent = `${activeTerm?.academicYear || ''} · Semester ${activeTerm?.semester || ''}`;
  renderDefaulterTable();
}

function renderDefaulterTable() {
  const search = $('#def-filter-search').value.trim().toLowerCase();
  const subjectFilter = $('#def-filter-subject').value;
  const statusFilter = $('#def-filter-status').value;
  let rows = getDefaulterRows().filter(({ student, context, stats, subjects }) =>
    (!$('#def-filter-department').value || context.department === $('#def-filter-department').value) &&
    (!$('#def-filter-year').value || context.year === $('#def-filter-year').value) &&
    (!$('#def-filter-section').value || getStudentSectionLabel(student) === $('#def-filter-section').value) &&
    (!search || `${student.name || ''} ${student.roll || ''}`.toLowerCase().includes(search)) &&
    (statusFilter === 'all' || stats.status === statusFilter) &&
    (!subjectFilter || subjects.some(subject => String(subject.id) === subjectFilter))
  );
  visibleDefaulterRows = rows;
  const key = defaulterState.sort;
  rows.sort((a, b) => {
    const av = key === 'percent' ? (a.stats.percent ?? 101) : key === 'attended' ? a.stats.attended : key === 'needed' ? a.needed.classesNeeded : key === 'canMiss' ? a.needed.canMiss : a.context[key] || a.student[key] || '';
    const bv = key === 'percent' ? (b.stats.percent ?? 101) : key === 'attended' ? b.stats.attended : key === 'needed' ? b.needed.classesNeeded : key === 'canMiss' ? b.needed.canMiss : b.context[key] || b.student[key] || '';
    return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true })) * defaulterState.direction;
  });
  const body = $('#defaulters-table-body');
  body.innerHTML = rows.length ? rows.map(({ student, context, stats, needed, subjects }) => {
    const id = String(student.id), initials = String(student.name || '?').split(/\s+/).slice(0,2).map(word => word[0] || '').join('').toUpperCase();
    const photo = student.photo ? `<img class="student-thumb" src="${escapeHtml(student.photo)}" alt="${escapeHtml(student.name || 'Student photo')}">` : `<span class="student-thumb placeholder">${escapeHtml(initials)}</span>`;
    const notifyMessage = `Attendance alert for ${student.name}: current attendance is ${stats.percent}%.`;
    const notifyHref = student.parentPhone ? `https://wa.me/${String(student.parentPhone).replace(/\D/g, '')}?text=${encodeURIComponent(notifyMessage)}` : student.parentEmail ? `mailto:${encodeURIComponent(student.parentEmail)}?subject=${encodeURIComponent('Attendance alert')}&body=${encodeURIComponent(notifyMessage)}` : '';
    return `<tr><td><input type="checkbox" data-defaulter-select="${escapeHtml(id)}" ${defaulterState.selected.has(id) ? 'checked' : ''} aria-label="Select ${escapeHtml(student.name || 'student')}"></td><td><button class="defaulter-student-open" type="button" data-defaulter-open="${escapeHtml(id)}">${photo}<span>${escapeHtml(student.name || 'Unnamed student')}</span></button></td><td>${escapeHtml(student.roll || '—')}</td><td>${escapeHtml(context.department || '—')}</td><td>${escapeHtml(context.year || '—')}</td><td>${escapeHtml(getStudentSectionLabel(student))}</td><td>${stats.attended} / ${stats.total}</td><td>${stats.percent}%</td><td><span class="badge ${stats.status === 'critical' ? 'danger' : 'warn'}">${escapeHtml(stats.status)}</span></td><td>${needed.classesNeeded === Infinity ? 'Not reachable' : needed.classesNeeded}</td><td>${needed.canMiss ?? 0}</td><td>${escapeHtml(subjects.map(subject => subject.code).join(', ') || '—')}</td><td>${isFacultyHod() && notifyHref ? `<a class="btn-xs" target="_blank" rel="noopener" href="${escapeHtml(notifyHref)}">Notify parent</a>` : '—'}</td></tr>`;
  }).join('') : '<tr><td colspan="13" class="muted">No defaulters match these filters.</td></tr>';
}

['term','department','year','section','subject','status','search'].forEach(key => $(`#def-filter-${key}`)?.addEventListener('change', () => {
  if (key === 'term') { DB.selectedTermId = $('#def-filter-term').value; DB.save(); renderGlobalTermSelector(); renderDashboard(); renderHistory(); renderReports(); renderStudents(); }
  renderDefaulterTable();
}));
$('#def-filter-search')?.addEventListener('input', renderDefaulterTable);
$('#def-subject-mode')?.addEventListener('change', event => { defaulterState.subjectMode = event.target.checked; renderDefaulterTable(); });
$('#defaulters-table-body')?.addEventListener('change', event => {
  const box = event.target.closest('[data-defaulter-select]'); if (!box) return;
  if (box.checked) defaulterState.selected.add(box.dataset.defaulterSelect); else defaulterState.selected.delete(box.dataset.defaulterSelect);
});
$('#defaulters-table-body')?.addEventListener('click', event => {
  const open = event.target.closest('[data-defaulter-open]'); if (open) openStudentProfileById(open.dataset.defaulterOpen);
});
$('.defaulters-table thead')?.addEventListener('click', event => {
  const cell = event.target.closest('[data-def-sort]'); if (!cell) return;
  const key = cell.dataset.defSort; defaulterState.direction = defaulterState.sort === key ? -defaulterState.direction : 1; defaulterState.sort = key; renderDefaulterTable();
});
$('#defaulters-export')?.addEventListener('click', () => {
  const selected = [...defaulterState.selected];
  const entries = visibleDefaulterRows.filter(entry => !selected.length || selected.includes(String(entry.student.id)));
  downloadCsv([['Name','Roll','Department','Year','Section','Attended','Total','Percent','Status','Classes needed','Can miss','Subjects'], ...entries.map(({student,context,stats,needed,subjects}) => [student.name,student.roll,context.department,context.year,getStudentSectionLabel(student),stats.attended,stats.total,stats.percent,stats.status,needed.classesNeeded,needed.canMiss,subjects.map(item=>item.code).join('; ')])], 'defaulters.csv');
});
$('#defaulters-print')?.addEventListener('click', () => window.print());

$('#dash-quick-take-btn').onclick = () => show('setup');
$('#dash-view-history').onclick = () => show('history');
$('#dash-view-reports').onclick = () => show('reports');

// Class Creation Modal
const openCreateClassDialog = () => {
  $('#c-dept').value = DB.teacher?.department || '';
  populateClassOwnerSelect(DB.teacher?.department || '');
  $('#class-modal').showModal();
};
$('#dash-add-class-btn').onclick = openCreateClassDialog;
$('#student-add-class').onclick = openCreateClassDialog;
$('#class-modal-close').onclick = () => $('#class-modal').close();
$('#class-modal-cancel').onclick = () => $('#class-modal').close();
$('#roster-owner-select')?.addEventListener('change', async event => {
  if (!isFacultyHod() || !selectedClassForRoster) return;
  const assigned = selectedClassForRoster.subjectId ? await assignFaculty(selectedClassForRoster.subjectId, event.target.value) : await assignFaculty(selectedClassForRoster.id, event.target.value);
  if (!assigned) return;
  if (USE_MOCK) DB.save();
  renderClassRoster();
  renderDashboard();
  renderStudents();
  renderReports();
});

$('#class-create-form').onsubmit = async e => {
  e.preventDefault();
  const dept = (isFacultyHod() ? $('#c-dept').value : DB.teacher?.department || '').trim().replace(/\s+/g, ' ');
  const year = $('#c-year').value.trim().replace(/\s+/g, ' ');
  const sectionInput = $('#c-sec').value.trim().replace(/\s+/g, ' ');
  const msgBox = $('#c-create-msg');
  msgBox.hidden = true;

  if (!dept || !year || !sectionInput) {
    msgBox.textContent = 'Enter a department, academic year, and section name.';
    msgBox.hidden = false;
    return;
  }

  const label = canonicalSectionName(dept, sectionInput);

  const res = await FaceAPI.addClass({
    department: dept,
    year,
    section: label,
    subject: '',
    code: '',
    time: '',
    room: '',
    label,
    teacherId: String(isFacultyHod() ? $('#c-owner').value : DB.teacher?.id || '')
  });

  if (!res.ok) {
    msgBox.textContent = res.error || 'Could not create class.';
    msgBox.hidden = false;
    return;
  }

  $('#class-modal').close();
  $('#class-create-form').reset();
  toast(`${res.class.label} section created.`);
  openClassRoster(res.class);
};

// ==========================================================
// 3. CLASSES & ROSTER CONTROLLER
// ==========================================================
function getSectionClasses(cls) {
  if (!cls) return [];
  const label = getClassSectionLabel(cls).toLowerCase();
  return getTermClasses().filter(item =>
    String(item.department || '').toLowerCase() === String(cls.department || '').toLowerCase() &&
    String(item.year || '').toLowerCase() === String(cls.year || '').toLowerCase() &&
    getClassSectionLabel(item).toLowerCase() === label
  );
}

function getSectionStudentsRaw(cls) {
  if (!cls) return [];
  const department = String(cls.department || '').trim().toLowerCase();
  const year = String(cls.year || '').trim().toLowerCase();
  const section = getClassSectionLabel(cls).trim().toLowerCase();
  const enrolledIds = Array.isArray(cls.studentIds) ? new Set(cls.studentIds.map(String)) : null;
  return DB.students.filter(student => {
    if (enrolledIds?.size && !enrolledIds.has(String(student.id))) return false;
    const studentSection = String(student.section || '').trim();
    if (!studentSection || studentSection.toLowerCase() === 'unassigned' || studentSection === '—') return false;
    return String(student.department || '').trim().toLowerCase() === department &&
      String(student.year || '').trim().toLowerCase() === year &&
      canonicalSectionName(student.department, studentSection).trim().toLowerCase() === section;
  });
}

function getSectionStudents(cls) {
  const allowed = getMyClasses().some(item => String(item.id) === String(cls?.id));
  if (!allowed) return [];
  const students = getSectionStudentsRaw(cls);
  return isFacultyHod() ? students : students.map(({ id, name, roll, section, photo }) => ({ id, name, roll, section, photo }));
}

function getSectionSessions(cls) {
  const classIds = new Set(getSectionClasses(cls).map(item => String(item.id)));
  return getVisibleHistory().filter(session => classIds.has(String(session.classId)));
}

function calculateVisibleAttendance(studentId, minPct = getMinAttendance(), warningPct = getWarningThreshold()) {
  const id = String(studentId);
  const sessions = getVisibleHistory().filter(session => (session.studentIds || []).map(String).includes(id)).filter(session => {
    const status = session.records?.[id]?.status;
    return !((status === 'on-duty' && DB.config.condonation?.onDuty === false) || (status === 'medical' && DB.config.condonation?.medical === false));
  });
  const attended = sessions.filter(session => (session.presentIds || []).map(String).includes(id)).length;
  const total = sessions.length;
  const percent = total ? Math.round(attended / total * 100) : null;
  const warning = Math.min(warningPct, minPct - 1);
  const status = percent === null ? 'none' : percent < warning ? 'critical' : percent < minPct ? 'warning' : 'eligible';
  return { attended, total, percent, status, classesNeeded: percent !== null && percent < minPct ? calcClassesNeeded(attended, total, minPct) : 0 };
}

function calculateSectionAttendance(studentId, cls, minPct = getMinAttendance(), warningPct = getWarningThreshold()) {
  const id = String(studentId);
  const sessions = getSectionSessions(cls).filter(session => (session.studentIds || []).map(String).includes(id));
  const attended = sessions.filter(session => (session.presentIds || []).map(String).includes(id)).length;
  const total = sessions.length;
  const percent = total ? Math.round(attended / total * 100) : null;
  const effectiveWarning = Math.min(warningPct, minPct - 1);
  const status = percent === null ? 'none' : percent < effectiveWarning ? 'critical' : percent < minPct ? 'warning' : 'eligible';
  const classesNeeded = percent !== null && percent < minPct ? calcClassesNeeded(attended, total, minPct) : 0;
  return { attended, total, percent, status, classesNeeded };
}

function countDefaultersAtLimit(minPct, warningPct) {
  return getTermStudents().filter(student => {
    const stats = calculateVisibleAttendance(student.id, minPct, warningPct);
    return stats.total > 0 && (stats.status === 'warning' || stats.status === 'critical');
  }).length;
}

function updateSettingsPreview() {
  const minInput = $('#settings-min-number');
  const slider = $('#settings-min-slider');
  const warningInput = $('#settings-warning-number');
  const preview = $('#settings-preview-text');
  $('#settings-message').hidden = true;
  const minPct = Number(minInput.value);
  if (!Number.isInteger(minPct) || minPct < 40 || minPct > 100) {
    preview.textContent = 'Enter a whole number from 40 to 100 to preview the change.';
    return;
  }
  slider.value = String(minPct);

  let warningPct = warningInput.value.trim() === '' ? NaN : Number(warningInput.value);
  if (Number.isInteger(warningPct) && warningPct >= minPct) {
    warningPct = minPct - 1;
    warningInput.value = String(warningPct);
  }
  if (!Number.isInteger(warningPct) || warningPct < 0 || warningPct >= minPct) {
    preview.textContent = 'Set the warning band to a whole number below the minimum.';
    return;
  }

  const candidateDefaulters = countDefaultersAtLimit(minPct, warningPct);
  const currentDefaulters = countDefaultersAtLimit(getMinAttendance(), getWarningThreshold());
  preview.textContent = `At ${minPct}%, ${candidateDefaulters} students would be defaulters (currently ${currentDefaulters}).`;
}

function renderSubjects() {
  const hod = isFacultyHod();
  const form = $('#subject-form');
  if (form) form.closest('.card').hidden = !hod;
  const description = $('#v-subjects .page-header .muted');
  if (description) description.textContent = hod ? 'Maintain the department subject list available for attendance sessions.' : 'View the subjects assigned to your classes.';
  const department = $('#subject-department');
  const year = $('#subject-year');
  const selectedDepartment = department.value;
  const departmentOptions = [...new Set([...getTermClasses().map(item => item.department), ...getTermStudents().map(item => item.department), ...getTermSubjects().map(item => item.department)].map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  department.innerHTML = `${departmentOptions.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}<option value="__other__">Other…</option>`;
  department.value = departmentOptions.includes(selectedDepartment) ? selectedDepartment : selectedDepartment === '__other__' ? '__other__' : departmentOptions[0] || '__other__';
  updateSubjectDepartmentOther();
  if (!year.options.length) year.innerHTML = COLLEGE_CONFIG.years.map(value => `<option>${escapeHtml(value)}</option>`).join('');
  const list = $('#subject-list');
  const subjects = hod
    ? getTermSubjects()
    : getTermClasses().filter(cls => String(cls.teacherId || '') === String(DB.teacher?.id) && (cls.subjectId || cls.subject || cls.code)).map(cls => {
      const subject = DB.subjects.find(item => String(item.id) === String(cls.subjectId || '')) || {};
      const term = DB.terms.find(item => String(item.id) === String(cls.termId || ''));
      return { ...subject, id: `${subject.id || cls.id}-${cls.id}`, code: subject.code || cls.code || '', name: subject.name || cls.subject || cls.code || 'Subject', department: cls.department, year: cls.year, semester: subject.semester || cls.semester || (term ? `Semester ${term.semester}` : ''), section: cls.label || cls.section };
    });
  const emptyMessage = hod ? 'No subjects have been added yet.' : 'No subjects are assigned to your classes yet.';
  list.innerHTML = subjects.length ? `<div class="subject-master-list">${subjects.map(subject => `<article class="subject-master-row"><div><b>${escapeHtml(subject.code)} · ${escapeHtml(subject.name)}</b><p class="muted">${escapeHtml(subject.department)} · ${escapeHtml(subject.year)}${subject.section ? ` · ${escapeHtml(subject.section)}` : ''}${subject.semester ? ` · ${escapeHtml(subject.semester)}` : ''}</p></div>${hod ? `<div><button type="button" class="btn btn-secondary" data-subject-edit="${escapeHtml(subject.id)}">Edit</button> <button type="button" class="btn danger-outline" data-subject-delete="${escapeHtml(subject.id)}">Delete</button></div>` : ''}</article>`).join('')}</div>` : `<p class="muted">${emptyMessage}</p>`;
}

function resetSubjectForm() {
  $('#subject-form').reset();
  $('#subject-id').value = '';
  $('#subject-department-other').value = '';
  updateSubjectDepartmentOther();
  $('#subject-save').textContent = 'Add Subject';
  $('#subject-cancel').hidden = true;
}

function updateSubjectDepartmentOther() {
  const select = $('#subject-department');
  const other = $('#subject-department-other');
  const needsOther = select.value === '__other__';
  other.hidden = !needsOther;
  other.required = needsOther;
  if (needsOther) other.focus?.();
}

$('#subject-department').addEventListener('change', updateSubjectDepartmentOther);

$('#subject-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!isFacultyHod()) return toast('Only the department HOD can manage subjects.', 'warn');
  const id = $('#subject-id').value;
  const code = $('#subject-code').value.trim().toUpperCase();
  const department = String(DB.teacher?.department || ($('#subject-department').value === '__other__' ? $('#subject-department-other').value : $('#subject-department').value)).trim().toUpperCase();
  const duplicate = DB.subjects.some(subject => subject.code.toLowerCase() === code.toLowerCase() && String(subject.id) !== String(id));
  if (!code || !$('#subject-name').value.trim() || !department || duplicate) { toast(duplicate ? 'That subject code already exists.' : 'Enter a subject code, name, and department.', 'warn'); return; }
  const year = $('#subject-year').value;
  const semesterNumber = Number($('#subject-semester').value);
  const yearNumber = Number(String(year).match(/[1-4]/)?.[0] || 0);
  if (yearNumber && (semesterNumber < yearNumber * 2 - 1 || semesterNumber > yearNumber * 2)) return toast('Choose a semester that matches the selected year.', 'danger');
  const subject = { id: id || `sub-${Date.now()}`, code, name: $('#subject-name').value.trim(), department, year, semester: `Semester ${semesterNumber}`, semesterNumber, termId: DB.selectedTermId || DB.terms.find(term => term.status === 'active')?.id, credits: Math.max(0, Math.floor(Number($('#subject-credits').value) || 0)), facultyId: '' };
  const saved = await FaceAPI.saveSubject(subject);
  if (!saved.ok) return toast(saved.error || 'Subject could not be saved.', 'danger');
  subject.id = saved.subject?.id || subject.id;
  const index = DB.subjects.findIndex(item => String(item.id) === String(id));
  if (index >= 0) DB.subjects[index] = subject; else if (!USE_MOCK) DB.subjects.push(subject);
  syncSubjectFaculty(subject.id);
  if (!DB.save()) { toast('Subject could not be saved. Check browser storage.', 'danger'); return; }
  resetSubjectForm(); renderSubjects(); toast('Subject saved.');
});
$('#subject-cancel').addEventListener('click', resetSubjectForm);
$('#subject-list').addEventListener('click', async event => {
  if (!isFacultyHod()) return;
  const edit = event.target.closest('[data-subject-edit]');
  const remove = event.target.closest('[data-subject-delete]');
  if (edit) {
    const subject = getTermSubjects().find(item => String(item.id) === edit.dataset.subjectEdit);
    if (!subject) return;
    $('#subject-id').value = subject.id; $('#subject-code').value = subject.code; $('#subject-name').value = subject.name;
    $('#subject-department').value = subject.department; $('#subject-year').value = subject.year;
    $('#subject-semester').value = String(subject.semesterNumber || Number(String(subject.semester || '').match(/[1-8]/)?.[0] || 1)); $('#subject-credits').value = subject.credits || '';
    $('#subject-save').textContent = 'Save Subject'; $('#subject-cancel').hidden = false;
  }
  if (remove) {
    const linkedClasses = DB.classes.filter(cls => String(cls.subjectId || '') === String(remove.dataset.subjectDelete) && getMyClasses().some(item => String(item.id) === String(cls.id)));
    for (const cls of linkedClasses) if (!await linkClassSubject(cls.id, '')) return;
    const result = await FaceAPI.deleteSubject(remove.dataset.subjectDelete);
    if (!result.ok) return toast(result.error || 'Subject could not be deleted.', 'danger');
    DB.subjects = DB.subjects.filter(item => String(item.id) !== remove.dataset.subjectDelete);
    if (DB.save()) { renderSubjects(); toast('Subject deleted.'); } else toast('Subject could not be deleted.', 'danger');
  }
});

function renderSettings() {
  $('#settings-min-number').value = String(getMinAttendance());
  $('#settings-min-slider').value = String(getMinAttendance());
  $('#settings-warning-number').value = String(getWarningThreshold());
  $('#settings-auto-switch-term').checked = DB.config.autoSwitchTermByDate !== false;
  $('#settings-default-odd').value = String(DB.config.defaultOddSemester || 1);
  $('#settings-default-even').value = String(DB.config.defaultEvenSemester || 2);
  $('#settings-message').hidden = true;
  updateSettingsPreview();
  updateStorageUsage();
  const promotion = $('#promotion-department');
  if (promotion && !promotion.options.length) promotion.innerHTML = (COLLEGE_CONFIG.departments || []).map(department => `<option>${escapeHtml(department)}</option>`).join('');
  renderGlobalTermSelector();
  const list = $('#term-list');
  if (list) list.innerHTML = DB.terms.map(term => `<article class="subject-master-row"><div><b>${escapeHtml(term.academicYear)} · Semester ${escapeHtml(term.semester)}</b><p class="muted">${escapeHtml(term.startDate)} to ${escapeHtml(term.endDate)} · ${escapeHtml(term.status)}</p></div><div><button class="btn-xs" type="button" data-term-active="${escapeHtml(term.id)}">Set active</button><button class="btn-xs" type="button" data-term-close="${escapeHtml(term.id)}">Close</button></div></article>`).join('');
}

$('#term-create')?.addEventListener('click', () => {
  const academicYear = $('#term-academic-year').value.trim(), semester = Number($('#term-semester').value), startDate = $('#term-start-date').value, endDate = $('#term-end-date').value;
  if (!academicYear || !startDate || !endDate || endDate < startDate) return toast('Enter a valid academic year and term dates.', 'danger');
  const term = { id: `term-${Date.now()}`, academicYear, semester, type: semester % 2 ? 'odd' : 'even', startDate, endDate, status: 'closed' };
  DB.terms.push(term); DB.save(); renderSettings(); toast('Term created. Set it active when ready.');
});
$('#term-list')?.addEventListener('click', event => {
  const activate = event.target.closest('[data-term-active]')?.dataset.termActive, close = event.target.closest('[data-term-close]')?.dataset.termClose;
  const term = DB.terms.find(item => item.id === (activate || close)); if (!term) return;
  if (activate) {
    const previous = DB.terms.find(item => item.status === 'active');
    DB.terms.forEach(item => item.status = item.id === activate ? 'active' : item.status === 'active' ? 'closed' : item.status);
    DB.selectedTermId = activate;
    if (previous && previous.id !== activate) promptCarryForwardTerm(previous, term);
  }
  if (close) { term.status = 'closed'; if (DB.selectedTermId === close) DB.selectedTermId = DB.terms.find(item => item.status === 'active' && item.id !== close)?.id || ''; }
  DB.save(); renderSettings(); renderDashboard(); renderHistory(); renderReports(); renderDefaulters(); renderStudents(); toast('Term status updated.');
});

function exportAllDatabaseData() {
  if (!isFacultyHod()) return toast('Data backup is available to HOD accounts.', 'warn');
  const visibleClasses = getMyClasses();
  const visibleClassIds = new Set(visibleClasses.map(cls => String(cls.id)));
  const visibleSessionIds = new Set(getVisibleHistory().map(session => String(session.id)));
  const departmentTeachers = [...getDepartmentFaculty(), DB.teacher];
  const snapshot = { teacher: DB.teacher, teachers: departmentTeachers, classes: visibleClasses, students: getVisibleStudents(), history: getVisibleHistory(), terms: DB.terms || [], selectedTermId: DB.selectedTermId, subjects: (DB.subjects || []).filter(subject => String(subject.department || '').toLowerCase() === String(DB.teacher.department || '').toLowerCase()), auditLog: (DB.auditLog || []).filter(entry => visibleSessionIds.has(String(entry.sessionId || ''))), config: DB.config, department: DB.teacher.department };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `faceauth-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
}
async function updateStorageUsage() {
  const progress = $('#storage-usage'), label = $('#storage-usage-label');
  if (!progress || !label) return;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) { label.textContent = 'Storage estimate unavailable'; return; }
    const used = estimate.usage || 0; progress.value = Math.min(100, used / estimate.quota * 100);
    label.textContent = `${(used / 1048576).toFixed(1)} MB of ${(estimate.quota / 1048576).toFixed(0)} MB`;
  } catch { label.textContent = 'Storage estimate unavailable'; }
}
$('#backup-download').addEventListener('click', exportAllDatabaseData);
$('#backup-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const required = ['teachers', 'classes', 'students', 'history'];
    const arraysValid = backup && required.every(key => Array.isArray(backup[key]) && backup[key].every(item => item && typeof item === 'object' && !Array.isArray(item)));
    const optionalArraysValid = (backup?.subjects === undefined || (Array.isArray(backup.subjects) && backup.subjects.every(item => item && typeof item === 'object'))) && (backup?.terms === undefined || (Array.isArray(backup.terms) && backup.terms.every(item => item && typeof item === 'object'))) && (backup?.auditLog === undefined || (Array.isArray(backup.auditLog) && backup.auditLog.every(item => item && typeof item === 'object')));
    const configValid = backup?.config && typeof backup.config === 'object' && Number.isInteger(backup.config.minAttendancePercent) && backup.config.minAttendancePercent >= 40 && backup.config.minAttendancePercent <= 100 && Number.isInteger(backup.config.warningThreshold) && backup.config.warningThreshold >= 0 && backup.config.warningThreshold < backup.config.minAttendancePercent && Array.isArray(backup.config.departments) && Array.isArray(backup.config.years);
    if (!arraysValid || !optionalArraysValid || !configValid || !backup.teacher || typeof backup.teacher !== 'object' || String(backup.department || backup.teacher.department || '').toLowerCase() !== String(DB.teacher.department || '').toLowerCase()) throw new Error('The file does not contain a valid backup for your department.');
    const department = String(DB.teacher.department || '').toLowerCase();
    const scopedClasses = backup.classes.filter(cls => String(cls.department || '').toLowerCase() === department);
    const scopedTeachers = backup.teachers.filter(teacher => String(teacher.department || '').toLowerCase() === department);
    if (scopedClasses.length !== backup.classes.length || scopedTeachers.length !== backup.teachers.length || backup.students.some(student => String(student.department || '').toLowerCase() !== department)) throw new Error('This backup contains records outside your department.');
    if (!confirm(`Replace ${DB.teacher.department} department data with this backup?`)) return;
    const old = Object.fromEntries(['teacher', 'teachers', 'classes', 'students', 'history', 'terms', 'selectedTermId', 'subjects', 'auditLog', 'config'].map(key => [key, DB[key]]));
    const deptClasses = new Set(DB.classes.filter(cls => String(cls.department || '').toLowerCase() === department).map(cls => String(cls.id)));
    const affectedStudentIds = new Set(DB.classes.filter(cls => deptClasses.has(String(cls.id))).flatMap(cls => (cls.studentIds || []).map(String)));
    const affectedHistoryIds = new Set(DB.history.filter(session => deptClasses.has(String(session.classId))).map(session => String(session.id)));
    DB.teachers = DB.teachers.filter(teacher => String(teacher.department || '').toLowerCase() !== department).concat(scopedTeachers);
    DB.classes = DB.classes.filter(cls => String(cls.department || '').toLowerCase() !== department).concat(scopedClasses);
    const importedStudentIds = new Set(backup.students.map(student => String(student.id)));
    DB.students = DB.students.filter(student => !affectedStudentIds.has(String(student.id)) && !importedStudentIds.has(String(student.id))).concat(backup.students);
    DB.history = DB.history.filter(session => !deptClasses.has(String(session.classId))).concat(backup.history.filter(session => scopedClasses.some(cls => String(cls.id) === String(session.classId))));
    DB.teacher = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id)) || DB.teacher;
    DB.config = { ...COLLEGE_CONFIG, ...backup.config };
    DB.subjects = DB.subjects.filter(subject => String(subject.department || '').toLowerCase() !== department).concat((backup.subjects || []).filter(subject => String(subject.department || '').toLowerCase() === department));
    DB.auditLog = DB.auditLog.filter(entry => !affectedHistoryIds.has(String(entry.sessionId || ''))).concat((backup.auditLog || []).filter(entry => backup.history.some(session => String(session.id) === String(entry.sessionId))));
    DB.terms = backup.terms || DB.terms; DB.selectedTermId = backup.selectedTermId || DB.terms.find(term => term.status === 'active')?.id;
    if (!DB.save()) { Object.assign(DB, old); throw new Error('Backup could not be saved.'); }
    DB.load();
    toast('Backup restored.'); show('dashboard');
  } catch (error) { toast(error.message || 'Could not read this backup.', 'danger'); }
  finally { event.target.value = ''; }
});

$('#promotion-preview').addEventListener('click', () => {
  const department = $('#promotion-department').value;
  const counts = COLLEGE_CONFIG.years.map((year, index) => `${escapeHtml(year)} → ${escapeHtml(COLLEGE_CONFIG.years[index + 1] || '4th Year (final year)')}: ${getOwnedStudents().filter(student => student.department === department && student.year === year).length}`);
  $('#promotion-preview-output').textContent = `${department}: ${counts.join(' · ')}`;
  $('#promotion-apply').disabled = false;
});
$('#promotion-apply').addEventListener('click', () => {
  const department = $('#promotion-department').value;
  if (!confirm(`Promote ${department} students by one year? Existing attendance history will remain unchanged.`)) return;
  const previousStudents = getOwnedStudents().map(student => ({ student, year: student.year }));
  const previousClasses = getOwnedClasses().map(cls => ({ cls, year: cls.year }));
  getOwnedStudents().filter(student => student.department === department).forEach(student => {
    const index = COLLEGE_CONFIG.years.indexOf(student.year);
    if (index >= 0 && index < COLLEGE_CONFIG.years.length - 1) student.year = COLLEGE_CONFIG.years[index + 1];
  });
  getOwnedClasses().filter(cls => cls.department === department).forEach(cls => {
    const index = COLLEGE_CONFIG.years.indexOf(cls.year);
    if (index >= 0 && index < COLLEGE_CONFIG.years.length - 1) cls.year = COLLEGE_CONFIG.years[index + 1];
  });
  if (!DB.save()) { previousStudents.forEach(item => { item.student.year = item.year; }); previousClasses.forEach(item => { item.cls.year = item.year; }); toast('Promotion could not be saved.', 'danger'); return; }
  $('#promotion-apply').disabled = true; $('#promotion-preview-output').textContent = '';
  renderStudents(); renderDashboard(); renderReports(); renderStudentEditor(); if (selectedClassForRoster) renderClassRoster(); toast(`${department} students promoted.`);
});

function saveAttendanceSettings(minPct, warningPct) {
  if (!confirm('This applies to all past and future attendance. Records are not changed; statuses are recalculated.')) return false;
  const oldConfig = DB.config;
  DB.config = { ...oldConfig, minAttendancePercent: minPct, warningThreshold: warningPct };
  if (!DB.save()) {
    DB.config = oldConfig;
    $('#settings-message').textContent = 'Settings could not be saved. Check browser storage and try again.';
    $('#settings-message').hidden = false;
    return false;
  }

  $('#settings-message').hidden = true;
  applyMinLimitLabels();
  renderDashboard();
  renderReports();
  if (selectedClassForRoster) renderClassRoster();
  renderHistory();
  renderSettings();
  toast(`Attendance settings saved: minimum ${minPct}%, warning ${getWarningThreshold()}%.`);
  return true;
}

$('#settings-min-number').addEventListener('input', updateSettingsPreview);
$('#settings-min-slider').addEventListener('input', () => {
  $('#settings-min-number').value = $('#settings-min-slider').value;
  updateSettingsPreview();
});
$('#settings-warning-number').addEventListener('input', updateSettingsPreview);
$('#settings-warning-number').addEventListener('change', updateSettingsPreview);
$$('[data-setting-preset]').forEach(button => {
  button.addEventListener('click', () => {
    $('#settings-min-number').value = button.dataset.settingPreset;
    $('#settings-min-slider').value = button.dataset.settingPreset;
    updateSettingsPreview();
  });
});
$('#attendance-settings-form').onsubmit = event => {
  event.preventDefault();
  const minPct = Number($('#settings-min-number').value);
  const warningText = $('#settings-warning-number').value.trim();
  const warningPct = warningText === '' ? NaN : Number(warningText);
  const message = $('#settings-message');
  if (!Number.isInteger(minPct) || minPct < 40 || minPct > 100) {
    message.textContent = 'Minimum attendance must be a whole number from 40 to 100.';
    message.hidden = false;
    return;
  }
  if (!Number.isInteger(warningPct) || warningPct < 0 || warningPct >= minPct || warningPct > 99) {
    message.textContent = 'Warning band must be a whole number lower than the minimum attendance limit.';
    message.hidden = false;
    return;
  }
  DB.config = { ...DB.config, autoSwitchTermByDate: $('#settings-auto-switch-term').checked, defaultOddSemester: Number($('#settings-default-odd').value), defaultEvenSemester: Number($('#settings-default-even').value) };
  saveAttendanceSettings(minPct, warningPct);
};
$('#settings-reset-default').onclick = () => {
  saveAttendanceSettings(75, 65);
};

function getSectionGroups() {
  const groups = new Map();
  getTermClasses().forEach(cls => {
    const label = getClassSectionLabel(cls);
    const key = `${String(cls.department || '').toLowerCase()}|${String(cls.year || '').toLowerCase()}|${label.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { label, department: cls.department || '', year: cls.year || '', classes: [] });
    groups.get(key).classes.push(cls);
  });
  return [...groups.values()].map(group => ({ ...group, representative: group.classes[0] }));
}

function getTermClasses() {
  return getMyClasses().filter(cls => !DB.selectedTermId || !cls.termId || String(cls.termId) === String(DB.selectedTermId));
}

function getMyClasses() {
  const classes = DB.classes || [];
  const teacher = DB.teacher || currentTeacher;
  if (!teacher?.id) return [];
  if (isFacultyHod(teacher)) return classes.filter(cls => String(cls.department || '').trim().toLowerCase() === String(teacher.department || '').trim().toLowerCase());
  return classes.filter(cls => String(cls.teacherId || '') === String(teacher.id));
}

function getMySubjects() {
  const ids = new Set(getMyClasses().map(cls => String(cls.subjectId || '')).filter(Boolean));
  return [...new Map((DB.subjects || []).filter(subject => ids.has(String(subject.id))).map(subject => [String(subject.id), subject])).values()];
}

function getVisibleHistory() {
  const classIds = new Set(getMyClasses().map(cls => String(cls.id)));
  const termId = String(DB.selectedTermId || DB.terms.find(term => term.status === 'active')?.id || '');
  return (DB.history || []).filter(session => classIds.has(String(session.classId)) && (!termId || String(session.termId || '') === termId));
}

function getVisibleStudents() {
  const classes = getMyClasses().filter(cls => !DB.selectedTermId || !cls.termId || String(cls.termId) === String(DB.selectedTermId));
  const students = [...new Map(classes.flatMap(cls => getSectionStudentsRaw(cls)).map(student => [String(student.id), student])).values()];
  if (isFacultyHod()) return students;
  return students.map(({ id, name, roll, section, photo }) => ({ id, name, roll, section, photo }));
}

function getOwnedClasses() { return getMyClasses(); }
function getOwnedStudents() { return getVisibleStudents(); }
function getDepartmentFaculty() {
  if (!isFacultyHod()) return [];
  return (DB.teachers || []).filter(teacher => teacher.role === 'faculty' && String(teacher.department || '').trim().toLowerCase() === String(DB.teacher?.department || '').trim().toLowerCase());
}

function assignFaculty(classOrSubjectId, teacherId) {
  const value = String(classOrSubjectId || ''), owner = String(teacherId || '');
  const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
  const cls = DB.classes.find(item => String(item.id) === value);
  const subject = DB.subjects.find(item => String(item.id) === value);
  if (!actor || (!isFacultyHod(actor) && owner !== String(actor.id))) return false;
  const target = owner ? DB.teachers.find(teacher => String(teacher.id) === owner && String(teacher.department || '').toLowerCase() === String(actor.department || '').toLowerCase()) : null;
  if (owner && !target) return false;
  if (subject && !isFacultyHod(actor)) return false;
  const assignments = cls
    ? (getMyClasses().some(item => String(item.id) === String(cls.id)) ? [cls] : [])
    : subject && isFacultyHod(actor) ? DB.classes.filter(item => String(item.subjectId || '') === String(subject.id) && String(item.department || '').toLowerCase() === String(actor.department || '').toLowerCase()) : [];
  if (!assignments.length) return false;
  if (!USE_MOCK) return Promise.all(assignments.map(item => FaceAPI.updateClass(item.id, { teacherId: owner }))).then(results => {
    const failure = results.find(result => !result.ok);
    if (failure) { toast(failure.error || 'Could not update class assignments.', 'danger'); return false; }
    assignments.forEach(item => { item.teacherId = owner; delete item.facultyId; });
    const subjectIds = new Set(assignments.map(item => String(item.subjectId || '')).filter(Boolean));
    if (subject) subjectIds.add(String(subject.id));
    subjectIds.forEach(syncSubjectFaculty);
    return true;
  });
  assignments.forEach(item => { item.teacherId = owner; delete item.facultyId; });
  const subjectIds = new Set(assignments.map(item => String(item.subjectId || '')).filter(Boolean));
  if (subject) subjectIds.add(String(subject.id));
  subjectIds.forEach(syncSubjectFaculty);
  return true;
}

function syncSubjectFaculty(subjectId) {
  const subject = DB.subjects.find(item => String(item.id) === String(subjectId));
  if (!subject) return;
  const linked = DB.classes.filter(item => String(item.subjectId || '') === String(subject.id));
  subject.facultyId = linked.length && linked.every(item => String(item.teacherId || '') === String(linked[0].teacherId || '')) ? String(linked[0].teacherId || '') : '';
}

function linkClassSubject(classId, subjectId) {
  const cls = DB.classes.find(item => String(item.id) === String(classId));
  if (!cls || !getMyClasses().some(item => String(item.id) === String(cls.id))) return false;
  const subject = DB.subjects.find(item => String(item.id) === String(subjectId));
  if (subjectId && !subject) return false;
  const previousSubjectId = String(cls.subjectId || '');
  if (subject && previousSubjectId && previousSubjectId !== String(subject.id)) return false;
  if (subject && (String(subject.department || '').toLowerCase() !== String(cls.department || '').toLowerCase() || String(subject.year || '').toLowerCase() !== String(cls.year || '').toLowerCase() || (subject.termId && cls.termId && String(subject.termId) !== String(cls.termId)))) return false;
  const newSubjectId = subject ? String(subject.id) : '';
  if (!USE_MOCK) return FaceAPI.updateClass(cls.id, { subjectId: newSubjectId, subject: subject?.name || '', code: subject?.code || '', teacherId: cls.teacherId }).then(result => {
    if (!result.ok) { toast(result.error || 'Could not link the subject to this class.', 'danger'); return false; }
    cls.subjectId = newSubjectId; cls.subject = subject?.name || ''; cls.code = subject?.code || '';
    if (previousSubjectId && previousSubjectId !== newSubjectId) syncSubjectFaculty(previousSubjectId);
    if (subject) syncSubjectFaculty(subject.id);
    return true;
  });
  cls.subjectId = newSubjectId;
  cls.subject = subject?.name || ''; cls.code = subject?.code || '';
  if (previousSubjectId && previousSubjectId !== String(cls.subjectId)) {
    syncSubjectFaculty(previousSubjectId);
  }
  if (subject) assignFaculty(cls.id, cls.teacherId);
  return true;
}

async function ensureSubjectForClass(cls, name, code = '') {
  if (!cls || !String(name || '').trim()) return null;
  const norm = value => String(value || '').trim().toLowerCase();
  let subject = DB.subjects.find(item =>
    norm(item.department) === norm(cls.department) && norm(item.year) === norm(cls.year) &&
    (!item.termId || !cls.termId || String(item.termId) === String(cls.termId)) &&
    (code ? norm(item.code) === norm(code) : norm(item.name) === norm(name))
  );
  if (!subject) {
    const baseCode = String(code || `SUB-${Date.now().toString().slice(-6)}`).trim().toUpperCase();
    subject = { id: `subject-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, code: baseCode, name: String(name).trim(), department: cls.department, year: cls.year, semester: '', semesterNumber: 0, termId: cls.termId || DB.selectedTermId, credits: 0, facultyId: '' };
    const result = await FaceAPI.saveSubject(subject);
    if (!result.ok) { toast(result.error || 'Subject could not be saved.', 'danger'); return null; }
    if (!USE_MOCK) DB.subjects.push(result.subject || subject);
  }
  cls.subject = subject.name;
  cls.code = subject.code;
  const linked = await linkClassSubject(cls.id, subject.id);
  if (!linked) return null;
  return subject;
}

function getRole(teacher) { return teacher?.role === 'hod' ? 'hod' : 'faculty'; }
function isFacultyHod(teacher = DB.teacher || currentTeacher) { return getRole(teacher) === 'hod'; }

function renderFaculty() {
  if (!isFacultyHod()) return;
  const host = $('#faculty-list'); if (!host) return;
  const faculty = (DB.teachers || []).filter(teacher => String(teacher.department || '').toLowerCase() === String(DB.teacher.department || '').toLowerCase());
  host.innerHTML = faculty.map(teacher => `<article class="subject-master-row"><div><b><button type="button" class="btn-text-link" data-faculty-details="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)}</button></b><p class="muted">${escapeHtml(teacher.id)} · ${escapeHtml(teacher.designation || 'Faculty')} · ${getRole(teacher) === 'hod' ? 'HOD' : 'Faculty'} · ${escapeHtml(teacher.department || 'Department not set')}</p></div><div>${String(teacher.id) === String(DB.teacher.id) ? '<span class="badge ok">Current HOD</span>' : `<button type="button" class="btn btn-secondary" data-promote-teacher="${escapeHtml(teacher.id)}">Make HOD</button>`}</div></article>`).join('') || '<p class="muted">No faculty accounts found.</p>';
}
function renderTeacherAssignments(teacherId) {
  const classes = getMyClasses().filter(cls => String(cls.teacherId || '') === String(teacherId));
  const departmentTeachers = (DB.teachers || []).filter(teacher => String(teacher.department || '').trim().toLowerCase() === String(DB.teacher?.department || '').trim().toLowerCase());
  const rows = classes.map(cls => {
    const subject = DB.subjects.find(item => String(item.id) === String(cls.subjectId || ''));
    const term = DB.terms.find(item => String(item.id) === String(cls.termId || ''));
    const selectedTeacherId = String(cls.teacherId || '');
    const className = [cls.year, cls.label || cls.section].filter(Boolean).join(' · ') || 'Class';
    const options = departmentTeachers.map(teacher => `<option value="${escapeHtml(teacher.id)}" ${String(teacher.id) === selectedTeacherId ? 'selected' : ''}>${escapeHtml(teacher.name)} · ${escapeHtml(teacher.id)}</option>`).join('');
    return `<tr><td>${escapeHtml(className)}</td><td>${escapeHtml(subject?.name || cls.subject || 'Subject not set')}</td><td>${escapeHtml(term ? `Semester ${term.semester}` : '—')}</td><td><select data-assignment-class="${escapeHtml(cls.id)}" aria-label="Teacher for ${escapeHtml(subject?.name || cls.subject || className)}">${options}</select></td></tr>`;
  });
  $('#faculty-details-assignments').innerHTML = rows.join('') || '<tr><td colspan="4" class="muted">No teaching assignments found.</td></tr>';
}
function populateFacultyAssignmentSubjects() {
  const year = $('#faculty-assignment-year').value;
  const department = String(DB.teacher?.department || '').trim().toLowerCase();
  const subjects = getTermSubjects().filter(subject => String(subject.department || '').trim().toLowerCase() === department && String(subject.year || '').trim().toLowerCase() === String(year).trim().toLowerCase());
  $('#faculty-assignment-subject').innerHTML = '<option value="">Select a subject</option>' + subjects.map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.code)} · ${escapeHtml(subject.name)}${subject.semester ? ` · ${escapeHtml(subject.semester)}` : ''}</option>`).join('');
}
$('#faculty-add-assignment').onclick = () => {
  if (!isFacultyHod()) return;
  const teacher = DB.teachers.find(item => String(item.id) === String($('#faculty-details-old-id').value));
  if (!teacher || String(teacher.department || '').toLowerCase() !== String(DB.teacher?.department || '').toLowerCase()) return;
  $('#faculty-assignment-form').reset();
  $('#faculty-assignment-error').hidden = true;
  $('#faculty-assignment-teacher').textContent = `Assigning a class to ${teacher.name}`;
  $('#faculty-assignment-dialog').showModal();
  populateFacultyAssignmentSubjects();
};
$('#faculty-assignment-year').addEventListener('change', populateFacultyAssignmentSubjects);
$('#faculty-assignment-close').onclick = () => $('#faculty-assignment-dialog').close();
$('#faculty-assignment-cancel').onclick = () => $('#faculty-assignment-dialog').close();
$('#faculty-assignment-form').onsubmit = async event => {
  event.preventDefault();
  const teacherId = $('#faculty-details-old-id').value;
  const teacher = DB.teachers.find(item => String(item.id) === String(teacherId));
  const subject = DB.subjects.find(item => String(item.id) === String($('#faculty-assignment-subject').value));
  const section = $('#faculty-assignment-section').value.trim();
  const error = $('#faculty-assignment-error');
  error.hidden = true;
  if (!isFacultyHod() || !teacher || !subject || String(teacher.department || '').toLowerCase() !== String(DB.teacher?.department || '').toLowerCase() || String(subject.department || '').toLowerCase() !== String(DB.teacher?.department || '').toLowerCase()) {
    error.textContent = 'Choose a valid subject and faculty member in your department.'; error.hidden = false; return;
  }
  const label = canonicalSectionName(DB.teacher.department, section);
  const result = await FaceAPI.addClass({
    department: DB.teacher.department, year: $('#faculty-assignment-year').value, section: label, label,
    subject: subject.name, code: subject.code, subjectId: subject.id,
    termId: subject.termId || DB.selectedTermId || '', teacherId
  });
  if (!result.ok) { error.textContent = result.error || 'Could not add this teaching assignment.'; error.hidden = false; return; }
  if (USE_MOCK) DB.save();
  $('#faculty-assignment-dialog').close();
  renderTeacherAssignments(teacherId);
  toast('Teaching assignment added.');
};
$('#faculty-details-assignments')?.addEventListener('change', async event => {
  const select = event.target.closest('[data-assignment-class]');
  if (!select || !isFacultyHod()) return;
  const classId = select.dataset.assignmentClass;
  const assigned = await assignFaculty(classId, select.value);
  if (!assigned) { toast('Could not update this teaching assignment.', 'danger'); renderTeacherAssignments($('#faculty-details-old-id').value); return; }
  if (USE_MOCK) DB.save();
  toast('Teaching assignment updated.');
});
$('#faculty-list')?.addEventListener('click', async event => {
  const details = event.target.closest('[data-faculty-details]');
  if (details && isFacultyHod()) {
    const teacher = DB.teachers.find(item => String(item.id) === String(details.dataset.facultyDetails));
    if (!teacher || String(teacher.department || '').toLowerCase() !== String(DB.teacher.department || '').toLowerCase()) return;
    $('#faculty-details-old-id').value = teacher.id;
    $('#faculty-details-id').value = teacher.id;
    $('#faculty-details-email').value = teacher.email || '';
    $('#faculty-details-name').value = teacher.name || '';
    $('#faculty-details-department').value = teacher.department || '';
    $('#faculty-details-title').textContent = teacher.name || 'Faculty details';
    $('#faculty-details-role').textContent = `${teacher.designation || 'Faculty'} · ${getRole(teacher) === 'hod' ? 'HOD' : 'Faculty'}`;
    renderTeacherAssignments(teacher.id);
    $('#faculty-details-dialog').showModal();
    return;
  }
  const button = event.target.closest('[data-promote-teacher]'); if (!button || !isFacultyHod()) return;
  const result = await FaceAPI.setTeacherRole(button.dataset.promoteTeacher, 'hod');
  if (!result.ok) return toast(result.error || 'Could not update the faculty role.', 'danger');
  toast('HOD role assigned. Sign in again to refresh your role.'); await $('#logout').onclick();
});
$('#faculty-details-close').onclick = () => $('#faculty-details-dialog').close();
$('#faculty-details-cancel').onclick = () => $('#faculty-details-dialog').close();
$('#faculty-details-form').onsubmit = async event => {
  event.preventDefault();
  if (!isFacultyHod()) return toast('Only the department HOD can edit faculty details.', 'warn');
  const oldId = $('#faculty-details-old-id').value;
  const result = await FaceAPI.updateTeacherDetails(oldId, { id: $('#faculty-details-id').value });
  if (!result.ok) return toast(result.error || 'Teacher ID could not be updated.', 'danger');
  $('#faculty-details-dialog').close();
  renderFaculty();
  renderDemoLoginLabel();
  toast('Teacher ID updated.');
};

function getTermSubjects() {
  const subjects = isFacultyHod()
    ? (DB.subjects || []).filter(subject => !DB.teacher?.department || String(subject.department || '').trim().toLowerCase() === String(DB.teacher.department).trim().toLowerCase())
    : getMySubjects();
  return subjects.filter(subject => !subject.termId || String(subject.termId) === String(DB.selectedTermId));
}

function populateClassOwnerSelect(department = $('#c-dept')?.value || DB.teacher?.department || '') {
  const select = $('#c-owner'), field = $('#class-owner-field');
  if (!select || !field) return;
  const hod = isFacultyHod();
  field.hidden = !hod;
  const teachers = (DB.teachers || []).filter(teacher => !department || teacher.department === department);
  select.innerHTML = teachers.map(teacher => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)} · ${escapeHtml(teacher.id)}</option>`).join('');
  select.value = teachers.some(teacher => String(teacher.id) === String(DB.teacher?.id)) ? String(DB.teacher.id) : String(teachers[0]?.id || DB.teacher?.id || '');
}

$('#c-dept')?.addEventListener('input', () => populateClassOwnerSelect($('#c-dept').value));
function getTermStudents() {
  return getVisibleStudents();
}

function renderStudents() {
  const departmentSelect = $('#student-department-filter');
  const yearSelect = $('#student-year-filter');
  const sectionSelect = $('#student-section-filter');
  const previousDepartment = departmentSelect.value;
  const previousYear = yearSelect.value;
  const previousSection = sectionSelect.value;
  const groups = getSectionGroups();
  const fillSelect = (select, placeholder, values, selectedValue = '') => {
    select.replaceChildren(new Option(placeholder, ''));
    values.forEach(value => select.add(new Option(value, value)));
    select.value = values.includes(selectedValue) ? selectedValue : '';
  };

  const departments = [...new Set(groups.map(group => group.department).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fillSelect(departmentSelect, 'Select department', departments, previousDepartment);
  const years = [...new Set(groups
    .filter(group => group.department === departmentSelect.value)
    .map(group => group.year).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fillSelect(yearSelect, 'Select year', years, previousYear);
  yearSelect.disabled = !departmentSelect.value;

  const sections = [...new Set(groups
    .filter(group => group.department === departmentSelect.value && group.year === yearSelect.value)
    .map(group => group.label))].sort((a, b) => a.localeCompare(b));
  fillSelect(sectionSelect, 'Select section', sections, previousSection);
  sectionSelect.disabled = !yearSelect.value;

  const container = $('#student-class-list');
  if (!departments.length) {
    container.innerHTML = `<p class="muted">No department sections yet. Select “Add Section” to get started.</p>`;
    return;
  }

  if (!departmentSelect.value) {
    container.innerHTML = `<p class="muted">Select a department to continue.</p>`;
    return;
  }
  if (!yearSelect.value) {
    container.innerHTML = `<p class="muted">Now select a year in ${departmentSelect.value}.</p>`;
    return;
  }
  if (!sectionSelect.value) {
    container.innerHTML = `<p class="muted">Choose a section in ${departmentSelect.value} · ${yearSelect.value}.</p>`;
    return;
  }

  const selectedGroups = groups.filter(group =>
    group.department === departmentSelect.value &&
    group.year === yearSelect.value &&
    group.label === sectionSelect.value
  );
  container.innerHTML = selectedGroups.map(group => {
    const cls = group.representative;
    const enrolledStudents = getSectionStudents(cls);

    return `
      <div class="class-card">
        <div class="class-card-head">
          <div class="class-badge-circle">${group.label}</div>
          <div class="class-card-info">
            <b>${group.label}</b>
            <div class="class-card-meta">Department: ${group.department} · ${group.year}</div>
          </div>
        </div>

        <div class="class-card-stats">
          <span><b>${enrolledStudents.length}</b> students</span>
        </div>

        <div class="class-card-footer">
          <button class="btn btn-secondary" onclick="openClassRosterById('${cls.id}')">Student List</button>
          <div style="display: flex; gap: 0.4rem;">
            ${isFacultyHod() ? `<button class="btn btn-secondary" onclick="renameClass('${cls.id}')">Rename Section</button>` : ''}
            <button class="btn primary" onclick="openAttendanceSetupForSection('${cls.id}')">Attendance</button>
            ${isFacultyHod() ? `<button class="btn-xs danger" onclick="deleteClassConfirm('${cls.id}')" title="Remove section">✕</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

$('#student-department-filter').addEventListener('change', () => {
  $('#student-year-filter').value = '';
  $('#student-section-filter').value = '';
  renderStudents();
});
$('#student-year-filter').addEventListener('change', () => {
  $('#student-section-filter').value = '';
  renderStudents();
});
$('#student-section-filter').addEventListener('change', renderStudents);

window.openClassRosterById = classId => {
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  if (cls) openClassRoster(cls);
  else toast('You do not have access to that section.', 'danger');
};

window.renameClass = async classId => {
  if (!isFacultyHod()) return toast('Only the department HOD can rename sections.', 'warn');
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  if (!cls) return;
  const oldLabel = getClassSectionLabel(cls);
  const name = prompt('Enter the new section name:', oldLabel);
  if (name === null) return;
  const label = canonicalSectionName(cls.department, name.trim().replace(/\s+/g, ' '));
  if (!label) { toast('Section name cannot be empty.', 'warn'); return; }
  if (getTermClasses().some(c =>
    !getSectionClasses(cls).includes(c) &&
    String(c.department || '').toLowerCase() === String(cls.department || '').toLowerCase() &&
    String(c.year || '').toLowerCase() === String(cls.year || '').toLowerCase() &&
    getClassSectionLabel(c).toLowerCase() === label.toLowerCase()
  )) {
    toast('This department section already exists.', 'warn'); return;
  }
  const sectionClasses = getSectionClasses(cls);
  for (const sectionClass of sectionClasses) {
    const result = await FaceAPI.updateClass(sectionClass.id, { label, section: label });
    if (!result.ok) { toast(result.error || 'Could not rename section.', 'danger'); return; }
  }
  const sectionStudentIds = new Set(sectionClasses.flatMap(sectionClass => (sectionClass.studentIds || []).map(String)));
  DB.students.forEach(student => {
    if (sectionStudentIds.has(String(student.id)) && String(student.section || '').toLowerCase() === oldLabel.toLowerCase()) student.section = label;
  });
  const sectionClassIds = new Set(sectionClasses.map(item => String(item.id)));
  getVisibleHistory().filter(session => sectionClassIds.has(String(session.classId))).forEach(session => {
    session.section = label;
    session.classLabel = label;
  });
  DB.save(); renderStudents(); renderDashboard(); renderSetup(); renderReports(); toast('Section renamed.');
};

window.deleteClassConfirm = async classId => {
  if (!isFacultyHod()) return toast('Only the department HOD can remove sections.', 'warn');
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  if (!cls) return;
  const sectionClasses = getSectionClasses(cls);
  if (confirm(`Remove section ${getClassSectionLabel(cls)} and its schedules? Student profiles and attendance history will remain saved.`)) {
    for (const sectionClass of sectionClasses) {
      const result = await FaceAPI.removeClass(sectionClass.id);
      if (!result.ok) { toast(result.error || 'Could not remove section.', 'danger'); return; }
    }
    toast('Section removed');
    renderStudents();
    renderDashboard();
  }
};

window.startClassSessionDirectly = classId => {
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  if (!cls) return;
  const roster = getSectionStudents(cls);
  if (!roster.length) {
    toast('Please enroll students into this class before starting attendance.', 'warn');
    openClassRoster(cls);
    return;
  }
  openAttendanceSetupForSection(cls.id);
};

function openClassRoster(cls) {
  cls = getTermClasses().find(item => String(item.id) === String(cls?.id));
  if (!cls) { toast('You do not have access to that section.', 'danger'); return; }
  selectedClassForRoster = cls;
  $('#class-student-query').value = '';
  $('#lookup-results').innerHTML = '';
  $('#lookup-msg').textContent = '';
  show('class-roster');
}

function renderClassRoster() {
  if (!selectedClassForRoster) {
    show('students');
    return;
  }

  const cls = selectedClassForRoster;
  const canManageRoster = isFacultyHod();
  ['roster-filter-input', 'student-lookup', 'register-class-student', 'roster-owner-field'].forEach(id => { const node = $('#' + id); if (node) node.hidden = !canManageRoster; });
  $('#roster-export-btn').hidden = false;
  const ownerField = $('#roster-owner-field');
  const ownerSelect = $('#roster-owner-select');
  if (ownerField && ownerSelect) {
    ownerField.hidden = !isFacultyHod();
    if (isFacultyHod()) {
      const teachers = [DB.teachers.find(teacher => teacher.role === 'hod' && teacher.department === cls.department), ...getDepartmentFaculty().filter(teacher => teacher.department === cls.department)].filter(Boolean);
      ownerSelect.innerHTML = teachers.map(teacher => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)} · ${escapeHtml(teacher.id)}</option>`).join('');
      ownerSelect.value = String(cls.teacherId || '');
    }
  }
  $('#roster-title').textContent = `${getClassSectionLabel(cls)} Student List`;
  $('#roster-meta').textContent = `${cls.department} Department · ${cls.year}`;

  const enrolled = getSectionStudents(cls);
  $('#roster-count').textContent = enrolled.length;

  const query = String($('#roster-filter-input').value || '').trim().toLowerCase();
  const filtered = enrolled.filter(s =>
    !query || s.name.toLowerCase().includes(query) || String(s.roll).toLowerCase().includes(query)
  );

  const container = $('#roster-students');
  if (!filtered.length) {
    container.innerHTML = `<p class="muted">${enrolled.length ? 'No students match your search.' : 'No students enrolled in this section yet. Search the student directory to add them.'}</p>`;
    return;
  }

  container.innerHTML = filtered.map(s => {
    const stats = calculateSectionAttendance(s.id, cls);
    const photoHtml = s.photo
      ? `<img class="student-thumb" src="${escapeHtml(s.photo)}" alt="${escapeHtml(s.name || 'Student photo')}">`
      : `<div class="student-thumb placeholder">${escapeHtml(String(s.name || '?').split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase())}</div>`;

    return `
      <div class="student-card">
        ${photoHtml}
        <div class="student-card-info" onclick="openStudentProfileById(${s.id})">
          <b>${escapeHtml(s.name || 'Unnamed student')}</b>
          <div class="student-roll">Roll: ${escapeHtml(s.roll || '—')} · ${escapeHtml(getStudentSectionLabel(s))}</div>
          <div style="margin-top: 0.3rem;">
            <span class="student-tag ${stats.status}">${stats.percent === null ? 'No data yet' : `${stats.percent}% Attendance`}</span>
          </div>
        </div>
        <div class="student-card-actions">
          <button class="btn-xs" onclick="openStudentProfileById(${s.id})">Attendance</button>
          ${canManageRoster ? `<button class="btn-xs danger" onclick="unenrollStudentFromClass('${cls.id}', ${s.id})" title="Remove from class">Unenroll</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

$('#roster-filter-input').addEventListener('input', renderClassRoster);

$('#roster-take-attendance').onclick = () => {
  if (selectedClassForRoster) openAttendanceSetupForSection(selectedClassForRoster.id);
};

$('#roster-export-btn').onclick = () => {
  if (!selectedClassForRoster) return;
  const cls = selectedClassForRoster;
  const enrolled = getSectionStudents(cls);
  const rows = [
    ['University Roll Number', 'Student Name', 'Department', 'Year', 'Section', 'Attendance Percent', 'Status'],
    ...enrolled.map(s => {
      const att = calculateSectionAttendance(s.id, cls);
      return [s.roll, s.name, cls.department, cls.year, getStudentSectionLabel(s), `${att.percent ?? '—'}%`, att.status.toUpperCase()];
    })
  ];
  downloadCsv(rows, `section-${getClassSectionLabel(cls)}-students.csv`);
};

// Search & Enroll Existing Students
$('#student-lookup').onsubmit = async e => {
  e.preventDefault();
  if (!isFacultyHod()) return toast('Student roster changes are available to HOD accounts.', 'warn');
  const query = $('#class-student-query').value.trim();
  if (!query || !selectedClassForRoster) return;

  const msg = $('#lookup-msg');
  msg.textContent = 'Searching college records...';

  const res = await FaceAPI.findStudents(query);
  const container = $('#lookup-results');

  if (!res.students.length) {
    msg.textContent = 'No matching student found. Click "+ Register New Student Bio" to add them.';
    container.innerHTML = '';
    return;
  }

  const visibleIds = new Set(getTermStudents().map(student => String(student.id)));
  const availableStudents = res.students.filter(student => visibleIds.has(String(student.id)) || !student.section || String(student.section).toLowerCase() === 'unassigned');
  if (!availableStudents.length) { msg.textContent = 'No matching student is available in your assigned sections.'; container.innerHTML = ''; return; }
  msg.textContent = `Found ${availableStudents.length} student${availableStudents.length === 1 ? '' : 's'}:`;
  const enrolledIds = new Set(getSectionStudents(selectedClassForRoster).map(student => String(student.id)));

  container.innerHTML = availableStudents.map(s => {
    const isEnrolled = enrolledIds.has(String(s.id));
    return `
      <div class="lookup-row">
        <div>
          <b>${escapeHtml(s.name || 'Unnamed student')}</b> (${escapeHtml(s.roll || '—')})
          <div class="muted" style="font-size: 0.78rem;">${escapeHtml(s.department || '—')} · ${escapeHtml(s.year || '—')} · ${escapeHtml(getStudentSectionLabel(s))}</div>
        </div>
        <button class="btn ${isEnrolled ? '' : 'primary'} btn-xs" ${isEnrolled ? 'disabled' : ''} onclick="enrollStudentIntoCurrentClass(${s.id})">
          ${isEnrolled ? 'Already Enrolled' : '+ Enroll in Class'}
        </button>
      </div>
    `;
  }).join('');
};

window.enrollStudentIntoCurrentClass = async studentId => {
  if (!isFacultyHod()) return toast('Only the department HOD can change student enrollment.', 'warn');
  if (!selectedClassForRoster) return;
  if (!getTermClasses().some(item => String(item.id) === String(selectedClassForRoster.id))) { toast('You do not have access to that section.', 'danger'); return; }
  for (const sectionClass of getSectionClasses(selectedClassForRoster)) {
    await FaceAPI.enrollStudent(sectionClass.id, studentId);
  }
  const student = getVisibleStudents().find(item => String(item.id) === String(studentId));
  if (student) student.section = getClassSectionLabel(selectedClassForRoster);
  DB.save();
  toast('Student enrolled in section');
  $('#student-lookup').dispatchEvent(new Event('submit'));
  renderClassRoster();
};

window.unenrollStudentFromClass = async (classId, studentId) => {
  if (!isFacultyHod()) return toast('Only the department HOD can change student enrollment.', 'warn');
  const cls = getTermClasses().find(item => String(item.id) === String(classId));
  if (!cls) { toast('You do not have access to that section.', 'danger'); return; }
  if (confirm('Remove this student from the section? Their college profile and attendance history will remain saved.')) {
    for (const sectionClass of getSectionClasses(cls)) {
      await FaceAPI.unenrollStudent(sectionClass.id, studentId);
    }
    toast('Student removed from section');
    renderClassRoster();
  }
};

$('#register-class-student').onclick = () => {
  if (!isFacultyHod()) return toast('Student registration is available to HOD accounts.', 'warn');
  if (selectedClassForRoster) {
    registrationClassId = selectedClassForRoster.id;
    $('#s-dept').value = selectedClassForRoster.department || 'CSE';
    $('#s-year').value = selectedClassForRoster.year || '3rd Year';
    $('#s-sec').value = selectedClassForRoster.label || selectedClassForRoster.section || '';
  }
  show('register');
};

// ==========================================================
// 4. BIOMETRIC REGISTRATION CONTROLLER
// ==========================================================
const CAPTURE_POSES = [
  { pose: 'front', instruction: 'Look directly into the camera lens with a neutral expression.', label: 'Front' },
  { pose: 'left', instruction: 'Gently turn your head slightly to your left.', label: 'Left' },
  { pose: 'right', instruction: 'Gently turn your head slightly to your right.', label: 'Right' },
  { pose: 'up', instruction: 'Tilt your chin slightly upwards.', label: 'Up' },
  { pose: 'down', instruction: 'Tilt your chin slightly downwards.', label: 'Down' }
];

function renderStudentRegistration() {
  if (regStream) stopRegCamera();
  const now = new Date();
  $('#s-date').value = now.toISOString().slice(0, 10);

  if (registrationClassId && selectedClassForRoster) {
    $('#s-dept').value = selectedClassForRoster.department || 'CSE';
    $('#s-year').value = selectedClassForRoster.year || '3rd Year';
  }

  const preferredSection = registrationClassId && selectedClassForRoster
    ? selectedClassForRoster.label
    : $('#s-sec').value;
  populateRegisteredSections(preferredSection);
  setRegistrationStep(1);
  updateCaptureControls();
}

function populateRegisteredSections(preferredSection = '') {
  const department = $('#s-dept').value === 'OTHER'
    ? $('#s-dept-other').value.trim()
    : $('#s-dept').value;
  const year = $('#s-year').value;
  const sectionCounts = new Map();
  const matchingClasses = getTermClasses().filter(cls => cls.department === department && cls.year === year);

  (COLLEGE_CONFIG.sectionCatalog?.[department] || []).forEach(section => {
    if (!sectionCounts.has(section)) sectionCounts.set(section, { students: new Set(), classes: 0 });
  });

  matchingClasses.forEach(cls => {
    const section = String(cls.label || `${cls.department}-${cls.section || ''}`).trim();
    if (!sectionCounts.has(section)) sectionCounts.set(section, { students: new Set(), classes: 0 });
    const counts = sectionCounts.get(section);
    counts.classes += 1;
    (cls.studentIds || []).forEach(id => counts.students.add(String(id)));
  });

  getTermStudents()
    .filter(student => student.department === department && student.year === year && student.section && student.section !== 'Unassigned')
    .forEach(student => {
      const section = String(student.section).trim();
      if (!sectionCounts.has(section)) sectionCounts.set(section, { students: new Set(), classes: 0 });
      sectionCounts.get(section).students.add(String(student.id));
    });

  const select = $('#s-sec');
  const sections = [...sectionCounts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  select.replaceChildren(new Option('Select a registered section', ''));
  sections.forEach(([section, counts]) => {
    const studentCount = counts.students.size;
    const info = studentCount
      ? `${studentCount} enrolled`
      : counts.classes
        ? `${counts.classes} class${counts.classes === 1 ? '' : 'es'}`
        : 'Section available';
    select.add(new Option(`${section} · ${info}`, section));
  });
  select.add(new Option('Other (add a new section)', 'OTHER'));

  const canKeep = sections.some(([section]) => section === preferredSection);
  select.value = canKeep ? preferredSection : '';
  const otherField = $('#s-sec-other');
  const customSection = select.value === 'OTHER';
  otherField.hidden = !customSection;
  otherField.required = customSection;
}

function keepUppercase(input) {
  input.addEventListener('input', () => {
    const cursor = input.selectionStart;
    const uppercaseValue = input.value.toLocaleUpperCase();
    if (uppercaseValue !== input.value) {
      input.value = uppercaseValue;
      input.setSelectionRange(cursor, cursor);
    }
  });
}

$$('input[type="text"], textarea').forEach(keepUppercase);

$('#s-dept').addEventListener('change', () => {
  const otherField = $('#s-dept-other');
  const isOther = $('#s-dept').value === 'OTHER';
  otherField.hidden = !isOther;
  otherField.required = isOther;
  if (isOther) otherField.focus();
  populateRegisteredSections();
});

$('#s-dept-other').addEventListener('input', () => populateRegisteredSections());
$('#s-year').addEventListener('change', () => populateRegisteredSections());

$('#s-sec').addEventListener('change', () => {
  const otherField = $('#s-sec-other');
  const isOther = $('#s-sec').value === 'OTHER';
  otherField.hidden = !isOther;
  otherField.required = isOther;
  if (isOther) otherField.focus();
});

function setRegistrationStep(step) {
  const detailsTab = $('#registration-tab-1');
  const captureTab = $('#registration-tab-2');
  const detailsPanel = $('#registration-panel-1');
  const capturePanel = $('#registration-panel-2');
  const showCapture = step === 2;

  detailsPanel.hidden = showCapture;
  capturePanel.hidden = !showCapture;
  detailsTab.classList.toggle('active', !showCapture);
  captureTab.classList.toggle('active', showCapture);
  detailsTab.setAttribute('aria-selected', String(!showCapture));
  captureTab.setAttribute('aria-selected', String(showCapture));
  captureTab.disabled = !$('#s-name').value.trim() || !$('#s-roll').value.trim();
}

$('#registration-continue').onclick = async () => {
  const name = $('#s-name');
  const roll = $('#s-roll');
  if (!name.value.trim()) {
    name.setCustomValidity('Enter the student name to continue.');
    name.reportValidity();
    name.setCustomValidity('');
    return;
  }
  if (!roll.value.trim()) {
    roll.setCustomValidity('Enter the university roll number to continue.');
    roll.reportValidity();
    roll.setCustomValidity('');
    return;
  }
  setRegistrationStep(2);
  $('#reg-msg').textContent = 'Allow camera access to begin face capture. You can also upload a profile photo.';
  await startRegistrationCamera();
};

$('#registration-back').onclick = () => { stopRegCamera(); setRegistrationStep(1); };
$('#registration-tab-1').onclick = () => { stopRegCamera(); setRegistrationStep(1); };
$('#registration-tab-2').onclick = () => {
  if (!$('#registration-tab-2').disabled) setRegistrationStep(2);
};
['#s-name', '#s-roll'].forEach(selector => {
  $(selector).addEventListener('input', () => {
    $('#registration-tab-2').disabled = !$('#s-name').value.trim() || !$('#s-roll').value.trim();
  });
});

function updateCaptureControls() {
  const count = regCaptures.length;
  const next = CAPTURE_POSES[count];

  $('#capture-step-num').textContent = Math.min(count + 1, 5);
  $('#capture-count').textContent = `${count} / 5 captures completed`;
  $('#capture-pose').textContent = next
    ? next.instruction
    : 'All 5 facial biometric angles recorded. Ready for enrollment.';

  const captureBtn = $('#reg-capture');
  captureBtn.disabled = !regStream || !next;
  captureBtn.textContent = next ? `📸 Capture ${next.label} Angle` : 'All Angles Recorded';

  $('#reg-reset').disabled = count === 0;
  $('#reg-save').disabled = count < 5 && !uploadedProfilePhoto;

  // Update thumbnail gallery
  const slots = $$('#capture-thumbs .thumb-slot');
  slots.forEach((slot, i) => {
    if (regCaptures[i]) {
      slot.classList.add('captured');
      const url = URL.createObjectURL(regCaptures[i].blob);
      slot.innerHTML = `<img src="${url}" alt="Capture ${i + 1}">`;
    } else {
      slot.classList.remove('captured');
      slot.innerHTML = `<span>${i + 1}. ${CAPTURE_POSES[i].label}</span>`;
    }
  });
}

async function startRegistrationCamera() {
  if (regStream) return;
  regStream = await startCamera($('#reg-video'));
  if (regStream) {
    $('#reg-cam-off').hidden = true;
    $('#reg-cam').textContent = '⏹ Stop Camera';
    $('#reg-msg').textContent = 'Camera is ready. Follow each pose and capture it to continue.';
    try { await $('#reg-video').play(); } catch {}
    updateCaptureControls();
  } else {
    $('#reg-msg').textContent = 'Camera is off. Select Start Camera to try again, or use an uploaded profile photo.';
  }
}

$('#reg-cam').onclick = async () => {
  if (regStream) stopRegCamera();
  else await startRegistrationCamera();
};

$('#reg-capture').onclick = async () => {
  if (!regStream || regCaptures.length >= CAPTURE_POSES.length) return;
  const currentStep = CAPTURE_POSES[regCaptures.length];
  const blob = await captureFrameBlob($('#reg-video'));

  if (!blob) {
    toast('Failed to capture frame. Please try again.', 'danger');
    return;
  }

  regCaptures.push({ pose: currentStep.pose, blob });
  playChime();
  $('#reg-msg').textContent = `Captured ${currentStep.label} angle.`;
  updateCaptureControls();
};

$('#reg-reset').onclick = () => {
  regCaptures = [];
  $('#reg-msg').textContent = 'Captures reset.';
  updateCaptureControls();
};

const photoCropCanvas = $('#photo-crop-canvas');
const photoCropContext = photoCropCanvas.getContext('2d');
function getCompressedCropDataUrl() {
  const output = document.createElement('canvas');
  output.width = Math.min(320, photoCropCanvas.width);
  output.height = Math.min(320, photoCropCanvas.height);
  output.getContext('2d').drawImage(photoCropCanvas, 0, 0, output.width, output.height);
  return output.toDataURL('image/jpeg', 0.78);
}

function drawPhotoCropPreview() {
  if (!cropSourceImage) return;
  const width = photoCropCanvas.width;
  const height = photoCropCanvas.height;
  const scale = Math.max(width / cropSourceImage.naturalWidth, height / cropSourceImage.naturalHeight) * cropZoom;
  const drawWidth = cropSourceImage.naturalWidth * scale;
  const drawHeight = cropSourceImage.naturalHeight * scale;
  const overflowX = Math.max(0, (drawWidth - width) / 2);
  const overflowY = Math.max(0, (drawHeight - height) / 2);
  const x = (width - drawWidth) / 2 - overflowX * cropPan.x;
  const y = (height - drawHeight) / 2 - overflowY * cropPan.y;

  photoCropContext.clearRect(0, 0, width, height);
  photoCropContext.fillStyle = '#ffffff';
  photoCropContext.fillRect(0, 0, width, height);
  photoCropContext.drawImage(cropSourceImage, x, y, drawWidth, drawHeight);
}

$('#s-photo-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    $('#photo-upload-status').textContent = 'Choose an image file to continue.';
    event.target.value = '';
    return;
  }

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This image could not be opened.'));
      image.src = dataUrl;
    });
    cropSourceImage = image;
    cropZoom = 1;
    cropPan = { x: 0, y: 0 };
    drawPhotoCropPreview();
    uploadedProfilePhoto = getCompressedCropDataUrl();
    $('#profile-photo-preview').src = uploadedProfilePhoto;
    $('#photo-upload-preview').hidden = false;
    $('#photo-upload-status').textContent = 'Preview the square crop or adjust it before registration.';
    updateCaptureControls();
  } catch (error) {
    uploadedProfilePhoto = '';
    cropSourceImage = null;
    $('#photo-upload-preview').hidden = true;
    $('#photo-upload-status').textContent = error.message;
    updateCaptureControls();
  }
});

$('#photo-crop-open').onclick = () => {
  if (!cropSourceImage) return;
  $('#photo-crop-zoom').value = cropZoom;
  drawPhotoCropPreview();
  $('#photo-crop-dialog').showModal();
};
$('#photo-crop-close').onclick = () => $('#photo-crop-dialog').close();
$('#photo-crop-cancel').onclick = () => $('#photo-crop-dialog').close();
$('#photo-crop-zoom').addEventListener('input', event => {
  cropZoom = Number(event.target.value);
  drawPhotoCropPreview();
});
$('#photo-crop-reset').onclick = () => {
  cropZoom = 1;
  cropPan = { x: 0, y: 0 };
  $('#photo-crop-zoom').value = cropZoom;
  drawPhotoCropPreview();
};
$('#photo-crop-apply').onclick = () => {
  if (!cropSourceImage) return;
  uploadedProfilePhoto = getCompressedCropDataUrl();
  $('#profile-photo-preview').src = uploadedProfilePhoto;
  $('#photo-upload-status').textContent = 'Cropped photo ready to use.';
  $('#photo-crop-dialog').close();
  updateCaptureControls();
};
$('#student-edit-photo-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onerror = () => toast('Could not read the selected photo.', 'danger');
  reader.onload = () => {
    const image = new Image();
    image.onload = () => { cropSourceImage = image; cropZoom = 1; cropPan = { x: 0, y: 0 }; $('#photo-crop-zoom').value = '1'; drawPhotoCropPreview(); $('#photo-crop-dialog').showModal(); };
    image.onerror = () => toast('The selected photo could not be opened.', 'danger');
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});
$('#photo-crop-apply').addEventListener('click', async () => {
  if (!selectedStudentForEdit || !uploadedProfilePhoto) return;
  const result = await FaceAPI.updateStudent(selectedStudentForEdit, { photo: uploadedProfilePhoto });
  if (!result.ok) { toast(result.error || 'Photo could not be saved.', 'danger'); return; }
  uploadedProfilePhoto = ''; cropSourceImage = null;
  renderStudentEditor(); renderStudents(); toast('Student photo updated.');
});

function closeEditFaceCapture() {
  if (editFaceStream) editFaceStream.getTracks().forEach(track => track.stop());
  editFaceStream = null; $('#edit-face-video').srcObject = null; $('#edit-face-dialog').close();
}
$('#student-edit-recapture').addEventListener('click', async () => {
  if (!selectedStudentForEdit) return;
  editFaceCaptures = []; $('#edit-face-count').textContent = '0 / 5 captures';
  $('#edit-face-save').disabled = true; $('#edit-face-capture').disabled = true;
  $('#edit-face-dialog').showModal();
});
$('#edit-face-camera').addEventListener('click', async () => {
  if (editFaceStream) return;
  editFaceStream = await startCamera($('#edit-face-video'));
  if (editFaceStream) { try { await $('#edit-face-video').play(); } catch {} $('#edit-face-capture').disabled = false; }
});
$('#edit-face-capture').addEventListener('click', async () => {
  const pose = CAPTURE_POSES[editFaceCaptures.length]; if (!pose || !editFaceStream) return;
  const blob = await captureFrameBlob($('#edit-face-video')); if (!blob) { toast('Could not capture this pose.', 'danger'); return; }
  editFaceCaptures.push({ pose: pose.pose, blob });
  $('#edit-face-count').textContent = `${editFaceCaptures.length} / 5 captures`;
  $('#edit-face-pose').textContent = CAPTURE_POSES[editFaceCaptures.length]?.instruction || 'All five poses captured.';
  $('#edit-face-save').disabled = editFaceCaptures.length !== 5;
  $('#edit-face-capture').disabled = editFaceCaptures.length === 5;
});
$('#edit-face-save').addEventListener('click', async () => {
  const result = await FaceAPI.recaptureStudentFace(selectedStudentForEdit, editFaceCaptures);
  if (!result.ok) { toast(result.error || 'Face capture could not be saved.', 'danger'); return; }
  closeEditFaceCapture(); toast('Face recapture saved.');
});
$('#edit-face-close').addEventListener('click', closeEditFaceCapture);
$('#edit-face-dialog').addEventListener('close', () => { if (editFaceStream) editFaceStream.getTracks().forEach(track => track.stop()); editFaceStream = null; $('#edit-face-video').srcObject = null; });
photoCropCanvas.addEventListener('pointerdown', event => {
  if (!cropSourceImage) return;
  cropDragPoint = { x: event.clientX, y: event.clientY };
  photoCropCanvas.setPointerCapture(event.pointerId);
});
photoCropCanvas.addEventListener('pointermove', event => {
  if (!cropDragPoint || !cropSourceImage) return;
  const rect = photoCropCanvas.getBoundingClientRect();
  const scale = Math.max(photoCropCanvas.width / cropSourceImage.naturalWidth, photoCropCanvas.height / cropSourceImage.naturalHeight) * cropZoom;
  const overflowX = Math.max(1, (cropSourceImage.naturalWidth * scale - photoCropCanvas.width) / 2);
  const overflowY = Math.max(1, (cropSourceImage.naturalHeight * scale - photoCropCanvas.height) / 2);
  cropPan.x = Math.max(-1, Math.min(1, cropPan.x - (event.clientX - cropDragPoint.x) * photoCropCanvas.width / rect.width / overflowX));
  cropPan.y = Math.max(-1, Math.min(1, cropPan.y - (event.clientY - cropDragPoint.y) * photoCropCanvas.height / rect.height / overflowY));
  cropDragPoint = { x: event.clientX, y: event.clientY };
  drawPhotoCropPreview();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => photoCropCanvas.addEventListener(type, () => { cropDragPoint = null; }));

$('#photo-clear').onclick = () => {
  $('#s-photo-file').value = '';
  $('#profile-photo-preview').removeAttribute('src');
  $('#photo-upload-preview').hidden = true;
  uploadedProfilePhoto = '';
  cropSourceImage = null;
  cropZoom = 1;
  cropPan = { x: 0, y: 0 };
  updateCaptureControls();
};

$('#reg-save').onclick = async () => {
  const name = $('#s-name').value.trim();
  const roll = $('#s-roll').value.trim();
  const admissionNumber = $('#s-admission').value.trim();
  const dept = $('#s-dept').value === 'OTHER'
    ? $('#s-dept-other').value.trim()
    : $('#s-dept').value;
  const year = $('#s-year').value;
  const sec = $('#s-sec').value === 'OTHER'
    ? $('#s-sec-other').value.trim()
    : $('#s-sec').value;
  const assignClassId = registrationClassId || '';
  const msgBox = $('#reg-msg');

  if (!name || !roll) {
    msgBox.textContent = 'Please enter student name and university roll number.';
    return;
  }

  if (!dept) {
    $('#s-dept-other').reportValidity();
    msgBox.textContent = 'Please enter the department name.';
    return;
  }
  if (!sec) {
    if ($('#s-sec').value === 'OTHER') $('#s-sec-other').reportValidity();
    else $('#s-sec').reportValidity();
    msgBox.textContent = 'Please select or enter a department section.';
    return;
  }

  const fullSectionName = $('#s-sec').value === 'OTHER'
    ? canonicalSectionName(dept, sec)
    : sec;

  const saveBtn = $('#reg-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Enrolling Student...';
  msgBox.textContent = 'Synthesizing facial embeddings...';

  const fileInput = $('#s-photo-file');

  const res = await FaceAPI.registerStudent({
    name,
    roll,
    admissionNumber,
    department: dept,
    year,
    section: fullSectionName,
    photo: uploadedProfilePhoto,
    parentName: $('#s-parent-name').value.trim(),
    parentPhone: $('#s-parent-phone').value.trim(),
    parentEmail: $('#s-parent-email').value.trim()
  }, regCaptures);

  saveBtn.textContent = 'Complete Biometric Registration';

  if (!res.ok) {
    msgBox.textContent = res.error || 'Registration failed.';
    saveBtn.disabled = false;
    return;
  }

  // A manually entered section must become a real department section as well
  // as a student profile, so it appears in Students immediately.
  let registeredSection = getTermClasses().find(cls =>
    String(cls.department || '').toUpperCase() === dept.toUpperCase() &&
    String(cls.year || '').toLowerCase() === year.toLowerCase() &&
    getClassSectionLabel(cls).toUpperCase() === fullSectionName.toUpperCase()
  );
  if (!registeredSection) {
    const created = await FaceAPI.addClass({
      department: dept,
      year,
      section: fullSectionName,
      label: fullSectionName,
      subject: '',
      code: '',
      room: '',
      time: '',
      days: [],
      studentIds: []
    });
    if (created.ok) registeredSection = created.class;
  }

  if (registeredSection) {
    const sectionEnrollments = await Promise.all(
      getSectionClasses(registeredSection).map(sectionClass => FaceAPI.enrollStudent(sectionClass.id, res.student.id))
    );
    if (sectionEnrollments.some(result => !result.ok)) {
      toast(`Student registered, but could not add them to ${fullSectionName}.`, 'warn');
    } else {
      toast(`Student registered in ${fullSectionName}.`);
    }
  } else {
    toast(`Student registered, but ${fullSectionName} could not be created. Add the section from Students.`, 'warn');
  }

  // Clear form
  $('#s-name').value = '';
  $('#s-roll').value = '';
  $('#s-admission').value = '';
  $('#s-dept').value = 'CSE';
  $('#s-dept-other').value = '';
  $('#s-dept-other').hidden = true;
  $('#s-dept-other').required = false;
  $('#s-sec').value = '';
  $('#s-sec-other').value = '';
  $('#s-sec-other').hidden = true;
  $('#s-sec-other').required = false;
  fileInput.value = '';
  $('#profile-photo-preview').removeAttribute('src');
  $('#photo-upload-preview').hidden = true;
  uploadedProfilePhoto = '';
  cropSourceImage = null;
  cropZoom = 1;
  cropPan = { x: 0, y: 0 };
  regCaptures = [];
  stopRegCamera();
  updateCaptureControls();

  if (assignClassId && selectedClassForRoster && String(selectedClassForRoster.id) === String(assignClassId)) {
    registrationClassId = null;
    show('class-roster');
  } else {
    registrationClassId = null;
    show('students');
  }
};

// ==========================================================
// 5. TAKE ATTENDANCE SETUP & LIVE SESSION
// ==========================================================
function renderSetup() {
  $('#c-subject').value = '';
  $('#c-date').value = new Date().toISOString().slice(0, 10);
  $('#c-confidence').value = DB.config.confidenceThreshold ?? 0.75;
  $('#c-late-minutes').value = DB.config.lateAfterMinutes ?? 10;
  $('#c-session-notes').value = '';

  const select = $('#c-class-select');
  const assignments = getTermClasses();
  select.innerHTML = assignments.length
    ? assignments.map(cls => `<option value="${escapeHtml(cls.id)}">${escapeHtml(getClassSectionLabel(cls))} · ${escapeHtml(cls.department)} Department · ${escapeHtml(cls.year)}${cls.subject ? ` · ${escapeHtml(cls.subject)}` : ' · Choose subject'} (${getSectionStudents(cls).length} students)</option>`).join('')
    : '<option value="">No department sections available - create one first</option>';

  select.disabled = !assignments.length;
  $('#c-go').disabled = !assignments.length;
  if (pendingSetupClassId) {
    const selectedClass = getTermClasses().find(cls => String(cls.id) === String(pendingSetupClassId));
    if (selectedClass) select.value = String(selectedClass.id);
    pendingSetupClassId = null;
  }

  select.onchange = () => {
    fillLectureDetailsFromClass();
    refreshSetupSubjectOptions();
    updateSetupRosterPreview();
  };
  fillLectureDetailsFromClass();
  refreshSetupSubjectOptions();
  updateSetupRosterPreview();
}

function refreshSetupSubjectOptions() {
  const select = $('#c-subject-select');
  if (!select) return;
  const cls = getTermClasses().find(item => String(item.id) === String($('#c-class-select').value));
  const assignedSubject = cls?.subjectId ? DB.subjects.find(subject => String(subject.id) === String(cls.subjectId)) : null;
  const candidates = (DB.subjects || []).filter(subject => cls && subject.department === cls.department && subject.year === cls.year && (!subject.termId || String(subject.termId) === String(DB.selectedTermId)));
  select.innerHTML = `<option value="">Choose a subject</option>${(assignedSubject ? [assignedSubject] : candidates).map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.code)} · ${escapeHtml(subject.name)}</option>`).join('')}`;
  select.value = assignedSubject?.id || '';
  select.disabled = !!assignedSubject;
  $('#c-subject').value = assignedSubject?.name || '';
}
$('#c-subject-select').addEventListener('change', async () => {
  const subject = DB.subjects.find(item => String(item.id) === String($('#c-subject-select').value));
  if (subject && !DB.classes.find(item => String(item.id) === String($('#c-class-select').value))?.subjectId) {
    $('#c-subject').value = subject.name;
    if (await linkClassSubject($('#c-class-select').value, subject.id) && USE_MOCK) DB.save();
    refreshSetupSubjectOptions();
  }
});

function fillLectureDetailsFromClass() {
  const cls = getTermClasses().find(c => String(c.id) === String($('#c-class-select').value));
  $('#c-slot').value = cls?.time || '09:00 AM - 10:00 AM';
  $('#c-room').value = cls?.room || 'Room 304 / Lab 3';
}

function updateSetupRosterPreview() {
  const classId = $('#c-class-select').value;
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  const container = $('#setup-roster-list');
  const countLabel = $('#setup-roster-count');

  if (!cls) {
    countLabel.textContent = 'No class selected.';
    container.innerHTML = '';
    return;
  }

  const roster = getSectionStudents(cls);
  countLabel.textContent = `${roster.length} student${roster.length === 1 ? '' : 's'} in this section:`;

  if (!roster.length) {
    container.innerHTML = `<p class="muted">No students are registered in this section yet.</p>`;
    return;
  }

  container.innerHTML = roster.map(s => `
    <div class="setup-preview-row">
      <span class="dot" style="background: var(--emerald-600);"></span>
      <b>${s.name}</b>
      <span class="muted" style="margin-left: auto; font-size: 0.8rem;">${s.roll}</span>
    </div>
  `).join('');
}

$('#c-go').onclick = async () => {
  $('#c-msg').hidden = true;
  const classId = $('#c-class-select').value;
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  if (!cls) return;

  const subject = $('#c-subject').value.trim();
  const lectureTime = $('#c-slot').value.trim();
  const room = $('#c-room').value.trim();
  const lectureDate = $('#c-date').value;
  if (!subject || !lectureTime || !room || !lectureDate) {
    $('#c-msg').textContent = 'Enter the lecture subject, date, time, and classroom before continuing.';
    $('#c-msg').hidden = false;
    return;
  }

  const roster = getSectionStudents(cls);
  if (!roster.length) {
    toast('No students enrolled in this class. Add students before taking attendance.', 'warn');
    openClassRoster(cls);
    return;
  }

  const mode = $('input[name="att-mode"]:checked')?.value || 'manual';
  const selectedSubject = (cls.subjectId && DB.subjects.find(item => String(item.id) === String(cls.subjectId))) || DB.subjects.find(item => String(item.id) === String($('#c-subject-select').value) && item.name === subject) || await ensureSubjectForClass(cls, subject);
  if (!selectedSubject) return toast('Choose or enter a valid subject before continuing.', 'warn');
  if (!await linkClassSubject(cls.id, selectedSubject.id)) return;
  const duplicate = getVisibleHistory().some(record => String(record.classId) === String(cls.id) &&
    ((record.subjectCode && selectedSubject?.code) ? String(record.subjectCode).toLowerCase() === String(selectedSubject.code).toLowerCase() : record.subject === subject) &&
    record.lectureTime === lectureTime && record.dateISO === lectureDate);
  if (duplicate) {
    $('#c-msg').textContent = 'Attendance is already recorded for this section, subject, slot, and date.';
    $('#c-msg').hidden = false;
    return;
  }
  DB.config.confidenceThreshold = Number($('#c-confidence').value);
  DB.config.lateAfterMinutes = Math.max(0, Math.min(180, Math.floor(Number($('#c-late-minutes').value) || 0)));
  DB.save();
  startSession(cls, mode, { subject: selectedSubject.name, lectureTime, room, lectureDate, subjectId: selectedSubject.id, subjectCode: selectedSubject.code, notes: $('#c-session-notes').value.trim() });
};

$$('input[name="att-mode"]').forEach(input => {
  input.addEventListener('change', () => {
    $$('.attendance-method-cards .radio-card').forEach(card => {
      card.classList.toggle('selected', card.querySelector('input').checked);
    });
  });
});
$('#camera-mode-note').hidden = false;
$('#camera-mode-note').textContent = 'Camera recognition connects to the service configured in api.js. Manual roll call stays available if the service is offline.';

window.openAttendanceSetupForSection = classId => {
  const cls = getTermClasses().find(item => String(item.id) === String(classId));
  if (!cls) { toast('You do not have access to that section.', 'danger'); return; }
  pendingSetupClassId = classId;
  show('setup');
};

// Initialize Live Biometric Session
function startSession(cls, mode = 'manual', details = {}) {
  if (!getTermClasses().some(item => String(item.id) === String(cls?.id))) { toast('You do not have access to that section.', 'danger'); return; }
  const roster = getSectionStudents(cls);
  activeAttendanceMode = mode;
  const sessionClass = {
    ...cls,
    subject: details.subject || cls.subject,
    ...(details.subjectCode ? { subjectCode: details.subjectCode } : {}),
    ...(details.subjectId ? { subjectId: details.subjectId } : {}),
    room: details.room || cls.room,
    lectureTime: details.lectureTime || cls.time,
    lectureDate: details.lectureDate || localDateIso()
  };
  const sessionTerm = DB.getCurrentTerm(sessionClass.lectureDate);
  if (sessionTerm.noRunningTerm) { toast('No semester is scheduled for this date. Add or activate a term in Settings first.', 'danger'); return; }
  if (String(DB.selectedTermId || '') !== String(sessionTerm.id) && !confirm(`Attendance will be recorded under Semester ${sessionTerm.semester} (${sessionTerm.academicYear}), not the term currently selected in the viewer. Continue?`)) return;
  const semesterForClass = DB.getSemesterForYear(cls.year, sessionTerm.type) || Number(sessionTerm.semester);
  activeSession = {
    ...sessionClass,
    studentIds: roster.map(s => s.id),
    present: {},
    unknownCount: 0,
    ...(details.notes ? { notes: details.notes } : {}),
    termId: sessionTerm.id,
    academicYear: sessionTerm.academicYear,
    semester: `Semester ${semesterForClass}`,
    startTime: new Date()
  };

  $('#live-title').textContent = sessionClass.subject;
  $('#live-sub').textContent = `${sessionClass.label} · ${sessionClass.room || 'Room 304'} · ${sessionClass.lectureTime || 'Time not set'}`;
  const showCamera = activeAttendanceMode === 'camera';
  $('#live-scanner-column').hidden = !showCamera;
  $('.live-grid').classList.toggle('manual-only', !showCamera);

  if (showCamera) resetRecognitionBanner();
  renderLiveRoster();
  show('live');

  if (showCamera) startLiveCamera();
}

async function startLiveCamera() {
  if (liveStream) return;
  liveStream = await startCamera($('#live-video'));
  if (liveStream) {
    $('#cam-off').hidden = true;
    $('#cam-toggle').textContent = '⏹ Stop Camera';
    $('#result').className = 'result-banner';
    $('#result').textContent = 'Camera connected. Connecting to the face recognition service…';
    liveLoop = setInterval(processLiveBiometricFrame, 3200);
  }
}

$('#cam-toggle').onclick = () => {
  if (liveStream) {
    stopLiveCamera();
  } else {
    startLiveCamera();
  }
};

function resetRecognitionBanner() {
  $('#result').className = 'result-banner';
  $('#result').innerHTML = `
    <div class="result-initial">
      <span class="icon">🔍</span>
      <div>
        <b>Face Recognition Engine Active</b>
        <p class="muted">Position student face inside frame, or use manual quick-mark.</p>
      </div>
    </div>
  `;
}

function renderLiveRoster() {
  if (!activeSession) return;
  const enrolled = getVisibleStudents().filter(s => (activeSession.studentIds || []).map(String).includes(String(s.id)));
  const presentIds = Object.keys(activeSession.present).map(Number);
  const presentCount = presentIds.length;
  const absentCount = enrolled.length - presentCount;
  const percent = enrolled.length > 0 ? Math.round((presentCount / enrolled.length) * 100) : 0;

  $('#count').textContent = `${presentCount} Present · ${absentCount} Not Marked`;
  $('#live-progress-fill').style.width = `${percent}%`;
  $('#live-progress-text').textContent = `${percent}% Attendance (${presentCount}/${enrolled.length})`;

  const query = String($('#live-search-input').value || '').trim().toLowerCase();
  const filtered = enrolled.filter(s =>
    !query || s.name.toLowerCase().includes(query) || String(s.roll).toLowerCase().includes(query)
  );

  const container = $('#live-list');
  container.innerHTML = filtered.map(s => {
    const isPresent = Boolean(activeSession.present[s.id]);
    const rec = activeSession.present[s.id];
    const badgeInfo = isPresent
      ? `<span class="badge ${rec.status === 'medical' || rec.status === 'on-duty' ? 'warn' : rec.late || rec.status === 'late' ? 'warn' : 'ok'}">✓ ${escapeHtml(rec.status === 'medical' ? 'Medical' : rec.status === 'on-duty' ? 'On duty' : rec.late || rec.status === 'late' ? 'Late' : rec.time || 'Present')}</span>`
      : `<span class="badge" style="background: var(--canvas);">Absent</span>`;

    return `
      <div class="live-student-row ${isPresent ? 'present' : ''}" onclick="toggleStudentPresence(${s.id})">
        <div>
          <b>${s.name}</b>
          <div class="muted" style="font-size: 0.78rem;">${s.roll} ${rec && rec.method === 'face' ? '· Biometric' : ''}</div>
        </div>
        ${badgeInfo}<select aria-label="Attendance status for ${escapeHtml(s.name)}" onclick="event.stopPropagation()" onchange="setLiveStudentStatus('${escapeHtml(s.id)}', this.value)"><option value="">Set status</option><option value="present">Present</option><option value="late">Late</option><option value="on-duty">On duty</option><option value="medical">Medical</option><option value="absent">Absent</option></select>
      </div>
    `;
  }).join('');
}

window.toggleStudentPresence = studentId => {
  if (!activeSession) return;
  if (activeSession.present[studentId]) {
    delete activeSession.present[studentId];
  } else {
    activeSession.present[studentId] = {
      status: isLate ? 'late' : 'present',
      method: 'manual',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    playChime();
  }
  renderLiveRoster();
};

window.setLiveStudentStatus = (studentId, status) => {
  if (!activeSession || !['present','late','on-duty','medical','absent'].includes(status)) return;
  const previous = activeSession.present[studentId]?.status || 'absent';
  if (status === 'absent') delete activeSession.present[studentId];
  else activeSession.present[studentId] = { status, method: 'manual', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), late: status === 'late' };
  if (['on-duty','medical'].includes(status)) {
    DB.auditLog.push({ action: 'condonation', studentId: String(studentId), sessionId: String(activeSession.id), from: previous, to: status, by: String(DB.teacher?.id || 'unknown'), at: new Date().toISOString(), reason: status === 'medical' ? 'Medical condonation' : 'On-duty condonation' }); DB.save();
  }
  renderLiveRoster();
};

$('#mark-all-btn').onclick = () => {
  if (!activeSession) return;
  activeSession.studentIds.forEach(id => {
    activeSession.present[id] = activeSession.present[id] || {
      status: 'present',
      method: 'manual (all)',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  });
  playChime();
  renderLiveRoster();
  toast('Marked all enrolled students as present');
};

$('#clear-all-btn').onclick = () => {
  if (!activeSession) return;
  activeSession.present = {};
  renderLiveRoster();
  toast('Cleared attendance checklist');
};

$('#live-search-input').addEventListener('input', renderLiveRoster);

// Frame Recognition Engine
async function processLiveBiometricFrame() {
  if (!activeSession || !liveStream || recognitionBusy) return;
  recognitionBusy = true;
  try {
  const video = $('#live-video');
  const blob = liveStream ? await captureFrameBlob(video) : null;

  const result = await FaceAPI.recognizeFrame(blob, activeSession);
  const banner = $('#result');

  const confidenceThreshold = Number(DB.config.confidenceThreshold ?? 0.75);
  if (result.status === 'match' && result.student && Number(result.score) >= confidenceThreshold) {
    const s = result.student;
    const isAlreadyPresent = Boolean(activeSession.present[s.id]);
    const recognitionTime = new Date();
    const startsAtText = String(activeSession.lectureTime || '').split('-')[0].trim();
    const startAt = new Date(`${activeSession.lectureDate || new Date().toISOString().slice(0, 10)} ${startsAtText}`);
    const lateMinutes = Number(DB.config.lateAfterMinutes ?? 10);
    const isLate = Number.isFinite(startAt.getTime()) && recognitionTime.getTime() > startAt.getTime() + lateMinutes * 60000;

    activeSession.present[s.id] = {
      status: 'present',
      method: 'face',
      time: recognitionTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      score: result.score,
      ...(isLate ? { late: true } : {})
    };

    banner.className = 'result-banner match';
    const photoHtml = s.photo
      ? `<img class="match-photo" src="${escapeHtml(s.photo)}" alt="${escapeHtml(s.name || 'Student photo')}">`
      : `<div class="match-photo" style="display:grid;place-items:center;background:var(--emerald-100);color:var(--emerald-900);font-weight:bold;">${escapeHtml(String(s.name || '?')[0])}</div>`;

    banner.innerHTML = `
      <div class="match-student-card">
        ${photoHtml}
        <div>
          <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.roll)})
          <div class="muted" style="font-size: 0.8rem;">
            ${isAlreadyPresent ? 'Verified present' : 'Marked present'} · Match Confidence: ${(result.score * 100).toFixed(1)}%
          </div>
        </div>
        <span class="badge ok" style="margin-left: auto;">Verified ✓</span>
      </div>
    `;

    if (!isAlreadyPresent) playChime();
    renderLiveRoster();
  } else if (result.status === 'unknown') {
    activeSession.unknownCount = Number(activeSession.unknownCount || 0) + 1;
    banner.className = 'result-banner';
    banner.textContent = result.message || 'No enrolled student matched. Try again or mark attendance manually.';
  } else if (result.status === 'unverified') {
    banner.className = 'result-banner';
    banner.innerHTML = `<span class="icon">⚠️</span><span>${result.message || 'Face angle unclear. Please look straight at camera.'}</span>`;
  } else if (result.status === 'unavailable') {
    banner.className = 'result-banner';
    banner.textContent = result.message || 'Camera recognition is unavailable.';
  } else if (result.status === 'match') {
    const reviewThreshold = Number(DB.config.reviewThreshold ?? .55);
    if (result.student && Number(result.score) >= reviewThreshold) {
      DB.reviewQueue ||= [];
      const item = { id: `review-${Date.now()}-${result.student.id}`, studentId: String(result.student.id), sessionId: String(activeSession.id), score: Number(result.score), at: new Date().toISOString() };
      DB.reviewQueue.push(item); DB.save(); renderRecognitionReviewQueue();
      banner.className = 'result-banner'; banner.textContent = `Possible match queued for review (${(result.score * 100).toFixed(1)}%).`;
    } else {
      banner.className = 'result-banner';
      banner.textContent = `Match confidence is below the review threshold. Ask the student to reposition or mark manually.`;
    }
  }
  } catch {
    $('#result').textContent = 'Recognition could not process this frame. Continue with manual attendance.';
  } finally {
    recognitionBusy = false;
  }
}
let recognitionBusy = false;

// End Session Dialog & Completion
$('#end-btn').onclick = () => {
  if (!activeSession) return;
  const enrolled = getVisibleStudents().filter(s => (activeSession.studentIds || []).map(String).includes(String(s.id)));
  const presentCount = Object.keys(activeSession.present).length;
  const absentCount = enrolled.length - presentCount;
  const percent = enrolled.length > 0 ? Math.round((presentCount / enrolled.length) * 100) : 0;

  $('#end-session-desc').textContent = `${activeSession.subject} (${activeSession.label}) · Conducted on ${new Date().toLocaleDateString('en-GB')}`;
  $('#end-session-stats').innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; margin: 1rem 0; text-align: center;">
      <div class="metric-box"><b>${enrolled.length}</b><span>Enrolled</span></div>
      <div class="metric-box" style="background: var(--status-ok-bg);"><b style="color: var(--status-ok-text);">${presentCount}</b><span>Present</span></div>
      <div class="metric-box" style="background: var(--status-danger-bg);"><b style="color: var(--status-danger-text);">${absentCount}</b><span>Absent</span></div>
    </div>
    <p class="muted" style="font-size: 0.82rem; text-align: center;">
      Attendance rate: <b>${percent}%</b>. Unmarked students will be recorded as absent.
    </p>
  `;
  const absentNames = enrolled.filter(student => !activeSession.present[student.id]).map(student => student.name || 'Unnamed student');
  $('#end-session-extra').textContent = `Unknown faces: ${Number(activeSession.unknownCount || 0)} · Absent: ${absentNames.length ? absentNames.join(', ') : 'None'}`;

  $('#end-session-modal').showModal();
};

$('#end-session-cancel').onclick = () => $('#end-session-modal').close();

$('#end-session-confirm').onclick = async () => {
  $('#end-session-modal').close();
  const res = await FaceAPI.saveSession(activeSession);
  if (!res.ok) {
    $('#end-session-modal').showModal();
    toast(res.error || 'Could not save attendance. Your session is still open.', 'danger');
    return;
  }
  stopLiveCamera();
  activeSession = null;
  toast('Lecture attendance recorded successfully in university register!');
  show('history');
  if (res.session) openSessionModal(res.session.id);
};

// ==========================================================
// 6. ATTENDANCE HISTORY CONTROLLER
// ==========================================================
function renderHistory() {
  const container = $('#hist-body');
  const classFilter = $('#history-class-filter');

  // Populate class filter dropdown
  classFilter.innerHTML = '<option value="all">All Sections</option>' +
    getSectionGroups().map(group => `<option value="${group.representative.id}">${group.label} · ${group.department} Department</option>`).join('');

  filterAndRenderHistoryTable();
}

function populateSemesterFilter(select, allLabel) {
  if (!select) return;
  const selected = select.value || 'all';
  const termId = String(DB.selectedTermId || DB.terms.find(term => term.status === 'active')?.id || '');
  const semesters = [...new Set(getVisibleHistory().filter(session => String(session.termId || '') === termId).map(session => session.semester).filter(Boolean))];
  select.innerHTML = `<option value="all">${allLabel}</option>${semesters.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = [...select.options].some(option => option.value === selected) ? selected : 'all';
}
const renderHistoryWithSemesters = renderHistory;
renderHistory = function () { renderHistoryWithSemesters(); populateSemesterFilter($('#history-semester-filter'), 'All semesters'); filterAndRenderHistoryTable(); };
const getHistoryBeforeSemester = getFilteredHistoryRecords;
getFilteredHistoryRecords = function () {
  const records = getHistoryBeforeSemester();
  const termId = String(DB.selectedTermId || DB.terms.find(term => term.status === 'active')?.id || '');
  const visibleClassIds = new Set(getTermClasses().map(cls => String(cls.id)));
  return records.filter(session => String(session.termId || '') === termId && visibleClassIds.has(String(session.classId)));
};

function filterAndRenderHistoryTable() {
  const records = getFilteredHistoryRecords();
  const container = $('#hist-body');
  if (!records.length) {
    container.innerHTML = `<tr><td colspan="9" class="muted" style="text-align: center; padding: 2rem;">No attendance session logs match your search.</td></tr>`;
    return;
  }

  container.innerHTML = records.map(h => {
    const total = (h.present || 0) + (h.absent || 0);
    const rate = total > 0 ? Math.round((h.present / total) * 100) : null;
    const badgeTone = rate === null ? '' : rate >= getMinAttendance() ? 'ok' : rate >= getWarningThreshold() ? 'warn' : 'danger';

    return `
      <tr>
        <td><b>${h.date}</b><br><small class="muted">${h.time || ''}</small></td>
        <td><b>${h.subject || 'Lecture'}</b></td>
        <td><span class="badge ok">${h.section || h.classLabel || '—'}</span></td>
        <td>${h.room || 'Room not recorded'}</td>
        <td>${total}</td>
        <td style="color: var(--status-ok-text); font-weight: bold;">${h.present}</td>
        <td style="color: var(--status-danger-text); font-weight: bold;">${h.absent}</td>
        <td><span class="badge ${badgeTone}">${rate === null ? 'No data yet' : `${rate}%`}</span></td>
        <td><button class="btn-xs" onclick="openSessionModal('${h.id}')">Inspect</button></td>
      </tr>
    `;
  }).join('');
}

function getFilteredHistoryRecords() {
  const query = String($('#history-search-input').value || '').trim().toLowerCase();
  const selectedClass = $('#history-class-filter').value;

  let records = getVisibleHistory();
  if (selectedClass !== 'all') {
    const selected = getTermClasses().find(cls => String(cls.id) === String(selectedClass));
    const sectionIds = new Set(getSectionClasses(selected).map(cls => String(cls.id)));
    records = records.filter(h => sectionIds.has(String(h.classId)));
  }
  if (query) {
    records = records.filter(h =>
      (h.subject && h.subject.toLowerCase().includes(query)) ||
      (h.section && h.section.toLowerCase().includes(query)) ||
      (h.date && h.date.toLowerCase().includes(query))
    );
  }
  return records;
}

$('#history-search-input').addEventListener('input', filterAndRenderHistoryTable);
$('#history-class-filter').addEventListener('change', filterAndRenderHistoryTable);
$('#history-semester-filter').addEventListener('change', filterAndRenderHistoryTable);

$('#history-export-csv').onclick = () => {
  const rows = [
    ['Session ID', 'Date', 'Time', 'Lecture Subject', 'Department Section', 'Room', 'Total Enrolled', 'Present', 'Absent', 'Attendance Percent'],
    ...getFilteredHistoryRecords().map(h => {
      const tot = (h.present || 0) + (h.absent || 0);
      const rate = tot > 0 ? Math.round((h.present / tot) * 100) : 0;
      return [h.id, h.date, h.time || '', h.subject, h.section || h.classLabel, h.room || '', tot, h.present, h.absent, `${rate}%`];
    })
  ];
  downloadCsv(rows, `college-attendance-history-${new Date().toISOString().slice(0, 10)}.csv`);
};

// Session Drilldown Modal
let inspectedSessionId = null;

window.openSessionModal = sessionId => {
  const session = getVisibleHistory().find(h => String(h.id) === String(sessionId));
  if (!session) return;
  inspectedSessionId = session.id;

  $('#sess-modal-title').textContent = session.subject;
  const lectureTimeMeta = session.lectureTime ? ` · Lecture ${session.lectureTime}` : '';
  $('#sess-modal-meta').textContent = `${session.date} · ${session.time || ''}${lectureTimeMeta} · ${session.section || session.classLabel} · ${session.room || 'Main Hall'}`;

  const visibleStudents = new Map(getVisibleStudents().map(student => [String(student.id), student]));
  const enrolled = (session.studentIds || []).map(id => visibleStudents.get(String(id))).filter(Boolean);
  const presentIds = new Set((session.presentIds || []).map(String));

  $('#sess-modal-stats').innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; margin: 1.2rem 0;">
      <div class="metric-box"><b>${enrolled.length}</b><span>Enrolled</span></div>
      <div class="metric-box" style="background: var(--status-ok-bg);"><b style="color: var(--status-ok-text);">${session.present}</b><span>Present</span></div>
      <div class="metric-box" style="background: var(--status-danger-bg);"><b style="color: var(--status-danger-text);">${session.absent}</b><span>Absent</span></div>
    </div>
  `;

  const container = $('#sess-modal-body');
  container.innerHTML = enrolled.map(s => {
    const isPresent = presentIds.has(String(s.id));
    const rec = (session.records || {})[String(s.id)] || {};
    const methodStr = rec.method === 'face' ? '📷 Biometric Face' : isPresent ? '📋 Manual' : '—';

    return `
      <tr>
        <td><b>${s.name}</b></td>
        <td>${s.roll}</td>
        <td><span class="badge ${isPresent ? 'ok' : 'danger'}">${isPresent ? 'Present' : 'Absent'}</span></td>
        <td><small class="muted">${methodStr}</small></td>
        <td><small class="muted">${rec.time || session.time || '—'}</small></td>
        <td>
          <button class="btn-xs ${isPresent ? 'danger' : 'primary'}" onclick="togglePastSessionAttendance('${session.id}', ${s.id}, '${isPresent ? 'absent' : 'present'}')">Mark ${isPresent ? 'Absent' : 'Present'}</button>
        </td>
      </tr>
    `;
  }).join('');

  $('#session-modal').showModal();
};

const openSessionModalWithLateBadges = window.openSessionModal;
window.openSessionModal = sessionId => {
  openSessionModalWithLateBadges(sessionId);
  const session = getVisibleHistory().find(item => String(item.id) === String(sessionId));
  if (!session) return;
  const rows = $$('#sess-modal-body tr');
  rows.forEach(row => {
    const student = getVisibleStudents().find(item => String(item.roll) === String(row.children[1]?.textContent));
    const record = student && (session.records || {})[String(student.id)];
    if (record?.late) {
      const badge = document.createElement('span'); badge.className = 'badge warn'; badge.textContent = 'Late';
      row.children[2]?.append(' ', badge);
    }
  });
};

window.togglePastSessionAttendance = async (sessionId, studentId, newStatus) => {
  const session = getVisibleHistory().find(item => String(item.id) === String(sessionId));
  if (!session) return toast('You do not have access to this attendance session.', 'danger');
  const res = await FaceAPI.updateSessionRecord(sessionId, studentId, newStatus);
  if (!res.ok) { toast(res.error || 'Could not update this record.', 'danger'); return; }
  toast(`Updated record for student`);
  openSessionModal(sessionId);
  renderHistory();
};

function renderAuditLog() {
  const list = $('#audit-log-list');
  const visibleSessionIds = new Set(getVisibleHistory().map(session => String(session.id)));
  const entries = (DB.auditLog || []).filter(entry => visibleSessionIds.has(String(entry.sessionId || '')));
  list.innerHTML = entries.length ? entries.slice().reverse().map(entry => `<article class="subject-master-row"><div><b>${escapeHtml(entry.from)} → ${escapeHtml(entry.to)}</b><p class="muted">Student ${escapeHtml(entry.studentId)} · Session ${escapeHtml(entry.sessionId)} · ${escapeHtml(entry.by)} · ${escapeHtml(entry.at)}</p><p>${escapeHtml(entry.reason)}</p></div></article>`).join('') : '<p class="muted">No attendance overrides have been recorded.</p>';
}
const togglePastSessionAttendanceWithAudit = window.togglePastSessionAttendance;
window.togglePastSessionAttendance = (sessionId, studentId, newStatus) => new Promise(resolve => {
  const dialog = $('#audit-reason-dialog');
  const input = $('#audit-reason-input');
  input.value = '';
  const cleanup = () => { $('#audit-reason-save').removeEventListener('click', submit); $('#audit-reason-cancel').removeEventListener('click', cancel); };
  const cancel = () => { cleanup(); dialog.close(); resolve(); };
  const submit = async () => {
    const reason = input.value.trim();
    if (!reason) { input.reportValidity(); input.focus(); return; }
    cleanup(); dialog.close();
    const session = getVisibleHistory().find(item => String(item.id) === String(sessionId));
    const previous = (session?.presentIds || []).map(String).includes(String(studentId)) ? 'present' : 'absent';
    await togglePastSessionAttendanceWithAudit(sessionId, studentId, newStatus);
    const updatedSession = getVisibleHistory().find(item => String(item.id) === String(sessionId));
    const isNowPresent = (updatedSession?.presentIds || []).map(String).includes(String(studentId));
    if ((newStatus === 'present') !== isNowPresent) { resolve(); return; }
    DB.auditLog ||= [];
    DB.auditLog.push({ studentId: String(studentId), sessionId: String(sessionId), from: previous, to: newStatus, by: String(DB.teacher?.id || 'unknown'), at: new Date().toISOString(), reason });
    if (!DB.save()) { DB.auditLog.pop(); toast('Attendance changed, but its audit entry could not be saved. Free storage and record the change again.', 'danger'); }
    renderAuditLog(); resolve();
  };
  $('#audit-reason-save').addEventListener('click', submit);
  $('#audit-reason-cancel').addEventListener('click', cancel);
  dialog.showModal();
});

$('#sess-modal-close').onclick = () => $('#session-modal').close();
$('#sess-modal-done').onclick = () => $('#session-modal').close();

$('#sess-modal-delete').onclick = async () => {
  if (confirm('Delete this attendance session log permanently?')) {
    const res = await FaceAPI.deleteSession(inspectedSessionId);
    if (!res.ok) { toast(res.error || 'Could not delete this session.', 'danger'); return; }
    $('#session-modal').close();
    toast('Session record deleted');
    renderHistory();
    renderDashboard();
  }
};

// ==========================================================
// 7. REPORTS & DEFAULTER ANALYSIS CONTROLLER
// ==========================================================
function renderReports() {
  const container = $('#rep-classes');
  const termClasses = getTermClasses();
  if (selectedClassForReport && !termClasses.some(cls => String(cls.id) === String(selectedClassForReport.id))) selectedClassForReport = null;
  if (!termClasses.length) {
    container.innerHTML = `<p class="muted">No department sections available.</p>`;
    return;
  }

  container.innerHTML = getSectionGroups().map(group => {
    const c = group.representative;
    const count = getSectionStudents(c).length;
    const isSelected = selectedClassForReport && getSectionClasses(c).some(item => String(item.id) === String(selectedClassForReport.id));
    return `
      <button class="report-class-btn ${isSelected ? 'selected' : ''}" onclick="selectReportClassById('${c.id}')">
        <span class="badge ok">${group.label}</span>
        <b style="display: block; margin: 0.35rem 0 0.15rem; font-size: 1rem;">${group.department} Department</b>
        <span class="muted" style="font-size: 0.8rem;">${group.year} · ${count} students</span>
      </button>
    `;
  }).join('');

  if (selectedClassForReport) {
    showClassReport(selectedClassForReport);
  } else if (termClasses.length) {
    selectReportClassById(termClasses[0].id);
  }
}

window.selectReportClassById = classId => {
  const cls = getTermClasses().find(c => String(c.id) === String(classId));
  if (cls) {
    selectedClassForReport = cls;
    renderReports();
  } else toast('You do not have access to that section.', 'danger');
};

function showClassReport(cls) {
  cls = getTermClasses().find(item => String(item.id) === String(cls?.id));
  if (!cls) { toast('You do not have access to that section.', 'danger'); return; }
  selectedClassForReport = cls;
  $('#rep-detail').hidden = false;

  $('#rep-dept-badge').textContent = `${cls.department} · ${cls.year}`;
  $('#rep-class-title').textContent = `${getClassSectionLabel(cls)} Student Attendance`;

  const enrolled = getSectionStudents(cls);
  const classSessions = getSectionSessions(cls);
  const totalConducted = classSessions.length;

  let totalAttendedCount = 0;
  let defaultersCount = 0;
  let criticalCount = 0;
  let eligibleCount = 0;

  const studentLedger = enrolled.map(s => {
    const stats = calculateSectionAttendance(s.id, cls);
    totalAttendedCount += stats.attended;
    if (stats.status === 'critical') criticalCount++;
    if (stats.status === 'warning' || stats.status === 'critical') defaultersCount++;
    if (stats.status === 'eligible') eligibleCount++;
    return { student: s, stats };
  });

  const totalStudentSessions = studentLedger.reduce((sum, item) => sum + item.stats.total, 0);
  const overallAvg = totalStudentSessions > 0
    ? `${Math.round((totalAttendedCount / totalStudentSessions) * 100)}%`
    : 'No data yet';

  $('#rep-avg-percent').textContent = overallAvg;
  $('#rep-class-note').textContent = `Total ${totalConducted} lecture sessions recorded for this section.`;

  // Update tabs counters
  $('#count-all').textContent = enrolled.length;
  $('#count-defaulters').textContent = defaultersCount;
  $('#count-critical').textContent = criticalCount;
  $('#count-eligible').textContent = eligibleCount;

  // Render metrics row
  $('#rep-metrics-row').innerHTML = `
    <div class="metric-box"><b>${totalConducted}</b><span>Lectures Conducted</span></div>
    <div class="metric-box"><b>${enrolled.length}</b><span>Total Enrolled</span></div>
    <div class="metric-box" style="background: var(--status-ok-bg);"><b style="color: var(--status-ok-text);">${eligibleCount}</b><span>Eligible (&ge;${getMinAttendance()}%)</span></div>
    <div class="metric-box" style="${defaultersCount > 0 ? 'background: var(--status-danger-bg);' : ''}"><b style="${defaultersCount > 0 ? 'color: var(--status-danger-text);' : ''}">${defaultersCount}</b><span>Defaulters (&lt;${getMinAttendance()}%)</span></div>
  `;

  // Render student ledger
  renderReportStudentLedger(studentLedger);
}

function filterSessionsBySubject(sessions, subjectId) {
  if (!subjectId) return sessions;
  const subject = (DB.subjects || []).find(item => String(item.id) === String(subjectId));
  if (!subject) return sessions;
  return sessions.filter(session => String(session.subjectId || '') === String(subject.id) ||
    (session.subjectCode && String(session.subjectCode).toLowerCase() === String(subject.code).toLowerCase()) ||
    String(session.subject || '').toLowerCase() === String(subject.name || '').toLowerCase());
}

function calculateFilteredSectionStats(studentId, cls) {
  const semester = $('#report-semester-filter')?.value || 'all';
  const subjectId = $('#report-subject-filter')?.value || '';
  let sessions = getSectionSessions(cls);
  // Section sessions are already scoped to the globally selected term.
  if (subjectId) sessions = filterSessionsBySubject(sessions, subjectId);
  const total = sessions.length;
  const attended = sessions.filter(session => (session.presentIds || []).map(String).includes(String(studentId))).length;
  const percent = total ? Math.round(attended / total * 100) : null;
  const warning = getWarningThreshold(), min = getMinAttendance();
  const status = percent === null ? 'none' : percent < warning ? 'critical' : percent < min ? 'warning' : 'eligible';
  return { attended, total, percent, status, classesNeeded: percent !== null && percent < min ? calcClassesNeeded(attended, total, min) : 0 };
}

const showClassReportWithSubjectTable = showClassReport;
showClassReport = function (cls) {
  const subject = $('#report-subject-filter')?.value || '';
  const semester = $('#report-semester-filter')?.value || 'all';
  if (!subject && semester === 'all') showClassReportWithSubjectTable(cls);
  else {
    selectedClassForReport = cls; $('#rep-detail').hidden = false;
    $('#rep-dept-badge').textContent = `${cls.department} · ${cls.year}`;
    $('#rep-class-title').textContent = `${getClassSectionLabel(cls)} Student Attendance`;
    const enrolled = getSectionStudents(cls);
    const sessions = getSectionSessions(cls);
    const filteredSessions = subject ? filterSessionsBySubject(sessions, subject) : sessions;
    const ledger = enrolled.map(student => ({ student, stats: calculateFilteredSectionStats(student.id, cls) }));
    const totals = ledger.filter(item => item.stats.percent !== null);
    const average = totals.length ? `${Math.round(totals.reduce((sum, item) => sum + item.stats.percent, 0) / totals.length)}%` : 'No data yet';
    const eligible = ledger.filter(item => item.stats.status === 'eligible').length;
    const defaulters = ledger.filter(item => item.stats.status === 'warning' || item.stats.status === 'critical').length;
    const critical = ledger.filter(item => item.stats.status === 'critical').length;
    $('#rep-avg-percent').textContent = average;
    $('#rep-class-note').textContent = `${filteredSessions.length} matching lecture sessions recorded for this section.`;
    $('#count-all').textContent = enrolled.length; $('#count-defaulters').textContent = defaulters; $('#count-critical').textContent = critical; $('#count-eligible').textContent = eligible;
    $('#rep-metrics-row').innerHTML = `<div class="metric-box"><b>${filteredSessions.length}</b><span>Matching lectures</span></div><div class="metric-box"><b>${enrolled.length}</b><span>Total enrolled</span></div><div class="metric-box"><b>${eligible}</b><span>Eligible (&ge;${getMinAttendance()}%)</span></div><div class="metric-box"><b>${defaulters}</b><span>Defaulters (&lt;${getMinAttendance()}%)</span></div>`;
    renderReportStudentLedger(ledger);
  }
};

function updateReportAcademicControls() {
  const dept = $('#report-department-filter');
  const year = $('#report-year-filter');
  const subject = $('#report-subject-filter');
  const semester = $('#report-semester-filter');
  if (!dept || !year || !subject) return;
  const termClasses = getTermClasses();
  const oldDept = dept.value, oldYear = year.value, oldSubject = subject.value;
  dept.innerHTML = '<option value="">All departments</option>' + [...new Set(termClasses.map(cls => cls.department).filter(Boolean))].map(value => `<option>${escapeHtml(value)}</option>`).join('');
  year.innerHTML = '<option value="">All years</option>' + [...new Set(termClasses.map(cls => cls.year).filter(Boolean))].map(value => `<option>${escapeHtml(value)}</option>`).join('');
  subject.innerHTML = '<option value="">All subjects</option>' + getTermSubjects().map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join('');
  populateSemesterFilter(semester, 'All semesters');
  const defaultDepartment = !reportFiltersInitialized && !isFacultyHod() ? DB.teacher?.department || '' : '';
  dept.value = oldDept || defaultDepartment; year.value = oldYear; subject.value = oldSubject;
  reportFiltersInitialized = true;
  const chipGroups = [
    { key: 'department', current: dept.value, values: [...new Set(termClasses.map(cls => cls.department).filter(Boolean))] },
    { key: 'year', current: year.value, values: [...new Set(termClasses.map(cls => cls.year).filter(Boolean))] }
  ];
  $('#report-filter-chips').innerHTML = chipGroups.map(group => `<div class="report-filter-chip-group"><b>${group.key === 'department' ? 'Department' : 'Year'}</b>${[['', 'All'], ...group.values.map(value => [value, value])].map(([value, label]) => `<button type="button" class="tab-btn report-filter-chip ${group.current === value ? 'active' : ''}" data-report-filter-group="${group.key}" data-report-filter-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('')}</div>`).join('');
  const buttons = $$('#rep-classes .report-class-btn');
  buttons.forEach(button => {
    const text = button.textContent;
    const match = getSectionGroups().find(group => text.includes(group.label));
    button.hidden = !!match && ((dept.value && match.department !== dept.value) || (year.value && match.year !== year.value));
  });
  const departments = [...new Set(termClasses.map(cls => cls.department).filter(Boolean))].filter(name => !dept.value || name === dept.value);
  $('#report-department-summary').innerHTML = departments.map(name => {
    const classes = termClasses.filter(cls => cls.department === name && (!year.value || cls.year === year.value));
    const students = [...new Map(classes.flatMap(cls => getSectionStudents(cls)).map(student => [String(student.id), student])).values()];
    const stats = students.map(student => calculateVisibleAttendance(student.id));
    const measured = stats.filter(item => item.percent !== null);
    const avg = measured.length ? `${Math.round(measured.reduce((sum, item) => sum + item.percent, 0) / measured.length)}%` : 'No data yet';
    const defaulters = measured.filter(item => item.percent < getMinAttendance()).length;
    return `<article class="metric-box"><b>${escapeHtml(name)}</b><span>${students.length} students · average ${avg} · ${defaulters} defaulters</span></article>`;
  }).join('');
  $('#report-department-view').disabled = !isFacultyHod();
  if (selectedClassForReport) {
    const printSessions = getSectionSessions(selectedClassForReport);
    const dates = printSessions.map(session => session.dateISO).filter(Boolean).sort();
    const range = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : 'No records';
    $('#report-print-header').innerHTML = `<b>${escapeHtml(COLLEGE_CONFIG.name)}</b><p>Department: ${escapeHtml(selectedClassForReport.department || '—')} · Date range: ${escapeHtml(range)}</p><div class="print-signature">HOD Signature: ______________________________</div>`;
  }
}
$('#report-filter-chips').addEventListener('click', event => {
  const button = event.target.closest('[data-report-filter-group]'); if (!button) return;
  const target = button.dataset.reportFilterGroup === 'department' ? $('#report-department-filter') : $('#report-year-filter');
  target.value = button.dataset.reportFilterValue;
  updateReportAcademicControls();
});

const renderReportsWithAcademicControls = renderReports;
renderReports = function () {
  renderReportsWithAcademicControls(); updateReportAcademicControls();
  const container = $('#rep-classes');
  const buttons = [...container.querySelectorAll('.report-class-btn')];
  const groups = getSectionGroups();
  if (!buttons.length) return;
  const fragment = document.createDocumentFragment();
  [...new Set(groups.map(group => group.department))].forEach(department => {
    const wrapper = document.createElement('section'); wrapper.className = 'report-department-group';
    const heading = document.createElement('h4'); heading.textContent = `${department} Department`; wrapper.append(heading);
    groups.filter(group => group.department === department).forEach(group => {
      const button = buttons.find(item => item.textContent.includes(group.label) && item.textContent.includes(group.year));
      if (button) wrapper.append(button);
    });
    if (wrapper.querySelector('.report-class-btn')) fragment.append(wrapper);
  });
  container.replaceChildren(fragment);
  updateReportAcademicControls();
};
['report-department-filter', 'report-year-filter'].forEach(id => document.getElementById(id)?.addEventListener('change', updateReportAcademicControls));
$('#report-subject-filter')?.addEventListener('change', () => { if (selectedClassForReport) showClassReport(selectedClassForReport); });
$('#report-semester-filter')?.addEventListener('change', () => { if (selectedClassForReport) showClassReport(selectedClassForReport); });
$('#report-department-view')?.addEventListener('click', () => {
  const department = $('#report-department-filter').value;
  if (!isFacultyHod()) { toast('Whole-department reports are available to HOD accounts.', 'warn'); return; }
  if (!department) { toast('Choose a department first.', 'warn'); return; }
  const classes = getTermClasses().filter(cls => cls.department === department && (!$('#report-year-filter').value || cls.year === $('#report-year-filter').value));
  const visibleStudents = new Map(getVisibleStudents().map(student => [String(student.id), student]));
  const ids = [...new Set(classes.flatMap(cls => getSectionStudents(cls)).map(student => String(student.id)))];
  $('#rep-detail').hidden = false;
  $('#rep-class-title').textContent = `${department} Department Attendance`;
  $('#rep-dept-badge').textContent = `${department} · All sections`;
  $('#rep-class-note').textContent = `${classes.length} sections · ${ids.length} students`;
  $('#rep-body').innerHTML = ids.map(id => visibleStudents.get(id)).filter(Boolean).map(student => {
    const stats = calculateVisibleAttendance(student.id);
    const pct = stats.percent === null ? 'No data yet' : `${stats.percent}%`;
    return `<article class="student-card"><div class="student-card-info"><b>${escapeHtml(student.name)}</b><div>${escapeHtml(getStudentSectionLabel(student))}</div></div><span class="badge ${stats.status}">${pct}</span></article>`;
  }).join('');
});

function renderReportStudentLedger(studentLedger) {
  const query = String($('#rep-search').value || '').trim().toLowerCase();

  const filtered = studentLedger.filter(item => {
    const s = item.student;
    const stats = item.stats;

    // Filter tab criteria
    if (activeReportFilter === 'defaulters' && (stats.percent === null || stats.percent >= getMinAttendance())) return false;
    if (activeReportFilter === 'critical' && stats.status !== 'critical') return false;
    if (activeReportFilter === 'eligible' && stats.status !== 'eligible') return false;
    if (activeReportRange.min !== null && (stats.percent === null || stats.percent < activeReportRange.min)) return false;
    if (activeReportRange.max !== null && (stats.percent === null || stats.percent > activeReportRange.max)) return false;

    // Query match
    if (query && !s.name.toLowerCase().includes(query) && !String(s.roll).toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  const container = $('#rep-body');
  if (!filtered.length) {
    container.innerHTML = `<p class="muted" style="padding: 1rem;">No students match the selected filter criteria.</p>`;
    return;
  }

  container.innerHTML = filtered.map(({ student: s, stats }) => {
    const photoHtml = s.photo
      ? `<img class="student-thumb" src="${s.photo}" alt="${s.name}">`
      : `<div class="student-thumb placeholder">${s.name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase()}</div>`;

    const classesNeededLabel = stats.classesNeeded === Infinity ? 'Not reachable' : stats.classesNeeded;
    const advice = stats.classesNeeded > 0
      ? `<div style="font-size: 0.74rem; color: var(--status-danger-text); margin-top: 0.25rem;">Needs ${classesNeededLabel} consecutive classes to reach ${getMinAttendance()}%</div>`
      : `<div style="font-size: 0.74rem; color: var(--status-ok-text); margin-top: 0.25rem;">Exceeds minimum eligibility</div>`;

    return `
      <div class="student-card" onclick="openStudentProfileById('${escapeHtml(s.id)}')">
        ${photoHtml}
        <div class="student-card-info">
          <b>${escapeHtml(s.name)}</b>
          <div class="student-roll">Roll: ${escapeHtml(s.roll)} · ${escapeHtml(getStudentSectionLabel(s))}</div>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">
            Attended: <b>${stats.attended} / ${stats.total}</b> sessions
          </div>
          ${advice}
        </div>
        <div class="student-card-actions">
          <span class="student-tag ${stats.status}">${stats.percent === null ? 'No data yet' : `${stats.percent}%`}</span>
          <button class="btn-xs" style="margin-top: auto;">Audit</button>
        </div>
      </div>
    `;
  }).join('');
}

// Adds the student calculator beside each existing report-card advice line.
const renderReportStudentLedgerWithBuffer = renderReportStudentLedger;
renderReportStudentLedger = function (studentLedger) {
  renderReportStudentLedgerWithBuffer(studentLedger);
  const query = String($('#rep-search').value || '').trim().toLowerCase();
  const visible = studentLedger.filter(({ student: s, stats }) => {
    if (activeReportFilter === 'defaulters' && (stats.percent === null || stats.percent >= getMinAttendance())) return false;
    if (activeReportFilter === 'critical' && stats.status !== 'critical') return false;
    if (activeReportFilter === 'eligible' && stats.status !== 'eligible') return false;
    if (activeReportRange.min !== null && (stats.percent === null || stats.percent < activeReportRange.min)) return false;
    if (activeReportRange.max !== null && (stats.percent === null || stats.percent > activeReportRange.max)) return false;
    return !query || String(s.name || '').toLowerCase().includes(query) || String(s.roll || '').toLowerCase().includes(query);
  });
  $$('#rep-body .student-card').forEach((card, index) => {
    const entry = visible[index];
    if (!entry || card.querySelector('.attendance-buffer-advice')) return;
    const buffer = calcAttendanceBuffer(entry.stats.attended, entry.stats.total, getMinAttendance(), getWarningThreshold());
    const line = document.createElement('div');
    line.className = 'attendance-buffer-advice muted';
    line.textContent = buffer.percent === null ? 'No data yet' : buffer.percent >= getMinAttendance()
      ? `Can miss ${buffer.canMiss} more ${buffer.canMiss === 1 ? 'class' : 'classes'} and stay eligible`
      : `Needs ${buffer.classesNeeded === Infinity ? 'Not reachable' : buffer.classesNeeded} consecutive ${buffer.classesNeeded === 1 ? 'class' : 'classes'} to reach ${getMinAttendance()}%`;
    card.querySelector('.student-card-info')?.append(line);
    if (buffer.percent !== null && buffer.percent < getMinAttendance() && (entry.student.parentPhone || entry.student.parentEmail)) {
      const message = `Attendance alert for ${entry.student.name}: current attendance is ${buffer.percent}%. ${buffer.classesNeeded === Infinity ? 'The required limit is not reachable.' : `Classes needed: ${buffer.classesNeeded}.`}`;
      const contact = document.createElement('a');
      contact.className = 'btn-xs'; contact.textContent = 'Notify parent'; contact.target = '_blank'; contact.rel = 'noopener';
      contact.addEventListener('click', event => event.stopPropagation());
      contact.href = entry.student.parentPhone
        ? `https://wa.me/${String(entry.student.parentPhone).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
        : `mailto:${encodeURIComponent(entry.student.parentEmail)}?subject=${encodeURIComponent('Attendance alert')}&body=${encodeURIComponent(message)}`;
      card.querySelector('.student-card-actions')?.append(contact);
    }
  });
};

// Report Filter Tabs
$$('#report-filter-tabs .tab-btn').forEach(btn => {
  btn.onclick = () => {
    $$('#report-filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeReportFilter = btn.dataset.filter;
    if (selectedClassForReport) showClassReport(selectedClassForReport);
  };
});

$('#rep-search').addEventListener('input', () => {
  if (selectedClassForReport) showClassReport(selectedClassForReport);
});

$('#rep-filter-toggle').onclick = () => {
  const panel = $('#rep-filter-panel');
  panel.hidden = !panel.hidden;
  $('#rep-filter-toggle').setAttribute('aria-expanded', String(!panel.hidden));
};
$('#rep-filter-apply').onclick = () => {
  const minText = $('#rep-filter-min').value.trim();
  const maxText = $('#rep-filter-max').value.trim();
  const min = minText === '' ? null : Number(minText);
  const max = maxText === '' ? null : Number(maxText);
  const message = $('#rep-filter-message');
  if ((min !== null && (!Number.isFinite(min) || min < 0 || min > 100)) ||
      (max !== null && (!Number.isFinite(max) || max < 0 || max > 100)) ||
      (min !== null && max !== null && min > max)) {
    message.textContent = 'Enter a range from 0 to 100, with the lower value first.';
    message.hidden = false;
    return;
  }
  activeReportRange = { min, max };
  message.hidden = true;
  if (selectedClassForReport) showClassReport(selectedClassForReport);
};
$('#rep-filter-clear').onclick = () => {
  activeReportRange = { min: null, max: null };
  $('#rep-filter-min').value = '';
  $('#rep-filter-max').value = '';
  $('#rep-filter-message').hidden = true;
  if (selectedClassForReport) showClassReport(selectedClassForReport);
};

$('#csv-btn').onclick = () => {
  if (!selectedClassForReport) return;
  const cls = selectedClassForReport;
  const enrolled = getSectionStudents(cls);
  const classSessions = getSectionSessions(cls);

  const headers = [
    'University Roll Number',
    'Student Name',
    'Department',
    'Section',
    'Total Lectures Conducted',
    'Lectures Attended',
    'Attendance Percentage',
    'Eligibility Status',
    `Classes Needed to Reach ${getMinAttendance()}%`
  ];

  const rows = [
    headers,
    ...enrolled.map(s => {
      const stats = calculateSectionAttendance(s.id, cls);
      return [
        s.roll,
        s.name,
        cls.department,
        getStudentSectionLabel(s),
        stats.total,
        stats.attended,
        stats.percent === null ? 'No data yet' : `${stats.percent}%`,
        stats.status.toUpperCase(),
        stats.classesNeeded === Infinity ? 'Not reachable' : stats.classesNeeded
      ];
    })
  ];

  downloadCsv(rows, `official-attendance-report-${getClassSectionLabel(cls)}.csv`);
};

$('#print-report-btn').onclick = () => {
  window.print();
};

function downloadCsv(rows, filename) {
  const content = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
const downloadCsvWithEmptyValues = downloadCsv;
downloadCsv = (rows, filename) => downloadCsvWithEmptyValues(rows.map(row => row.map(value => typeof value === 'string' && value.toLowerCase() === 'null%' ? '—' : value)), filename);

// ==========================================================
// 8. STUDENT PROFILE & AUDIT DIALOG
// ==========================================================
window.openStudentProfileById = studentId => {
  const student = getTermStudents().find(s => String(s.id) === String(studentId));
  if (!student) return;

  const dialog = $('#student-dialog');
  dialog.dataset.studentId = String(student.id);

  $('#student-dialog-name').textContent = student.name;
  $('#student-dialog-roll').textContent = `University Roll Number: ${student.roll}`;
  const studentContext = getVisibleStudentContext(student);
  $('#student-dialog-admission').textContent = isFacultyHod() ? student.admissionNumber || 'Not provided' : '';
  $('#student-dialog-admission').closest('.detail-cell').hidden = !isFacultyHod();
  $('#student-dialog-department').textContent = student.department || studentContext.department || '—';
  $('#student-dialog-year').textContent = student.year || studentContext.year || '—';
  $('#student-dialog-section').textContent = getStudentSectionLabel(student);
  $('#student-dialog-email').textContent = isFacultyHod() ? student.email || `${student.name.toLowerCase().replace(/\s+/g, '.')}@student.college.edu` : '';
  $('#student-dialog-email').closest('.detail-cell').hidden = !isFacultyHod();
  $('#student-dialog-date').textContent = isFacultyHod() ? student.date || '—' : '';
  $('#student-dialog-date').closest('.detail-cell').hidden = !isFacultyHod();
  $('#student-dialog-delete').hidden = !isFacultyHod();

  const stats = calculateVisibleAttendance(student.id);
  $('#student-dialog-attendance').textContent = stats.percent === null ? 'No data yet' : `${stats.attended} / ${stats.total} sessions (${stats.percent}%)`;

  const statusBadge = $('#student-dialog-status-badge');
  statusBadge.className = `student-tag ${stats.status}`;
  statusBadge.textContent = stats.status.toUpperCase();

  const photoImg = $('#student-dialog-photo');
  const initialsDiv = $('#student-dialog-initials');
  photoImg.onerror = () => {
    photoImg.hidden = true;
    photoImg.removeAttribute('src');
    initialsDiv.hidden = false;
    initialsDiv.textContent = student.name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  if (student.photo) {
    photoImg.src = student.photo;
    photoImg.hidden = false;
    initialsDiv.hidden = true;
  } else {
    photoImg.hidden = true;
    initialsDiv.hidden = false;
    initialsDiv.textContent = student.name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase();
  }

  // Render Student Past Lecture History
  const studentSessions = getVisibleHistory().filter(h => (h.studentIds || []).map(String).includes(String(student.id)));
  const historyList = $('#student-dialog-history-list');

  if (!studentSessions.length) {
    historyList.innerHTML = `<p class="muted" style="font-size: 0.8rem;">No past sessions recorded for this student's courses.</p>`;
  } else {
    historyList.innerHTML = `
      <div class="session-history-table" role="table" aria-label="Lecture-by-lecture attendance">
        <div class="session-history-table-head" role="row">
          <span role="columnheader">Date</span>
          <span role="columnheader">Subject</span>
          <span role="columnheader">Attendance</span>
        </div>
        ${studentSessions.map(h => {
      const isPresent = (h.presentIds || []).includes(String(student.id));
      return `
        <div class="session-history-row" role="row">
          <time class="session-history-date" role="cell">${h.date || h.dateISO || 'Date unavailable'}${h.time ? `<small>${h.time}</small>` : ''}</time>
          <div class="session-history-subject-cell" role="cell">
            <b class="session-history-subject">${h.subject || 'Untitled subject'}</b>
            <small class="session-history-section">${h.section || h.classLabel || '—'}</small>
          </div>
          <span class="badge ${isPresent ? 'ok' : 'danger'}" role="cell">${isPresent ? 'Present ✓' : 'Absent ✗'}</span>
        </div>
      `;
        }).join('')}
      </div>`;
  }

  $('#student-view-mode').hidden = false;
  dialog.showModal();
};

// Additive profile-dialog calculator wrapper; attendance data remains read-only.
const openStudentProfileWithBuffer = window.openStudentProfileById;
window.openStudentProfileById = studentId => {
  openStudentProfileWithBuffer(studentId);
  const student = getTermStudents().find(s => String(s.id) === String(studentId));
  if (!student) return;
  const stats = calculateVisibleAttendance(student.id);
  const buffer = calcAttendanceBuffer(stats.attended, stats.total, getMinAttendance(), getWarningThreshold());
  $('#student-dialog-buffer').textContent = buffer.percent === null ? 'No data yet' : buffer.percent >= getMinAttendance()
    ? `Can miss ${buffer.canMiss} more ${buffer.canMiss === 1 ? 'class' : 'classes'} and stay eligible`
    : `Needs ${buffer.classesNeeded === Infinity ? 'Not reachable' : buffer.classesNeeded} consecutive ${buffer.classesNeeded === 1 ? 'class' : 'classes'}`;
  $('#student-what-if-attend').value = '0';
  $('#student-what-if-miss').value = '0';
  $('#student-what-if-result').textContent = buffer.percent === null ? 'No data yet' : `Current: ${buffer.percent}% · ${buffer.status}`;
};

function updateStudentWhatIf() {
  const studentId = $('#student-dialog').dataset.studentId;
  const student = getTermStudents().find(s => String(s.id) === String(studentId));
  if (!student) return;
  const base = calculateVisibleAttendance(student.id);
  const attend = Math.max(0, Math.floor(Number($('#student-what-if-attend').value) || 0));
  const miss = Math.max(0, Math.floor(Number($('#student-what-if-miss').value) || 0));
  const projected = calcAttendanceBuffer(base.attended + attend, base.total + attend + miss, getMinAttendance(), getWarningThreshold());
  $('#student-what-if-result').textContent = projected.percent === null ? 'No data yet' : `Projected: ${projected.percent}% · ${projected.status}`;
}
$('#student-what-if-attend').addEventListener('input', updateStudentWhatIf);
$('#student-what-if-miss').addEventListener('input', updateStudentWhatIf);

$('#student-dialog-close').onclick = () => $('#student-dialog').close();
$('#student-dialog-done').onclick = () => $('#student-dialog').close();

function renderStudentEditor() {
  updateStudentEditorFilters();
  const query = String($('#student-edit-search').value || '').trim().toLowerCase();
  const list = $('#student-edit-list');
  const department = $('#student-edit-filter-department').value;
  const year = $('#student-edit-filter-year').value;
  const section = $('#student-edit-filter-section').value;
  const students = getTermStudents()
    .filter(student => (!department || student.department === department) && (!year || student.year === year) && (!section || getStudentSectionLabel(student) === section))
    .filter(student => !query || String(student.name || '').toLowerCase().includes(query) || String(student.roll || '').toLowerCase().includes(query))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  list.replaceChildren();
  if (!students.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = query || department || year || section ? 'No students match the selected filters.' : 'No student profiles are available.';
    list.append(empty);
    return;
  }
  students.forEach(student => {
    const row = document.createElement('div');
    row.className = 'student-edit-list-row';
    const details = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = student.name || 'Unnamed student';
    const meta = document.createElement('small');
    meta.textContent = `${student.roll || 'No roll number'} · ${student.department || 'Department not set'} · ${student.year || 'Year not set'} · ${getStudentSectionLabel(student)}`;
    details.append(name, meta);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary';
    button.dataset.studentEdit = String(student.id);
    button.textContent = 'Edit Profile';
    row.append(details, button);
    list.append(row);
  });
}

function updateStudentEditorFilters() {
  const department = $('#student-edit-filter-department');
  const year = $('#student-edit-filter-year');
  const section = $('#student-edit-filter-section');
  if (!department || !year || !section) return;
  const oldDepartment = department.value, oldYear = year.value, oldSection = section.value;
  const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const setOptions = (select, label, values, previous) => {
    select.innerHTML = `<option value="">All ${label}</option>${unique(values).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    select.value = [...select.options].some(option => option.value === previous) ? previous : '';
  };
  const visibleStudents = getTermStudents();
  setOptions(department, 'departments', visibleStudents.map(student => student.department), oldDepartment);
  const departmentStudents = visibleStudents.filter(student => !department.value || student.department === department.value);
  setOptions(year, 'years', departmentStudents.map(student => student.year), oldYear);
  const sectionStudents = departmentStudents.filter(student => !year.value || student.year === year.value);
  setOptions(section, 'sections', sectionStudents.map(getStudentSectionLabel).filter(value => value !== '—'), oldSection);
}

function beginStudentEdit(studentId) {
  const student = getTermStudents().find(s => String(s.id) === String(studentId));
  if (!student) return;
  selectedStudentForEdit = String(student.id);
  populateStudentEditLocations(student);
  $('#student-edit-name').value = student.name;
  $('#student-edit-roll').value = student.roll;
  $('#student-edit-admission').value = student.admissionNumber || '';
  $('#student-edit-email').value = student.email || '';
  $('#student-edit-parent-name').value = student.parentName || '';
  $('#student-edit-parent-phone').value = student.parentPhone || '';
  $('#student-edit-parent-email').value = student.parentEmail || '';
  $('#student-editor-selected-name').textContent = `${student.name} · ${student.roll} · ${student.department || 'Department not set'} · ${student.year || 'Year not set'} · ${getStudentSectionLabel(student)}`;
  $('#student-edit-message').hidden = true;
  $('#student-editor-panel').hidden = false;
  $('#student-editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateStudentEditLocations(student) {
  const dept = $('#student-edit-department'), year = $('#student-edit-year'), section = $('#student-edit-section');
  const deptOther = $('#student-edit-department-other'), yearOther = $('#student-edit-year-other'), sectionOther = $('#student-edit-section-other');
  const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
  const fillSelect = (select, label, values, current) => {
    const choices = unique(values);
    select.innerHTML = `<option value="">Select ${label.toLowerCase()}</option>${choices.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}<option value="__other__">Other…</option>`;
    select.value = choices.includes(current) ? current : '__other__';
  };
  const selectedValue = (select, custom) => select.value === '__other__' ? custom.value.trim() : select.value;
  const toggleOther = (select, custom) => { const useCustom = select.value === '__other__'; custom.hidden = !useCustom; custom.required = useCustom; };
  const visibleStudents = getTermStudents(), visibleClasses = getTermClasses();
  const departments = unique([...visibleClasses.map(cls => cls.department), ...visibleStudents.map(item => item.department)]);
  fillSelect(dept, 'department', departments, student.department || '');
  deptOther.value = dept.value === '__other__' ? student.department || '' : '';
  toggleOther(dept, deptOther);

  const updateSections = () => {
    const department = selectedValue(dept, deptOther), academicYear = selectedValue(year, yearOther);
    const values = [
      ...getTermClasses().filter(cls => cls.department === department && cls.year === academicYear).map(cls => cls.label || cls.section),
      ...visibleStudents.filter(item => item.department === department && item.year === academicYear).map(item => item.section),
      'Unassigned'
    ];
    fillSelect(section, 'section', values, getStudentSectionLabel(student));
    sectionOther.value = section.value === '__other__' ? (student.section || '') : '';
    toggleOther(section, sectionOther);
  };
  const updateYears = () => {
    const department = selectedValue(dept, deptOther);
    const values = [...visibleClasses.filter(cls => cls.department === department).map(cls => cls.year), ...visibleStudents.filter(item => item.department === department).map(item => item.year)];
    fillSelect(year, 'year', values, student.year || '');
    yearOther.value = year.value === '__other__' ? (student.year || '') : '';
    toggleOther(year, yearOther);
    updateSections();
  };
  dept.onchange = () => { toggleOther(dept, deptOther); updateYears(); };
  deptOther.oninput = updateYears;
  year.onchange = () => { toggleOther(year, yearOther); updateSections(); };
  yearOther.oninput = updateSections;
  section.onchange = () => toggleOther(section, sectionOther);
  updateYears();
}

$('#student-edit-search').addEventListener('input', renderStudentEditor);
['student-edit-filter-department', 'student-edit-filter-year', 'student-edit-filter-section'].forEach(id => document.getElementById(id).addEventListener('change', renderStudentEditor));
$('#student-edit-list').addEventListener('click', event => {
  const button = event.target.closest('[data-student-edit]');
  if (button) beginStudentEdit(button.dataset.studentEdit);
});

$('#student-edit-cancel').onclick = () => {
  selectedStudentForEdit = null;
  $('#student-editor-panel').hidden = true;
  $('#student-edit-message').hidden = true;
};

function editLocationValue(field) {
  const select = $(`#student-edit-${field}`);
  return select.value === '__other__' ? $(`#student-edit-${field}-other`).value.trim() : select.value.trim();
}

$('#student-edit-form').onsubmit = async e => {
  e.preventDefault();
  const studentId = selectedStudentForEdit;
  if (!studentId) return;
  const changes = {
    name: $('#student-edit-name').value.trim(),
    roll: $('#student-edit-roll').value.trim(),
    admissionNumber: $('#student-edit-admission').value.trim(),
    department: (editLocationValue('department') || '').toUpperCase(),
    year: editLocationValue('year'),
    section: canonicalSectionName(editLocationValue('department'), editLocationValue('section')),
    email: $('#student-edit-email').value.trim(),
    parentName: $('#student-edit-parent-name').value.trim(),
    parentPhone: $('#student-edit-parent-phone').value.trim(),
    parentEmail: $('#student-edit-parent-email').value.trim()
  };

  const before = getTermStudents().find(student => String(student.id) === String(studentId));
  const previousPlacement = before ? { department: before.department, year: before.year, section: getStudentSectionLabel(before) } : null;
  const previousClasses = before ? getSectionClasses({ department: before.department, year: before.year, label: getStudentSectionLabel(before), studentIds: [before.id] }) : [];
  const placementChanged = previousPlacement && (previousPlacement.department !== changes.department || previousPlacement.year !== changes.year || previousPlacement.section !== changes.section);
  const nextClasses = getTermClasses().filter(cls => cls.department === changes.department && canonicalAcademicYear(cls.year) === canonicalAcademicYear(changes.year) && String(cls.label || cls.section).toLowerCase() === changes.section.toLowerCase());
  if (placementChanged && !nextClasses.length) {
    $('#student-edit-message').textContent = 'Choose a section assigned to your account before moving this student.';
    $('#student-edit-message').hidden = false;
    return;
  }

  const res = await FaceAPI.updateStudent(studentId, changes);
  if (!res.ok) {
    $('#student-edit-message').textContent = res.error || 'Failed to update student.';
    $('#student-edit-message').hidden = false;
    return;
  }

  let placementSyncFailed = false;
  if (placementChanged) {
    for (const cls of previousClasses) { const result = await FaceAPI.unenrollStudent(cls.id, studentId); if (!result.ok) placementSyncFailed = true; }
    for (const cls of nextClasses) { const result = await FaceAPI.enrollStudent(cls.id, studentId); if (!result.ok) placementSyncFailed = true; }
  }

  toast(placementSyncFailed ? 'Profile saved, but section enrollment could not be fully synchronized.' : 'Student details updated', placementSyncFailed ? 'danger' : 'ok');
  selectedStudentForEdit = null;
  $('#student-editor-panel').hidden = true;
  $('#student-edit-message').hidden = true;
  renderStudentEditor();
  renderStudents();
  if (selectedClassForRoster) renderClassRoster();
  if (selectedClassForReport) showClassReport(selectedClassForReport);
};

// New directory renderer. The original editor remains available as a fallback.
function renderStudentDirectory() {
  try {
    ensureStudentDirectorySetup();
    studentDirectoryReady = true;
    syncStudentDirectoryStateFromControls();
    updateStudentDirectoryFilterOptions();
    renderStudentDirectoryChips();
    renderStudentDirectoryTable();
  } catch (error) {
    console.error('Student directory renderer failed; using the original directory.', error);
    renderStudentEditor();
  }
}

function ensureStudentDirectorySetup() {
  const panel = $('#student-editor-panel');
  const host = $('#student-edit-panel-host');
  if (panel && host && panel.parentElement !== host) host.append(panel);
  if (studentDirectoryReady) return;

  const search = $('#student-edit-search');
  search.addEventListener('input', () => { studentDirectoryState.search = search.value; studentDirectoryState.page = 1; studentDirectoryState.allMatching = false; renderStudentDirectoryTable(); renderStudentDirectoryChips(); });
  ['student-edit-filter-department', 'student-edit-filter-year', 'student-edit-filter-section'].forEach((id, index) => {
    document.getElementById(id).addEventListener('change', () => {
      if (index === 0) { studentDirectoryState.department = document.getElementById(id).value; studentDirectoryState.year = ''; studentDirectoryState.section = ''; }
      if (index === 1) { studentDirectoryState.year = document.getElementById(id).value; studentDirectoryState.section = ''; }
      if (index === 2) studentDirectoryState.section = document.getElementById(id).value;
      studentDirectoryState.page = 1;
      studentDirectoryState.allMatching = false;
      renderStudentDirectory();
    });
  });
  $('#student-directory-chips').addEventListener('click', event => {
    if (event.target.closest('[data-selected-only]')) { studentDirectoryState.selectedOnly = !studentDirectoryState.selectedOnly; studentDirectoryState.page = 1; renderStudentDirectoryChips(); renderStudentDirectoryTable(); return; }
    const chip = event.target.closest('[data-student-quick-filter]');
    if (!chip) return;
    studentDirectoryState.quick = chip.dataset.studentQuickFilter;
    studentDirectoryState.page = 1;
    studentDirectoryState.allMatching = false;
    renderStudentDirectoryChips(); renderStudentDirectoryTable();
  });
  $('#student-directory-clear').addEventListener('click', clearStudentDirectoryFilters);
  $('#student-directory-page-size').addEventListener('change', event => { studentDirectoryState.pageSize = Number(event.target.value) || 25; studentDirectoryState.page = 1; renderStudentDirectoryTable(); });
  $('#student-directory-group').addEventListener('change', event => { studentDirectoryState.group = event.target.checked; if (event.target.checked) { studentDirectoryState.groupDepartmentYear = false; $('#student-directory-group-department-year').checked = false; } renderStudentDirectoryTable(); });
  $('#student-directory-group-department-year').addEventListener('change', event => { studentDirectoryState.groupDepartmentYear = event.target.checked; if (event.target.checked) { studentDirectoryState.group = false; $('#student-directory-group').checked = false; } renderStudentDirectoryTable(); });
  $('#student-directory-pagination').addEventListener('click', event => {
    const button = event.target.closest('[data-directory-page]');
    if (!button || button.disabled) return;
    studentDirectoryState.page = Number(button.dataset.directoryPage) || 1;
    renderStudentDirectoryTable();
  });
  $('#student-edit-list').addEventListener('click', event => {
    const edit = event.target.closest('[data-student-edit]');
    if (edit) {
      event.stopImmediatePropagation();
      studentEditDrawerReturnFocus = edit;
      openStudentEditDrawer(edit.dataset.studentEdit);
      return;
    }
    const sort = event.target.closest('[data-directory-sort]');
    if (sort) { sortStudentDirectory(sort.dataset.directorySort); return; }
    const row = event.target.closest('[data-student-row]');
    if (!row || event.target.closest('button,input,a,select,label')) return;
    event.stopImmediatePropagation();
    studentEditDrawerReturnFocus = row.querySelector('[data-student-edit]');
    openStudentEditDrawer(row.dataset.studentRow);
  }, true);
  $('#student-selection-menu').addEventListener('change', event => applyStudentDirectorySelection(event.target.value));
  $('#student-bulk-clear').addEventListener('click', clearStudentDirectorySelection);
  $('#student-edit-list').addEventListener('click', event => {
    const avatar = event.target.closest('[data-student-avatar-select]');
    if (avatar) { event.preventDefault(); event.stopImmediatePropagation(); toggleStudentDirectorySelection(avatar.dataset.studentAvatarSelect, event); return; }
    const row = event.target.closest('[data-student-row]');
    if (row && event.target.closest('button,input,a,select,label')) return;
  }, true);
  $('#student-edit-list').addEventListener('keydown', event => {
    const avatar = event.target.closest('[data-student-avatar-select]');
    if (!avatar || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation(); toggleStudentDirectorySelection(avatar.dataset.studentAvatarSelect, event);
  }, true);
  $('#student-edit-list').addEventListener('pointerdown', event => {
    const row = event.target.closest('[data-student-row]'); if (!row || event.target.closest('button,a,input')) return;
    studentDirectoryState.longPressTimer = setTimeout(() => { toggleStudentDirectorySelection(row.dataset.studentRow, event); studentDirectoryState.longPressTimer = null; }, 550);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type => $('#student-edit-list').addEventListener(type, () => { clearTimeout(studentDirectoryState.longPressTimer); studentDirectoryState.longPressTimer = null; }));
  $('#student-bulk-export').addEventListener('click', exportSelectedStudentsCsv);
  $('#student-bulk-delete').addEventListener('click', deleteSelectedStudents);
  $('#student-bulk-move').addEventListener('click', openStudentBulkMoveDialog);
  $('#student-bulk-move-close').addEventListener('click', () => $('#student-bulk-move-dialog').close());
  $('#student-bulk-move-cancel').addEventListener('click', () => $('#student-bulk-move-dialog').close());
  $('#student-move-new-section').addEventListener('input', updateStudentMovePreview);
  $('#student-bulk-move-apply').addEventListener('click', applyStudentBulkMove);
  $('#student-import-template').addEventListener('click', () => downloadCsv([['roll', 'name', 'admissionNumber', 'department', 'year', 'section', 'email']], 'student-import-template.csv'));
  $('#student-import-csv-open').addEventListener('click', () => $('#student-import-csv-file').click());
  $('#student-import-csv-file').addEventListener('change', previewStudentCsvImport);
  $('#student-import-preview-close').addEventListener('click', () => $('#student-import-preview-dialog').close());
  $('#student-import-preview-cancel').addEventListener('click', () => $('#student-import-preview-dialog').close());
  $('#student-import-preview-confirm').addEventListener('click', importValidStudentRows);

  setupStudentEditDrawer();
  setupStudentDirectoryStorageGuard();
}

function syncStudentDirectoryStateFromControls() {
  studentDirectoryState.search = $('#student-edit-search').value || '';
  studentDirectoryState.department = $('#student-edit-filter-department').value;
  studentDirectoryState.year = $('#student-edit-filter-year').value;
  studentDirectoryState.section = $('#student-edit-filter-section').value;
  $('#student-directory-page-size').value = String(studentDirectoryState.pageSize);
  $('#student-directory-group').checked = studentDirectoryState.group;
  $('#student-directory-group-department-year').checked = studentDirectoryState.groupDepartmentYear;
}

function updateStudentDirectoryFilterOptions() {
  const department = $('#student-edit-filter-department');
  const year = $('#student-edit-filter-year');
  const section = $('#student-edit-filter-section');
  const groups = getSectionGroups();
  const distinct = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const fill = (select, allLabel, values, chosen) => {
    select.innerHTML = `<option value="">${allLabel}</option>${distinct(values).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    select.value = [...select.options].some(option => option.value === chosen) ? chosen : '';
  };
  const visibleStudents = getTermStudents();
  fill(department, 'All departments', [...groups.map(group => group.department), ...visibleStudents.map(student => student.department)], studentDirectoryState.department);
  const yearValues = groups.filter(group => !department.value || group.department === department.value).map(group => group.year);
  const studentYears = visibleStudents.filter(student => !department.value || student.department === department.value).map(student => student.year);
  fill(year, 'All years', [...yearValues, ...studentYears], studentDirectoryState.year);
  const matchingGroups = groups.filter(group => (!department.value || group.department === department.value) && (!year.value || group.year === year.value)).map(group => group.label);
  const matchingStudentSections = visibleStudents.filter(student => (!department.value || student.department === department.value) && (!year.value || student.year === year.value)).map(getStudentSectionLabel);
  fill(section, 'All sections', [...matchingGroups, ...matchingStudentSections], studentDirectoryState.section);
  studentDirectoryState.department = department.value;
  studentDirectoryState.year = year.value;
  studentDirectoryState.section = section.value;
}

function getStudentFaceDirectoryStatus(student) {
  if ((Number(student.faceCaptureCount) >= 5) || (Array.isArray(student.faceCaptures) && student.faceCaptures.length >= 5)) return { label: '5/5 captured', tone: 'ok', captured: true };
  if (student.photo) return { label: 'Photo only', tone: 'warn', captured: false };
  return { label: 'None', tone: 'danger', captured: false };
}

function getStudentAttentionReasons(student, validSections = getSectionGroups()) {
  const reasons = [];
  const section = String(student.section || '').trim();
  if (!section || section.toLowerCase() === 'unassigned') reasons.push('No section assigned');
  else if (!validSections.some(group => String(group.department).toLowerCase() === String(student.department || '').toLowerCase() && String(group.year).toLowerCase() === String(student.year || '').toLowerCase() && String(group.label).toLowerCase() === getStudentSectionLabel(student).toLowerCase())) reasons.push('Section is not registered');
  if (!canonicalAcademicYear(student.year)) reasons.push('Year missing or invalid');
  if (!String(student.email || '').trim()) reasons.push('Email missing');
  if (!getStudentFaceDirectoryStatus(student).captured) reasons.push('Face data missing');
  return reasons;
}

function getStudentDirectoryFilteredRows() {
  const query = String(studentDirectoryState.search || '').trim().toLowerCase();
  const groups = getSectionGroups();
  return getTermStudents().filter(student => {
    if (studentDirectoryState.department && student.department !== studentDirectoryState.department) return false;
    if (studentDirectoryState.year && student.year !== studentDirectoryState.year) return false;
    if (studentDirectoryState.section && getStudentSectionLabel(student) !== studentDirectoryState.section) return false;
    if (query && ![student.name, student.roll, student.admissionNumber, student.email].some(value => String(value || '').toLowerCase().includes(query))) return false;
    const reasons = getStudentAttentionReasons(student, groups);
    if (studentDirectoryState.quick === 'attention' && !reasons.length) return false;
    if (studentDirectoryState.quick === 'noface' && getStudentFaceDirectoryStatus(student).captured) return false;
    if (studentDirectoryState.quick === 'unassigned' && student.section && String(student.section).toLowerCase() !== 'unassigned') return false;
    if (studentDirectoryState.selectedOnly && !studentDirectoryState.selected.has(String(student.id))) return false;
    return true;
  }).sort((a, b) => compareStudentDirectoryRows(a, b, groups));
}

function compareStudentDirectoryRows(a, b, groups) {
  const compare = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
  let result = 0;
  if (studentDirectoryState.sort === 'default') {
    result = compare(a.department, b.department) || compare(canonicalAcademicYear(a.year), canonicalAcademicYear(b.year)) || compare(getStudentSectionLabel(a), getStudentSectionLabel(b)) || compare(a.name, b.name);
  } else {
    const key = studentDirectoryState.sort;
    result = compare(key === 'section' ? getStudentSectionLabel(a) : a[key], key === 'section' ? getStudentSectionLabel(b) : b[key]);
    if (studentDirectoryState.direction === 'desc') result *= -1;
    result ||= compare(a.department, b.department) || compare(canonicalAcademicYear(a.year), canonicalAcademicYear(b.year)) || compare(getStudentSectionLabel(a), getStudentSectionLabel(b)) || compare(a.name, b.name);
  }
  return result;
}

function renderStudentDirectoryChips() {
  const groups = getSectionGroups();
  const visibleStudents = getTermStudents();
  const all = visibleStudents.length;
  const attention = visibleStudents.filter(student => getStudentAttentionReasons(student, groups).length).length;
  const noFace = visibleStudents.filter(student => !getStudentFaceDirectoryStatus(student).captured).length;
  const unassigned = visibleStudents.filter(student => !student.section || String(student.section).toLowerCase() === 'unassigned').length;
  const chips = [['all', 'All', all], ['attention', 'Needs attention', attention], ['noface', 'No face data', noFace], ['unassigned', 'Unassigned', unassigned]];
  $('#student-directory-chips').innerHTML = chips.map(([key, label, count]) => `<button type="button" class="tab-btn ${studentDirectoryState.quick === key ? 'active' : ''}" data-student-quick-filter="${key}">${label} <span>${count}</span></button>`).join('') + `<button type="button" class="tab-btn ${studentDirectoryState.selectedOnly ? 'active' : ''}" data-selected-only>Selected (${studentDirectoryState.selected.size})</button>`;
}

function toggleStudentDirectorySelection(id, event = {}) {
  const key = String(id), index = studentDirectoryMatchingIds.indexOf(key);
  if (event.shiftKey && studentDirectoryState.lastSelectedIndex !== null && index >= 0) {
    const [from, to] = [studentDirectoryState.lastSelectedIndex, index].sort((a, b) => a - b);
    studentDirectoryMatchingIds.slice(from, to + 1).forEach(item => studentDirectoryState.selected.add(item));
  } else if (studentDirectoryState.selected.has(key)) studentDirectoryState.selected.delete(key);
  else studentDirectoryState.selected.add(key);
  if (index >= 0) studentDirectoryState.lastSelectedIndex = index;
  renderStudentDirectoryChips(); renderStudentDirectoryTable();
}

function clearStudentDirectorySelection() { studentDirectoryState.selected.clear(); studentDirectoryState.allMatching = false; studentDirectoryState.selectedOnly = false; studentDirectoryState.lastSelectedIndex = null; renderStudentDirectoryChips(); renderStudentDirectoryTable(); }

function applyStudentDirectorySelection(action) {
  const filtered = getStudentDirectoryFilteredRows(), pageIds = studentDirectoryPageIds.map(String);
  if (action === 'clear') clearStudentDirectorySelection();
  else {
    let targets = [];
    if (action === 'page') targets = pageIds;
    if (action === 'matching') targets = filtered.map(student => String(student.id));
    if (action === 'section') targets = filtered.filter(student => studentDirectoryState.section ? getStudentSectionLabel(student) === studentDirectoryState.section : getStudentSectionLabel(student) === getStudentSectionLabel(filtered.find(item => pageIds.includes(String(item.id))) || {})).map(student => String(student.id));
    if (action === 'year') targets = filtered.filter(student => studentDirectoryState.year ? student.year === studentDirectoryState.year : student.year === (filtered.find(item => pageIds.includes(String(item.id))) || {}).year).map(student => String(student.id));
    if (action === 'defaulters') targets = filtered.filter(student => { const stats = calculateVisibleAttendance(student.id); return stats.percent !== null && stats.percent < getMinAttendance(); }).map(student => String(student.id));
    if (action === 'noface') targets = filtered.filter(student => !getStudentFaceDirectoryStatus(student).captured).map(student => String(student.id));
    targets.forEach(id => studentDirectoryState.selected.add(id));
    studentDirectoryState.allMatching = action === 'matching'; studentDirectoryState.selectedOnly = false;
    renderStudentDirectoryChips(); renderStudentDirectoryTable();
  }
  $('#student-selection-menu').value = '';
}

function renderStudentDirectoryTable() {
  const filtered = getStudentDirectoryFilteredRows();
  const validIds = new Set(getOwnedStudents().map(student => String(student.id)));
  studentDirectoryState.selected = new Set([...studentDirectoryState.selected].filter(id => validIds.has(String(id))));
  studentDirectoryMatchingIds = filtered.map(student => String(student.id));
  const pageSize = Math.max(1, Number(studentDirectoryState.pageSize) || 25);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  studentDirectoryState.page = Math.min(Math.max(1, studentDirectoryState.page), pageCount);
  const start = (studentDirectoryState.page - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  studentDirectoryPageIds = pageRows.map(student => String(student.id));
  $('#student-directory-count').textContent = `Showing ${pageRows.length} of ${filtered.length} students`;
  $('#student-edit-list').innerHTML = pageRows.length ? renderStudentDirectoryPage(pageRows) : `<div class="student-directory-empty"><span aria-hidden="true">🎓</span><h3>No students match these filters</h3><p class="muted">Try a different department, year, section, or search term.</p><button class="btn btn-secondary" type="button" data-clear-student-filters>Clear filters</button></div>`;
  renderStudentDirectoryPagination(pageCount, filtered.length);
  $('#student-edit-list').querySelector('[data-clear-student-filters]')?.addEventListener('click', clearStudentDirectoryFilters);
  updateStudentBulkBar();
  if (!$('#student-edit-drawer').hidden) renderStudentEditDrawerNavigation();
}

function renderStudentDirectoryPage(students) {
  const headers = `<thead><tr><th scope="col">Photo</th>${[['name', 'Name'], ['roll', 'Roll'], ['department', 'Department'], ['year', 'Year'], ['section', 'Section']].map(([key, label]) => `<th scope="col" data-sort-column="${key}" aria-sort="${studentDirectoryState.sort === key ? (studentDirectoryState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-directory-sort="${key}" aria-label="Sort by ${label}">${label}</button></th>`).join('')}<th scope="col">Face status</th><th scope="col">Actions</th></tr></thead>`;
  const rows = students.map(student => {
    const id = String(student.id);
    const initials = String(student.name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
    const photo = student.photo ? `<img class="student-thumb" src="${escapeHtml(student.photo)}" alt="${escapeHtml(student.name || 'Student photo')}">` : `<span class="student-thumb placeholder" aria-label="${escapeHtml(initials)}">${escapeHtml(initials)}</span>`;
    const face = getStudentFaceDirectoryStatus(student);
    const reasons = getStudentAttentionReasons(student);
    const attention = reasons.length ? `<span class="student-attention-mark" title="${escapeHtml(reasons.join('; '))}" aria-label="Needs attention: ${escapeHtml(reasons.join('; '))}">⚠</span>` : '';
    const selected = studentDirectoryState.selected.has(id);
    const avatar = `<button type="button" class="student-avatar-select ${selected ? 'selected' : ''}" data-student-avatar-select="${escapeHtml(id)}" aria-label="${selected ? 'Deselect' : 'Select'} ${escapeHtml(student.name || 'student')}" aria-pressed="${selected}">${photo}<span class="avatar-selection-tick" aria-hidden="true">✓</span></button>`;
    return `<tr class="${selected ? 'student-row-selected' : ''}" data-student-row="${escapeHtml(id)}"><td data-label="Photo">${avatar}</td><td data-label="Name"><b>${escapeHtml(student.name || 'Unnamed student')}</b> ${attention}</td><td data-label="Roll">${escapeHtml(student.roll || '—')}</td><td data-label="Department">${escapeHtml(student.department || '—')}</td><td data-label="Year"><span class="badge ok">${escapeHtml(student.year || 'Year not set')}</span></td><td data-label="Section">${escapeHtml(getStudentSectionLabel(student) || '—')}</td><td data-label="Face status"><span class="badge ${face.tone}">${face.label}</span></td><td data-label="Actions"><button type="button" class="btn btn-secondary btn-xs" data-student-edit="${escapeHtml(id)}">Edit</button></td></tr>`;
  });
  if (!studentDirectoryState.group && !studentDirectoryState.groupDepartmentYear) return `<div class="table-responsive student-directory-table-wrap"><table class="data-table student-directory-table">${headers}<tbody>${rows.join('')}</tbody></table></div>`;
  if (studentDirectoryState.groupDepartmentYear) {
    const departments = new Map();
    students.forEach((student, index) => {
      const department = String(student.department || 'Department not set');
      const year = String(student.year || 'Year not set');
      if (!departments.has(department)) departments.set(department, new Map());
      const years = departments.get(department);
      if (!years.has(year)) years.set(year, []);
      years.get(year).push(rows[index]);
    });
    return [...departments.entries()].map(([department, years]) => {
      const departmentCount = [...years.values()].reduce((count, yearRows) => count + yearRows.length, 0);
      const yearGroups = [...years.entries()].map(([year, yearRows]) => `<details class="student-directory-group student-directory-year-group" open><summary>${escapeHtml(year)} <span class="badge ok">${yearRows.length}</span></summary><div class="table-responsive student-directory-table-wrap"><table class="data-table student-directory-table">${headers}<tbody>${yearRows.join('')}</tbody></table></div></details>`).join('');
      return `<details class="student-directory-group student-directory-department-group" open><summary>${escapeHtml(department)} <span class="badge ok">${departmentCount}</span></summary><div class="student-directory-group-children">${yearGroups}</div></details>`;
    }).join('');
  }
  const groups = new Map();
  students.forEach((student, index) => {
    const key = `${student.department || '—'}|${student.year || 'Year not set'}|${getStudentSectionLabel(student)}`;
    if (!groups.has(key)) groups.set(key, { label: key.replaceAll('|', ' · '), rows: [] });
    groups.get(key).rows.push(rows[index]);
  });
  return [...groups.values()].map(group => `<details class="student-directory-group" open><summary>${escapeHtml(group.label)} <span class="badge ok">${group.rows.length}</span></summary><div class="table-responsive student-directory-table-wrap"><table class="data-table student-directory-table">${headers}<tbody>${group.rows.join('')}</tbody></table></div></details>`).join('');
}

function renderStudentDirectoryPagination(pageCount, total) {
  const container = $('#student-directory-pagination');
  if (pageCount <= 1) { container.replaceChildren(); return; }
  const makeButton = (label, page, disabled, current = false) => `<button type="button" class="btn-xs ${current ? 'active' : ''}" data-directory-page="${page}" ${disabled ? 'disabled' : ''} aria-current="${current ? 'page' : 'false'}">${label}</button>`;
  const buttons = [makeButton('Previous', studentDirectoryState.page - 1, studentDirectoryState.page === 1)];
  const first = Math.max(1, studentDirectoryState.page - 2), last = Math.min(pageCount, first + 4);
  for (let page = first; page <= last; page++) buttons.push(makeButton(String(page), page, false, page === studentDirectoryState.page));
  buttons.push(makeButton('Next', studentDirectoryState.page + 1, studentDirectoryState.page >= pageCount));
  container.innerHTML = `<span class="muted">${total} results</span>${buttons.join('')}`;
}

function updateStudentBulkBar() {
  const bar = $('#student-bulk-bar');
  const selected = studentDirectoryState.selected.size;
  bar.hidden = selected === 0;
  $('#student-bulk-count').textContent = `${selected} selected`;
  $('#student-directory-chips').querySelector('[data-selected-only]')?.replaceChildren(document.createTextNode(`Selected (${selected})`));
}

function sortStudentDirectory(key) {
  if (studentDirectoryState.sort === key) studentDirectoryState.direction = studentDirectoryState.direction === 'asc' ? 'desc' : 'asc';
  else { studentDirectoryState.sort = key; studentDirectoryState.direction = 'asc'; }
  studentDirectoryState.page = 1;
  renderStudentDirectoryTable();
}

function clearStudentDirectoryFilters() {
  studentDirectoryState.department = ''; studentDirectoryState.year = ''; studentDirectoryState.section = '';
  studentDirectoryState.search = ''; studentDirectoryState.quick = 'all'; studentDirectoryState.page = 1;
  studentDirectoryState.allMatching = false; studentDirectoryState.selectedOnly = false;
  $('#student-edit-search').value = '';
  renderStudentDirectory();
}

function setupStudentEditDrawer() {
  const drawer = $('#student-edit-drawer');
  const panel = $('#student-editor-panel');
  const form = $('#student-edit-form');
  $('#student-edit-drawer-close').addEventListener('click', closeStudentEditDrawer);
  $('#student-edit-drawer-backdrop').addEventListener('click', closeStudentEditDrawer);
  $('#student-edit-previous').addEventListener('click', () => moveStudentEditDrawer(-1));
  $('#student-edit-next').addEventListener('click', () => moveStudentEditDrawer(1));
  $('#photo-crop-apply').addEventListener('click', async event => {
    if (drawer.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const student = getVisibleStudents().find(item => String(item.id) === String(studentEditDrawerId));
    if (!student) return;
    let photo;
    try { photo = getCompressedCropDataUrl(); }
    catch { toast('Could not prepare the cropped photo.', 'danger'); return; }
    const result = await FaceAPI.updateStudent(student.id, fullStudentUpdatePayload(student, { photo }));
    if (!result.ok) { toast(result.error || 'Photo could not be saved.', 'danger'); return; }
    uploadedProfilePhoto = ''; cropSourceImage = null;
    $('#photo-crop-dialog').close();
    $('#student-edit-photo-file').value = '';
    updateStudentEditDrawerSummary();
    renderStudentDirectory();
    renderStudents();
    toast('Student photo updated.');
  }, true);
  $('#student-edit-cancel').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); closeStudentEditDrawer(); }, true);
  form.addEventListener('input', () => { studentEditDirty = isStudentEditDrawerDirty(); });
  form.addEventListener('change', () => { studentEditDirty = isStudentEditDrawerDirty(); });
  form.addEventListener('submit', event => {
    if (drawer.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveStudentFromDirectoryDrawer();
  }, true);
  drawer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeStudentEditDrawer(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  new MutationObserver(() => {
    if (!panel.hidden) return;
    if (studentEditSaveKeepOpen && studentEditDrawerId && !drawer.hidden) {
      studentEditSaveKeepOpen = false;
      selectedStudentForEdit = studentEditDrawerId;
      studentEditDirty = false;
      $('#student-edit-message').hidden = true;
      updateStudentEditDrawerSummary();
      captureStudentEditDrawerSnapshot();
      panel.hidden = false;
      renderStudentDirectory();
      $('#student-edit-name').focus();
    }
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

function openStudentEditDrawer(studentId) {
  if (!isFacultyHod()) return toast('Student profile management is available to HOD accounts.', 'warn');
  const student = getVisibleStudents().find(item => String(item.id) === String(studentId));
  if (!student) return;
  if (studentEditDrawerId && studentEditDrawerId !== String(studentId) && isStudentEditDrawerDirty() && !confirm('Discard unsaved profile changes and open another student?')) return;
  selectedStudentForEdit = String(student.id);
  studentEditDrawerId = String(student.id);
  populateStudentEditLocations(student);
  $('#student-edit-name').value = student.name || '';
  $('#student-edit-roll').value = student.roll || '';
  $('#student-edit-admission').value = student.admissionNumber || '';
  $('#student-edit-email').value = student.email || '';
  $('#student-edit-parent-name').value = student.parentName || '';
  $('#student-edit-parent-phone').value = student.parentPhone || '';
  $('#student-edit-parent-email').value = student.parentEmail || '';
  $('#student-editor-selected-name').textContent = `${student.roll || 'No roll'} · ${student.department || 'Department not set'} · ${student.year || 'Year not set'} · ${getStudentSectionLabel(student)}`;
  $('#student-edit-message').hidden = true;
  $('#student-editor-panel').hidden = false;
  $('#student-edit-drawer').hidden = false;
  $('#student-edit-drawer-backdrop').hidden = false;
  updateStudentEditDrawerSummary();
  studentEditDirty = false;
  captureStudentEditDrawerSnapshot();
  $('#student-edit-drawer-title').focus();
  $('#student-edit-name').focus();
  renderStudentEditDrawerNavigation();
}

function updateStudentEditDrawerSummary() {
  const student = getVisibleStudents().find(item => String(item.id) === String(studentEditDrawerId));
  if (!student) return;
  const stats = calculateVisibleAttendance(student.id);
  const status = stats.status || 'none';
  const photo = student.photo
    ? `<img class="student-thumb" src="${escapeHtml(student.photo)}" alt="${escapeHtml(student.name || 'Student photo')}">`
    : `<span class="student-thumb placeholder">${escapeHtml(String(student.name || '?').trim().split(/\s+/).slice(0, 2).map(value => value[0] || '').join('').toUpperCase())}</span>`;
  const hasPercent = stats.percent !== null && stats.percent !== undefined && Number.isFinite(Number(stats.percent));
  $('#student-edit-summary').innerHTML = `${photo}<div><b>${escapeHtml(student.name || 'Unnamed student')}</b><p class="muted">Attendance: ${hasPercent ? `${Number(stats.percent)}%` : 'No data yet'} · <span class="badge ${['eligible', 'warning', 'critical'].includes(status) ? status === 'eligible' ? 'ok' : status === 'warning' ? 'warn' : 'danger' : ''}">${hasPercent ? escapeHtml(status) : 'No data yet'}</span></p></div>`;
}

function captureStudentEditDrawerSnapshot() {
  const form = $('#student-edit-form');
  studentEditOriginalValues = [...form.elements].filter(element => element.name || element.id).map(element => [element.id || element.name, element.type === 'file' ? element.value : element.value]);
}

function isStudentEditDrawerDirty() {
  if (!studentEditOriginalValues) return false;
  const form = $('#student-edit-form');
  const current = [...form.elements].filter(element => element.name || element.id).map(element => [element.id || element.name, element.type === 'file' ? element.value : element.value]);
  return JSON.stringify(current) !== JSON.stringify(studentEditOriginalValues);
}

function closeStudentEditDrawer() {
  if (isStudentEditDrawerDirty() && !confirm('Discard unsaved changes to this student profile?')) return;
  $('#student-editor-panel').hidden = true;
  $('#student-edit-drawer').hidden = true;
  $('#student-edit-drawer-backdrop').hidden = true;
  selectedStudentForEdit = null;
  studentEditDrawerId = null;
  studentEditDirty = false;
  studentEditOriginalValues = null;
  studentEditSaveKeepOpen = false;
  studentEditDrawerReturnFocus?.focus?.();
}

function renderStudentEditDrawerNavigation() {
  const index = studentDirectoryMatchingIds.indexOf(String(studentEditDrawerId));
  $('#student-edit-position').textContent = index < 0 ? '' : `${index + 1} of ${studentDirectoryMatchingIds.length}`;
  $('#student-edit-previous').disabled = index <= 0;
  $('#student-edit-next').disabled = index < 0 || index >= studentDirectoryMatchingIds.length - 1;
}

async function saveStudentFromDirectoryDrawer() {
  const student = getVisibleStudents().find(item => String(item.id) === String(studentEditDrawerId));
  const message = $('#student-edit-message');
  if (!student) return;
  message.hidden = true;
  const department = (editLocationValue('department') || '').trim().toUpperCase();
  const year = canonicalAcademicYear(editLocationValue('year'));
  const section = canonicalSectionName(department, editLocationValue('section'));
  if (!department || !year || !section || !$('#student-edit-form').reportValidity()) {
    message.textContent = 'Enter a valid name, roll, department, academic year, section, and email.';
    message.hidden = false;
    return;
  }
  let changes;
  try {
    changes = fullStudentUpdatePayload(student, {
      name: $('#student-edit-name').value.trim(),
      roll: $('#student-edit-roll').value.trim(),
      admissionNumber: $('#student-edit-admission').value.trim(),
      department,
      year,
      section,
      email: $('#student-edit-email').value.trim(),
      parentName: $('#student-edit-parent-name').value.trim(),
      parentPhone: $('#student-edit-parent-phone').value.trim(),
      parentEmail: $('#student-edit-parent-email').value.trim()
    });
  } catch (error) {
    message.textContent = error.message || 'Check the student details and try again.';
    message.hidden = false;
    return;
  }
  const previousPlacement = { department: student.department, year: canonicalAcademicYear(student.year), section: getStudentSectionLabel(student) };
  const moving = previousPlacement.department !== changes.department || previousPlacement.year !== changes.year || previousPlacement.section !== changes.section;
  let targetClasses = [];
  if (moving) {
    const target = await ensureStudentTargetSection(changes.department, changes.year, changes.section);
    if (!target.ok) { message.textContent = target.error; message.hidden = false; return; }
    targetClasses = target.classes;
  }
  const result = await FaceAPI.updateStudent(student.id, changes);
  if (!result.ok) { message.textContent = result.error || 'Failed to update student.'; message.hidden = false; return; }
  let rosterFailed = false;
  if (moving) {
    const oldClasses = getSectionClasses({ department: previousPlacement.department, year: previousPlacement.year, label: previousPlacement.section, studentIds: [student.id] });
    for (const cls of oldClasses) { const sync = await FaceAPI.unenrollStudent(cls.id, student.id); if (!sync.ok) rosterFailed = true; }
    for (const cls of targetClasses) { const sync = await FaceAPI.enrollStudent(cls.id, student.id); if (!sync.ok) rosterFailed = true; }
  }
  studentEditDirty = false;
  captureStudentEditDrawerSnapshot();
  updateStudentEditDrawerSummary();
  refreshStudentDirectoryRelatedViews();
  toast(rosterFailed ? 'Profile saved, but section enrollment could not be fully synchronized.' : 'Student details updated', rosterFailed ? 'warn' : 'ok');
}

function moveStudentEditDrawer(direction) {
  if (isStudentEditDrawerDirty() && !confirm('Discard unsaved changes and move to another student?')) return;
  studentEditOriginalValues = null;
  studentEditDirty = false;
  const index = studentDirectoryMatchingIds.indexOf(String(studentEditDrawerId));
  const nextId = studentDirectoryMatchingIds[index + direction];
  if (nextId !== undefined) openStudentEditDrawer(nextId);
}

function setupStudentDirectoryStorageGuard() {
  window.addEventListener('faceauth-storage-error', () => { if (studentDirectoryBulkRunning) studentDirectoryStorageError = true; });
}

function getSelectedStudentRecords() {
  const ids = studentDirectoryState.allMatching ? studentDirectoryMatchingIds : [...studentDirectoryState.selected];
  const visible = new Map(getVisibleStudents().map(student => [String(student.id), student]));
  return ids.map(id => visible.get(String(id))).filter(Boolean);
}

function exportSelectedStudentsCsv() {
  if (!isFacultyHod()) return toast('Student profile exports are available to HOD accounts.', 'warn');
  const students = getSelectedStudentRecords();
  if (!students.length) { toast('Select at least one student to export.', 'warn'); return; }
  downloadCsv([['roll', 'name', 'admissionNumber', 'department', 'year', 'section', 'email'], ...students.map(student => [student.roll || '—', student.name || '—', student.admissionNumber || '—', student.department || '—', student.year || '—', getStudentSectionLabel(student) || '—', student.email || '—'])], 'selected-students.csv');
}

async function deleteSelectedStudents() {
  const students = getSelectedStudentRecords();
  if (!students.length) { toast('Select at least one student to delete.', 'warn'); return; }
  if (!confirm(`Delete ${students.length} selected student${students.length === 1 ? '' : 's'} and their class enrolments?`)) return;
  const failures = [];
  let completed = 0;
  studentDirectoryBulkRunning = true; studentDirectoryStorageError = false;
  for (const student of students) {
    if (studentDirectoryStorageError) { failures.push(`${student.name || student.roll} (stopped: storage is full)`); break; }
    const result = await FaceAPI.deleteStudent(student.id);
    if (!result.ok) failures.push(`${student.name || student.roll} (${result.error || 'delete failed'})`);
    else completed++;
  }
  studentDirectoryBulkRunning = false;
  studentDirectoryState.selected.clear(); studentDirectoryState.allMatching = false;
  refreshStudentDirectoryRelatedViews();
  toast(formatStudentBulkResult('deleted', completed, failures), failures.length ? 'warn' : 'ok');
}

function formatStudentBulkResult(action, completed, failures) {
  const failText = failures.length ? `; ${failures.length} failed: ${failures.join(', ')}` : '';
  return `${completed} ${action}${completed === 1 ? '' : 's'}${failText}`;
}

function refreshStudentDirectoryRelatedViews() {
  renderStudentDirectoryChips();
  renderStudentDirectoryTable();
  renderStudents();
  if (selectedClassForRoster && $('#v-class-roster').classList.contains('active')) renderClassRoster();
  if ($('#v-reports').classList.contains('active') && selectedClassForReport) showClassReport(selectedClassForReport);
}

function openStudentBulkMoveDialog() {
  const students = getSelectedStudentRecords();
  if (!students.length) { toast('Select at least one student to move.', 'warn'); return; }
  const dept = $('#student-move-department');
  const values = [...new Set(getTermClasses().map(cls => cls.department).filter(Boolean))];
  dept.innerHTML = `<option value="">Choose department</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  $('#student-move-year').innerHTML = '<option value="">Choose year</option>';
  $('#student-move-section').innerHTML = '<option value="">Choose section</option><option value="__new__">New section…</option>';
  $('#student-move-new-section').value = '';
  $('#student-move-new-section').hidden = true;
  $('#student-move-error').hidden = true;
  $('#student-bulk-move-dialog').showModal();
  updateStudentMovePreview();
}

function updateStudentMoveYears() {
  const department = $('#student-move-department').value;
  const yearSelect = $('#student-move-year');
  const years = [...new Set(getTermClasses().filter(cls => cls.department === department).map(cls => cls.year).filter(Boolean))];
  yearSelect.innerHTML = `<option value="">Choose year</option>${years.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  updateStudentMoveSections();
}

function updateStudentMoveSections() {
  const dept = $('#student-move-department').value;
  const year = $('#student-move-year').value;
  const sections = getSectionGroups().filter(group => group.department === dept && group.year === year).map(group => group.label);
  $('#student-move-section').innerHTML = `<option value="">Choose section</option>${[...new Set(sections)].map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}<option value="__new__">New section…</option>`;
  $('#student-move-new-section').hidden = $('#student-move-section').value !== '__new__';
  updateStudentMovePreview();
}

$('#student-move-department').addEventListener('change', updateStudentMoveYears);
$('#student-move-year').addEventListener('change', updateStudentMoveSections);
$('#student-move-section').addEventListener('change', () => { $('#student-move-new-section').hidden = $('#student-move-section').value !== '__new__'; $('#student-move-new-section').value = ''; updateStudentMovePreview(); });

function updateStudentMovePreview() {
  const students = getSelectedStudentRecords();
  const department = $('#student-move-department').value;
  const year = canonicalAcademicYear($('#student-move-year').value);
  const sectionInput = $('#student-move-section').value === '__new__' ? $('#student-move-new-section').value.trim() : $('#student-move-section').value;
  const targetSection = department && sectionInput ? canonicalSectionName(department, sectionInput) : '';
  const sources = [...new Set(students.map(student => `${student.department || '—'} · ${student.year || 'Year not set'} · ${getStudentSectionLabel(student)}`))];
  $('#student-move-preview').textContent = targetSection && year
    ? `${students.length} student${students.length === 1 ? '' : 's'} will move from ${sources.join(', ')} to ${department} · ${year} · ${targetSection}.`
    : `Select a destination. ${students.length} student${students.length === 1 ? '' : 's'} selected.`;
}

async function ensureStudentTargetSection(department, year, section) {
  const targetLabel = canonicalSectionName(department, section);
  let target = getTermClasses().find(cls => cls.department === department && canonicalAcademicYear(cls.year) === year && String(cls.label || cls.section).toLowerCase() === targetLabel.toLowerCase());
  if (!target) {
    const result = await FaceAPI.addClass({ department, year, section: targetLabel, label: targetLabel, subject: '', code: '', room: '', time: '', days: [], studentIds: [] });
    if (!result.ok) return { ok: false, error: result.error || `Could not create ${targetLabel}.` };
    target = result.class;
  }
  return { ok: true, classes: getSectionClasses(target) };
}

function fullStudentUpdatePayload(student, changes = {}) {
  const payload = {
    name: student.name || '',
    roll: student.roll || '',
    admissionNumber: student.admissionNumber || '',
    department: student.department || '',
    year: canonicalAcademicYear(student.year),
    section: student.section || '',
    email: student.email || '',
    ...changes
  };
  payload.year = canonicalAcademicYear(payload.year);
  payload.department = String(payload.department || '').trim().toUpperCase();
  payload.section = canonicalSectionName(payload.department, payload.section);
  if (!payload.year) throw new Error('Invalid academic year. Choose 1st, 2nd, 3rd, or 4th Year.');
  return payload;
}

async function moveOneStudent(student, department, year, section, targetClasses) {
  const oldPlacement = { department: student.department, year: canonicalAcademicYear(student.year), section: getStudentSectionLabel(student) };
  const newPlacement = { department, year, section: canonicalSectionName(department, section) };
  const oldClasses = getSectionClasses({ department: oldPlacement.department, year: oldPlacement.year, label: oldPlacement.section, studentIds: [student.id] });
  const payload = fullStudentUpdatePayload(student, newPlacement);
  const updated = await FaceAPI.updateStudent(student.id, payload);
  if (!updated.ok) return { ok: false, error: updated.error || 'Profile update failed.' };
  for (const cls of oldClasses) {
    const result = await FaceAPI.unenrollStudent(cls.id, student.id);
    if (studentDirectoryStorageError) return { ok: false, error: 'Storage is full; roster changes may not have saved.' };
    if (!result.ok) return { ok: false, error: result.error || `Could not unenroll from ${getClassSectionLabel(cls)}.` };
  }
  for (const cls of targetClasses) {
    const result = await FaceAPI.enrollStudent(cls.id, student.id);
    if (studentDirectoryStorageError) return { ok: false, error: 'Storage is full; roster changes may not have saved.' };
    if (!result.ok) return { ok: false, error: result.error || `Could not enroll in ${getClassSectionLabel(cls)}.` };
  }
  return { ok: true };
}

async function applyStudentBulkMove() {
  const students = getSelectedStudentRecords();
  const department = String($('#student-move-department').value || '').trim().toUpperCase();
  const year = canonicalAcademicYear($('#student-move-year').value);
  const chosen = $('#student-move-section').value;
  const section = chosen === '__new__' ? $('#student-move-new-section').value.trim() : chosen;
  const message = $('#student-move-error');
  message.hidden = true;
  if (!students.length || !department || !year || !section) { message.textContent = 'Choose a valid department, year, and section.'; message.hidden = false; return; }
  if (!confirm(`Move ${students.length} selected student${students.length === 1 ? '' : 's'} to ${department} · ${year} · ${canonicalSectionName(department, section)}?`)) return;
  studentDirectoryBulkRunning = true; studentDirectoryStorageError = false;
  const failures = [];
  let completed = 0;
  let targetClasses = null;
  for (const student of students) {
    if (studentDirectoryStorageError) { failures.push(`${student.name || student.roll} (stopped: storage is full)`); break; }
    if (!targetClasses) {
      const target = await ensureStudentTargetSection(department, year, section);
      if (!target.ok) { failures.push(`Section ${section} (${target.error})`); break; }
      targetClasses = target.classes;
      if (studentDirectoryStorageError) { failures.push(`${student.name || student.roll} (stopped: storage is full)`); break; }
    }
    try {
      const result = await moveOneStudent(student, department, year, section, targetClasses);
      if (result.ok) completed++;
      else failures.push(`${student.name || student.roll} (${result.error})`);
    } catch (error) { failures.push(`${student.name || student.roll} (${error.message || 'move failed'})`); }
  }
  studentDirectoryBulkRunning = false;
  $('#student-bulk-move-dialog').close();
  studentDirectoryState.selected.clear(); studentDirectoryState.allMatching = false;
  refreshStudentDirectoryRelatedViews();
  toast(formatStudentBulkResult('moved', completed, failures), failures.length ? 'warn' : 'ok');
}

function detectStudentCsvDelimiter(text) {
  let quoted = false, commas = 0, semicolons = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"' && quoted) { index++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && (char === '\n' || char === '\r')) break;
    if (!quoted && char === ',') commas++;
    if (!quoted && char === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

function parseStudentCsv(text, delimiter = detectStudentCsvDelimiter(text)) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

async function previewStudentCsvImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = parseStudentCsv(await file.text());
    if (parsed.length < 2) throw new Error('The CSV needs a header row and at least one student row.');
    const headers = parsed[0].map(value => value.trim().toLowerCase());
    const requiredHeaders = ['roll', 'name', 'admissionnumber', 'department', 'year', 'section', 'email'];
    if (requiredHeaders.some(header => !headers.includes(header))) throw new Error('Include these columns in the CSV header: roll, name, admissionNumber, department, year, section, email.');
    const indexByHeader = Object.fromEntries(headers.map((header, index) => [header, index]));
    const existingRolls = new Set(DB.students.map(student => String(student.roll || '').trim().toLowerCase()).filter(Boolean));
    const seenRolls = new Set();
    const sections = getSectionGroups();
    studentImportPreviewRows = parsed.slice(1).map((values, index) => {
      const record = Object.fromEntries(requiredHeaders.map(header => [header === 'admissionnumber' ? 'admissionNumber' : header, String(values[indexByHeader[header]] || '').trim()]));
      record.department = (record.department || 'CSE').toUpperCase();
      const canonicalYear = canonicalAcademicYear(record.year);
      const rollKey = record.roll.trim().toLowerCase();
      let status = 'OK', valid = true;
      if (!record.roll || !record.name) { status = 'Missing name or roll'; valid = false; }
      else if (existingRolls.has(rollKey) || seenRolls.has(rollKey)) { status = 'Duplicate roll'; valid = false; }
      else if (!canonicalYear) { status = 'Invalid year'; valid = false; }
      if (rollKey) seenRolls.add(rollKey);
      record.year = canonicalYear || record.year;
      record.section = record.section ? canonicalSectionName(record.department, record.section) : 'Unassigned';
      const sectionExists = sections.some(group => group.department.toLowerCase() === record.department.toLowerCase() && group.year.toLowerCase() === String(canonicalYear).toLowerCase() && group.label.toLowerCase() === record.section.toLowerCase());
      if (valid && record.section !== 'Unassigned' && !sectionExists) status = 'New section will be created';
      return { line: index + 2, data: record, status, valid };
    });
    renderStudentCsvImportPreview(file.name);
  } catch (error) { toast(error.message || 'Could not read the CSV file.', 'danger'); }
}

function renderStudentCsvImportPreview(filename = '') {
  const valid = studentImportPreviewRows.filter(row => row.valid).length;
  const skipped = studentImportPreviewRows.length - valid;
  $('#student-import-preview-summary').textContent = `${filename ? `${filename} · ` : ''}${valid} valid rows, ${skipped} rows will be skipped.`;
  $('#student-import-preview-body').innerHTML = studentImportPreviewRows.map(row => `<tr><td>${escapeHtml(row.data.roll || '—')}</td><td>${escapeHtml(row.data.name || '—')}</td><td>${escapeHtml(row.data.department || '—')}</td><td>${escapeHtml(row.data.year || '—')}</td><td>${escapeHtml(row.data.section || '—')}</td><td><span class="badge ${row.valid ? row.status.startsWith('New section') ? 'warn' : 'ok' : 'danger'}">${escapeHtml(row.status)}</span></td></tr>`).join('');
  $('#student-import-preview-confirm').disabled = valid === 0;
  $('#student-import-preview-dialog').showModal();
}

async function importValidStudentRows() {
  const validRows = studentImportPreviewRows.filter(row => row.valid);
  const failures = studentImportPreviewRows.filter(row => !row.valid).map(row => ({ ...row, error: row.status }));
  let skipped = failures.length;
  let imported = 0;
  studentDirectoryBulkRunning = true; studentDirectoryStorageError = false;
  $('#student-import-preview-confirm').disabled = true;
  for (let rowIndex = 0; rowIndex < validRows.length; rowIndex++) {
    const row = validRows[rowIndex];
    if (studentDirectoryStorageError) {
      failures.push(...validRows.slice(rowIndex).map(pending => ({ ...pending, error: 'Stopped because browser storage is full' })));
      skipped += validRows.length - rowIndex;
      break;
    }
    const data = row.data;
    const result = await FaceAPI.registerStudent({
      name: data.name, roll: data.roll, admissionNumber: data.admissionNumber,
      department: data.department, year: canonicalAcademicYear(data.year),
      section: data.section || 'Unassigned', email: data.email || undefined, photo: ''
    }, []);
    if (!result.ok) { failures.push({ ...row, error: result.error || 'Registration failed' }); skipped++; continue; }
    imported++;
    if (data.section && data.section !== 'Unassigned') {
      const target = await ensureStudentTargetSection(data.department, canonicalAcademicYear(data.year), data.section);
      if (!target.ok) { failures.push({ ...row, error: `Student created, but section setup failed: ${target.error}` }); continue; }
      if (studentDirectoryStorageError) {
        failures.push({ ...row, error: 'Student created, but section setup stopped because browser storage is full' });
        failures.push(...validRows.slice(rowIndex + 1).map(pending => ({ ...pending, error: 'Stopped because browser storage is full' })));
        skipped += validRows.length - rowIndex - 1;
        break;
      }
      let enrollmentError = '';
      for (const cls of target.classes) {
        const enroll = await FaceAPI.enrollStudent(cls.id, result.student.id);
        if (studentDirectoryStorageError) { enrollmentError = 'Browser storage is full; section enrolment may not have saved'; break; }
        if (!enroll.ok) enrollmentError = enroll.error || 'Section enrollment failed';
      }
      if (enrollmentError) failures.push({ ...row, error: `Student created, but ${enrollmentError}` });
    }
  }
  studentDirectoryBulkRunning = false;
  $('#student-import-preview-dialog').close();
  studentDirectoryState.page = 1;
  refreshStudentDirectoryRelatedViews();
  toast(`${imported} imported, ${skipped} skipped${failures.length > skipped ? `; ${failures.length - skipped} section issue${failures.length - skipped === 1 ? '' : 's'}` : ''}${studentDirectoryStorageError ? ' (stopped: storage full)' : ''}.`, failures.length ? 'warn' : 'ok');
  if (failures.length) downloadCsv([['line', 'roll', 'name', 'status', 'error'], ...failures.map(row => [row.line, row.data.roll || '—', row.data.name || '—', row.status, row.error || '—'])], 'student-import-errors.csv');
  studentImportPreviewRows = [];
}

$('#student-dialog-delete').onclick = async () => {
  if (!isFacultyHod()) return toast('Student profile management is available to HOD accounts.', 'warn');
  const studentId = $('#student-dialog').dataset.studentId;
  const student = getVisibleStudents().find(s => String(s.id) === String(studentId));
  if (!student) return;

  if (confirm(`Permanently remove ${student.name} from the college database and all enrolled courses?`)) {
    const res = await FaceAPI.deleteStudent(student.id);
    if (!res.ok) { toast(res.error || 'Could not delete this student.', 'danger'); return; }
    $('#student-dialog').close();
    toast('Student removed from college database');
    renderStudents();
    if (selectedClassForRoster) renderClassRoster();
    if (selectedClassForReport) showClassReport(selectedClassForReport);
  }
};

// ==========================================================
// 9. AUTOMATIC SESSION RESTORATION ON LOAD
// ==========================================================
window.addEventListener('DOMContentLoaded', () => {
  FaceAPI.migrateLegacyTeacherPasswords().catch(() => toast('Could not secure a legacy faculty credential. Re-register that account.', 'danger'));
  try {
    const saved = localStorage.getItem('collegeAttendanceCurrentTeacher');
    if (saved) {
      const staleTeacher = JSON.parse(saved);
      const teacher = DB.teachers.find(item => String(item.id) === String(staleTeacher?.id));
      if (teacher) {
        enterFacultyPortal(teacher);
        const requested = location.hash.slice(1);
        if (requested && $('#v-' + requested)) show(requested, { recordHistory: false });
        return;
      }
    }
  } catch (e) {
    console.warn('Could not restore session:', e);
  }
});

function refreshOfflineBanner() {
  const banner = $('#offline-banner');
  if (banner) banner.hidden = navigator.onLine || $('#shell').hidden;
}
window.addEventListener('online', refreshOfflineBanner);
window.addEventListener('offline', refreshOfflineBanner);
if ($('#shell')) new MutationObserver(refreshOfflineBanner).observe($('#shell'), { attributes: true, attributeFilter: ['hidden'] });
$('#offline-update-button').addEventListener('click', async () => {
  const registration = await navigator.serviceWorker?.getRegistration();
  registration?.waiting?.postMessage('SKIP_WAITING');
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  navigator.serviceWorker.ready.then(registration => {
    const showUpdate = () => { const button = $('#offline-update-button'); if (button) { button.hidden = false; button.closest('#offline-banner').hidden = false; button.closest('#offline-banner').firstChild.textContent = 'A new version is ready. '; } };
    if (registration.waiting) showUpdate();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', () => {
      if (registration.installing?.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
    }));
  }).catch(() => {});
}
