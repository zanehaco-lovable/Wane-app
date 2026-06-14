import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { getOrCreateWallet, postTransaction, listTransactions } from '../services/wallet.js';

const r = Router();
r.use(requireAuth);
r.get('/', wrap(async (req, res) => res.json(await getOrCreateWallet(req.user.sub))));
r.get('/transactions', wrap(async (req, res) => res.json(await listTransactions(req.user.sub))));
r.post('/transactions', wrap(async (req, res) => {
  const { amount_cents, type, description } = req.body;
  if (!Number.isInteger(amount_cents) || !type) return res.status(400).json({ error: 'invalid_body' });
  res.json(await postTransaction({ userId: req.user.sub, amountCents: amount_cents, type, description }));
}));
export default r;
