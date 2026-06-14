import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { tx, q } from '../db.js';

const PLATFORM_PCT = 15;
const r = Router();
r.use(requireAuth);

// Teacher must have a curriculum (a published level with >=1 lesson) before publishing a course.
async function teacherHasCurriculum(teacherId) {
  const row = (await q(
    `SELECT COUNT(*)::int AS n FROM levels_and_units WHERE created_by=$1`, [teacherId]
  )).rows[0];
  return row && row.n > 0;
}

r.get('/', wrap(async (req, res) => {
  const all = (await q(
    `SELECT c.*, u.full_name AS teacher_name FROM courses c JOIN users u ON u.id=c.teacher_id
      WHERE c.published = TRUE OR c.teacher_id = $1 ORDER BY c.created_at DESC`, [req.user.sub])).rows;
  res.json(all);
}));

r.post('/', requireRole('TEACHER'), wrap(async (req, res) => {
  const { title, price } = req.body;
  if (!title) return res.status(400).json({ error: 'title_required' });
  const row = (await q('INSERT INTO courses (teacher_id, title, price_cents) VALUES ($1,$2,$3) RETURNING *',
    [req.user.sub, title, Math.round((price || 0) * 100)])).rows[0];
  res.status(201).json(row);
}));

r.post('/:id/publish', requireRole('TEACHER'), wrap(async (req, res) => {
  if (!(await teacherHasCurriculum(req.user.sub)))
    return res.status(409).json({ error: 'curriculum_required' });
  const row = (await q("UPDATE courses SET published=TRUE WHERE id=$1 AND teacher_id=$2 RETURNING *", [req.params.id, req.user.sub])).rows[0];
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
}));

// Student requests enrollment; teacher accepts.
r.post('/:id/enroll', wrap(async (req, res) => {
  const row = (await q(
    `INSERT INTO enrollments (course_id, student_id) VALUES ($1,$2)
     ON CONFLICT (course_id, student_id) DO NOTHING RETURNING *`, [req.params.id, req.user.sub])).rows[0];
  res.status(201).json(row || { ok: true, note: 'already_requested' });
}));
r.post('/enrollments/:id/accept', requireRole('TEACHER'), wrap(async (req, res) => {
  res.json((await q("UPDATE enrollments SET status='ACCEPTED' WHERE id=$1 RETURNING *", [req.params.id])).rows[0]);
}));

// Buy course from wallet — platform takes commission, teacher gets the rest.
r.post('/:id/buy', wrap(async (req, res) => {
  const out = await tx(async (c) => {
    const course = (await c.query('SELECT * FROM courses WHERE id=$1 AND published=TRUE', [req.params.id])).rows[0];
    if (!course) { const e = new Error('course_not_found'); e.status = 404; throw e; }
    const price = BigInt(course.price_cents);
    let w = (await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [req.user.sub])).rows[0];
    if (!w) w = (await c.query('INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [req.user.sub])).rows[0];
    if (BigInt(w.balance_cents) < price) { const e = new Error('insufficient_balance'); e.status = 402; throw e; }
    const commission = price * BigInt(PLATFORM_PCT) / 100n;
    const teacherCut = price - commission;
    await c.query('UPDATE wallets SET balance_cents = balance_cents - $1 WHERE id=$2', [price.toString(), w.id]);
    await c.query('INSERT INTO financial_transactions (wallet_id, amount_cents, type, description) VALUES ($1,$2,$3,$4)',
      [w.id, (-price).toString(), 'WITHDRAWAL', `Course ${course.title}`]);
    let tw = (await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [course.teacher_id])).rows[0];
    if (!tw) tw = (await c.query('INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [course.teacher_id])).rows[0];
    await c.query('UPDATE wallets SET balance_cents = balance_cents + $1 WHERE id=$2', [teacherCut.toString(), tw.id]);
    await c.query('INSERT INTO financial_transactions (wallet_id, amount_cents, type, description) VALUES ($1,$2,$3,$4)',
      [tw.id, teacherCut.toString(), 'DEPOSIT', `Course sale (−${PLATFORM_PCT}%)`]);
    await c.query('INSERT INTO course_sales (course_id, student_id, amount_cents, commission_cents, method) VALUES ($1,$2,$3,$4,$5)',
      [course.id, req.user.sub, price.toString(), commission.toString(), 'wallet']);
    await c.query("UPDATE enrollments SET status='CONFIRMED' WHERE course_id=$1 AND student_id=$2", [course.id, req.user.sub]);
    return { confirmed: true, teacher_cut_cents: Number(teacherCut), commission_cents: Number(commission) };
  });
  res.json(out);
}));
export default r;
