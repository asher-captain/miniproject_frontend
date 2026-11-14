// ==========================================================
// College Attendance Management System - Data API Service
// ==========================================================

const USE_MOCK = true;
const BASE_URL = location.port === '8000' ? '/api' : 'http://127.0.0.1:8000/api';
// Run a face-recognition service at this URL, or change it to your service URL.
const RECOGNITION_URL = `${BASE_URL}/recognize`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function apiRequest(path, options = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, options);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: body?.error || body?.message || `Request failed (HTTP ${res.status}).` };
    return body ?? { ok: true };
  } catch {
    return { ok: false, error: 'Could not contact the server.' };
  }
}
async function hashPassword(password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function calcClassesNeeded(attended, total, minPct = getMinAttendance()) {
  const m = minPct / 100;
  if (total === 0 || attended / total >= m) return 0;
  if (m >= 1) return Infinity;
  return Math.max(0, Math.ceil((minPct * total - 100 * attended) / (100 - minPct)));
}

function classesCanMiss(attended, total, minPct = getMinAttendance()) {
  const m = minPct / 100;
  if (m <= 0) return Infinity;
  return Math.max(0, Math.floor(attended / m - total));
}

function calcAttendanceBuffer(attended, total, minPct, warningPct) {
  const safeTotal = Number(total);
  const safeAttended = Number(attended);
  const min = Number(minPct);
  const warning = Math.min(Number(warningPct), min - 1);
  if (!Number.isFinite(safeTotal) || safeTotal <= 0 || !Number.isFinite(safeAttended) || !Number.isFinite(min) || min <= 0) {
    return { canMiss: 0, classesNeeded: 0, percent: null, status: 'none' };
  }
  const percent = Math.round((safeAttended / safeTotal) * 100);
  return {
    canMiss: classesCanMiss(safeAttended, safeTotal, min),
    classesNeeded: percent < min ? calcClassesNeeded(safeAttended, safeTotal, min) : 0,
    percent,
    status: percent < warning ? 'critical' : percent < min ? 'warning' : 'eligible'
  };
}

async function migrateLegacyTeacherPasswords() {
  const legacy = (DB.teachers || []).filter(teacher => typeof teacher.password === 'string');
  for (const teacher of legacy) {
    teacher.passwordSalt ||= crypto.randomUUID();
    teacher.passwordHash = await hashPassword(teacher.password, teacher.passwordSalt);
    delete teacher.password;
    if (DB.teacher && String(DB.teacher.id) === String(teacher.id)) DB.teacher = teacher;
  }
  if (legacy.length) DB.save();
}

const FaceAPI = {
  migrateLegacyTeacherPasswords,
  // --------------------------------------------------------
  // Teacher Authentication
  // --------------------------------------------------------
  async login(idOrEmail, password) {
    if (USE_MOCK) {
      await sleep(150);
      const query = String(idOrEmail || '').trim().toLowerCase();
      const pass = String(password || '').trim();

      const teacher = (DB.teachers || []).find(t => String(t.id || '').toLowerCase() === query || (t.email && t.email.toLowerCase() === query));
      if (teacher && pass && teacher.passwordHash && teacher.passwordSalt && await hashPassword(pass, teacher.passwordSalt) === teacher.passwordHash) {
        DB.teacher = DB.teachers.find(item => String(item.id) === String(teacher.id));
        DB.save();
        return { ok: true, teacher: DB.teacher };
      }

      return { ok: false, error: 'Invalid Teacher ID/Email or Password.' };
    }

    try {
      return await apiRequest('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: idOrEmail, password })
      }).then(result => {
        if (result.ok && result.teacher?.id) {
          const index = DB.teachers.findIndex(item => String(item.id) === String(result.teacher.id));
          if (index < 0) DB.teachers.push(result.teacher);
          else DB.teachers[index] = { ...DB.teachers[index], ...result.teacher };
          DB.teacher = DB.teachers.find(item => String(item.id) === String(result.teacher.id));
          DB.save();
          result.teacher = DB.teacher;
        }
        return result;
      });
    } catch { return { ok: false, error: 'Cannot connect to backend server.' }; }
  },

  async demoLogin() {
    const teacher = DB.teachers.find(t => t.role === 'hod' && String(t.department || '').trim().toUpperCase() === 'CSE') || DB.teachers.find(t => t.role === 'hod');
    if (!teacher) return { ok: false, error: 'Demo account is unavailable.' };
    DB.teacher = teacher;
    DB.save();
    return { ok: true, teacher };
  },

  async registerTeacher(data) {
    if (USE_MOCK) {
      await sleep(350);
      const email = String(data.email || '').trim().toLowerCase();
      if (DB.teachers.some(t => t.email.toLowerCase() === email)) {
        return { ok: false, error: 'A teacher account with this email address already exists.' };
      }

      const id = 'T' + crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
      const passwordSalt = crypto.randomUUID();
      const passwordHash = await hashPassword(data.password, passwordSalt);
      const newTeacher = {
        id,
        name: data.name.trim(),
        email,
        department: data.department || 'CSE',
        designation: data.designation || 'Assistant Professor',
        role: 'faculty',
        facultyIdCard: data.facultyIdCard || null,
        passwordSalt,
        passwordHash
      };

      const previousTeacher = DB.teacher;
      DB.teachers.push(newTeacher);
      DB.teacher = newTeacher;
      if (!DB.save()) {
        DB.teachers.pop();
        DB.teacher = previousTeacher;
        return { ok: false, error: 'Account could not be saved. Remove some stored photos or documents and try again.' };
      }
      return { ok: true, teacher: newTeacher };
    }

    const result = await apiRequest('/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    if (result.ok && result.teacher?.id) {
      result.teacher.role = 'faculty';
      DB.teachers.push(result.teacher);
      DB.teacher = result.teacher;
      DB.save();
    }
    return result;
  },

  async setTeacherRole(teacherId, role) {
    if (!['hod', 'faculty'].includes(role)) return { ok: false, error: 'Choose a valid teacher role.' };
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const target = DB.teachers.find(teacher => String(teacher.id) === String(teacherId));
    if (!actor || actor.role !== 'hod' || !target || String(actor.department || '').toLowerCase() !== String(target.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can manage faculty roles.' };
    if (!USE_MOCK) return await apiRequest(`/teachers/${encodeURIComponent(teacherId)}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    DB.teachers.forEach(teacher => {
      if (teacher !== target && teacher.role === 'hod' && String(teacher.department || '').toLowerCase() === String(target.department || '').toLowerCase()) teacher.role = 'faculty';
    });
    target.role = role;
    delete target.isHod;
    if (DB.teacher && String(DB.teacher.id) === String(target.id)) DB.teacher = target;
    if (!DB.save()) return { ok: false, error: 'The role change could not be saved.' };
    return { ok: true, teacher: target };
  },

  async updateTeacherDetails(teacherId, updates) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const target = DB.teachers.find(teacher => String(teacher.id) === String(teacherId));
    const sameDepartment = (left, right) => String(left?.department || '').trim().toLowerCase() === String(right?.department || '').trim().toLowerCase();
    const nextId = String(updates?.id || '').trim();
    if (!actor || actor.role !== 'hod' || !target || !sameDepartment(actor, target)) return { ok: false, error: 'Only the department HOD can edit department teacher details.' };
    if (!nextId) return { ok: false, error: 'Teacher ID is required.' };
    if (DB.teachers.some(teacher => teacher !== target && String(teacher.id).toLowerCase() === nextId.toLowerCase())) return { ok: false, error: 'That Teacher ID is already in use.' };
    if (!USE_MOCK) {
      const result = await apiRequest(`/teachers/${encodeURIComponent(teacherId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nextId }) });
      if (!result.ok) return result;
    }
    const oldId = String(target.id);
    target.id = nextId;
    DB.classes.forEach(cls => { if (String(cls.teacherId || '') === oldId) cls.teacherId = nextId; });
    DB.subjects.forEach(subject => { if (String(subject.facultyId || '') === oldId) subject.facultyId = nextId; });
    if (DB.teacher && String(DB.teacher.id) === oldId) DB.teacher = target;
    if (currentTeacher && String(currentTeacher.id) === oldId) currentTeacher = target;
    if (USE_MOCK && !DB.save()) {
      target.id = oldId;
      DB.classes.forEach(cls => { if (String(cls.teacherId || '') === nextId) cls.teacherId = oldId; });
      DB.subjects.forEach(subject => { if (String(subject.facultyId || '') === nextId) subject.facultyId = oldId; });
      if (DB.teacher === target) DB.teacher = target;
      return { ok: false, error: 'Teacher ID could not be saved to browser storage.' };
    }
    return { ok: true, teacher: target };
  },

  async saveSubject(subject) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const existing = DB.subjects.find(item => String(item.id) === String(subject.id));
    if (!actor || actor.role !== 'hod' || String(subject.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can manage subjects.' };
    if (USE_MOCK) {
      const index = DB.subjects.findIndex(item => String(item.id) === String(subject.id));
      if (index < 0) DB.subjects.push(subject); else DB.subjects[index] = subject;
      if (!DB.save()) return { ok: false, error: 'Subject could not be saved to browser storage.' };
      return { ok: true, subject };
    }
    const method = DB.subjects.some(item => String(item.id) === String(subject.id)) ? 'PUT' : 'POST';
    const path = method === 'POST' ? '/subjects' : `/subjects/${encodeURIComponent(subject.id)}`;
    return await apiRequest(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subject) });
  },

  async deleteSubject(subjectId) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const subject = DB.subjects.find(item => String(item.id) === String(subjectId));
    const linkedClasses = DB.classes.filter(cls => String(cls.subjectId || '') === String(subjectId));
    if (!actor || actor.role !== 'hod' || !subject || String(subject.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can manage subjects.' };
    if (USE_MOCK) {
      DB.subjects = DB.subjects.filter(item => String(item.id) !== String(subjectId));
      DB.classes.filter(cls => String(cls.subjectId || '') === String(subjectId)).forEach(cls => { cls.subjectId = ''; cls.subject = ''; cls.code = ''; });
      if (!DB.save()) return { ok: false, error: 'Subject could not be removed from browser storage.' };
      return { ok: true };
    }
    return await apiRequest(`/subjects/${encodeURIComponent(subjectId)}`, { method: 'DELETE' });
  },

  async logout() {
    try {
      localStorage.removeItem('collegeAttendanceCurrentTeacher');
    } catch {}
    return { ok: true };
  },

  // --------------------------------------------------------
  // Classes Management
  // --------------------------------------------------------
  async addClass(cls) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    if (!actor || String(cls.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Classes can only be created in your department.' };
    const ownerId = String(cls.teacherId || (actor.role === 'hod' ? '' : actor.id));
    if (ownerId && !DB.teachers.some(teacher => String(teacher.id) === ownerId && String(teacher.department || '').toLowerCase() === String(actor.department || '').toLowerCase())) return { ok: false, error: 'Choose a teacher in your department.' };
    if (actor.role !== 'hod' && ownerId !== String(actor.id)) return { ok: false, error: 'Faculty can only create their own assignments.' };
    if (USE_MOCK) {
      await sleep(250);
      const year = canonicalAcademicYear(cls.year);
      if (!year) return { ok: false, error: 'Choose a valid academic year (1st to 4th Year).' };
      const norm = v => String(v || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      const duplicate = DB.classes.some(c =>
        norm(c.department) === norm(cls.department) &&
        norm(c.year) === norm(cls.year) &&
        norm(c.label || c.section) === norm(cls.label || cls.section) &&
        norm(c.subjectId || c.code || c.subject || '') === norm(cls.subjectId || cls.code || cls.subject || '') &&
        String(c.termId || '') === String(cls.termId || DB.selectedTermId || '')
      );

      if (duplicate) {
        return { ok: false, error: 'This department section already exists.' };
      }

      const newClass = {
        id: `class-${Date.now()}`,
        label: cls.label || `${cls.department}-${cls.section}`,
        department: cls.department,
        year,
        section: cls.label || `${cls.department}-${cls.section}`,
        subject: cls.subject || '',
        code: cls.code || '',
        subjectId: String(cls.subjectId || ''),
        room: cls.room || '',
        time: cls.time || '',
        days: Array.isArray(cls.days) ? cls.days : [],
        studentIds: Array.isArray(cls.studentIds) ? cls.studentIds : [],
        termId: cls.termId || DB.selectedTermId || DB.terms.find(term => term.status === 'active')?.id,
        teacherId: String(cls.teacherId || DB.teacher?.id || '')
      };

      DB.classes.push(newClass);
      if (newClass.subjectId && typeof assignFaculty === 'function') assignFaculty(newClass.id, newClass.teacherId);
      DB.save();
      return { ok: true, class: newClass };
    }

    return await apiRequest('/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cls)
      });
  },

  async updateClass(id, updates) {
    const normalizedUpdates = { ...updates };
    if (Object.hasOwn(normalizedUpdates, 'year')) {
      normalizedUpdates.year = canonicalAcademicYear(normalizedUpdates.year);
      if (!normalizedUpdates.year) return { ok: false, error: 'Choose a valid academic year (1st to 4th Year).' };
    }
    if (USE_MOCK) {
      const target = DB.classes.find(c => String(c.id) === String(id));
      if (!target) return { ok: false, error: 'Class not found.' };
      const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
      if (!actor || String(target.department || '').toLowerCase() !== String(actor.department || '').toLowerCase() || (actor.role !== 'hod' && String(target.teacherId || '') !== String(actor.id))) return { ok: false, error: 'You do not have access to this class.' };
      if (Object.hasOwn(normalizedUpdates, 'teacherId') && (actor.role !== 'hod' || !DB.teachers.some(teacher => String(teacher.id) === String(normalizedUpdates.teacherId) && String(teacher.department || '').toLowerCase() === String(actor.department || '').toLowerCase()))) return { ok: false, error: 'Only the department HOD can assign classes to department faculty.' };
      if (Object.hasOwn(normalizedUpdates, 'subjectId') && target.subjectId && String(target.subjectId) !== String(normalizedUpdates.subjectId || '')) return { ok: false, error: 'A teaching assignment can have only one subject.' };

      const previousSubjectId = String(target.subjectId || '');
      Object.assign(target, normalizedUpdates);
      if (Object.hasOwn(normalizedUpdates, 'teacherId')) delete target.facultyId;
      if (normalizedUpdates.label) target.section = normalizedUpdates.label;
      if (Object.hasOwn(normalizedUpdates, 'subjectId') && typeof linkClassSubject === 'function') linkClassSubject(id, normalizedUpdates.subjectId);
      if (Object.hasOwn(normalizedUpdates, 'teacherId') && typeof assignFaculty === 'function') assignFaculty(id, target.teacherId);
      if (previousSubjectId && previousSubjectId !== String(target.subjectId || '') && typeof syncSubjectFaculty === 'function') syncSubjectFaculty(previousSubjectId);
      DB.save();
      return { ok: true, class: target };
    }

    return await apiRequest(`/classes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedUpdates)
      });
  },

  async removeClass(id) {
    if (USE_MOCK) {
      const removed = DB.classes.find(c => String(c.id) === String(id));
      const prevLen = DB.classes.length;
      DB.classes = DB.classes.filter(c => String(c.id) !== String(id));
      if (DB.classes.length === prevLen) return { ok: false, error: 'Class not found.' };
      if (removed?.subjectId && typeof syncSubjectFaculty === 'function') syncSubjectFaculty(removed.subjectId);
      DB.save();
      return { ok: true };
    }

    return await apiRequest(`/classes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async enrollStudent(classId, studentId) {
    if (USE_MOCK) {
      const target = DB.classes.find(c => String(c.id) === String(classId));
      if (!target) return { ok: false, error: 'Class not found.' };
      const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
      if (!actor || actor.role !== 'hod' || String(target.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can change student enrollment.' };

      target.studentIds = target.studentIds || [];
      const numId = Number(studentId);
      if (!target.studentIds.includes(numId)) {
        target.studentIds.push(numId);
        DB.save();
      }
      return { ok: true, class: target };
    }

    return await apiRequest(`/classes/${encodeURIComponent(classId)}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId })
      });
  },

  async unenrollStudent(classId, studentId) {
    if (USE_MOCK) {
      const target = DB.classes.find(c => String(c.id) === String(classId));
      if (!target) return { ok: false, error: 'Class not found.' };
      const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
      if (!actor || actor.role !== 'hod' || String(target.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can change student enrollment.' };

      target.studentIds = (target.studentIds || []).filter(id => String(id) !== String(studentId));
      DB.save();
      return { ok: true, class: target };
    }

    return await apiRequest(`/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`, {
        method: 'DELETE'
      });
  },

  // --------------------------------------------------------
  // Students Management
  // --------------------------------------------------------
  async findStudents(query) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    if (!actor || actor.role !== 'hod') return { ok: false, error: 'Only the department HOD can search college student profiles.', students: [] };
    const q = String(query || '').trim().toLowerCase();
    const students = DB.students.filter(s => String(s.department || '').toLowerCase() === String(actor.department || '').toLowerCase()).filter(s =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      String(s.roll).toLowerCase().includes(q) ||
      (s.department && s.department.toLowerCase().includes(q)) ||
      (s.section && s.section.toLowerCase().includes(q))
    );
    return { ok: true, students };
  },

  async registerStudent(studentData, images = []) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    if (!actor || actor.role !== 'hod' || String(studentData.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can register students in this department.' };
    const profileData = { ...studentData };
    profileData.year = canonicalAcademicYear(profileData.year);
    if (!profileData.year) return { ok: false, error: 'Choose a valid academic year (1st to 4th Year).' };
    if (!profileData.photo && images[0]?.blob) {
      try {
        profileData.photo = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the captured profile photo.'));
          reader.readAsDataURL(images[0].blob);
        });
      } catch {
        return { ok: false, error: 'Could not save the face registration photo. Please capture again.' };
      }
    }

    if (USE_MOCK) {
      await sleep(400);
      const roll = String(profileData.roll || '').trim().toLowerCase();
      if (DB.students.some(s => String(s.roll).trim().toLowerCase() === roll)) {
        return { ok: false, error: `Roll number ${profileData.roll} is already registered to another student.` };
      }
      const admissionNumber = String(profileData.admissionNumber || '').trim();
      if (admissionNumber && DB.students.some(s => String(s.admissionNumber || '').trim().toLowerCase() === admissionNumber.toLowerCase())) {
        return { ok: false, error: `Admission number ${admissionNumber} is already registered to another student.` };
      }

      const photo = profileData.photo || '';

      const newStudent = {
        id: Date.now(),
        name: profileData.name.trim(),
        roll: profileData.roll.trim(),
        admissionNumber,
        department: profileData.department || 'CSE',
        year: profileData.year || '3rd Year',
        section: profileData.section || 'Unassigned',
        email: profileData.email || `${profileData.name.toLowerCase().replace(/\s+/g, '.')}@student.college.edu`,
        date: profileData.date || new Date().toISOString().slice(0, 10),
        photo,
        faceCaptureCount: images.length || (photo ? 1 : 0)
      };

      DB.students.push(newStudent);
      if (!DB.save()) { DB.students.pop(); return { ok: false, error: 'Student was not saved. Free some browser storage and try again.' }; }
      return { ok: true, student: newStudent };
    }

    const fd = new FormData();
    Object.entries(profileData).forEach(([k, v]) => fd.append(k, v));
    images.forEach(img => fd.append('images', img.blob, `${img.pose}.jpg`));
    const result = await apiRequest('/students', { method: 'POST', body: fd });
    if (result.ok && result.student && !result.student.photo) result.student.photo = profileData.photo || '';
    return result;
  },

  async updateStudent(id, changes) {
    const normalizedChanges = { ...changes };
    if (Object.hasOwn(normalizedChanges, 'year')) {
      normalizedChanges.year = canonicalAcademicYear(normalizedChanges.year);
      if (!normalizedChanges.year) return { ok: false, error: 'Choose a valid academic year (1st to 4th Year).' };
    }
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const visibleTarget = DB.students.find(student => String(student.id) === String(id));
    if (!actor || actor.role !== 'hod' || !visibleTarget || String(visibleTarget.department || '').toLowerCase() !== String(actor.department || '').toLowerCase() || (normalizedChanges.department && String(normalizedChanges.department).toLowerCase() !== String(actor.department || '').toLowerCase())) return { ok: false, error: 'Only the department HOD can edit this student profile.' };
    if (USE_MOCK) {
      const idx = DB.students.findIndex(s => String(s.id) === String(id));
      if (idx === -1) return { ok: false, error: 'Student record not found.' };
      const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
      if (!actor || actor.role !== 'hod' || String(DB.students[idx].department || '').toLowerCase() !== String(actor.department || '').toLowerCase() || (normalizedChanges.department && String(normalizedChanges.department).toLowerCase() !== String(actor.department || '').toLowerCase())) return { ok: false, error: 'Only the department HOD can edit this student profile.' };

      const roll = String(normalizedChanges.roll || '').trim().toLowerCase();
      if (DB.students.some((s, i) => i !== idx && String(s.roll).trim().toLowerCase() === roll)) {
        return { ok: false, error: 'Another student already has this roll number.' };
      }
      const admissionNumber = String(normalizedChanges.admissionNumber || '').trim();
      if (admissionNumber && DB.students.some((s, i) => i !== idx && String(s.admissionNumber || '').trim().toLowerCase() === admissionNumber.toLowerCase())) {
        return { ok: false, error: 'Another student already has this admission number.' };
      }

      const previous = { ...DB.students[idx] };
      Object.assign(DB.students[idx], normalizedChanges, { admissionNumber });
      if (!DB.save()) { Object.assign(DB.students[idx], previous); return { ok: false, error: 'Student changes could not be saved to browser storage.' }; }
      return { ok: true, student: DB.students[idx] };
    }

    return await apiRequest(`/students/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedChanges)
      });
  },

  async recaptureStudentFace(id, images = []) {
    if (!Array.isArray(images) || images.length !== 5 || images.some(image => !image?.blob)) return { ok: false, error: 'Capture all five face poses before saving.' };
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const visibleTarget = DB.students.find(student => String(student.id) === String(id));
    if (!actor || actor.role !== 'hod' || !visibleTarget || String(visibleTarget.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can edit student face data.' };
    if (USE_MOCK) {
      const student = DB.students.find(item => String(item.id) === String(id));
      if (!student) return { ok: false, error: 'Student record not found.' };
      const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
      if (!actor || actor.role !== 'hod' || String(student.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can edit student face data.' };
      const previous = { ...student };
      try {
        const faceCaptures = await Promise.all(images.map(async image => {
          const bitmap = await createImageBitmap(image.blob);
          const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
          return canvas.toDataURL('image/jpeg', 0.68);
        }));
        student.faceCaptures = faceCaptures;
      } catch { return { ok: false, error: 'Captured face images could not be prepared for storage.' }; }
      student.faceCaptureCount = images.length;
      student.faceUpdatedAt = new Date().toISOString();
      if (!DB.save()) {
        Object.keys(student).forEach(key => { if (!Object.hasOwn(previous, key)) delete student[key]; });
        Object.assign(student, previous);
        return { ok: false, error: 'Face captures could not be saved to browser storage. Free some space and try again.' };
      }
      return { ok: true, student };
    }
    const form = new FormData();
    images.forEach(image => form.append('images', image.blob, `${image.pose}.jpg`));
    return apiRequest(`/students/${encodeURIComponent(id)}/face-captures`, { method: 'POST', body: form });
  },

  async deleteStudent(id) {
    const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
    const visibleTarget = DB.students.find(student => String(student.id) === String(id));
    if (!actor || actor.role !== 'hod' || !visibleTarget || String(visibleTarget.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can remove this student.' };
    if (USE_MOCK) {
      const actor = DB.teachers.find(teacher => String(teacher.id) === String(DB.teacher?.id));
      const target = DB.students.find(student => String(student.id) === String(id));
      if (!actor || actor.role !== 'hod' || !target || String(target.department || '').toLowerCase() !== String(actor.department || '').toLowerCase()) return { ok: false, error: 'Only the department HOD can remove this student.' };
      const previousStudents = DB.students;
      const previousClasses = DB.classes.map(cls => ({ cls, studentIds: [...(cls.studentIds || [])] }));
      DB.students = DB.students.filter(s => String(s.id) !== String(id));
      DB.classes.forEach(c => {
        if (Array.isArray(c.studentIds)) {
          c.studentIds = c.studentIds.filter(sId => String(sId) !== String(id));
        }
      });
      if (!DB.save()) {
        DB.students = previousStudents;
        previousClasses.forEach(({ cls, studentIds }) => { cls.studentIds = studentIds; });
        return { ok: false, error: 'Student could not be deleted from browser storage.' };
      }
      return { ok: true };
    }

    return await apiRequest(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // --------------------------------------------------------
  // Face Recognition & Attendance Engine
  // --------------------------------------------------------
  async recognizeFrame(frameBlob, session) {
    if (!frameBlob) return { status: 'unavailable', message: 'Start the camera before attempting recognition.' };
    const fd = new FormData();
    fd.append('frame', frameBlob, 'frame.jpg');
    fd.append('classId', String(session.id));
    fd.append('section', String(session.label || ''));
    fd.append('subject', String(session.subject || ''));
    fd.append('lectureDate', String(session.lectureDate || ''));
    fd.append('studentIds', JSON.stringify(session.studentIds || []));
    try {
      const res = await fetch(RECOGNITION_URL, { method: 'POST', body: fd });
      if (!res.ok) return { status: 'unavailable', message: `Recognition service returned HTTP ${res.status}. Check the service and its API shape.` };
      const data = await res.json();
      const allowed = new Set(['match', 'unknown', 'unverified', 'unavailable']);
      if (!data || !allowed.has(data.status)) return { status: 'unavailable', message: 'Recognition service returned an unsupported response. Expected a status of match, unknown, unverified, or unavailable.' };
      return data;
    } catch (error) {
      return { status: 'unavailable', message: `Could not reach face recognition at ${RECOGNITION_URL}. Start the service or update RECOGNITION_URL in api.js.` };
    }
  },

  // --------------------------------------------------------
  // Attendance Sessions & History
  // --------------------------------------------------------
  async saveSession(session) {
    if (typeof getMyClasses === 'function' && !getMyClasses().some(cls => String(cls.id) === String(session.id))) return { ok: false, error: 'You do not have access to this teaching assignment.' };
    if (USE_MOCK) {
      if (typeof getMyClasses === 'function' && !getMyClasses().some(cls => String(cls.id) === String(session.id))) return { ok: false, error: 'You do not have access to this teaching assignment.' };
      const enrolled = DB.students.filter(s =>
        (session.studentIds || []).map(String).includes(String(s.id))
      );

      const presentStudentIds = Object.keys(session.present).map(String);
      const absentStudentIds = enrolled
        .filter(s => !presentStudentIds.includes(String(s.id)))
        .map(s => String(s.id));

      const newRecord = {
        id: `sess-${Date.now()}`,
        classId: session.id,
        dateISO: session.lectureDate || new Date().toISOString().slice(0, 10),
        date: new Date(`${session.lectureDate || new Date().toISOString().slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: session.subject,
        ...(session.subjectCode ? { subjectCode: session.subjectCode } : {}),
        ...(session.subjectId ? { subjectId: session.subjectId } : {}),
        lectureTime: session.lectureTime || '',
        section: session.label,
        classLabel: session.label,
        room: session.room || 'Main Hall',
        present: presentStudentIds.length,
        absent: absentStudentIds.length,
        studentIds: enrolled.map(s => String(s.id)),
        presentIds: presentStudentIds,
        absentIds: absentStudentIds,
        records: session.present,
        notes: session.notes || '',
        unknownCount: Number(session.unknownCount || 0),
        academicYear: session.academicYear,
        semester: session.semester,
        termId: session.termId
      };

      DB.history.unshift(newRecord);
      if (!DB.save()) {
        DB.history.shift();
        return { ok: false, error: 'Attendance could not be saved to browser storage. Free some storage and try again.' };
      }
      return { ok: true, session: newRecord };
    }

    return await apiRequest('/sessions/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session)
      });
  },

  async updateSessionRecord(sessionId, studentId, newStatus) {
    const session = DB.history.find(h => String(h.id) === String(sessionId));
    if (!session) return { ok: false, error: 'Session not found.' };
    if (typeof getMyClasses === 'function' && !getMyClasses().some(cls => String(cls.id) === String(session.classId))) return { ok: false, error: 'You do not have access to this attendance session.' };
    const previous = JSON.parse(JSON.stringify(session));

    const sId = String(studentId);
    session.presentIds = session.presentIds || [];
    session.absentIds = session.absentIds || [];

    if (['present', 'late', 'on-duty', 'medical'].includes(newStatus)) {
      if (!session.presentIds.includes(sId)) session.presentIds.push(sId);
      session.absentIds = session.absentIds.filter(id => id !== sId);
      session.records = session.records || {};
      session.records[sId] = { status: newStatus, method: 'manual (override)', time: new Date().toLocaleTimeString() };
    } else {
      if (!session.absentIds.includes(sId)) session.absentIds.push(sId);
      session.presentIds = session.presentIds.filter(id => id !== sId);
      if (session.records && session.records[sId]) delete session.records[sId];
    }

    session.present = session.presentIds.length;
    session.absent = session.absentIds.length;
    if (!DB.save()) {
      Object.assign(session, previous);
      return { ok: false, error: 'The attendance change could not be saved to browser storage.' };
    }
    return { ok: true, session };
  },

  async deleteSession(sessionId) {
    if (typeof getMyClasses === 'function') {
      const target = DB.history.find(session => String(session.id) === String(sessionId));
      if (!target || !getMyClasses().some(cls => String(cls.id) === String(target.classId))) return { ok: false, error: 'You do not have access to this attendance session.' };
    }
    const previous = DB.history;
    DB.history = DB.history.filter(h => String(h.id) !== String(sessionId));
    if (!DB.save()) { DB.history = previous; return { ok: false, error: 'The session could not be deleted from browser storage.' }; }
    return { ok: true };
  },

  // --------------------------------------------------------
  // College Attendance Mathematics & Analytics
  // --------------------------------------------------------
  calculateAttendance(studentId, classId = null, minPct = getMinAttendance(), warningPct = getWarningThreshold()) {
    const sId = String(studentId);
    const selectedTermId = DB.selectedTermId || DB.terms?.find(term => term.status === 'active')?.id;
    let relevantSessions = (typeof getVisibleHistory === 'function' ? getVisibleHistory() : DB.history).filter(session => String(session.termId || '') === String(selectedTermId));
    relevantSessions = relevantSessions.filter(session => {
      const status = session.records?.[sId]?.status;
      return !((status === 'on-duty' && DB.config.condonation?.onDuty === false) || (status === 'medical' && DB.config.condonation?.medical === false));
    });
    if (classId) {
      relevantSessions = relevantSessions.filter(h => String(h.classId) === String(classId));
    } else {
      // Find classes student is enrolled in
      const enrolledClasses = DB.classes.filter(c => (c.studentIds || []).map(String).includes(sId));
      const enrolledClassIds = new Set(enrolledClasses.map(c => String(c.id)));
      relevantSessions = relevantSessions.filter(h =>
        enrolledClassIds.has(String(h.classId)) || (h.studentIds && h.studentIds.includes(sId))
      );
    }

    const total = relevantSessions.length;
    const attended = relevantSessions.filter(h => (h.presentIds || []).includes(sId)).length;
    const percent = total > 0 ? Math.round((attended / total) * 100) : null;

    const minReq = minPct;
    const warnReq = Math.min(warningPct, minReq - 1);

    let status = percent === null ? 'none' : 'eligible';
    if (percent !== null && percent < warnReq) {
      status = 'critical';
    } else if (percent !== null && percent < minReq) {
      status = 'warning';
    }

    const classesNeeded = percent !== null && percent < minReq ? calcClassesNeeded(attended, total, minReq) : 0;

    return {
      attended,
      total,
      percent,
      status,
      classesNeeded
    };
  }
};

if (typeof window !== 'undefined') {
  window.FaceAPI = FaceAPI;
}
