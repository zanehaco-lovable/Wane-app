import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { ensureSeed } from './seed.js';

import authRoutes from './routes/auth.routes.js';
import learnRoutes from './routes/learn.routes.js';
import examRoutes from './routes/exam.routes.js';
import aiRoutes from './routes/ai.routes.js';
import adminRoutes from './routes/admin.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import inheritanceRoutes from './routes/inheritance.routes.js';
import certificateRoutes from './routes/certificate.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import voucherRoutes from './routes/voucher.routes.js';
import agentRoutes from './routes/agent.routes.js';
import rulesRoutes from './routes/rules.routes.js';
import adminExtRoutes from './routes/admin_ext.routes.js';
import courseRoutes from './routes/course.routes.js';
import academicsRoutes from './routes/academics.routes.js';
import syncRoutes from './routes/sync.routes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, providers: providerStatus() }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/api/auth', authRoutes);
app.use('/api/learn', learnRoutes);
app.use('/api/exam', examRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/inheritance', inheritanceRoutes);
app.use('/api/certificate', certificateRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/admin', adminExtRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/sync', syncRoutes);

app.use(notFound);
app.use(errorHandler);

// Honest provider status — shows which live integrations are configured.
function providerStatus() {
  return {
    ai_llm: !!config.ai.apiKey ? 'live' : 'fallback',
    speech: (config.speech.apiKey && config.speech.baseUrl) ? 'live' : 'fallback',
    zoom: !!config.zoom.clientId ? 'live' : 'fallback',
    google_meet: !!config.google.refreshToken ? 'live' : 'fallback',
    sms_twilio: !!process.env.TWILIO_ACCOUNT_SID ? 'live' : 'fallback',
  };
}

async function start() {
  if (config.seedOnBoot) {
    try { const r = await ensureSeed(); console.log('seed:', r); }
    catch (e) { console.error('seed failed (continuing):', e.message); }
  }
  app.listen(config.port, () => {
    console.log(`Wane API on :${config.port}  providers=${JSON.stringify(providerStatus())}`);
  });
}
start();
