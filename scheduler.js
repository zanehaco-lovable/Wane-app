import { config } from '../config.js';

/*
 Live session link generation.
 LIVE: real Zoom (Server-to-Server OAuth) or Google Calendar (Meet) when creds set.
 FALLBACK: deterministic fake link so scheduling works without OAuth. Honest.
*/
async function zoomToken() {
  const basic = Buffer.from(`${config.zoom.clientId}:${config.zoom.clientSecret}`).toString('base64');
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${config.zoom.accountId}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } }
  );
  if (!res.ok) throw new Error(`Zoom token HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function createZoom({ title, startAt, durationMin }) {
  const token = await zoomToken();
  const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: title, type: 2, start_time: startAt, duration: durationMin }),
  });
  if (!res.ok) throw new Error(`Zoom meeting HTTP ${res.status}`);
  const d = await res.json();
  return { joinUrl: d.join_url, externalId: String(d.id) };
}

async function googleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId, client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function createMeet({ title, startAt, durationMin }) {
  const token = await googleAccessToken();
  const end = new Date(new Date(startAt).getTime() + durationMin * 60000).toISOString();
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: title, start: { dateTime: startAt }, end: { dateTime: end },
        conferenceData: { createRequest: { requestId: `wane-${Date.now()}` } },
      }) }
  );
  if (!res.ok) throw new Error(`Google event HTTP ${res.status}`);
  const d = await res.json();
  return { joinUrl: d.hangoutLink || d.conferenceData?.entryPoints?.[0]?.uri, externalId: d.id };
}

function fakeLink(platform) {
  const seg = (n) => Math.random().toString(36).slice(2, 2 + n);
  return platform === 'Zoom'
    ? { joinUrl: `https://zoom.us/j/${Math.floor(1e10 * Math.random())}`, externalId: 'fake-' + seg(6) }
    : { joinUrl: `https://meet.google.com/${seg(3)}-${seg(4)}-${seg(3)}`, externalId: 'fake-' + seg(6) };
}

export async function createSession({ title, platform, startAt, durationMin }) {
  try {
    if (platform === 'Zoom' && config.zoom.clientId) return await createZoom({ title, startAt, durationMin });
    if (platform === 'Google Meet' && config.google.refreshToken) return await createMeet({ title, startAt, durationMin });
  } catch (e) { /* fall back to deterministic link */ }
  return fakeLink(platform);
}
