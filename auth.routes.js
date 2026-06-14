import { Router } from 'express';
import { q } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { sign, requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { getOrCreateWallet } from '../services/wallet.js';

const r = Router();

r.post('/register', wrap(async (req, res) => {
  const { full_name, email, password, dialect = 'ckb' } = req.body;
  if (!full_name || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  const exists = (await q('SELECT 1 FROM users WHERE email=$1', [email])).rowCount;
  if (exists) return res.status(409).json({ error: 'email_taken' });
  const hash = await hashPassword(password);
  const u = (await q(
    'INSERT INTO users (full_name,email,password_hash,dialect,ui_lang) VALUES ($1,$2,$3,$4,$4) RETURNING *',
    [full_name, email, hash, dialect]
  )).rows[0];
  await getOrCreateWallet(u.id);
  res.status(201).json({ token: sign(u), user: pub(u) });
}));

r.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const u = (await q('SELECT * FROM users WHERE email=$1', [email])).rows[0];
  if (!u || !(await verifyPassword(password, u.password_hash)))
    return res.status(401).json({ error: 'invalid_credentials' });
  res.json({ token: sign(u), user: pub(u) });
}));

r.get('/me', requireAuth, wrap(async (req, res) => {
  const u = (await q('SELECT * FROM users WHERE id=$1', [req.user.sub])).rows[0];
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({ user: pub(u) });
}));

const pub = (u) => ({ id: u.id, full_name: u.full_name, email: u.email, role: u.role, dialect: u.dialect, ui_lang: u.ui_lang });
export default r;
