import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { q } from '../db.js';
import { issueCertificate, verifyCertificate } from '../services/certificate.js';

const r = Router();

// Issue a certificate when the student has COMPLETED every level of their dialect.
r.post('/issue', requireAuth, wrap(async (req, res) => {
  const u = (await q('SELECT * FROM users WHERE id=$1', [req.user.sub])).rows[0];
  const total = (await q('SELECT COUNT(*)::int AS n FROM levels_and_units WHERE dialect=$1', [u.dialect])).rows[0].n;
  const done = (await q(
    `SELECT COUNT(*)::int AS n FROM user_progress p
       JOIN levels_and_units l ON l.id=p.node_id
      WHERE p.user_id=$1 AND l.dialect=$2 AND p.status='COMPLETED'`, [u.id, u.dialect])).rows[0].n;
  if (total === 0 || done < total) return res.status(400).json({ error: 'not_all_levels_completed', done, total });

  const agg = (await q(
    `SELECT COALESCE(ROUND(AVG(reading)),0) reading, COALESCE(ROUND(AVG(writing)),0) writing,
            COALESCE(ROUND(AVG(speaking)),0) speaking
       FROM exam_attempts WHERE user_id=$1 AND passed=TRUE`, [u.id])).rows[0];
  const scores = { reading: +agg.reading, writing: +agg.writing, speaking: +agg.speaking };

  const { publicId, verifyUrl, pdf } = await issueCertificate({ userId: u.id, fullName: u.full_name, scores });
  res.json({ public_id: publicId, verify_url: verifyUrl, pdf_base64: pdf.toString('base64') });
}));

// Download the PDF directly.
r.get('/:publicId/pdf', requireAuth, wrap(async (req, res) => {
  const u = (await q('SELECT * FROM users WHERE id=$1', [req.user.sub])).rows[0];
  const cert = (await q('SELECT * FROM certificates WHERE hash_id=$1', [req.params.publicId])).rows[0];
  if (!cert) return res.status(404).json({ error: 'not_found' });
  const { pdf } = await issueCertificate({ userId: cert.user_id, fullName: cert.full_name, scores: cert.scores });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.publicId}.pdf"`);
  res.send(pdf);
}));

// PUBLIC verification gateway (no auth) — this is what the QR resolves to.
r.get('/verify/:publicId', wrap(async (req, res) => {
  res.json(await verifyCertificate(req.params.publicId));
}));
export default r;
