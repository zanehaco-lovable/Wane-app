import { Router } from 'express';
import QRCode from 'qrcode';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';
import { config } from '../config.js';
import { createVouchers, allocate, markSold, redeem } from '../services/voucher.js';
import { buildMessage, deepLinks, sendSms } from '../services/sms.js';

const r = Router();
const redeemUrl = (code) => `${config.verifyBaseUrl.replace('/verify.html','')}/redeem?code=${code}`;

// Admin generates digital balance cards.
r.post('/', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  const amount_cents = Math.round((req.body.amount || 0) * 100);
  const qty = Math.min(50, Math.max(1, parseInt(req.body.qty || 1, 10)));
  if (amount_cents <= 0) return res.status(400).json({ error: 'invalid_amount' });
  const cost = amount_cents * qty;
  // Admin mints cards freely — no treasury balance required; we only track issued value.
  await q('UPDATE platform_treasury SET issued_cents = issued_cents + $1 WHERE id=1', [cost]);
  const rows = await createVouchers({ amountCents: amount_cents, qty, createdBy: req.user.sub });
  res.status(201).json(rows);
}));

r.get('/', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q('SELECT * FROM vouchers ORDER BY created_at DESC LIMIT 500')).rows);
}));

// QR PNG for a voucher (printable).
r.get('/:code/qr.png', requireAuth, wrap(async (req, res) => {
  const png = await QRCode.toBuffer(redeemUrl(req.params.code), { width: 240, margin: 1 });
  res.setHeader('Content-Type', 'image/png'); res.send(png);
}));

// Send links (and optional real SMS via Twilio if configured).
r.post('/:id/send', requireAuth, requireRole('ADMIN', 'AGENT'), wrap(async (req, res) => {
  const v = (await q('SELECT * FROM vouchers WHERE id=$1', [req.params.id])).rows[0];
  if (!v) return res.status(404).json({ error: 'not_found' });
  const msg = buildMessage({ code: v.code, amountCents: v.amount_cents, redeemUrl: redeemUrl(v.code) });
  const links = deepLinks(msg, { phone: req.body.phone, emailTo: req.body.email });
  let sms = { sent: false, reason: 'no_provider' };
  if (req.body.channel === 'sms' && req.body.phone) { try { sms = await sendSms({ to: req.body.phone, body: msg }); } catch (e) { sms = { sent: false, reason: e.message }; } }
  res.json({ message: msg, links, sms });
}));

r.post('/:id/allocate', requireAuth, requireRole('ADMIN'), wrap(async (req, res) => {
  res.json(await allocate(req.params.id, req.body.agent_id || null));
}));

// Agent marks a card sold to a buyer.
r.post('/:id/sell', requireAuth, requireRole('AGENT'), wrap(async (req, res) => {
  const row = await markSold(req.params.id, req.user.sub, req.body.buyer || '');
  if (!row) return res.status(400).json({ error: 'not_allocated_or_not_active' });
  res.json(row);
}));

// Any authenticated user redeems a code into their wallet.
r.post('/redeem', requireAuth, wrap(async (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'missing_code' });
  res.json(await redeem(code, req.user.sub));
}));
export default r;
