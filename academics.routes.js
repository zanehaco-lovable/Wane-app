import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';
import { draftQuestion } from '../services/ragEngine.js';

const upload = multer({ dest: '/tmp/wane-uploads' });
const r = Router();
r.use(requireAuth);

/* ---- Teacher applications (professional file + certificate uploads) ---- */
r.post('/teacher-applications', upload.array('certificates', 8), wrap(async (req, res) => {
  const { full_name, subjects = '[]', bio = '', experience = '' } = req.body;
  const certs = (req.files || []).map(f => ({ name: f.originalname, path: f.path }));
  const subj = typeof subjects === 'string' ? JSON.parse(subjects || '[]') : subjects;
  const row = (await q(
    `INSERT INTO teacher_applications (user_id, full_name, subjects, bio, experience, certificates)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.sub, full_name || 'Applicant', JSON.stringify(subj), bio, experience, JSON.stringify(certs)]
  )).rows[0];
  res.status(201).json(row);
}));
r.get('/teacher-applications', requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q("SELECT * FROM teacher_applications WHERE status='PENDING' ORDER BY created_at")).rows);
}));
r.post('/teacher-applications/:id/approve', requireRole('ADMIN'), wrap(async (req, res) => {
  const app = (await q("UPDATE teacher_applications SET status='APPROVED', reviewed_by=$2 WHERE id=$1 RETURNING *", [req.params.id, req.user.sub])).rows[0];
  if (!app) return res.status(404).json({ error: 'not_found' });
  await q("UPDATE users SET role='TEACHER', approved=TRUE, subjects=$2, bio=$3 WHERE id=$1", [app.user_id, app.subjects, app.bio]);
  res.json(app);
}));
r.post('/teacher-applications/:id/reject', requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q("UPDATE teacher_applications SET status='REJECTED', reviewed_by=$2 WHERE id=$1 RETURNING *", [req.params.id, req.user.sub])).rows[0]);
}));

/* ---- Find teachers (search + filter) ---- */
r.get('/teachers', wrap(async (req, res) => {
  const { name = '', subject = '' } = req.query;
  const rows = (await q(
    `SELECT id, full_name, subjects, bio FROM users
      WHERE role='TEACHER' AND approved=TRUE
        AND ($1='' OR full_name ILIKE '%'||$1||'%')
        AND ($2='' OR subjects @> to_jsonb($2::text))
      ORDER BY full_name`, [name, subject])).rows;
  res.json(rows);
}));

/* ---- Exam committees (admin forms; members author; AI assists) ---- */
r.post('/committees', requireRole('ADMIN'), wrap(async (req, res) => {
  const { name, dialect, member_ids = [] } = req.body;
  if (!name || !dialect) return res.status(400).json({ error: 'missing_fields' });
  const c = (await q('INSERT INTO exam_committees (name, dialect, created_by) VALUES ($1,$2,$3) RETURNING *', [name, dialect, req.user.sub])).rows[0];
  for (const tid of member_ids) await q('INSERT INTO committee_members (committee_id, teacher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.id, tid]);
  res.status(201).json(c);
}));
r.get('/committees', wrap(async (req, res) => {
  const rows = (await q(
    `SELECT c.*, COALESCE(json_agg(m.teacher_id) FILTER (WHERE m.teacher_id IS NOT NULL),'[]') AS members
       FROM exam_committees c LEFT JOIN committee_members m ON m.committee_id=c.id
      GROUP BY c.id ORDER BY c.created_at DESC`)).rows;
  res.json(rows);
}));
r.get('/committees/ai-draft', requireRole('TEACHER','ADMIN'), wrap(async (req, res) => {
  res.json(await draftQuestion(req.query.dialect || 'kmr'));
}));
r.post('/committees/:id/questions', requireRole('TEACHER','ADMIN'), wrap(async (req, res) => {
  const member = (await q('SELECT 1 FROM committee_members WHERE committee_id=$1 AND teacher_id=$2', [req.params.id, req.user.sub])).rows[0];
  if (!member && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'not_a_member' });
  const { prompt, options, answer_index, marks = 5, ai_assisted = false } = req.body;
  const c = (await q('SELECT dialect FROM exam_committees WHERE id=$1', [req.params.id])).rows[0];
  const row = (await q(
    `INSERT INTO exam_questions (committee_id, dialect, prompt, options, answer_index, marks, ai_assisted, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, c.dialect, prompt, JSON.stringify(options), answer_index, marks, ai_assisted, req.user.sub])).rows[0];
  res.status(201).json(row);
}));
r.post('/exam-questions/:id/approve', requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q("UPDATE exam_questions SET status='APPROVED' WHERE id=$1 RETURNING *", [req.params.id])).rows[0]);
}));
r.get('/exam-bank', wrap(async (req, res) => {
  res.json((await q("SELECT * FROM exam_questions WHERE status='APPROVED' ORDER BY created_at DESC")).rows);
}));

/* ---- Course quizzes (teacher) + attempts (student auto-grade) ---- */
r.post('/quizzes', requireRole('TEACHER'), wrap(async (req, res) => {
  const { course_id, title, questions } = req.body;
  if (!course_id || !Array.isArray(questions) || !questions.length) return res.status(400).json({ error: 'invalid' });
  const own = (await q('SELECT 1 FROM courses WHERE id=$1 AND teacher_id=$2', [course_id, req.user.sub])).rows[0];
  if (!own) return res.status(403).json({ error: 'not_your_course' });
  const row = (await q('INSERT INTO course_quizzes (course_id, title, questions) VALUES ($1,$2,$3) RETURNING *',
    [course_id, title || 'Quiz', JSON.stringify(questions)])).rows[0];
  res.status(201).json(row);
}));
r.get('/courses/:id/quizzes', wrap(async (req, res) => {
  res.json((await q('SELECT id, title, questions FROM course_quizzes WHERE course_id=$1', [req.params.id])).rows);
}));
r.post('/quizzes/:id/attempt', wrap(async (req, res) => {
  const quiz = (await q('SELECT * FROM course_quizzes WHERE id=$1', [req.params.id])).rows[0];
  if (!quiz) return res.status(404).json({ error: 'not_found' });
  const answers = req.body.answers || [];
  let score = 0, total = 0;
  quiz.questions.forEach((q2, i) => { total += q2.marks; if (answers[i] === q2.answer) score += q2.marks; });
  const row = (await q(
    `INSERT INTO quiz_attempts (quiz_id, student_id, score, total) VALUES ($1,$2,$3,$4)
     ON CONFLICT (quiz_id, student_id) DO UPDATE SET score=EXCLUDED.score, total=EXCLUDED.total, created_at=now()
     RETURNING *`, [quiz.id, req.user.sub, score, total])).rows[0];
  res.json(row);
}));
export default r;
