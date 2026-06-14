import { q } from '../db.js';
import { verifyStudentText } from './ragEngine.js';

// Weighted random sampling without replacement.
function weightedSample(items, n) {
  const pool = items.map(i => ({ i, w: i.weight || 1 }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0].i);
  }
  return out;
}

// Generate a balanced tri-component exam for a level.
export async function generateExam(levelId, dialect) {
  const { rows } = await q('SELECT * FROM question_bank WHERE level_id = $1', [levelId]);
  const bySec = (s) => rows.filter(r => r.section === s);
  return {
    reading: weightedSample(bySec('READING'), 4).map(stripAnswer),
    writing: weightedSample(bySec('WRITING'), 1).map(r => ({ id: r.id, prompt: r.prompt })),
    speaking: weightedSample(bySec('SPEAKING'), 1).map(r => ({ id: r.id, prompt: r.prompt, reference_audio_url: r.reference_audio_url })),
  };
}
function stripAnswer(r) { return { id: r.id, prompt: r.prompt, options: r.options }; }

// Grade the READING section locally (instant, offline-capable on client too).
export async function gradeReading(answers) {
  if (!answers?.length) return 0;
  const ids = answers.map(a => a.id);
  const { rows } = await q('SELECT id, answer_idx FROM question_bank WHERE id = ANY($1)', [ids]);
  const key = Object.fromEntries(rows.map(r => [r.id, r.answer_idx]));
  let correct = 0;
  for (const a of answers) if (key[a.id] === a.choice) correct++;
  return Math.round((100 * correct) / answers.length);
}

// Grade WRITING via the RAG engine; fewer errors => higher score.
export async function gradeWriting(text, dialect, lang) {
  if (!text?.trim()) return { score: 0, result: { is_correct: false, corrections: [] } };
  const result = await verifyStudentText(text, dialect, lang);
  const errors = result.corrections.length;
  const words = text.trim().split(/\s+/).length || 1;
  const errorRate = errors / words;
  const score = Math.max(0, Math.round(100 * (1 - Math.min(1, errorRate * 2.5))));
  return { score, result };
}
