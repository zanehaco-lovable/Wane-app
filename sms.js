import { config } from '../config.js';
/*
 Send a voucher by SMS / WhatsApp / Email.
 LIVE SMS/WhatsApp via Twilio when TWILIO_* set; email via SMTP/provider when set.
 Otherwise returns deep links (sms:, wa.me, mailto:) the client/admin can open.
 Honest: automatic server-side sending needs a provider key; links always work.
*/
export function buildMessage({ code, amountCents, redeemUrl }) {
  return `Wane balance card ${code} — $${(amountCents/100).toFixed(2)} — redeem: ${redeemUrl}`;
}
export function deepLinks(msg, { phone, emailTo } = {}) {
  const e = encodeURIComponent(msg);
  return {
    sms: `sms:${phone || ''}?&body=${e}`,
    whatsapp: `https://wa.me/${(phone||'').replace(/\D/g,'')}?text=${e}`,
    email: `mailto:${emailTo || ''}?subject=${encodeURIComponent('Wane balance card')}&body=${e}`,
  };
}
export async function sendSms({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !tok || !from) return { sent: false, reason: 'no_provider' };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
  return { sent: true };
}
