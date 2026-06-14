import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { generateExam, gradeReading, gradeWriting } from '../services/exam.js';
import { scorePronunciation } from '../services/speech.js';
import { applyExamResult } from '../services/progression.js';
import { q } from '../db.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const r = Router();

// Generate a fresh tri-component exam for a level.
r.get('/:levelId/generate', requireAuth, wrap(async (req, res) => {
  const dialect = req.user.dialect || 'ckb';
  res.json(await generateExam(req.params.levelId, dialect));
}));

// Grade reading (instant).
r.post('/:levelId/reading', requireAuth, wrap(async (req, res) => {
  res.json({ score: await gradeReading(req.body.answers || []) });
}));

// Grade writing via RAG engine.
r.post('/:levelId/writing', requireAuth, wrap(async (req, res) => {
  const lang = req.body.lang || req.user.dialect || 'ckb';
  res.json(await gradeWriting(req.body.text || '', req.user.dialect || 'ckb', lang));
}));

// Score speaking from an uploaded audio clip.
r.post('/:levelId/speaking', requireAuth, upload.single('audio'), wrap(async (req, res) => {
  const out = await scorePronunciation({
    audioBuffer: req.file?.buffer || Buffer.alloc(0),
    referenceText: req.body.referenceText || '',
    dialect: req.user.dialect || 'ckb',
  });
  res.json(out);
}));

// Submit the full exam: persist attempt, run gatekeeper.
r.post('/:levelId/submit', requireAuth, wrap(async (req, res) => {
  const { reading = 0, writing = 0, speaking = 0, detail = {} } = req.body;
  const total = Math.round((reading + writing + speaking) / 3);
  const gate = await applyExamResult({ userId: req.user.sub, levelId: req.params.levelId, total });
  await q(
    `INSERT INTO exam_attempts (user_id, level_id, reading, writing, speaking, total, passed, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.user.sub, req.params.levelId, reading, writing, speaking, total, gate.passed, JSON.stringify(detail)]
  );
  res.json({ total, ...gate });
}));
export default r;
