import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';

const r = Router();
r.use(requireAuth, requireRole('ADMIN'));

// Suspend / activate accounts (with reason).
r.post('/users/:id/suspend', wrap(async (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason_required' });
  const u = (await q("UPDATE users SET status='SUSPENDED', suspend_reason=$2 WHERE id=$1 AND role<>'ADMIN' RETURNING id,email,status,suspend_reason", [req.params.id, reason])).rows[0];
  if (!u) return res.status(404).json({ error: 'not_found_or_admin' });
  res.json(u);
}));
r.post('/users/:id/activate', wrap(async (req, res) => {
  res.json((await q("UPDATE users SET status='ACTIVE', suspend_reason=NULL WHERE id=$1 RETURNING id,email,status", [req.params.id])).rows[0]);
}));

// Treasury: prepare balance used to fund printing of cards.
r.get('/treasury', wrap(async (req, res) => {
  res.json((await q('SELECT * FROM platform_treasury WHERE id=1')).rows[0]);
}));
r.post('/treasury/add', wrap(async (req, res) => {
  const cents = Math.round((req.body.amount || 0) * 100);
  if (cents <= 0) return res.status(400).json({ error: 'invalid_amount' });
  res.json((await q('UPDATE platform_treasury SET balance_cents = balance_cents + $1 WHERE id=1 RETURNING *', [cents])).rows[0]);
}));
export default r;
