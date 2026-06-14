import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';
import { applyExamResult } from '../services/progression.js';

const r = Router();
r.use(requireAuth);

// Offline outbox flush: client pushes queued ops; server applies idempotently.
r.post('/flush', wrap(async (req, res) => {
  const ops = Array.isArray(req.body.ops) ? req.body.ops : [];
  const applied = [];
  for (const op of ops) {
    await q('INSERT INTO sync_log (user_id, op, payload, client_ts) VALUES ($1,$2,$3,$4)',
      [req.user.sub, op.type, JSON.stringify(op.payload || {}), op.ts || null]);
    if (op.type === 'exam_result' && op.payload?.levelId) {
      const g = await applyExamResult({ userId: req.user.sub, levelId: op.payload.levelId, total: op.payload.total || 0 });
      applied.push({ id: op.id, result: g });
    } else {
      applied.push({ id: op.id, result: 'logged' });
    }
  }
  res.json({ applied, count: applied.length });
}));
export default r;
