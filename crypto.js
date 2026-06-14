import crypto from 'node:crypto';
// SHA-256 fingerprint for tamper-proof certificates.
// Inputs: name, graduation date, the three section scores, and a server-side pepper.
export function certHash({ fullName, issuedAt, scores, pepper }) {
  const canonical = JSON.stringify({
    n: fullName.trim(),
    d: issuedAt,
    r: scores.reading, w: scores.writing, s: scores.speaking,
  });
  return crypto.createHmac('sha256', pepper).update(canonical).digest('hex');
}
// Short public id derived from the hash, e.g. WANE-789X-LK21
export function shortId(hashHex) {
  const a = hashHex.slice(0, 4).toUpperCase();
  const b = hashHex.slice(4, 8).toUpperCase();
  return `WANE-${a}-${b}`;
}
