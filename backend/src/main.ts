import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { UPLOAD_DIR } from './common/uploader';
import { serveMapTile } from './common/map-tiles';
import { languageMiddleware } from './common/auth.guard';
import { securityHeaders, globalApiLimiter } from './common/security';
import { setupSwaggerDocs } from './common/swagger';
import { customerRouter } from './modules/customer/customer.routes';
import { staffRouter } from './modules/staff/staff.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { platformRouter } from './modules/platform/platform.routes';
import { webhookRouter } from './modules/webhooks/webhook.routes';
import { pool } from './config/database';
import { databaseScope } from './config/database-scope';
import { verifyToken } from './common/jwt';
import { redis } from './config/redis';
import { startHoldCleanerJob } from './workers/hold-cleaner';
import { startEmailWorkerJob } from './workers/email-worker';
import { refreshSmtpSettingsCache } from './common/email.service';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Security Headers (Helmet) & CORS
app.use(securityHeaders);
app.use(cors());

// Parse JSON payload (limit 2MB for standard JSON)
app.use(express.json({ limit: '2mb' }));
app.use(languageMiddleware);
app.use((req, res, next) => {
  let identity;
  try { if (req.headers.authorization?.startsWith('Bearer ')) identity = verifyToken(req.headers.authorization.slice(7)); } catch { /* Portal guards reject invalid credentials. */ }
  const authentication = /^\/api\/(staff|admin)\/v1\/auth\/(login|pin-unlock)$/.test(req.path);
  const identifier = authentication ? String(req.body.username || req.body.email || req.body.phone || req.body.staff_id || '').trim().toLowerCase() : '';
  databaseScope.run({ tenantId: identity?.tenantId, userId: identity?.userId, portal: authentication ? 'authentication' : identity?.portal || 'public', identifier, service: identity?.portal === 'platform' }, next);
});

// Rate Limiting (DDoS & Brute-force protection)
app.use('/api', globalApiLimiter);

// Serve Static Uploaded Images & Cached Street Map Tiles
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.get('/map-tiles/:style/:z/:x/:y', serveMapTile);

// Interactive Swagger / OpenAPI Documentation
setupSwaggerDocs(app);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT 1 as db_ok');
    const redisPong = await redis.ping();
    res.json({
      status: 'UP',
      database: dbRes.rows[0].db_ok === 1 ? 'CONNECTED' : 'ERROR',
      redis: redisPong === 'PONG' ? 'CONNECTED' : 'ERROR',
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      docs: `http://localhost:${PORT}/docs`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ status: 'DOWN', error: err.message });
  }
});

// Portal Specific Route Groups (Section 19.2 & Section 24)
app.use('/api/customer/v1', customerRouter);
app.use('/api/staff/v1', staffRouter);
app.use('/api/admin/v1', adminRouter);
app.use('/api/platform/v1', platformRouter);

// Public Webhooks (Bank & Email)
app.use('/webhooks', webhookRouter);

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ error_code: 'NOT_FOUND', message: 'API route not found' });
});

// Warm SMTP settings cache & Start Background Workers
void refreshSmtpSettingsCache();
startHoldCleanerJob(60000); // Releases expired 10-minute holds (Section 6.3)
startEmailWorkerJob(5000);   // Processes and dispatches email outbox (Section 17.1)

app.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`[API] Sports Court Booking Platform (VND Currency)`);
  console.log(`[NET] Listening on http://localhost:${PORT}`);
  console.log(`[DOC] OpenAPI UI      : http://localhost:${PORT}/docs`);
  console.log(`[RTE] Customer Portal : /api/customer/v1`);
  console.log(`[RTE] Staff Portal    : /api/staff/v1`);
  console.log(`[RTE] Admin Portal    : /api/admin/v1`);
  console.log(`[RTE] Platform Console: /api/platform/v1`);
  console.log(`[RTE] Webhooks        : /webhooks/bank/:provider`);
  console.log(`========================================================`);
});
