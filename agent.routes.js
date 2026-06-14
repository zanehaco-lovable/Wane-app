import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';

const r = Router();

// User applies to become an agent.
r.post('/apply', requireAuth, wrap(async (req, res) => {
  const { full_name, phone, region } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'missing_fields' });
  const existing = (await q("SELECT * FROM agent_applications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [req.user.sub])).rows[0];
  if (existing && existing.status === 'PENDING') return res.status(409).json({ error: 'already_pending' });
  const row = (await q(
    'INSERT INTO agent_applications (user_id, full_name, phone, region) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.sub, full_name, phone, region || null]
  )).rows[0];
  res.status(201).json(row);
}));

r.get('/my-application', requireAuth, wrap(async (req, res) => {
  const row = (await q('SELECT * FROM agent_applications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.sub])).rows[0];
  res.json(row || null);
}));

// Admin reviews applications.
r.get('/applications', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q(
    `SELECT a.*, u.email FROM agent_applications a JOIN users u ON u.id=a.user_id
      WHERE a.status='PENDING' ORDER BY a.created_at`)).rows);
}));
r.post('/applications/:id/approve', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  const app = (await q("UPDATE agent_applications SET status='APPROVED', reviewed_by=$2 WHERE id=$1 RETURNING *", [req.params.id, req.user.sub])).rows[0];
  if (!app) return res.status(404).json({ error: 'not_found' });
  await q("UPDATE users SET role='AGENT' WHERE id=$1", [app.user_id]);   // promote
  const terms = 'The agent is licensed to resell Wane balance cards purchased from the platform, at agreed prices, and agrees to the platform terms.';
  await q(`INSERT INTO agency_licenses (agent_id, terms, admin_signed) VALUES ($1,$2,TRUE)
           ON CONFLICT (agent_id) DO NOTHING`, [app.user_id, terms]);
  res.json(app);
}));
r.post('/applications/:id/reject', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q("UPDATE agent_applications SET status='REJECTED', reviewed_by=$2 WHERE id=$1 RETURNING *", [req.params.id, req.user.sub])).rows[0]);
}));

// Agent inventory.
r.get('/inventory', requireAuth, requireRole('AGENT'), wrap(async (req, res) => {
  res.json((await q("SELECT * FROM vouchers WHERE owner_agent=$1 ORDER BY created_at DESC", [req.user.sub])).rows);
}));
export default r;

// --- card purchase from admin treasury stock & license signing (appended) ---
import { tx as _tx } from '../db.js';
const WHOLESALE_PCT = 90;
r.post('/buy-card/:voucherId', requireAuth, requireRole('AGENT'), wrap(async (req, res) => {
  const out = await _tx(async (c) => {
    const v = (await c.query("SELECT * FROM vouchers WHERE id=$1 FOR UPDATE", [req.params.voucherId])).rows[0];
    if (!v || v.owner_agent || v.status !== 'ACTIVE') { const e = new Error('not_available'); e.status = 409; throw e; }
    const price = BigInt(v.amount_cents) * BigInt(WHOLESALE_PCT) / 100n;
    let w = (await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [req.user.sub])).rows[0];
    if (!w) w = (await c.query('INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [req.user.sub])).rows[0];
    if (BigInt(w.balance_cents) < price) { const e = new Error('insufficient_balance'); e.status = 402; throw e; }
    await c.query('UPDATE wallets SET balance_cents = balance_cents - $1 WHERE id=$2', [price.toString(), w.id]);
    await c.query('INSERT INTO financial_transactions (wallet_id, amount_cents, type, description) VALUES ($1,$2,$3,$4)',
      [w.id, (-price).toString(), 'WITHDRAWAL', `Buy card ${v.code}`]);
    await c.query('UPDATE platform_treasury SET balance_cents = balance_cents + $1 WHERE id=1', [price.toString()]);
    await c.query('UPDATE vouchers SET owner_agent=$2 WHERE id=$1', [v.id, req.user.sub]);
    return { bought: v.code, paid_cents: Number(price) };
  });
  res.json(out);
}));
r.post('/license/sign', requireAuth, requireRole('AGENT'), wrap(async (req, res) => {
  const row = (await q("UPDATE agency_licenses SET agent_signed=TRUE, agent_signed_at=now() WHERE agent_id=$1 RETURNING *", [req.user.sub])).rows[0];
  if (!row) return res.status(404).json({ error: 'no_license' });
  res.json(row);
}));
