import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { getTree } from '../services/progression.js';

const r = Router();
r.get('/tree', requireAuth, wrap(async (req, res) => {
  const dialect = req.query.dialect || req.user.dialect || 'ckb';
  res.json({ dialect, levels: await getTree(req.user.sub, dialect) });
}));
export default r;
