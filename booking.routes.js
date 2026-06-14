import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { tx, q } from '../db.js';
import { createSession } from '../services/scheduler.js';

const r = Router();

// Public-ish (authenticated) list of upcoming accredited-exam slots.
r.get('/slots', requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT s.*, c.name AS center_name, c.city
       FROM exam_slots s LEFT JOIN exam_centers c ON c.id=s.center_id
      WHERE s.starts_at > now() ORDER BY s.starts_at`);
  res.json(rows);
}));

// Admin/teacher creates a slot (online or on-site).
r.post('/slots', requireAuth, requireRole('ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const { level_id = null, starts_at, mode = 'ONLINE', center_id = null, seats = 10 } = req.body;
  if (!starts_at) return res.status(400).json({ error: 'missing_starts_at' });
  const row = (await q(
    'INSERT INTO exam_slots (level_id, starts_at, mode, center_id, seats) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [level_id, starts_at, mode, center_id, seats]
  )).rows[0];
  res.status(201).json(row);
}));

// Student books an accredited exam appointment (online proctored OR on-site).
r.post('/slots/:id/book', requireAuth, wrap(async (req, res) => {
  const mode = (req.body.mode || 'ONLINE').toUpperCase();
  const result = await tx(async (c) => {
    const slot = (await c.query('SELECT * FROM exam_slots WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!slot) { const e = new Error('slot_not_found'); e.status = 404; throw e; }
    if (slot.booked >= slot.seats) { const e = new Error('slot_full'); e.status = 409; throw e; }

    let joinUrl = null, centerId = null;
    if (mode === 'ONLINE') {
      // Real meeting link via Zoom/Meet adapter (falls back to a generated link).
      const s = await createSession({ title: 'Wane accredited exam', platform: 'Google Meet',
        startAt: slot.starts_at, durationMin: 60 });
      joinUrl = s.joinUrl;
    } else {
      centerId = slot.center_id;
    }

    await c.query('UPDATE exam_slots SET booked = booked + 1 WHERE id=$1', [slot.id]);
    const booking = (await c.query(
      `INSERT INTO exam_bookings (slot_id, user_id, mode, join_url, center_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slot_id, user_id) DO UPDATE SET mode=EXCLUDED.mode, join_url=EXCLUDED.join_url
       RETURNING *`,
      [slot.id, req.user.sub, mode, joinUrl, centerId]
    )).rows[0];
    return booking;
  });
  res.status(201).json(result);
}));

r.get('/my', requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT b.*, s.starts_at, c.name AS center_name, c.city, c.address
       FROM exam_bookings b
       JOIN exam_slots s ON s.id=b.slot_id
       LEFT JOIN exam_centers c ON c.id=b.center_id
      WHERE b.user_id=$1 ORDER BY s.starts_at`, [req.user.sub]);
  res.json(rows);
}));

r.delete('/:id', requireAuth, wrap(async (req, res) => {
  await tx(async (c) => {
    const b = (await c.query('SELECT * FROM exam_bookings WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub])).rows[0];
    if (!b) { const e = new Error('not_found'); e.status = 404; throw e; }
    await c.query('UPDATE exam_slots SET booked = GREATEST(0, booked - 1) WHERE id=$1', [b.slot_id]);
    await c.query('DELETE FROM exam_bookings WHERE id=$1', [b.id]);
  });
  res.json({ ok: true });
}));
export default r;
