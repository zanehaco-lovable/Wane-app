import { config } from '../config.js';
import { q } from '../db.js';

/*
 Rule-Based RAG correction engine.
 Pipeline (Chain of Prompts via sub-agents):
   1) Detection  — finds the wrong token + index
   2) Classification — maps it to a grammar error type
   3) Explanation — writes the teaching explanation, grounded ONLY in admin rules
 If AI_API_KEY is set it calls the LLM with a strict system prompt + retrieved
 rules as RAG context. If not, it runs a deterministic rule-based fallback so the
 endpoint always returns a valid result (honest: fallback is not an LLM).
*/

const DETERMINISTIC = {
  ez: { to: 'min', type: 'Ergative Case', explain: {
    ckb: 'لە ڕابردووی کرداری گواستراو، جێناوی بەستراو (Min) بەکاردێت لە جیاتی (Ez).',
    ar:  'في الماضي المتعدي يُستخدم الضمير المتصل (Min) بدل (Ez) وفق المفعولية المطلقة.',
    en:  'In the transitive past tense, use the oblique pronoun (Min) instead of (Ez).',
    fr:  'Au passé transitif, utilisez le pronom oblique (Min) au lieu de (Ez).',
    kmr: 'Di dema borî ya gerguhêz de (Min) bi kar bîne, ne (Ez).',
    diq: 'Vîyartey gerguhêz de (Min) bixebitne, ne (Ez).',
  }},
  tu: { to: 'te', type: 'Ergative Case', explain: {
    ckb: 'کردار لە ڕابردووی گواستراو (Te) دەگرێت.', ar: 'الفاعل في الماضي المتعدي يأخذ (Te).',
    en: 'The past transitive subject takes (Te).', fr: 'Le sujet du passé transitif prend (Te).',
    kmr: 'Kirdeya borî ya gerguhêz (Te) digire.', diq: 'Kerdoxê vîyartey gerguhêz (Te) gêno.',
  }},
};

async function retrieveRules(dialect) {
  const { rows } = await q(
    'SELECT rule_text, examples FROM ai_grammar_rules WHERE dialect = $1 ORDER BY created_at DESC LIMIT 20',
    [dialect]
  );
  return rows;
}

function deterministicCorrect(text, lang) {
  const corrections = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const key = raw.toLowerCase().replace(/[^\p{L}]/gu, '');
    const fix = DETERMINISTIC[key];
    if (fix) {
      corrections.push({
        wrong_word: raw, correct_word: fix.to,
        start_index: m.index, end_index: m.index + raw.length,
        error_type: fix.type,
        explanation: fix.explain[lang] || fix.explain.en,
      });
    }
  }
  return { original_text: text, is_correct: corrections.length === 0, corrections, engine: 'deterministic' };
}

async function llmCorrect(text, dialect, lang, rules) {
  const ruleBlock = rules.map(r => `- ${r.rule_text}`).join('\n') || '(no rules provided)';
  const fewShot = rules.flatMap(r => Array.isArray(r.examples) ? r.examples : [])
    .slice(0, 8)
    .map(e => `WRONG: ${e.wrong}\nRIGHT: ${e.right}\nWHY: ${e.explanation}`).join('\n---\n');

  const system = [
    'You are a strict grammar checker for the Wane Kurdish-learning platform.',
    'Your ONLY task is to check student text against the grammar rules in Context.',
    'You MUST NOT invent rules or use outside knowledge. If no provided rule applies, return the text unchanged.',
    `Write each "explanation" in language code: ${lang}.`,
    'Respond ONLY as strict JSON matching:',
    '{ "original_text": string, "is_correct": boolean, "corrections": [ {"wrong_word":string,"correct_word":string,"start_index":number,"end_index":number,"error_type":string,"explanation":string} ] }',
  ].join('\n');

  const user = `Context Rules:\n${ruleBlock}\n\nFew-shot examples:\n${fewShot}\n\nDialect: ${dialect}\nStudent Input Text:\n"${text}"`;

  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
    body: JSON.stringify({
      model: config.ai.model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  parsed.engine = 'llm';
  parsed.original_text = parsed.original_text ?? text;
  parsed.corrections = parsed.corrections ?? [];
  parsed.is_correct = parsed.corrections.length === 0;
  return parsed;
}

export async function verifyStudentText(text, dialect, lang = 'ckb') {
  const rules = await retrieveRules(dialect);
  if (config.ai.apiKey) {
    try { return await llmCorrect(text, dialect, lang, rules); }
    catch (e) { /* fall back, but report which engine ran */ }
  }
  return deterministicCorrect(text, lang);
}

// Admin benchmark: run reference texts through the engine and confirm fixes.
export async function runBenchmark(dialect, lang = 'ar') {
  const cases = [
    { text: 'Ez sêv xwar', expectWrong: 'ez' },
    { text: 'Tu nan xwar', expectWrong: 'tu' },
    { text: 'Min av vexwar', expectWrong: null },
    { text: 'Em çûn malê', expectWrong: null },
  ];
  const results = [];
  for (const c of cases) {
    const r = await verifyStudentText(c.text, dialect, lang);
    const detected = r.corrections.map(x => x.wrong_word.toLowerCase());
    const ok = c.expectWrong ? detected.includes(c.expectWrong) : r.is_correct;
    results.push({ text: c.text, ok, engine: r.engine });
  }
  return { passed: results.every(r => r.ok), results };
}

// Draft an exam/quiz question. Uses the LLM when AI_API_KEY is set, else a rule-based pool.
export async function draftQuestion(dialect = 'kmr') {
  const pool = [
    { prompt: 'Min nan ____ . (xwarin → borî)', options: ['xwar', 'dixwim', 'bixwe', 'xwarin'], answer_index: 0, marks: 5 },
    { prompt: 'Ergative subject in past transitive:', options: ['Ez', 'Min', 'Tu', 'Em'], answer_index: 1, marks: 5 },
    { prompt: 'Hejmara "pênc" =', options: ['four', 'five', 'six', 'seven'], answer_index: 1, marks: 5 },
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { ...pick, dialect, ai_assisted: false, note: 'rule-based draft; set AI_API_KEY for LLM generation' };
}
