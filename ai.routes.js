import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { verifyStudentText } from '../services/ragEngine.js';

const r = Router();
// Free writing check used by the student "AI writing" screen.
r.post('/check', requireAuth, wrap(async (req, res) => {
  const { text, dialect, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'missing_text' });
  res.json(await verifyStudentText(text, dialect || req.user.dialect || 'ckb', lang || 'ckb'));
}));
export default r;
