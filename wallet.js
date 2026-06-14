import { tx, q } from '../db.js';

export async function getOrCreateWallet(userId) {
  const found = (await q('SELECT * FROM wallets WHERE user_id=$1', [userId])).rows[0];
  if (found) return found;
  return (await q('INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [userId])).rows[0];
}

// Atomic ledger move: insert signed transaction + update balance, with CHECK >= 0.
export async function postTransaction({ userId, amountCents, type, description }) {
  return tx(async (c) => {
    let w = (await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!w) w = (await c.query('INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [userId])).rows[0];
    const next = BigInt(w.balance_cents) + BigInt(amountCents);
    if (next < 0n) { const e = new Error('insufficient_funds'); e.status = 400; throw e; }
    await c.query('UPDATE wallets SET balance_cents=$1, updated_at=now() WHERE id=$2', [next.toString(), w.id]);
    const txr = (await c.query(
      'INSERT INTO financial_transactions (wallet_id, amount_cents, type, description) VALUES ($1,$2,$3,$4) RETURNING *',
      [w.id, amountCents, type, description || null]
    )).rows[0];
    return { balance_cents: next.toString(), transaction: txr };
  });
}

export async function listTransactions(userId) {
  const { rows } = await q(
    `SELECT t.* FROM financial_transactions t
       JOIN wallets w ON w.id=t.wallet_id
      WHERE w.user_id=$1 ORDER BY t.created_at DESC LIMIT 100`, [userId]);
  return rows;
}
