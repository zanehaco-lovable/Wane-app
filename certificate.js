import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { q } from '../db.js';
import { config } from '../config.js';
import { certHash, shortId } from '../utils/crypto.js';

/*
 Cryptographic certification.
 1) Build SHA-256 HMAC fingerprint from (name, date, 3 scores, server pepper).
 2) Derive a short public id (WANE-XXXX-YYYY).
 3) Store in DB; the verify endpoint reads it back, so editing the PDF cannot
    forge it — the QR resolves to the server's record.
 4) Render a PDF with an embedded QR pointing to the verify page.
*/
export async function issueCertificate({ userId, fullName, scores }) {
  const issuedAt = new Date().toISOString();
  const hash = certHash({ fullName, issuedAt, scores, pepper: config.certSecret });
  const publicId = shortId(hash);
  const verifyUrl = `${config.verifyBaseUrl}?id=${encodeURIComponent(publicId)}`;

  // Persist (idempotent on hash_id).
  const { rows } = await q(
    `INSERT INTO certificates (user_id, hash_id, full_name, scores)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (hash_id) DO UPDATE SET full_name=EXCLUDED.full_name
     RETURNING *`,
    [userId, publicId, fullName, JSON.stringify(scores)]
  );

  const pdf = await renderPdf({ fullName, scores, publicId, verifyUrl, issuedAt });
  return { certificate: rows[0], publicId, verifyUrl, pdf };
}

export async function verifyCertificate(publicId) {
  const { rows } = await q(
    'SELECT hash_id, full_name, scores, issued_at FROM certificates WHERE hash_id=$1', [publicId]);
  if (!rows.length) return { valid: false };
  const c = rows[0];
  return { valid: true, public_id: c.hash_id, full_name: c.full_name, scores: c.scores, issued_at: c.issued_at };
}

async function renderPdf({ fullName, scores, publicId, verifyUrl, issuedAt }) {
  const qrPng = await QRCode.toBuffer(verifyUrl, { width: 220, margin: 1 });
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0f1c1a');
    doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(3).stroke('#f5c542');
    doc.fillColor('#f5c542').fontSize(40).text('Wane Academy', 0, 90, { align: 'center' });
    doc.fillColor('#ffffff').fontSize(16).text('Certificate of Completion', { align: 'center' });
    doc.moveDown(1.5).fontSize(30).fillColor('#ffffff').text(fullName, { align: 'center' });
    doc.moveDown(0.5).fontSize(13).fillColor('#bcd3cd')
      .text(`Reading ${scores.reading}%   ·   Writing ${scores.writing}%   ·   Speaking ${scores.speaking}%`, { align: 'center' });
    doc.moveDown(0.4).fontSize(11).fillColor('#9fb6b0')
      .text(`Issued ${new Date(issuedAt).toDateString()}`, { align: 'center' });
    doc.image(qrPng, doc.page.width / 2 - 110, doc.page.height - 200, { width: 110 });
    doc.fontSize(12).fillColor('#f5c542').text(publicId, 0, doc.page.height - 70, { align: 'center' });
    doc.end();
  });
}
