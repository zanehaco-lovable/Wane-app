import { q, pool } from './db.js';
import { hashPassword } from './utils/password.js';
import { getOrCreateWallet } from './services/wallet.js';

const LEVELS = [
  { o: 1, t: { ckb: 'ئەلفوبێ و دەنگەکان', kmr: 'Alfabe û Deng', diq: 'Alfabe û Veng', en: 'Alphabet & Sounds', fr: 'Alphabet & sons', ar: 'الأبجدية والأصوات' } },
  { o: 2, t: { ckb: 'ناساندنی خۆت', kmr: 'Xwe nas kirin', diq: 'Xo nasnayîş', en: 'Introduce yourself', fr: 'Se présenter', ar: 'تقديم نفسك' } },
  { o: 3, t: { ckb: 'ڕستەی سادە', kmr: 'Hevoka sade', diq: 'Cumleya sade', en: 'Simple sentences', fr: 'Phrases simples', ar: 'الجمل البسيطة' } },
  { o: 4, t: { ckb: 'کات و ژمارە', kmr: 'Dem û Hejmar', diq: 'Wext û Amar', en: 'Time & Numbers', fr: 'Temps & nombres', ar: 'الوقت والأرقام' } },
  { o: 5, t: { ckb: 'ئەرگەتیڤ و ڕابردوو', kmr: 'Ergatîf û Borî', diq: 'Ergatîf û Vîyarte', en: 'Ergative & Past', fr: 'Ergatif & passé', ar: 'الإرغاتيف والماضي' } },
  { o: 6, t: { ckb: 'گفتوگۆی ئاست‌بەرز', kmr: 'Axaftina Pêşketî', diq: 'Qiseykerdişo Pêşkewte', en: 'Advanced conversation', fr: 'Conversation avancée', ar: 'محادثة متقدّمة' } },
];
const DEMO = [
  { full_name: 'Aram Admin', email: 'admin@wane.academy', password: 'admin123', role: 'ADMIN', dialect: 'ckb' },
  { full_name: 'Rojîn Mamoste', email: 'teacher@wane.academy', password: 'teacher123', role: 'TEACHER', dialect: 'kmr' },
  { full_name: 'Dîlan Student', email: 'student@wane.academy', password: 'student123', role: 'STUDENT', dialect: 'ckb' },
  { full_name: 'Karwan Agent', email: 'agent@wane.academy', password: 'agent123', role: 'AGENT', dialect: 'kmr' },
];

export async function ensureSeed() {
  const n = (await q('SELECT COUNT(*)::int AS c FROM users')).rowCount ? (await q('SELECT COUNT(*)::int AS c FROM users')).rows[0].c : 0;
  if (n > 0) return { seeded: false };

  for (const u of DEMO) {
    const hash = await hashPassword(u.password);
    const row = (await q(
      'INSERT INTO users (full_name,email,password_hash,role,dialect,ui_lang) VALUES ($1,$2,$3,$4,$5,$5) RETURNING *',
      [u.full_name, u.email, hash, u.role, u.dialect]
    )).rows[0];
    await getOrCreateWallet(row.id);
  }

  // Levels + gateway exams + question bank, per dialect (ckb, kmr, diq).
  for (const dialect of ['ckb', 'kmr', 'diq']) {
    for (const lv of LEVELS) {
      const level = (await q(
        'INSERT INTO levels_and_units (title, titles, dialect, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
        [lv.t.en, JSON.stringify(lv.t), dialect, lv.o]
      )).rows[0];
      await q('INSERT INTO gateway_exams (level_id, passing_score) VALUES ($1,80)', [level.id]);
      // Reading questions
      const reading = [
        { p: 'Min sêv ____ . (xwarin, past)', o: ['xwar', 'dixwim', 'bixwe', 'xwarin'], a: 0 },
        { p: 'Choose the ergative subject (past transitive):', o: ['Ez', 'Min', 'Tu', 'Em'], a: 1 },
        { p: 'Hejmara "sê" bi îngilîzî:', o: ['two', 'three', 'four', 'five'], a: 1 },
        { p: 'Tu ____ diçî mektebê?', o: ['çû', 'here', 'diçî', 'çûyî'], a: 2 },
        { p: 'وشەی ڕاست بۆ «كتاب»:', o: ['پەرتووک', 'نامە', 'قەڵەم', 'مێز'], a: 0 },
      ];
      for (const rq of reading) {
        await q('INSERT INTO question_bank (level_id, section, dialect, prompt, options, answer_idx, weight) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [level.id, 'READING', dialect, rq.p, JSON.stringify(rq.o), rq.a, 1]);
      }
      await q('INSERT INTO question_bank (level_id, section, dialect, prompt) VALUES ($1,$2,$3,$4)',
        [level.id, 'WRITING', dialect, 'Write a free sentence about your day.']);
      await q('INSERT INTO question_bank (level_id, section, dialect, prompt, reference_audio_url) VALUES ($1,$2,$3,$4,$5)',
        [level.id, 'SPEAKING', dialect, 'Read aloud: Ez ji Kurdistanê me.', null]);
    }
  }

  // Grammar rules for RAG
  await q('INSERT INTO ai_grammar_rules (dialect, rule_text, examples) VALUES ($1,$2,$3)',
    ['kmr', 'Ergative: di dema borî ya lêkera gerguhêz de, kirde forma cînavka girêdayî digire (Min, Te, Wî).',
      JSON.stringify([{ wrong: 'Ez sêv xwar', right: 'Min sêv xwar', explanation: 'past transitive → Min' }])]);
  await q('INSERT INTO ai_grammar_rules (dialect, rule_text, examples) VALUES ($1,$2,$3)',
    ['ckb', 'لە ڕابردووی کرداری گواستراو، جێناوی بەستراو بەکاردێت.', JSON.stringify([])]);

  // Phonetics
  for (const g of ['Ç', 'Ş', 'Ê', 'Î', 'Û']) {
    await q('INSERT INTO phonetics (grapheme, dialect, tip) VALUES ($1,$2,$3)', [g, 'kmr', `Pronunciation tip for ${g}.`]);
  }

  // Semantic groups (cross-dialect)
  const grp = (await q("INSERT INTO semantic_groups (concept) VALUES ('BOOK') RETURNING id")).rows[0].id;
  await q('INSERT INTO semantic_words (group_id, dialect, word) VALUES ($1,$2,$3),($1,$4,$5)',
    [grp, 'ckb', 'پەرتووک', 'kmr', 'pirtûk']);

  // Exam centers + accredited exam slots (online + on-site)
  const center = (await q(
    "INSERT INTO exam_centers (name, city, address) VALUES ('Wane Center — Erbil','Erbil','100m Road') RETURNING id"
  )).rows[0].id;
  const base = Date.now();
  const slot = (d, mode, cid) => q(
    'INSERT INTO exam_slots (starts_at, mode, center_id, seats) VALUES ($1,$2,$3,$4)',
    [new Date(base + d * 86400000).toISOString(), mode, cid, mode === 'ONSITE' ? 6 : 10]
  );
  await slot(6, 'ONLINE', null);
  await slot(8, 'ONLINE', null);
  await slot(12, 'ONSITE', center);

  await q('UPDATE platform_treasury SET balance_cents = 50000 WHERE id=1');  // $500 demo float
  await q("UPDATE users SET approved=TRUE, subjects='[\"kurmancî\",\"grammar\"]', bio='10y teaching Kurmancî.' WHERE email='teacher@wane.academy'");

  return { seeded: true };
}

// Allow `npm run seed` to run standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeed().then(r => { console.log('seed:', r); return pool.end(); })
    .catch(e => { console.error(e); process.exit(1); });
}
