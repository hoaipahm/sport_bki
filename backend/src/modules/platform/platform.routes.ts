import { Router, Response } from 'express';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { pool } from '../../config/database';
import { databaseScope } from '../../config/database-scope';
import { hashPassword, comparePassword, signAccessToken } from '../../common/jwt';
import { AuthenticatedRequest, requirePortal, sendTranslatedError } from '../../common/auth.guard';
import { recordAuditLog } from '../../common/audit';
import { authRateLimiter, uploadRateLimiter } from '../../common/security';
import {
  uploadMiddleware,
  optimizeAndSaveImage,
  avatarUploadMiddleware,
  optimizeAvatarImage,
  handleUploadErrors,
} from '../../common/uploader';
import { getActiveSmtpConfig, refreshSmtpSettingsCache, sendDirectSmtpTestEmail } from '../../common/email.service';

export const platformRouter = Router();

platformRouter.post('/auth/login', authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { email, password, totp_code } = req.body;
  if (!email || !password) {
    return sendTranslatedError(req, res, 400, 'INVALID_CREDENTIALS');
  }

  try {
    const adminRes = await databaseScope.run({ service: true }, () =>
      pool.query(
        `SELECT id, email, full_name, avatar_url, password_hash, role, is_active, preferred_language, created_at, totp_enabled, totp_secret, auth_version
         FROM platform_admins WHERE LOWER(email) = $1 AND is_active = TRUE`,
        [String(email).trim().toLowerCase()]
      )
    );

    if (adminRes.rows.length === 0) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const admin = adminRes.rows[0];
    const isMatch = await comparePassword(password, admin.password_hash);
    if (!isMatch) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    if (admin.totp_enabled) {
      if (!totp_code) return res.status(403).json({ error_code: 'TWO_FACTOR_REQUIRED', requires_2fa: true });
      if (!/^\d{6}$/.test(String(totp_code).trim()) || !admin.totp_secret || !verifySync({ token: String(totp_code).trim(), secret: admin.totp_secret, epochTolerance: [30, 0] }).valid) {
        return res.status(401).json({ error_code: 'INVALID_2FA_TOKEN', requires_2fa: true });
      }
    }

    const token = signAccessToken({
      userId: admin.id,
      portal: 'platform',
      sessionVersion: admin.auth_version,
      role: 'SUPER_ADMIN',
      preferredLanguage: admin.preferred_language,
    });

    return res.json({
      access_token: token,
      admin: {
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
        avatar_url: admin.avatar_url || null,
        role: admin.role,
        preferred_language: admin.preferred_language,
        created_at: admin.created_at,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.get('/me', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT id, email, full_name, avatar_url, role, preferred_language, totp_enabled, created_at
       FROM platform_admins WHERE id = $1`,
      [req.user!.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    return res.json({ profile: r.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.patch('/me', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { full_name, preferred_language } = req.body;
  try {
    const cur = (await pool.query(`SELECT * FROM platform_admins WHERE id = $1`, [req.user!.userId])).rows[0];
    if (!cur) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    const nextName = typeof full_name === 'string' && full_name.trim().length >= 2 ? full_name.trim().slice(0, 120) : cur.full_name;
    const nextLang = ['vi', 'en'].includes(preferred_language) ? preferred_language : cur.preferred_language;
    const upd = await pool.query(
      `UPDATE platform_admins SET full_name = $1, preferred_language = $2 WHERE id = $3
       RETURNING id, email, full_name, avatar_url, role, preferred_language, created_at`,
      [nextName, nextLang, req.user!.userId]
    );
    return res.json({ profile: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post(
  '/me/avatar',
  requirePortal('platform'),
  uploadRateLimiter,
  avatarUploadMiddleware.single('avatar'),
  async (req: AuthenticatedRequest, res: Response) => {
    const file = req.file;
    if (!file) return sendTranslatedError(req, res, 400, 'MISSING_FIELDS');
    try {
      const processed = await optimizeAvatarImage(file.buffer, file.originalname);
      const baseUrl = process.env.PUBLIC_API_URL || 'http://localhost:4000';
      const avatarUrl = `${baseUrl}${processed.url}`;
      const upd = await pool.query(
        `UPDATE platform_admins SET avatar_url = $1 WHERE id = $2
         RETURNING id, email, full_name, avatar_url, role, preferred_language, created_at`,
        [avatarUrl, req.user!.userId]
      );
      return res.status(201).json({ avatar_url: avatarUrl, profile: upd.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    }
  },
  handleUploadErrors
);

platformRouter.post('/me/password', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || String(new_password).length < 8 || new_password !== confirm_password) {
    return sendTranslatedError(req, res, 400, 'PASSWORD_INVALID');
  }
  try {
    const cur = (await pool.query(`SELECT * FROM platform_admins WHERE id = $1`, [req.user!.userId])).rows[0];
    if (!cur) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    if (!(await comparePassword(current_password, cur.password_hash))) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }
    const newHash = await hashPassword(new_password);
    await pool.query(`UPDATE platform_admins SET password_hash = $1, auth_version = auth_version + 1 WHERE id = $2`, [newHash, req.user!.userId]);
    return res.json({ status: 'PASSWORD_CHANGED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post('/auth/2fa/setup', requirePortal('platform'), authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const secret = generateSecret();
    const result = await pool.query(`UPDATE platform_admins SET totp_secret = $1 WHERE id = $2 AND totp_enabled = FALSE RETURNING id`, [secret, req.user!.userId]);
    if (!result.rowCount) return res.status(409).json({ error_code: 'TWO_FACTOR_ALREADY_ENABLED' });
    return res.json({ secret, otpauth: generateURI({ secret, label: `platform-${req.user!.userId}`, issuer: 'SportsCourtBooking' }) });
  } catch { return res.status(500).json({ error_code: 'INTERNAL_ERROR' }); }
});

platformRouter.post('/auth/2fa/verify', requirePortal('platform'), authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const row = (await pool.query(`SELECT totp_secret FROM platform_admins WHERE id = $1`, [req.user!.userId])).rows[0];
    if (!row?.totp_secret || !/^\d{6}$/.test(String(req.body.token || '')) ||
        !verifySync({ token: String(req.body.token), secret: row.totp_secret, epochTolerance: [30, 0] }).valid) {
      return res.status(400).json({ error_code: 'INVALID_2FA_TOKEN' });
    }
    await pool.query(`UPDATE platform_admins SET totp_enabled = TRUE WHERE id = $1`, [req.user!.userId]);
    return res.json({ totp_enabled: true });
  } catch { return res.status(500).json({ error_code: 'INTERNAL_ERROR' }); }
});

platformRouter.get('/tenants', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantsRes = await pool.query(
      `SELECT t.*, s.plan_name, s.price_per_month, s.status as subscription_status, s.expires_at as plan_expires_at,
              COUNT(v.id)::int as venue_count
       FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       LEFT JOIN venues v ON v.tenant_id = t.id
       GROUP BY t.id, s.plan_name, s.price_per_month, s.status, s.expires_at
       ORDER BY t.created_at DESC`
    );

    return res.json({ tenants: tenantsRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post('/tenants', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const {
    name,
    code,
    plan_name = 'STANDARD',
    price_per_month = 350000,
    owner_full_name,
    owner_username,
    owner_email,
    owner_phone,
    owner_password,
  } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tRes = await client.query(
      `INSERT INTO tenants (name, code, status, bank_account_info)
       VALUES ($1, $2, 'ACTIVE', '{"sandbox_mode": true, "verified_by_owner": false}'::jsonb)
       RETURNING *`,
      [String(name).trim(), String(code).trim().toLowerCase()]
    );
    const tenant = tRes.rows[0];

    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_name, price_per_month, status, starts_at, expires_at)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW() + INTERVAL '1 year')`,
      [tenant.id, String(plan_name).trim() || 'STANDARD', Math.max(0, Number(price_per_month) || 0)]
    );

    let createdOwner = null;
    if (owner_email && owner_password && String(owner_password).length >= 8) {
      const pwHash = await hashPassword(String(owner_password));
      const uname =
        String(owner_username || `${String(code).trim().toLowerCase()}_owner`)
          .replace(/[^a-z0-9_]/gi, '')
          .slice(0, 30) || `owner_${Date.now().toString().slice(-5)}`;
      const oRes = await client.query(
        `INSERT INTO tenant_staff (tenant_id, full_name, username, phone, email, password_hash, role, status, discount_limit)
         VALUES ($1, $2, $3, $4, $5, $6, 'OWNER', 'ACTIVE', 500000)
         RETURNING id, full_name, username, email, role`,
        [
          tenant.id,
          String(owner_full_name || `Chủ sân ${name}`).trim(),
          uname,
          String(owner_phone || '0900000000').trim(),
          String(owner_email).trim().toLowerCase(),
          pwHash,
        ]
      );
      createdOwner = oRes.rows[0];
    }

    await client.query('COMMIT');
    return res.status(201).json({ tenant, owner: createdOwner });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

platformRouter.put('/tenants/:id', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.params.id;
  const { name, code, plan_name, price_per_month } = req.body;
  try {
    const cur = (await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    if (!cur) return res.status(404).json({ error_code: 'TENANT_NOT_FOUND' });

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : cur.name;
    const nextCode = typeof code === 'string' && code.trim() ? code.trim().toLowerCase() : cur.code;

    const upd = await pool.query(
      `UPDATE tenants SET name = $1, code = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [nextName, nextCode, tenantId]
    );

    if (plan_name !== undefined || price_per_month !== undefined) {
      const subExist = (await pool.query(`SELECT id, plan_name, price_per_month FROM subscriptions WHERE tenant_id = $1 LIMIT 1`, [tenantId])).rows[0];
      if (subExist) {
        await pool.query(
          `UPDATE subscriptions SET plan_name = $1, price_per_month = $2 WHERE id = $3`,
          [
            typeof plan_name === 'string' && plan_name.trim() ? plan_name.trim() : subExist.plan_name,
            price_per_month !== undefined ? Math.max(0, Number(price_per_month) || 0) : subExist.price_per_month,
            subExist.id,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO subscriptions (tenant_id, plan_name, price_per_month, status, starts_at, expires_at)
           VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW() + INTERVAL '1 year')`,
          [tenantId, String(plan_name || 'STANDARD').trim(), Math.max(0, Number(price_per_month) || 0)]
        );
      }
    }

    await recordAuditLog({
      tenantId,
      actorPortal: 'platform',
      actorId: req.user!.userId,
      action: 'UPDATE_TENANT',
      targetTable: 'tenants',
      targetId: tenantId,
      afterState: { name: nextName, code: nextCode, plan_name, price_per_month },
      ipAddress: req.ip,
    });

    return res.json({ tenant: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.delete('/tenants/:id', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.params.id;
  try {
    const del = await pool.query(`DELETE FROM tenants WHERE id = $1 RETURNING id, name, code`, [tenantId]);
    if (!del.rows[0]) return res.status(404).json({ error_code: 'TENANT_NOT_FOUND' });
    return res.json({ status: 'TENANT_DELETED', deleted: del.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// Purge seeded demo bookings & demo tournaments cleanly so operators can start fresh with real data
platformRouter.post('/demo-data/purge', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const delBookings = await pool.query(
      `DELETE FROM bookings WHERE booking_code LIKE 'DS-DEMO%' OR notes = 'Dữ liệu vận hành mẫu cục bộ'`
    );
    const delTournaments = await pool.query(
      `DELETE FROM tournaments WHERE name_vi = 'Cúp Giao Hữu Phù Đổng Mở Rộng 2026'`
    );
    return res.json({
      status: 'DEMO_DATA_PURGED',
      deleted_bookings: delBookings.rowCount || 0,
      deleted_tournaments: delTournaments.rowCount || 0,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// PLATFORM-WIDE DYNAMIC SPORTS CATALOG CRUD
// ============================================================================

platformRouter.get('/sports', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(c.id)::int FROM courts c WHERE c.sport_id = s.id) as court_count
       FROM sports s
       ORDER BY s.created_at ASC`
    );
    return res.json({ sports: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post('/sports', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { code, name_vi, name_en, min_duration_mins = 60, step_mins = 30 } = req.body;
  const cleanCode = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  if (!cleanCode || !name_vi) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'Cần nhập mã môn (code) và tên tiếng Việt.' });
  }
  try {
    const ins = await pool.query(
      `INSERT INTO sports (code, name_i18n, min_duration_mins, step_mins)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET name_i18n = EXCLUDED.name_i18n,
             min_duration_mins = EXCLUDED.min_duration_mins,
             step_mins = EXCLUDED.step_mins
       RETURNING *`,
      [
        cleanCode,
        JSON.stringify({ vi: String(name_vi).trim(), en: String(name_en || name_vi).trim() }),
        Math.max(30, Number(min_duration_mins) || 60),
        Math.max(15, Number(step_mins) || 30),
      ]
    );
    return res.status(201).json({ sport: ins.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.put('/sports/:id', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { name_vi, name_en, min_duration_mins = 60, step_mins = 30 } = req.body;
  if (!name_vi) return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  try {
    const upd = await pool.query(
      `UPDATE sports
       SET name_i18n = $1, min_duration_mins = $2, step_mins = $3
       WHERE id = $4 RETURNING *`,
      [
        JSON.stringify({ vi: String(name_vi).trim(), en: String(name_en || name_vi).trim() }),
        Math.max(30, Number(min_duration_mins) || 60),
        Math.max(15, Number(step_mins) || 30),
        req.params.id,
      ]
    );
    if (!upd.rows[0]) return res.status(404).json({ error_code: 'NOT_FOUND' });
    return res.json({ sport: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.delete('/sports/:id', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const used = await pool.query(`SELECT COUNT(*)::int as cnt FROM courts WHERE sport_id = $1`, [req.params.id]);
    if (Number(used.rows[0]?.cnt || 0) > 0) {
      return res.status(409).json({
        error_code: 'SPORT_IN_USE',
        message: 'Không thể xóa môn thể thao này vì đang có sân hoạt động gắn với nó. Hãy xóa hoặc đổi môn của các sân trước.',
      });
    }
    const del = await pool.query(`DELETE FROM sports WHERE id = $1 RETURNING id, code`, [req.params.id]);
    if (!del.rows[0]) return res.status(404).json({ error_code: 'NOT_FOUND' });
    return res.json({ status: 'SPORT_DELETED', deleted: del.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post('/tenants/:id/suspend', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.params.id;
  const adminId = req.user!.userId;

  try {
    await pool.query(`UPDATE tenants SET status = 'SUSPENDED', updated_at = NOW() WHERE id = $1`, [tenantId]);

    await recordAuditLog({
      tenantId,
      actorPortal: 'platform',
      actorId: adminId,
      action: 'SUSPEND_TENANT',
      targetTable: 'tenants',
      targetId: tenantId,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Tenant suspended successfully.', status: 'SUSPENDED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post('/tenants/:id/reactivate', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.params.id;
  try {
    await pool.query(`UPDATE tenants SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1`, [tenantId]);
    return res.json({ message: 'Tenant reactivated successfully.', status: 'ACTIVE' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * Persisted time-limited read-only Support Sessions (P-02)
 */
platformRouter.get('/support/sessions', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  const sRes = await pool.query(
    `SELECT ss.*, t.name as tenant_name, pa.email as admin_email
     FROM support_sessions ss
     JOIN tenants t ON t.id = ss.tenant_id
     JOIN platform_admins pa ON pa.id = ss.admin_id
     ORDER BY ss.created_at DESC LIMIT 20`
  );
  return res.json({ sessions: sRes.rows });
});

platformRouter.post('/support/sessions', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { tenant_id, reason, duration_mins = 30 } = req.body;
  const adminId = req.user!.userId;

  if (!tenant_id || !reason) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'tenant_id and reason are required.' });
  }

  const safeMins = Math.min(60, Math.max(5, Number(duration_mins) || 30));
  const sRes = await pool.query(
    `INSERT INTO support_sessions (tenant_id, admin_id, reason, read_only, expires_at)
     VALUES ($1, $2, $3, TRUE, NOW() + ($4 || ' minutes')::interval)
     RETURNING *`,
    [tenant_id, adminId, String(reason).trim(), safeMins]
  );

  await recordAuditLog({
    tenantId: tenant_id,
    actorPortal: 'platform',
    actorId: adminId,
    action: 'START_SUPPORT_SESSION',
    targetTable: 'support_sessions',
    targetId: sRes.rows[0].id,
    afterState: sRes.rows[0],
    ipAddress: req.ip,
  });

  return res.status(201).json({
    message: 'Support session started. Read-only access audited.',
    session: sRes.rows[0],
  });
});

platformRouter.get('/monitoring', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [emailQueueRes, holdsRes, webhooksRes, bookingsCountRes] = await Promise.all([
      pool.query(`SELECT status, COUNT(id)::int as count FROM email_outbox GROUP BY status`),
      pool.query(`SELECT COUNT(id)::int as active_holds FROM bookings WHERE status = 'PENDING' AND hold_expires_at > NOW()`),
      pool.query(`SELECT provider, status, COUNT(id)::int as count FROM webhook_events GROUP BY provider, status`),
      pool.query(`SELECT status, COUNT(id)::int as count FROM bookings GROUP BY status`),
    ]);

    return res.json({
      email_queue: emailQueueRes.rows,
      active_holds: holdsRes.rows[0]?.active_holds || 0,
      webhooks: webhooksRes.rows,
      bookings_by_status: bookingsCountRes.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// REAL SMTP CONFIGURATION & LIVE DELIVERY VERIFICATION (F-10)
// ============================================================================

platformRouter.get('/smtp', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const active = await getActiveSmtpConfig();
    const row = (await pool.query(`SELECT host, port, secure, username, password != '' as has_password, from_email, from_name, enabled, updated_at FROM platform_smtp_settings WHERE id = 1`)).rows[0];
    return res.json({
      active_source: active.source,
      is_live: active.enabled,
      settings: {
        host: row?.host || active.host || '',
        port: Number(row?.port || active.port || 587),
        secure: Boolean(row?.secure ?? active.secure),
        username: row?.username || active.username || '',
        has_password: Boolean(row?.has_password || active.password),
        from_email: row?.from_email || active.from_email || 'noreply@sportscourt.vn',
        from_name: row?.from_name || active.from_name || 'Sports Court Booking',
        enabled: Boolean(row?.enabled ?? active.enabled),
        updated_at: row?.updated_at || null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.put('/smtp', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { host = '', port = 587, secure = false, username = '', password, from_email = '', from_name = 'Sports Court Booking', enabled = false } = req.body;
  try {
    const existing = (await pool.query(`SELECT password FROM platform_smtp_settings WHERE id = 1`)).rows[0];
    const nextPassword = typeof password === 'string' && password.length > 0 ? password : existing?.password || '';

    await pool.query(
      `UPDATE platform_smtp_settings
       SET host = $1, port = $2, secure = $3, username = $4, password = $5,
           from_email = $6, from_name = $7, enabled = $8, updated_by = $9, updated_at = NOW()
       WHERE id = 1`,
      [
        String(host).trim(),
        Number(port) || 587,
        Boolean(secure),
        String(username).trim(),
        nextPassword,
        String(from_email).trim() || 'noreply@sportscourt.vn',
        String(from_name).trim() || 'Sports Court Booking',
        Boolean(enabled),
        req.user!.userId,
      ]
    );

    const active = await refreshSmtpSettingsCache();
    return res.json({ status: 'SMTP_UPDATED', is_live: active.enabled, active_source: active.source });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post('/smtp/test', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const { recipient } = req.body;
  if (typeof recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
    return res.status(400).json({ error_code: 'INVALID_EMAIL', message: 'Valid recipient email required.' });
  }
  try {
    const info = await sendDirectSmtpTestEmail(recipient.trim(), req.lang || 'vi');
    return res.json({ status: 'SENT', ...info });
  } catch (err: any) {
    return res.status(502).json({
      error_code: err.message === 'SMTP_NOT_CONFIGURED' ? 'SMTP_NOT_CONFIGURED' : 'SMTP_CONNECTION_FAILED',
      message: err.message === 'SMTP_NOT_CONFIGURED' ? 'Chưa bật hoặc chưa điền đủ cấu hình SMTP.' : `Lỗi kết nối SMTP: ${err.code || err.message}`,
    });
  }
});

// ============================================================================
// PLATFORM MEDIA SHOWCASE & CROSS-TENANT VENUE GALLERY MANAGER
// ============================================================================

platformRouter.get('/media', requirePortal('platform'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [mediaRes, venuesRes] = await databaseScope.run({ service: true }, () =>
      Promise.all([
        pool.query(`SELECT hero_slides, auth_slides, ops_slides, updated_at FROM platform_media_settings WHERE id = 1`),
        pool.query(
          `SELECT v.id, v.name, v.slug, v.cover_photo_url, v.photos, t.name as tenant_name
           FROM venues v
           JOIN tenants t ON t.id = v.tenant_id
           ORDER BY t.created_at ASC, v.created_at ASC`
        ),
      ])
    );

    const row = mediaRes.rows[0] || {};
    return res.json({
      settings: {
        hero_slides: Array.isArray(row.hero_slides) ? row.hero_slides : [],
        auth_slides: Array.isArray(row.auth_slides) ? row.auth_slides : [],
        ops_slides: Array.isArray(row.ops_slides) ? row.ops_slides : [],
        updated_at: row.updated_at || null,
      },
      venues: venuesRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.post(
  '/media/upload',
  requirePortal('platform'),
  uploadRateLimiter,
  uploadMiddleware.array('photos', 10),
  async (req: AuthenticatedRequest, res: Response) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error_code: 'NO_FILES_UPLOADED', message: 'Vui lòng chọn ít nhất 1 ảnh để tải lên.' });
    }

    const targetType = String(req.body?.target_type || 'venue');
    const venueId = typeof req.body?.venue_id === 'string' ? req.body.venue_id.trim() : '';

    try {
      const results = [];
      for (const file of files) {
        const processed = await optimizeAndSaveImage(file.buffer, file.originalname);
        results.push(processed);
      }
      const baseUrl = process.env.PUBLIC_API_URL || 'http://localhost:4000';
      const newUrls = results.map((r) => `${baseUrl}${r.url}`);

      if (targetType === 'venue' && venueId) {
        await databaseScope.run({ service: true }, async () => {
          const cur = (await pool.query(`SELECT cover_photo_url, photos FROM venues WHERE id = $1`, [venueId])).rows[0];
          if (!cur) throw new Error('VENUE_NOT_FOUND');
          const existing: string[] = Array.isArray(cur.photos) ? cur.photos : [];
          const merged = Array.from(new Set([...newUrls, ...existing])).slice(0, 30);
          const cover = newUrls[0] || cur.cover_photo_url || null;
          await pool.query(
            `UPDATE venues SET cover_photo_url = $1, photos = $2::jsonb, updated_at = NOW() WHERE id = $3`,
            [cover, JSON.stringify(merged), venueId]
          );
        });
      } else if (['hero', 'auth', 'ops'].includes(targetType)) {
        const col = targetType === 'hero' ? 'hero_slides' : targetType === 'auth' ? 'auth_slides' : 'ops_slides';
        await databaseScope.run({ service: true }, async () => {
          const cur = (await pool.query(`SELECT ${col} FROM platform_media_settings WHERE id = 1`)).rows[0];
          const existing: string[] = Array.isArray(cur?.[col]) ? cur[col] : [];
          const merged = Array.from(new Set([...newUrls, ...existing])).slice(0, 24);
          await pool.query(
            `INSERT INTO platform_media_settings (id, ${col}, updated_by, updated_at)
             VALUES (1, $1::jsonb, $2, NOW())
             ON CONFLICT (id) DO UPDATE SET ${col} = EXCLUDED.${col}, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [JSON.stringify(merged), req.user!.userId]
          );
        });
      } else {
        return res.status(400).json({ error_code: 'INVALID_TARGET', message: 'Loại thư viện ảnh không hợp lệ.' });
      }

      return res.status(201).json({
        message: `Đã nén chuẩn WebP và thêm ${results.length} ảnh mới vào hệ thống!`,
        uploaded_urls: newUrls,
      });
    } catch (err: any) {
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    }
  },
  handleUploadErrors
);

platformRouter.put('/media', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const cleanArr = (arr: any) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr.filter((u) => typeof u === 'string' && u.trim().length > 0).map((u: string) => u.trim()))).slice(0, 24)
      : undefined;

  const hero = cleanArr(req.body?.hero_slides);
  const auth = cleanArr(req.body?.auth_slides);
  const ops = cleanArr(req.body?.ops_slides);

  try {
    const upd = await databaseScope.run({ service: true }, async () => {
      const cur = (await pool.query(`SELECT * FROM platform_media_settings WHERE id = 1`)).rows[0] || {};
      const nextHero = hero ?? cur.hero_slides ?? [];
      const nextAuth = auth ?? cur.auth_slides ?? [];
      const nextOps = ops ?? cur.ops_slides ?? [];
      const r = await pool.query(
        `INSERT INTO platform_media_settings (id, hero_slides, auth_slides, ops_slides, updated_by, updated_at)
         VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4, NOW())
         ON CONFLICT (id) DO UPDATE
         SET hero_slides = EXCLUDED.hero_slides,
             auth_slides = EXCLUDED.auth_slides,
             ops_slides = EXCLUDED.ops_slides,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
         RETURNING hero_slides, auth_slides, ops_slides, updated_at`,
        [JSON.stringify(nextHero), JSON.stringify(nextAuth), JSON.stringify(nextOps), req.user!.userId]
      );
      return r.rows[0];
    });
    return res.json({ status: 'MEDIA_UPDATED', settings: upd });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

platformRouter.put('/venues/:id/photos', requirePortal('platform'), async (req: AuthenticatedRequest, res: Response) => {
  const venueId = req.params.id;
  const rawPhotos = Array.isArray(req.body?.photos) ? req.body.photos : [];
  const cleaned = Array.from(
    new Set(
      rawPhotos
        .filter((u: any) => typeof u === 'string' && u.trim().length > 0)
        .map((u: string) => u.trim())
    )
  ).slice(0, 30);

  const requestedCover = typeof req.body?.cover_photo_url === 'string' && req.body.cover_photo_url.trim()
    ? req.body.cover_photo_url.trim()
    : cleaned[0] || null;
  const ordered = requestedCover
    ? [requestedCover, ...cleaned.filter((u) => u !== requestedCover)]
    : cleaned;

  try {
    const upd = await databaseScope.run({ service: true }, () =>
      pool.query(
        `UPDATE venues SET cover_photo_url = $1, photos = $2::jsonb, updated_at = NOW()
         WHERE id = $3 RETURNING id, name, cover_photo_url, photos`,
        [requestedCover, JSON.stringify(ordered), venueId]
      )
    );
    if (!upd.rows[0]) return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });
    return res.json({ status: 'VENUE_PHOTOS_UPDATED', venue: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});
