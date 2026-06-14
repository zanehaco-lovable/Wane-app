import { tx, q } from '../db.js';

// Strict gatekeeper: a level becomes COMPLETED only when its gateway exam is
// passed (>= passing_score). The next level (sort_order+1, same dialect) flips
// LOCKED -> UNLOCKED. Runs in one transaction.
export async function applyExamResult({ userId, levelId, total }) {
  return tx(async (c) => {
    const lvl = (await c.query('SELECT * FROM levels_and_units WHERE id=$1', [levelId])).rows[0];
    if (!lvl) { const e = new Error('level_not_found'); e.status = 404; throw e; }
    const gw = (await c.query('SELECT passing_score FROM gateway_exams WHERE level_id=$1', [levelId])).rows[0];
    const passMark = gw?.passing_score ?? 80;
    const passed = total >= passMark;

    await c.query(
      `INSERT INTO user_progress (user_id, node_id, status, best_score, attempts, updated_at)
       VALUES ($1,$2,$3,$4,1,now())
       ON CONFLICT (user_id, node_id) DO UPDATE SET
         status = CASE WHEN $3='COMPLETED' THEN 'COMPLETED' ELSE user_progress.status END,
         best_score = GREATEST(COALESCE(user_progress.best_score,0), $4),
         attempts = user_progress.attempts + 1,
         updated_at = now()`,
      [userId, levelId, passed ? 'COMPLETED' : 'UNLOCKED', total]
    );

    let unlockedNext = null;
    if (passed) {
      const nxt = (await c.query(
        'SELECT id FROM levels_and_units WHERE dialect=$1 AND sort_order=$2',
        [lvl.dialect, lvl.sort_order + 1]
      )).rows[0];
      if (nxt) {
        await c.query(
          `INSERT INTO user_progress (user_id, node_id, status, updated_at)
           VALUES ($1,$2,'UNLOCKED',now())
           ON CONFLICT (user_id, node_id) DO UPDATE SET
             status = CASE WHEN user_progress.status='LOCKED' THEN 'UNLOCKED' ELSE user_progress.status END,
             updated_at = now()`,
          [userId, nxt.id]
        );
        unlockedNext = nxt.id;
      }
    }
    return { passed, passMark, unlockedNext };
  });
}

// Build the student's tree (all levels for a dialect + their status).
export async function getTree(userId, dialect) {
  const { rows } = await q(
    `SELECT l.id, l.titles, l.sort_order,
            COALESCE(p.status,'LOCKED') AS status, p.best_score
       FROM levels_and_units l
       LEFT JOIN user_progress p ON p.node_id=l.id AND p.user_id=$1
      WHERE l.dialect=$2
      ORDER BY l.sort_order`, [userId, dialect]);
  // First level is UNLOCKED by default if no row exists.
  if (rows.length && rows[0].status === 'LOCKED' && rows[0].best_score == null) rows[0].status = 'UNLOCKED';
  return rows;
}
