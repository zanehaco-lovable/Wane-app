import crypto from 'node:crypto';
import { tx, q } from '../db.js';

export function genCode() {
  const s = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `WANE-${s()}-${s()}`;
}
export async function createVouchers({ amountCents, qty, createdBy }) {
  const out = [];
  for (let i = 0; i < qty; i++) {
    const row = (await q(
      'INSERT INTO vouchers (code, amount_cents, created_by) VALUES ($1,$2,$3) RETURNING *',
      [genCode(), amountCents, createdBy]
    )).rows[0];
    out.push(row);
  }
  return out;
}
export async function allocate(voucherId, agentId) {
  return (await q('UPDATE vouchers SET owner_agent=$2 WHERE id=$1 RETURNING *', [voucherId, agentId || null])).rows[0];
}
export async function markSold(voucherId, agentId, buyer) {
  return (await q(
    `UPDATE vouchers SET status='SOLD', buyer=$3 WHERE id=$1 AND owner_agent=$2 AND status='ACTIVE' RETURNING *`,
    [voucherId, agentId, buyer]
  )).rows[0];
}
// Redeem credits the wallet atomically and closes the voucher.
export async function redeem(code, userId) {
  return tx(async (c) => {
    const v = (await c.query("SELECT * FROM vouchers WHERE code=$1 FOR UPDATE", [code])).rows[0];
    if (!v) { const e = new Error('voucher_not_found'); e.status = 404; throw e; }
    if (v.status === 'REDEEMED' || v.status === 'VOID') { const e = new Error('voucher_used'); e.status = 409; throw e; }
    let w = (await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!w) w = (await c.query('INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [userId])).rows[0];
    const next = BigInt(w.balance_cents) + BigInt(v.amount_cents);
    await c.query('UPDATE wallets SET balance_cents=$1, updated_at=now() WHERE id=$2', [next.toString(), w.id]);
    await c.query('INSERT INTO financial_transactions (wallet_id, amount_cents, type, description) VALUES ($1,$2,$3,$4)',
      [w.id, v.amount_cents, 'TOPUP', `Voucher ${v.code}`]);
    await c.query("UPDATE vouchers SET status='REDEEMED', redeemed_by=$2, redeemed_at=now() WHERE id=$1", [v.id, userId]);
    return { credited_cents: Number(v.amount_cents), balance_cents: next.toString() };
  });
}
