import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';

const r = Router();
r.use(requireAuth);

// List rules (admin + teacher).
r.get('/', requireRole('ADMIN', 'TEACHER'), wrap(async (req, res) => {
  res.json((await q('SELECT r.*, u.full_name AS owner_name FROM ai_grammar_rules r LEFT JOIN users u ON u.id=r.created_by ORDER BY r.created_at DESC')).rows);
}));

// Add a rule (teacher publishes own; admin too).
r.post('/', requireRole('ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const { dialect, rule_text, examples = [], published = true } = req.body;
  if (!dialect || !rule_text) return res.status(400).json({ error: 'missing_fields' });
  const row = (await q(
    'INSERT INTO ai_grammar_rules (dialect, rule_text, examples, created_by, published) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [dialect, rule_text, JSON.stringify(examples), req.user.sub, published]
  )).rows[0];
  res.status(201).json(row);
}));

// Edit: ADMIN can edit ANY rule even after publishing; TEACHER only own.
r.patch('/:id', requireRole('ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const rule = (await q('SELECT * FROM ai_grammar_rules WHERE id=$1', [req.params.id])).rows[0];
  if (!rule) return res.status(404).json({ error: 'not_found' });
  if (req.user.role === 'TEACHER' && rule.created_by !== req.user.sub)
    return res.status(403).json({ error: 'forbidden_not_owner' });
  const { rule_text, dialect, published, admin_note, edit_reason } = req.body;
  const isAdmin = req.user.role === 'ADMIN';
  const row = (await q(
    `UPDATE ai_grammar_rules SET
       rule_text  = COALESCE($2, rule_text),
       dialect    = COALESCE($3, dialect),
       published  = COALESCE($4, published),
       admin_note = COALESCE($5, admin_note),
       edit_reason= COALESCE($6, edit_reason)
     WHERE id=$1 RETURNING *`,
    [req.params.id, rule_text ?? null, dialect ?? null, published ?? null,
     isAdmin ? (admin_note ?? null) : null, isAdmin ? (edit_reason ?? null) : null]
  )).rows[0];
  res.json(row);
}));

r.delete('/:id', requireRole('ADMIN', 'TEACHER'), wrap(async (req, res) => {
  const rule = (await q('SELECT * FROM ai_grammar_rules WHERE id=$1', [req.params.id])).rows[0];
  if (!rule) return res.status(404).json({ error: 'not_found' });
  if (req.user.role === 'TEACHER' && rule.created_by !== req.user.sub)
    return res.status(403).json({ error: 'forbidden_not_owner' });
  await q('DELETE FROM ai_grammar_rules WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
// Admin asks the author to clarify a rule (with examples expected back).
r.post('/:id/clarify', requireRole('ADMIN'), wrap(async (req, res) => {
  res.json((await q('UPDATE ai_grammar_rules SET clarify_requested=TRUE WHERE id=$1 RETURNING *', [req.params.id])).rows[0]);
}));
// Author (teacher) submits explanation + examples.
r.post('/:id/explain', requireRole('TEACHER'), wrap(async (req, res) => {
  const rule = (await q('SELECT * FROM ai_grammar_rules WHERE id=$1', [req.params.id])).rows[0];
  if (!rule) return res.status(404).json({ error: 'not_found' });
  if (rule.created_by !== req.user.sub) return res.status(403).json({ error: 'forbidden_not_owner' });
  const { explanation, examples = [] } = req.body;
  const row = (await q(
    `UPDATE ai_grammar_rules SET author_explanation=$2, examples=$3, clarify_requested=FALSE WHERE id=$1 RETURNING *`,
    [req.params.id, explanation || '', JSON.stringify(examples)]
  )).rows[0];
  res.json(row);
}));
export default r;
