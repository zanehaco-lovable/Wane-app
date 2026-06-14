import crypto from 'node:crypto';
import { config } from '../config.js';

/*
 Speaking section scorer.
 LIVE: when SPEECH_API_KEY + SPEECH_BASE_URL are set, POST the audio to a
 Speech-to-Text / pronunciation-assessment provider and use its phoneme score.
 FALLBACK: deterministic pseudo-score derived from the audio bytes so the
 endpoint is testable offline. Honest: the fallback does NOT assess pronunciation.
*/
export async function scorePronunciation({ audioBuffer, referenceText, dialect }) {
  if (config.speech.apiKey && config.speech.baseUrl) {
    const res = await fetch(`${config.speech.baseUrl}/assess`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.speech.apiKey}`,
        'Content-Type': 'application/octet-stream',
        'X-Reference-Text': encodeURIComponent(referenceText || ''),
        'X-Dialect': dialect || '',
      },
      body: audioBuffer,
    });
    if (!res.ok) throw new Error(`Speech HTTP ${res.status}`);
    const data = await res.json();
    return {
      score: Math.round(data.pronunciationScore ?? data.accuracy ?? 0),
      fluency: data.fluencyScore ?? null,
      engine: 'provider',
    };
  }
  // Deterministic fallback: stable score in 60..95 based on audio hash + length.
  const len = audioBuffer?.length || 0;
  const h = crypto.createHash('sha256').update(audioBuffer || Buffer.alloc(0)).digest();
  const base = 60 + (h[0] % 36);                 // 60..95
  const adj = len > 2000 ? 0 : -5;               // very short clips penalised
  return { score: Math.max(0, Math.min(100, base + adj)), fluency: null, engine: 'fallback' };
}
