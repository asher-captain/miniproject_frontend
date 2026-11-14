// ==========================================================
// College Attendance Management System - Core Data & Storage
// ==========================================================

const COLLEGE_CONFIG = {
  name: 'FaceAuth',
  shortName: 'FaceAuth',
  minAttendancePercent: 75, // Default minimum attendance requirement
  warningThreshold: 65,     // Default warning-band threshold
  lateAfterMinutes: 10,
  confidenceThreshold: 0.75,
  reviewThreshold: 0.55,
  sessionEditLockHours: 24,
  condonation: { onDuty: true, medical: true },
  departments: ['CSE', 'IT', 'ECE', 'MECH', 'CIVIL'],
  years: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
  sectionCatalog: {
    CSE: ['CSE-21', 'CSE-22', 'CSE-23'],
    ECE: ['ECE-A', 'ECE-B', 'ECE-C']
  },
  autoSwitchTermByDate: true,
  defaultOddSemester: 1,
  defaultEvenSemester: 2,
};

function localISODate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function generateTermForDate(date = localISODate(), semester = null) {
  const day = new Date(`${date}T12:00:00`);
  const year = day.getFullYear(), month = day.getMonth() + 1;
  const odd = month >= 7;
  const academicStart = odd ? year : year - 1;
  const config = typeof DB !== 'undefined' ? DB.config : COLLEGE_CONFIG;
  const termSemester = Number(semester) || (odd ? config.defaultOddSemester : config.defaultEvenSemester);
  return {
    id: `term-${academicStart}-${academicStart + 1}-s${termSemester}-${odd ? 'odd' : 'even'}`,
    academicYear: `${academicStart} - ${academicStart + 1}`,
    semester: termSemester,
    type: odd ? 'odd' : 'even',
    startDate: odd ? `${year}-07-01` : `${year}-01-01`,
    endDate: odd ? `${year}-12-31` : `${year}-06-30`,
    status: 'active'
  };
}

// Seed dataset
const INITIAL_TEACHERS = [
  {
    id: 'T101',
    name: 'Mrs. Anuksha Srivastava',
    email: 'anuksha.srivastava@college.edu',
    department: 'CSE',
    designation: 'Associate Professor & HOD',
    role: 'hod',
    passwordSalt: 'faceauth-seed-v1',
    passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76'
  },
  {
    id: 'T102',
    name: 'Dr. Rajesh Deshmukh',
    email: 'rajesh.deshmukh@college.edu',
    department: 'IT',
    designation: 'Professor',
    role: 'faculty',
    passwordSalt: 'faceauth-seed-v1',
    passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76'
  },
  { id: 'T103', name: 'Dr. Meera Kulkarni', email: 'meera.kulkarni@college.edu', department: 'IT', designation: 'Professor & HOD', role: 'hod', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T104', name: 'Prof. Karan Shah', email: 'karan.shah@college.edu', department: 'CSE', designation: 'Assistant Professor', role: 'faculty', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T105', name: 'Dr. Nisha Rao', email: 'nisha.rao@college.edu', department: 'ECE', designation: 'Associate Professor & HOD', role: 'hod', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T106', name: 'Prof. Arjun Menon', email: 'arjun.menon@college.edu', department: 'ECE', designation: 'Assistant Professor', role: 'faculty', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T107', name: 'Dr. Sandeep Joshi', email: 'sandeep.joshi@college.edu', department: 'MECH', designation: 'Professor & HOD', role: 'hod', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T108', name: 'Prof. Isha Verma', email: 'isha.verma@college.edu', department: 'MECH', designation: 'Assistant Professor', role: 'faculty', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T109', name: 'Dr. Farah Khan', email: 'farah.khan@college.edu', department: 'CIVIL', designation: 'Associate Professor & HOD', role: 'hod', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' },
  { id: 'T110', name: 'Prof. Dev Patel', email: 'dev.patel@college.edu', department: 'CIVIL', designation: 'Assistant Professor', role: 'faculty', passwordSalt: 'faceauth-seed-v1', passwordHash: '0fc8b80b9a99ac760796757cdda33e884536839c94caa104672bff1690ca8f76' }
];

const INITIAL_STUDENTS = [
  {
    id: 1,
    name: 'Vaishnavi Katiyar',
    roll: '2400320101218',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'vaishnavi.k@student.college.edu',
    date: '2026-08-10',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 2,
    name: 'Aarav Sharma',
    roll: '2400320101219',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'aarav.s@student.college.edu',
    date: '2026-08-10',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 3,
    name: 'Priya Singh',
    roll: '2400320101220',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'priya.s@student.college.edu',
    date: '2026-08-10',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 4,
    name: 'Rahul Kumar',
    roll: '2400320101221',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'rahul.k@student.college.edu',
    date: '2026-08-11',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 5,
    name: 'Neha Verma',
    roll: '2400320101222',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'neha.v@student.college.edu',
    date: '2026-08-11',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 6,
    name: 'Karan Mehta',
    roll: '2400320101223',
    department: 'CSE',
    year: '3rd Year',
    section: 'B',
    email: 'karan.m@student.college.edu',
    date: '2026-08-12',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 7,
    name: 'Ananya Patel',
    roll: '2400320101224',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'ananya.p@student.college.edu',
    date: '2026-08-12',
    photo: '',
    faceCaptureCount: 5
  },
  {
    id: 8,
    name: 'Rohan Gupta',
    roll: '2400320101225',
    department: 'CSE',
    year: '3rd Year',
    section: 'A',
    email: 'rohan.g@student.college.edu',
    date: '2026-08-14',
    photo: '',
    faceCaptureCount: 5
  },
  { id: 9, name: 'Aditi Rao', roll: '2400320201101', department: 'IT', year: '3rd Year', section: 'IT-A', email: 'aditi.rao@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 10, name: 'Kabir Nair', roll: '2400320201102', department: 'IT', year: '3rd Year', section: 'IT-A', email: 'kabir.nair@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 11, name: 'Anaya Iyer', roll: '2400320301201', department: 'ECE', year: '2nd Year', section: 'ECE-A', email: 'anaya.iyer@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 12, name: 'Ritvik Bose', roll: '2400320301202', department: 'ECE', year: '2nd Year', section: 'ECE-A', email: 'ritvik.bose@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 13, name: 'Diya Kapoor', roll: '2400320401301', department: 'MECH', year: '2nd Year', section: 'MECH-A', email: 'diya.kapoor@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 14, name: 'Vihaan Das', roll: '2400320401302', department: 'MECH', year: '2nd Year', section: 'MECH-A', email: 'vihaan.das@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 15, name: 'Myra Thomas', roll: '2400320501401', department: 'CIVIL', year: '2nd Year', section: 'CIVIL-A', email: 'myra.thomas@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 },
  { id: 16, name: 'Reyansh Gupta', roll: '2400320501402', department: 'CIVIL', year: '2nd Year', section: 'CIVIL-A', email: 'reyansh.gupta@student.college.edu', date: '2026-08-10', photo: '', faceCaptureCount: 0 }
];

const INITIAL_CLASSES = [
  {
    id: 'cse-3a-ds',
    label: 'CSE-21',
    department: 'CSE',
    year: '3rd Year',
    section: 'CSE-21',
    subject: 'Data Structures & Algorithms',
    code: 'CS301',
    room: 'Lab 3 / Room 302',
    time: '09:00 AM - 10:00 AM',
    days: ['Mon', 'Wed', 'Fri'],
    teacherId: 'T104',
    studentIds: [1, 2, 3, 4, 5, 7, 8]
  },
  {
    id: 'cse-3a-os',
    label: 'CSE-21',
    department: 'CSE',
    year: '3rd Year',
    section: 'CSE-21',
    subject: 'Operating Systems',
    code: 'CS302',
    room: 'Seminar Hall B',
    time: '11:15 AM - 12:15 PM',
    days: ['Tue', 'Thu'],
    teacherId: 'T101',
    studentIds: [1, 2, 3, 4, 5, 7, 8]
  },
  {
    id: 'cse-3b-db',
    label: 'CSE-22',
    department: 'CSE',
    year: '3rd Year',
    section: 'CSE-22',
    subject: 'Database Management Systems',
    code: 'CS303',
    room: 'Computer Center 2',
    time: '02:00 PM - 03:00 PM',
    days: ['Mon', 'Tue', 'Thu'],
    teacherId: 'T104',
    studentIds: [6]
  },
  {
    id: 'it-3a-cn',
    label: 'IT-A',
    department: 'IT',
    year: '3rd Year',
    section: 'IT-A',
    subject: 'Computer Networks',
    code: 'IT304',
    room: 'Networking Lab',
    time: '03:15 PM - 04:15 PM',
    days: ['Wed', 'Fri'],
    teacherId: 'T102',
    studentIds: [9, 10]
  },
  {
    id: 'ece-2a-dc', label: 'ECE-A', department: 'ECE', year: '2nd Year', section: 'ECE-A', subject: 'Digital Circuits', code: 'EC201', teacherId: 'T106', room: 'Electronics Lab', time: '10:00 AM - 11:00 AM', days: ['Mon', 'Wed'], studentIds: [11, 12]
  },
  {
    id: 'mech-2a-tm', label: 'MECH-A', department: 'MECH', year: '2nd Year', section: 'MECH-A', subject: 'Thermodynamics', code: 'ME201', teacherId: 'T108', room: 'Workshop 2', time: '11:15 AM - 12:15 PM', days: ['Tue', 'Thu'], studentIds: [13, 14]
  },
  {
    id: 'civil-2a-som', label: 'CIVIL-A', department: 'CIVIL', year: '2nd Year', section: 'CIVIL-A', subject: 'Strength of Materials', code: 'CE201', teacherId: 'T110', room: 'Civil Lab', time: '01:00 PM - 02:00 PM', days: ['Wed', 'Fri'], studentIds: [15, 16]
  }
];

const INITIAL_HISTORY = [
  {
    id: 'sess-101',
    classId: 'cse-3a-ds',
    date: '10 Oct 2026',
    time: '09:02 AM',
    subject: 'Data Structures & Algorithms',
    section: 'CSE-21',
    classLabel: 'CSE-21',
    room: 'Lab 3',
    present: 6,
    absent: 1,
    studentIds: ['1', '2', '3', '4', '5', '7', '8'],
    presentIds: ['1', '2', '3', '5', '7', '8'],
    absentIds: ['4'],
    records: {
      '1': { status: 'present', method: 'face', time: '09:03 AM', score: 0.96 },
      '2': { status: 'present', method: 'face', time: '09:04 AM', score: 0.98 },
      '3': { status: 'present', method: 'face', time: '09:05 AM', score: 0.91 },
      '4': { status: 'absent', method: 'system', time: '09:15 AM' },
      '5': { status: 'present', method: 'face', time: '09:06 AM', score: 0.94 },
      '7': { status: 'present', method: 'face', time: '09:07 AM', score: 0.95 },
      '8': { status: 'present', method: 'manual', time: '09:10 AM' }
    }
  },
  {
    id: 'sess-102',
    classId: 'cse-3a-ds',
    date: '08 Oct 2026',
    time: '09:05 AM',
    subject: 'Data Structures & Algorithms',
    section: 'CSE-21',
    classLabel: 'CSE-21',
    room: 'Lab 3',
    present: 5,
    absent: 2,
    studentIds: ['1', '2', '3', '4', '5', '7', '8'],
    presentIds: ['1', '2', '5', '7', '8'],
    absentIds: ['3', '4'],
    records: {
      '1': { status: 'present', method: 'face', time: '09:06 AM', score: 0.95 },
      '2': { status: 'present', method: 'face', time: '09:06 AM', score: 0.97 },
      '3': { status: 'absent', method: 'system', time: '09:20 AM' },
      '4': { status: 'absent', method: 'system', time: '09:20 AM' },
      '5': { status: 'present', method: 'face', time: '09:07 AM', score: 0.93 },
      '7': { status: 'present', method: 'face', time: '09:08 AM', score: 0.92 },
      '8': { status: 'present', method: 'manual', time: '09:12 AM' }
    }
  },
  {
    id: 'sess-103',
    classId: 'cse-3a-ds',
    date: '06 Oct 2026',
    time: '09:01 AM',
    subject: 'Data Structures & Algorithms',
    section: 'CSE-21',
    classLabel: 'CSE-21',
    room: 'Lab 3',
    present: 7,
    absent: 0,
    studentIds: ['1', '2', '3', '4', '5', '7', '8'],
    presentIds: ['1', '2', '3', '4', '5', '7', '8'],
    absentIds: [],
    records: {
      '1': { status: 'present', method: 'face', time: '09:02 AM', score: 0.98 },
      '2': { status: 'present', method: 'face', time: '09:02 AM', score: 0.97 },
      '3': { status: 'present', method: 'face', time: '09:03 AM', score: 0.93 },
      '4': { status: 'present', method: 'face', time: '09:04 AM', score: 0.89 },
      '5': { status: 'present', method: 'face', time: '09:05 AM', score: 0.94 },
      '7': { status: 'present', method: 'face', time: '09:05 AM', score: 0.96 },
      '8': { status: 'present', method: 'face', time: '09:06 AM', score: 0.92 }
    }
  },
  {
    id: 'sess-104',
    classId: 'cse-3a-os',
    date: '07 Oct 2026',
    time: '11:18 AM',
    subject: 'Operating Systems',
    section: 'CSE-21',
    classLabel: 'CSE-21',
    room: 'Hall B',
    present: 6,
    absent: 1,
    studentIds: ['1', '2', '3', '4', '5', '7', '8'],
    presentIds: ['1', '2', '3', '5', '7', '8'],
    absentIds: ['4'],
    records: {}
  },
  {
    id: 'sess-105',
    classId: 'cse-3a-os',
    date: '05 Oct 2026',
    time: '11:20 AM',
    subject: 'Operating Systems',
    section: 'CSE-21',
    classLabel: 'CSE-21',
    room: 'Hall B',
    present: 5,
    absent: 2,
    studentIds: ['1', '2', '3', '4', '5', '7', '8'],
    presentIds: ['1', '2', '3', '5', '7'],
    absentIds: ['4', '8'],
    records: {}
  }
];

// In-memory Database object with automatic LocalStorage synchronization
function canonicalSectionName(department, value) {
  const dept = String(department || '').trim();
  const section = String(value || '').trim();
  if (!dept || !section) return section;
  const escapedDept = dept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = section.replace(new RegExp(`^${escapedDept}[-\\s]*`, 'i'), '').trim();
  return section.toLowerCase().startsWith(dept.toLowerCase())
    ? (suffix ? `${dept}-${suffix}` : dept)
    : `${dept}-${section}`;
}

function canonicalAcademicYear(value) {
  const match = String(value || '').trim().match(/^([1-4])(?:st|nd|rd|th)?\s*(?:year)?$/i);
  if (!match) return '';
  const number = Number(match[1]);
  const ordinal = ['th', 'st', 'nd', 'rd', 'th'][number];
  return `${number}${ordinal} Year`;
}

function getMinAttendance() {
  const value = DB.config?.minAttendancePercent;
  return Number.isInteger(value) && value >= 40 && value <= 100
    ? value
    : COLLEGE_CONFIG.minAttendancePercent;
}

function getWarningThreshold() {
  const value = DB.config?.warningThreshold;
  const savedWarning = Number.isInteger(value) && value >= 0 && value <= 99
    ? value
    : COLLEGE_CONFIG.warningThreshold;
  return Math.min(savedWarning, getMinAttendance() - 1);
}

const DB = {
  config: COLLEGE_CONFIG,
  teacher: INITIAL_TEACHERS[0],
  teachers: INITIAL_TEACHERS,
  classes: INITIAL_CLASSES,
  students: INITIAL_STUDENTS,
  history: INITIAL_HISTORY,
  terms: [],
  selectedTermId: null,
  subjects: [],
  auditLog: [],
  reviewQueue: [],

  // Load from persistent storage
  load() {
    this.config = { ...COLLEGE_CONFIG };
    const read = (key, fallback, valid = value => Array.isArray(value)) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const value = JSON.parse(raw);
        if (valid(value)) return value;
      } catch (e) { console.warn(`Could not read ${key}:`, e); }
      return fallback;
    };
    const has = key => { try { return localStorage.getItem(key) !== null; } catch { return false; } };
    this.teacher = read('collegeAttendanceCurrentTeacher', this.teacher, value => value && typeof value === 'object');
    this.teachers = read('collegeAttendanceTeachers', this.teachers);
    this.teachers.forEach(teacher => {
      const legacyHod = teacher.isHod === true || String(teacher.role || '').toLowerCase() === 'hod' || /(?:^|\W)hod(?:$|\W)/i.test(teacher.designation || '');
      teacher.role = legacyHod ? 'hod' : 'faculty';
      delete teacher.isHod;
    });
    const savedTeacherId = this.teacher?.id;
    this.teacher = this.teachers.find(teacher => String(teacher.id) === String(savedTeacherId)) || null;
    this.teachers.forEach(teacher => {
      if (teacher.role === 'hod' && this.teachers.some(other => other !== teacher && other.role === 'hod' && String(other.department || '').toLowerCase() === String(teacher.department || '').toLowerCase())) teacher.role = 'faculty';
    });
    this.classes = read('collegeAttendanceClasses', this.classes);
    this.students = read('collegeAttendanceStudents', this.students);
    this.history = read('collegeAttendanceHistory', this.history);
    this.terms = read('collegeAttendanceTerms', []);
    const savedSelectedTermId = localStorage.getItem('collegeAttendanceSelectedTerm') || null;
    this.selectedTermId = savedSelectedTermId;
    this.subjects = read('collegeAttendanceSubjects', this.subjects);
    this.auditLog = read('collegeAttendanceAudit', this.auditLog);
    this.reviewQueue = read('collegeAttendanceReviewQueue', []);
    const hadNoTerms = !this.terms.length;
    if (hadNoTerms) this.terms = [generateTermForDate()];
    const current = this.getCurrentTerm();
    const active = this.terms.find(term => term.status === 'active') || current;
    this.selectedTermId = this.terms.some(term => term.id === this.selectedTermId) ? this.selectedTermId : current?.id || active?.id;
    this.history.forEach(session => {
      if (session.termId && this.terms.some(term => term.id === session.termId)) return;
      const date = session.dateISO || '';
      const match = this.terms.find(term => date >= term.startDate && date <= term.endDate);
      const term = match || this.terms.find(item => item.status === 'active') || current || this.terms[0];
      if (term) { session.termId = term.id; session.academicYear = term.academicYear; session.semester = `Semester ${term.semester}`; }
    });

      // Support migration from legacy keys if new keys are not yet set
      if (!has('collegeAttendanceClasses')) {
        this.classes = read('faceAttendanceClasses', this.classes);
      }
      if (!has('collegeAttendanceStudents')) {
        this.students = read('faceAttendanceStudents', this.students);
      }

    const savedSettings = read('collegeAttendanceSettings', null, value => value && typeof value === 'object' && !Array.isArray(value));
    if (savedSettings) {
      const minAttendancePercent = Number.isInteger(savedSettings.minAttendancePercent) &&
        savedSettings.minAttendancePercent >= 40 && savedSettings.minAttendancePercent <= 100
        ? savedSettings.minAttendancePercent
        : COLLEGE_CONFIG.minAttendancePercent;
      const warningThreshold = Number.isInteger(savedSettings.warningThreshold) &&
        savedSettings.warningThreshold >= 0 && savedSettings.warningThreshold <= 99
        ? savedSettings.warningThreshold
        : COLLEGE_CONFIG.warningThreshold;
      this.config = { ...COLLEGE_CONFIG, minAttendancePercent, warningThreshold };
      if (Number.isInteger(savedSettings.lateAfterMinutes) && savedSettings.lateAfterMinutes >= 0 && savedSettings.lateAfterMinutes <= 180) this.config.lateAfterMinutes = savedSettings.lateAfterMinutes;
      if (Number.isFinite(savedSettings.confidenceThreshold) && savedSettings.confidenceThreshold >= 0 && savedSettings.confidenceThreshold <= 1) this.config.confidenceThreshold = savedSettings.confidenceThreshold;
      if (Number.isFinite(savedSettings.reviewThreshold) && savedSettings.reviewThreshold >= 0 && savedSettings.reviewThreshold < this.config.confidenceThreshold) this.config.reviewThreshold = savedSettings.reviewThreshold;
      if (Number.isFinite(savedSettings.sessionEditLockHours) && savedSettings.sessionEditLockHours >= 0) this.config.sessionEditLockHours = savedSettings.sessionEditLockHours;
      if (savedSettings.condonation && typeof savedSettings.condonation === 'object') this.config.condonation = { onDuty: savedSettings.condonation.onDuty !== false, medical: savedSettings.condonation.medical !== false };
      if (Array.isArray(savedSettings.holidays)) this.config.holidays = savedSettings.holidays;
      this.config.autoSwitchTermByDate = savedSettings.autoSwitchTermByDate !== false;
      if (Number.isInteger(savedSettings.defaultOddSemester) && savedSettings.defaultOddSemester >= 1 && savedSettings.defaultOddSemester <= 8) this.config.defaultOddSemester = savedSettings.defaultOddSemester;
      if (Number.isInteger(savedSettings.defaultEvenSemester) && savedSettings.defaultEvenSemester >= 1 && savedSettings.defaultEvenSemester <= 8) this.config.defaultEvenSemester = savedSettings.defaultEvenSemester;
    }
    if (hadNoTerms) {
      this.terms = [generateTermForDate()];
      this.selectedTermId = this.terms[0].id;
    }

    // Ensure studentIds arrays exist and IDs are normalized
    this.classes.forEach(c => {
      c.id = c.id || `class-${c.label}-${c.subject}`.replace(/\s+/g, '-').toLowerCase();
      if (!Array.isArray(c.studentIds)) {
        c.studentIds = this.students
          .filter(s => s.section === c.section && (!c.department || s.department === c.department))
          .map(s => s.id);
      }
    });
    this.normalizeSections();
    this.pendingTermActivation = this.syncActiveTermByDate();
    if (!savedSelectedTermId || !this.terms.some(term => term.id === savedSelectedTermId)) {
      const currentTerm = this.getCurrentTerm();
      this.selectedTermId = currentTerm.id;
    }
    const migrationTerm = this.terms.find(term => term.status === 'active') || this.getCurrentTerm();
    this.classes.forEach(cls => {
      if (hadNoTerms || !cls.termId) cls.termId = migrationTerm?.id || current?.id;
      if (!cls.teacherId && cls.facultyId) cls.teacherId = String(cls.facultyId);
      if (!cls.teacherId) {
        const subjectOwner = this.subjects.find(subject => subject.department === cls.department && subject.year === cls.year && subject.facultyId)?.facultyId;
        const departmentHod = this.teachers.find(teacher => teacher.department === cls.department && teacher.role === 'hod');
        const departmentFaculty = this.teachers.filter(teacher => teacher.department === cls.department && teacher.role !== 'hod');
        cls.teacherId = String(subjectOwner || (departmentFaculty.length === 1 ? departmentFaculty[0].id : departmentHod?.id || ''));
      }
      cls.teacherId = String(cls.teacherId || '');
      delete cls.facultyId;
      let subject = this.subjects.find(item => cls.subjectId && String(item.id) === String(cls.subjectId));
      if (!subject) subject = this.subjects.find(item =>
        String(item.department || '').trim().toLowerCase() === String(cls.department || '').trim().toLowerCase() &&
        String(item.year || '').trim().toLowerCase() === String(cls.year || '').trim().toLowerCase() &&
        ((!cls.termId || !item.termId || String(item.termId) === String(cls.termId))) &&
        ((cls.code && String(item.code || '').trim().toLowerCase() === String(cls.code).trim().toLowerCase()) || (!cls.code && String(item.name || '').trim().toLowerCase() === String(cls.subject || '').trim().toLowerCase()))
      );
      if (!subject && (cls.subject || cls.code)) {
        subject = { id: `subject-${String(cls.id).replace(/[^a-z0-9-]/gi, '-')}`, code: String(cls.code || `SUB-${String(cls.id).slice(-6)}`).toUpperCase(), name: cls.subject || cls.code, department: cls.department || '', year: cls.year || '', semester: cls.semester || '', semesterNumber: Number(cls.semesterNumber || 0) || undefined, termId: cls.termId, credits: 0, facultyId: '' };
        this.subjects.push(subject);
      }
      if (subject) cls.subjectId = String(subject.id);
    });
    this.subjects.forEach(subject => {
      const linked = this.classes.filter(cls => String(cls.subjectId || '') === String(subject.id));
      subject.facultyId = linked.length && linked.every(cls => String(cls.teacherId || '') === String(linked[0].teacherId || '')) ? String(linked[0].teacherId || '') : '';
    });
    this.subjects.forEach(subject => { if (hadNoTerms || !subject.termId) subject.termId = migrationTerm?.id || current?.id; });
    if (hadNoTerms) this.history.forEach(session => {
      const term = this.terms[0];
      const cls = this.classes.find(item => String(item.id) === String(session.classId));
      session.termId = term?.id; session.academicYear = term?.academicYear;
      session.semester = `Semester ${this.getSemesterForYear(cls?.year, term?.type) || term?.semester || 1}`;
    });
    this.save();
  },

  getCurrentTerm(date = localISODate()) {
    date = date instanceof Date ? localISODate(date) : String(date || localISODate()).slice(0, 10);
    const matching = this.terms.filter(term => term.startDate <= date && term.endDate >= date);
    if (matching.length) {
      const selected = matching.find(term => term.status === 'active') || matching.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
      return { ...selected, noRunningTerm: false };
    }
    const ended = this.terms.filter(term => term.endDate < date).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    const upcoming = this.terms.filter(term => term.startDate > date).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    return ended ? { ...ended, noRunningTerm: true } : upcoming ? { ...upcoming, noRunningTerm: true } : { ...generateTermForDate(date), noRunningTerm: true };
  },

  getSemesterForYear(year, type = this.getCurrentTerm()?.type) {
    const yearNumber = Number(String(year || '').match(/[1-4]/)?.[0]);
    return yearNumber ? (yearNumber - 1) * 2 + (type === 'even' ? 2 : 1) : null;
  },

  syncActiveTermByDate(date = localISODate()) {
    if (this.config.autoSwitchTermByDate === false) return null;
    let current = this.getCurrentTerm(date);
    let term = this.terms.find(item => item.id === current.id);
    if (current.noRunningTerm) {
      const generated = generateTermForDate(date);
      if (!this.terms.some(item => item.id === generated.id)) this.terms.push(generated);
      current = generated;
      term = this.terms.find(item => item.id === generated.id);
    }
    if (!term) { term = { ...current, noRunningTerm: undefined }; this.terms.push(term); }
    if (!term) return null;
    const previous = this.terms.find(item => item.status === 'active');
    if (previous?.id === term.id) return null;
    this.terms.forEach(item => { item.status = item.id === term.id ? 'active' : item.status === 'active' ? 'closed' : item.status; });
    return { term, previous };
  },

  normalizeSections() {
    const originalClassSections = new Map(this.classes.map(c => [String(c.id), c.section]));
    const canonicalize = (department, value) => {
      const section = String(value || '').trim();
      if (!section) return '';
      const dept = String(department || '').trim();
      if (!dept) return section;
      // Translate labels from the earlier demo layout into the real CSE sections.
      if (dept.toUpperCase() === 'CSE') {
        const legacyCseSection = section.match(/^CSE[-\s]*3([ABC])$/i) || section.match(/^3([ABC])$/i);
        if (legacyCseSection) return `CSE-${['A', 'B', 'C'].indexOf(legacyCseSection[1].toUpperCase()) + 21}`;
      }
      if (dept.toUpperCase() === 'IT') {
        const legacyItSection = section.match(/^IT[-\s]*3([ABC])$/i);
        if (legacyItSection) return `IT-${legacyItSection[1].toUpperCase()}`;
      }
      return canonicalSectionName(dept, section);
    };

    this.classes.forEach(cls => {
      cls.year = canonicalAcademicYear(cls.year);
      cls.label = canonicalize(cls.department, cls.label || cls.section);
      cls.section = cls.label;
    });

    this.students.forEach(student => {
      const department = String(student.department || '').trim();
      const statedSection = String(student.section || '').trim();
      student.year = canonicalAcademicYear(student.year);
      const normalizedSection = canonicalize(department, statedSection);
      const linkedClasses = this.classes.filter(cls =>
        String(cls.department || '').toLowerCase() === department.toLowerCase() &&
        (cls.studentIds || []).some(id => String(id) === String(student.id))
      );
      const sectionClasses = this.classes.filter(cls =>
        String(cls.department || '').toLowerCase() === department.toLowerCase() &&
        String(cls.label || '').toLowerCase() === normalizedSection.toLowerCase()
      );
      const yearCandidates = linkedClasses.length ? linkedClasses : sectionClasses;
      const candidateYears = [...new Set(yearCandidates.map(cls => cls.year).filter(Boolean))];
      if (candidateYears.length === 1 && (!student.year || !candidateYears.includes(student.year))) {
        student.year = candidateYears[0];
      }

      const explicitDepartmentSection = department && statedSection.toLowerCase().startsWith(department.toLowerCase());
      if (explicitDepartmentSection) {
        student.section = normalizedSection;
        return;
      }

      const linkedClass = this.classes.find(cls =>
        String(cls.department || '').toLowerCase() === department.toLowerCase() &&
        (!cls.year || !student.year || cls.year === student.year) &&
        (cls.studentIds || []).some(id => String(id) === String(student.id))
      );
      const legacySectionMatches = this.classes.filter(cls =>
        String(cls.department || '').toLowerCase() === String(student.department || '').toLowerCase() &&
        (!cls.year || !student.year || cls.year === student.year) &&
        String(originalClassSections.get(String(cls.id)) || '').toLowerCase() === String(student.section || '').toLowerCase()
      );
      const uniqueLegacyLabels = [...new Set(legacySectionMatches.map(cls => cls.label))];
      const legacySectionClass = linkedClass || (uniqueLegacyLabels.length === 1 ? legacySectionMatches[0] : null);
      student.section = legacySectionClass ? legacySectionClass.label : 'Unassigned';
    });

    // Keep each registered student's section represented in the section list.
    // This also repairs data saved before registration began creating section records.
    this.students.forEach(student => {
      const department = String(student.department || '').trim();
      const year = String(student.year || '').trim();
      const section = String(student.section || '').trim();
      if (!department || !section || section.toLowerCase() === 'unassigned' || section === '—') return;

      const label = canonicalize(department, section);
      student.section = label;
      let sectionClasses = this.classes.filter(cls =>
        String(cls.department || '').toLowerCase() === department.toLowerCase() &&
        String(cls.year || '').toLowerCase() === year.toLowerCase() &&
        String(cls.label || '').toLowerCase() === label.toLowerCase()
      );

      if (!sectionClasses.length) {
        const idPart = `${department}-${year}-${label}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        const id = `section-${idPart}`;
        sectionClasses = [{
          id,
          label,
          department,
          year,
          section: label,
          subject: '',
          code: '',
          room: '',
          time: '',
          days: [],
          studentIds: []
        }];
        this.classes.push(sectionClasses[0]);
      }

      sectionClasses.forEach(cls => {
        cls.studentIds = Array.isArray(cls.studentIds) ? cls.studentIds : [];
        if (!cls.studentIds.some(id => String(id) === String(student.id))) cls.studentIds.push(student.id);
      });
    });

    const studentsById = new Map(this.students.map(student => [String(student.id), student]));
    this.classes.forEach(cls => {
      cls.studentIds = (cls.studentIds || []).filter(id => {
        const student = studentsById.get(String(id));
        if (!student) return true;
        return String(student.department || '').toLowerCase() === String(cls.department || '').toLowerCase() &&
          String(student.year || '').toLowerCase() === String(cls.year || '').toLowerCase() &&
          canonicalize(student.department, student.section).toLowerCase() === String(cls.label || '').toLowerCase();
      });
    });

    this.history.forEach(session => {
      const cls = this.classes.find(item => String(item.id) === String(session.classId));
      const label = cls?.label || session.classLabel || session.section;
      if (label) {
        session.section = label;
        session.classLabel = label;
      }

      const roster = Array.isArray(session.studentIds) ? [...new Set(session.studentIds.map(String))] : [];
      const hasPresentIds = Array.isArray(session.presentIds);
      const recordedPresentIds = Object.entries(session.records || {})
        .filter(([, record]) => record?.status === 'present')
        .map(([id]) => String(id));
      const presentIds = [...new Set((hasPresentIds ? session.presentIds : recordedPresentIds).map(String))]
        .filter(id => !roster.length || roster.includes(id));
      if (Array.isArray(session.studentIds)) session.studentIds = roster;
      if (hasPresentIds || recordedPresentIds.length) session.presentIds = presentIds;
      if (roster.length && (hasPresentIds || recordedPresentIds.length)) {
        session.presentIds = presentIds;
        session.absentIds = roster.filter(id => !presentIds.includes(id));
        session.present = session.presentIds.length;
        session.absent = session.absentIds.length;
      }
    });
  },

  // Save current state to LocalStorage
  save() {
    try {
      localStorage.setItem('collegeAttendanceCurrentTeacher', JSON.stringify(this.teacher));
      localStorage.setItem('collegeAttendanceTeachers', JSON.stringify(this.teachers));
      localStorage.setItem('collegeAttendanceClasses', JSON.stringify(this.classes));
      localStorage.setItem('collegeAttendanceStudents', JSON.stringify(this.students));
      localStorage.setItem('collegeAttendanceHistory', JSON.stringify(this.history));
      localStorage.setItem('collegeAttendanceTerms', JSON.stringify(this.terms || []));
      localStorage.setItem('collegeAttendanceSelectedTerm', this.selectedTermId || '');
      localStorage.setItem('collegeAttendanceSubjects', JSON.stringify(this.subjects || []));
      localStorage.setItem('collegeAttendanceAudit', JSON.stringify(this.auditLog || []));
      localStorage.setItem('collegeAttendanceReviewQueue', JSON.stringify(this.reviewQueue || []));
      // Keep legacy keys updated for compatibility
      localStorage.setItem('faceAttendanceClasses', JSON.stringify(this.classes));
      localStorage.setItem('faceAttendanceStudents', JSON.stringify(this.students));
      const minAttendancePercent = Number.isInteger(this.config.minAttendancePercent) &&
        this.config.minAttendancePercent >= 40 && this.config.minAttendancePercent <= 100
        ? this.config.minAttendancePercent
        : COLLEGE_CONFIG.minAttendancePercent;
      const warningThreshold = Number.isInteger(this.config.warningThreshold) &&
        this.config.warningThreshold >= 0 && this.config.warningThreshold <= 99
        ? this.config.warningThreshold
        : COLLEGE_CONFIG.warningThreshold;
      localStorage.setItem('collegeAttendanceSettings', JSON.stringify({ minAttendancePercent, warningThreshold, lateAfterMinutes: this.config.lateAfterMinutes, confidenceThreshold: this.config.confidenceThreshold, reviewThreshold: this.config.reviewThreshold, sessionEditLockHours: this.config.sessionEditLockHours, condonation: this.config.condonation, holidays: this.config.holidays || [], autoSwitchTermByDate: this.config.autoSwitchTermByDate !== false, defaultOddSemester: this.config.defaultOddSemester, defaultEvenSemester: this.config.defaultEvenSemester }));
      return true;
    } catch (e) {
      console.warn('Could not save to local storage:', e);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('faceauth-storage-error', { detail: { name: e?.name || 'StorageError' } }));
      return false;
    }
  },

  // Reset to initial demo dataset
  resetToDemo() {
    this.teachers = JSON.parse(JSON.stringify(INITIAL_TEACHERS));
    this.teacher = this.teachers[0];
    this.classes = JSON.parse(JSON.stringify(INITIAL_CLASSES));
    this.students = JSON.parse(JSON.stringify(INITIAL_STUDENTS));
    this.history = JSON.parse(JSON.stringify(INITIAL_HISTORY));
    this.terms = [generateTermForDate()];
    this.selectedTermId = this.terms[0].id;
    this.classes.forEach(cls => { cls.termId = this.terms[0].id; });
    this.history.forEach(session => { session.termId = this.terms[0].id; session.academicYear = this.terms[0].academicYear; });
    this.subjects = [];
    this.classes.forEach(cls => {
      const departmentHod = this.teachers.find(teacher => teacher.department === cls.department && teacher.role === 'hod');
      const departmentFaculty = this.teachers.filter(teacher => teacher.department === cls.department && teacher.role === 'faculty');
      cls.teacherId = String(cls.teacherId || departmentHod?.id || (departmentFaculty.length === 1 ? departmentFaculty[0].id : ''));
      delete cls.facultyId;
      let subject = this.subjects.find(item => String(item.department).toLowerCase() === String(cls.department).toLowerCase() && String(item.year).toLowerCase() === String(cls.year).toLowerCase() && String(item.code).toLowerCase() === String(cls.code || '').toLowerCase());
      if (!subject) {
        subject = { id: `subject-demo-${String(cls.id).replace(/[^a-z0-9-]/gi, '-')}`, code: String(cls.code || `SUB-${String(cls.id).slice(-6)}`).toUpperCase(), name: cls.subject || cls.code, department: cls.department, year: cls.year, semester: '', semesterNumber: 0, termId: cls.termId, credits: 0, facultyId: '' };
        this.subjects.push(subject);
      }
      cls.subjectId = String(subject.id);
    });
    this.subjects.forEach(subject => {
      const linked = this.classes.filter(cls => String(cls.subjectId) === String(subject.id));
      subject.facultyId = linked.length && linked.every(cls => String(cls.teacherId) === String(linked[0].teacherId)) ? String(linked[0].teacherId || '') : '';
    });
    this.normalizeSections();
    this.save();
  }
};

// Initialize DB on script load
DB.load();
if (typeof window !== 'undefined') {
  window.DB = DB;
  window.COLLEGE_CONFIG = COLLEGE_CONFIG;
  window.INITIAL_TEACHERS = INITIAL_TEACHERS;
}
