import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';
import { runBenchmark } from '../services/ragEngine.js';
import { createSession } from '../services/scheduler.js';
import { commonErrors, studentLedger } from '../services/analytics.js';

const r = Router();
r.use(requireAuth, requireRole('ADMIN'));   // strict RBAC for the whole router

// --- AI grammar rules (RAG context) ---
r.get('/rules', wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM ai_grammar_rules ORDER BY created_at DESC')).rows;
  res.json(rows);
}));
r.post('/rules', wrap(async (req, res) => {
  const { dialect, rule_text, examples = [] } = req.body;
  if (!dialect || !rule_text) return res.status(400).json({ error: 'missing_fields' });
  const row = (await q(
    'INSERT INTO ai_grammar_rules (dialect, rule_text, examples, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [dialect, rule_text, JSON.stringify(examples), req.user.sub]
  )).rows[0];
  res.status(201).json(row);
}));
r.delete('/rules/:id', wrap(async (req, res) => {
  await q('DELETE FROM ai_grammar_rules WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
r.post('/rules/benchmark', wrap(async (req, res) => {
  res.json(await runBenchmark(req.body.dialect || 'kmr', req.body.lang || 'ar'));
}));

// --- Phonetics hub ---
r.get('/phonetics', wrap(async (req, res) => {
  res.json((await q('SELECT * FROM phonetics ORDER BY grapheme')).rows);
}));
r.post('/phonetics', wrap(async (req, res) => {
  const { grapheme, dialect, audio_url, tip } = req.body;
  const row = (await q(
    'INSERT INTO phonetics (grapheme, dialect, audio_url, tip, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [grapheme, dialect, audio_url || null, tip || null, req.user.sub]
  )).rows[0];
  res.status(201).json(row);
}));

// --- Live sessions ---
r.get('/sessions', wrap(async (req, res) => {
  res.json((await q('SELECT * FROM live_sessions ORDER BY start_at DESC')).rows);
}));
r.post('/sessions', wrap(async (req, res) => {
  const { title, platform = 'Google Meet', start_at, duration_min = 45 } = req.body;
  const link = await createSession({ title, platform, startAt: start_at, durationMin: duration_min });
  const row = (await q(
    `INSERT INTO live_sessions (title, platform, start_at, duration_min, join_url, external_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [title, platform, start_at, duration_min, link.joinUrl, link.externalId, req.user.sub]
  )).rows[0];
  res.status(201).json(row);
}));

// --- Analytics ---
r.get('/analytics/errors', wrap(async (req, res) => res.json(await commonErrors())));
r.get('/analytics/students', wrap(async (req, res) => res.json(await studentLedger())));
export default r;
