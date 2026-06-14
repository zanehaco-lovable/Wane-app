import { q } from '../db.js';

// Extended legacy system: a beneficiary's payout window ends 70 years after the
// activation (death) date. share_percentage is validated 0..100 by the DB CHECK;
// here we also enforce that active shares for one owner do not exceed 100%.
export async function addBeneficiary({ ownerId, name, relationship, sharePercentage }) {
  const { rows } = await q(
    `SELECT COALESCE(SUM(share_percentage),0) AS total
       FROM inheritance_beneficiaries WHERE original_owner_id=$1 AND is_active=TRUE`, [ownerId]);
  const used = Number(rows[0].total);
  if (used + Number(sharePercentage) > 100) {
    const e = new Error('shares_exceed_100'); e.status = 400; throw e;
  }
  return (await q(
    `INSERT INTO inheritance_beneficiaries (original_owner_id, beneficiary_name, relationship, share_percentage)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [ownerId, name, relationship, sharePercentage]
  )).rows[0];
}

export async function listBeneficiaries(ownerId) {
  return (await q('SELECT * FROM inheritance_beneficiaries WHERE original_owner_id=$1 ORDER BY created_at', [ownerId])).rows;
}

// Activate the legacy: set payout_start_date=now, payout_end_date=now+70y.
export async function activateLegacy(ownerId) {
  const start = new Date();
  const end = new Date(start); end.setFullYear(end.getFullYear() + 70);
  const { rows } = await q(
    `UPDATE inheritance_beneficiaries
        SET payout_start_date=$2, payout_end_date=$3
      WHERE original_owner_id=$1 AND is_active=TRUE
      RETURNING *`, [ownerId, start.toISOString(), end.toISOString()]);
  return rows;
}
