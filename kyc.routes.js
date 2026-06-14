import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';

const r = Router();
r.use(requireAuth);
// Submit KYC (the identity number should be encrypted at rest in production).
r.post('/', wrap(async (req, res) => {
  const { identity_card_number, passport_image_url, phone_number } = req.body;
  if (!identity_card_number || !phone_number) return res.status(400).json({ error: 'missing_fields' });
  const row = (await q(
    'INSERT INTO kyc_verification (user_id, identity_card_number, passport_image_url, phone_number) VALUES ($1,$2,$3,$4) RETURNING id, is_verified, created_at',
    [req.user.sub, identity_card_number, passport_image_url || null, phone_number]
  )).rows[0];
  res.status(201).json(row);
}));
r.get('/me', wrap(async (req, res) => {
  const row = (await q('SELECT id, is_verified, verified_at FROM kyc_verification WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.sub])).rows[0];
  res.json(row || { is_verified: false });
}));
// Admin approves KYC.
r.post('/:id/approve', requireRole('ADMIN'), wrap(async (req, res) => {
  const row = (await q('UPDATE kyc_verification SET is_verified=TRUE, verified_at=now() WHERE id=$1 RETURNING *', [req.params.id])).rows[0];
  res.json(row);
}));
export default r;
