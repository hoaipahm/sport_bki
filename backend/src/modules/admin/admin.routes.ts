import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { pool } from '../../config/database';
import { databaseScope } from '../../config/database-scope';
import { hashPassword, comparePassword, signAccessToken } from '../../common/jwt';
import { AuthenticatedRequest, requirePortal, sendTranslatedError } from '../../common/auth.guard';
import { recordAuditLog } from '../../common/audit';
import { broadcastCourtChange } from '../../common/realtime';
import { uploadMiddleware, avatarUploadMiddleware, optimizeAndSaveImage, optimizeAvatarImage, handleUploadErrors } from '../../common/uploader';
import { authRateLimiter, uploadRateLimiter } from '../../common/security';
import { expandPhysicalCourts } from '../booking/booking.service';
import { vietnamDate } from '../../../../shared/booking';
import { adminExtensionsRouter } from './extensions.routes';

export const adminRouter = Router();
adminRouter.use(adminExtensionsRouter);

async function getAdminPermittedVenues(userId: string, role: string | undefined, tenantId: string): Promise<string[]> {
  if (role === 'OWNER') {
    const res = await pool.query(`SELECT id FROM venues WHERE tenant_id = $1`, [tenantId]);
    return res.rows.map((r) => r.id);
  }
  const res = await pool.query(`SELECT venue_id FROM staff_venue_assignments WHERE staff_id = $1`, [userId]);
  return res.rows.map((r) => r.venue_id);
}

function requireAssignedResource(table: 'courts' | 'price_rules') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const row = (await pool.query(`SELECT venue_id FROM ${table} WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user!.tenantId])).rows[0];
      if (!row) return res.status(404).json({ error_code: 'NOT_FOUND' });
      const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, req.user!.tenantId!);
      if (!permitted.includes(row.venue_id)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
      next();
    } catch { return res.status(500).json({ error_code: 'INTERNAL_ERROR' }); }
  };
}

// ============================================================================
// 1. TENANT ADMIN AUTHENTICATION & SERVER-BOUND 2FA (F-09)
// ============================================================================

adminRouter.post('/auth/login', authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { username, email, password, totp_code } = req.body;
  const loginIdentifier = String(username || email || '').trim().toLowerCase();
  if (!loginIdentifier || !password) {
    return sendTranslatedError(req, res, 400, 'INVALID_CREDENTIALS');
  }

  try {
    const adminRes = await pool.query(
      `SELECT s.id, s.tenant_id, s.full_name, s.username, s.email, s.phone, s.avatar_url, s.discount_limit,
              s.password_hash, s.auth_version, s.role, s.preferred_language, s.totp_secret, s.totp_enabled, s.created_at, t.name as tenant_name
       FROM tenant_staff s
       JOIN tenants t ON t.id = s.tenant_id AND t.status = 'ACTIVE'
       WHERE (LOWER(s.username) = $1 OR LOWER(COALESCE(s.email, '')) = $1)
         AND s.role IN ('OWNER', 'MANAGER')
         AND s.status = 'ACTIVE'`,
      [loginIdentifier]
    );

    if (adminRes.rows.length === 0) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const admin = adminRes.rows[0];
    const isMatch = await comparePassword(password, admin.password_hash);
    if (!isMatch) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    // Server-bound 2FA check when enrolled
    if (admin.totp_enabled && admin.totp_secret) {
      if (!totp_code) {
        return res.status(403).json({
          error_code: 'TWO_FACTOR_REQUIRED',
          requires_2fa: true,
          message: 'Vui lòng nhập mã 6 số từ ứng dụng xác thực 2FA.',
        });
      }
      const check2fa = /^\d{6}$/.test(String(totp_code).trim()) && verifySync({ token: String(totp_code).trim(), secret: admin.totp_secret, epochTolerance: [30, 0] });
      if (!check2fa || !check2fa.valid) {
        return res.status(401).json({
          error_code: 'INVALID_2FA_TOKEN',
          requires_2fa: true,
          message: 'Mã xác thực 2FA không chính xác.',
        });
      }
    }

    const permittedVenues = await getAdminPermittedVenues(admin.id, admin.role, admin.tenant_id);

    const token = signAccessToken({
      userId: admin.id,
      portal: 'admin',
      sessionVersion: admin.auth_version,
      tenantId: admin.tenant_id,
      role: admin.role,
      preferredLanguage: admin.preferred_language,
    });

    return res.json({
      access_token: token,
      admin: {
        id: admin.id,
        full_name: admin.full_name,
        username: admin.username,
        email: admin.email,
        phone: admin.phone,
        avatar_url: admin.avatar_url || null,
        discount_limit: Number(admin.discount_limit || 0),
        role: admin.role,
        preferred_language: admin.preferred_language,
        created_at: admin.created_at,
        totp_enabled: Boolean(admin.totp_enabled),
        tenant_id: admin.tenant_id,
        tenant_name: admin.tenant_name,
        assigned_venues: permittedVenues,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.get('/me', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  try {
    const r = await pool.query(
      `SELECT s.id, s.tenant_id, s.full_name, s.username, s.email, s.phone, s.avatar_url,
              s.role, s.status, s.discount_limit, s.preferred_language, s.totp_enabled, s.created_at,
              t.name as tenant_name
       FROM tenant_staff s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [userId, tenantId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    const permittedVenues = await getAdminPermittedVenues(userId, r.rows[0].role, tenantId);
    return res.json({
      profile: {
        ...r.rows[0],
        discount_limit: Number(r.rows[0].discount_limit || 0),
        totp_enabled: Boolean(r.rows[0].totp_enabled),
        assigned_venues: permittedVenues,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.patch('/me', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { full_name, phone, email, preferred_language } = req.body;
  try {
    const curRes = await pool.query(`SELECT * FROM tenant_staff WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
    if (curRes.rows.length === 0) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    const cur = curRes.rows[0];

    const nextName = typeof full_name === 'string' && full_name.trim().length >= 2 ? full_name.trim().slice(0, 120) : cur.full_name;
    const nextPhone = typeof phone === 'string' && phone.trim().length >= 9 ? phone.trim().slice(0, 20) : cur.phone;
    const nextEmail =
      typeof email === 'string'
        ? email.trim() === ''
          ? null
          : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
            ? email.trim().toLowerCase()
            : cur.email
        : cur.email;
    const nextLang = ['vi', 'en'].includes(preferred_language) ? preferred_language : cur.preferred_language;

    const upd = await pool.query(
      `UPDATE tenant_staff
       SET full_name = $1, phone = $2, email = $3, preferred_language = $4, updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING id, tenant_id, full_name, username, email, phone, avatar_url, role, status, discount_limit, preferred_language, totp_enabled, created_at`,
      [nextName, nextPhone, nextEmail, nextLang, userId, tenantId]
    );
    return res.json({ profile: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.post(
  '/me/avatar',
  requirePortal('admin'),
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
        `UPDATE tenant_staff SET avatar_url = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3
         RETURNING id, full_name, username, email, phone, avatar_url, role, discount_limit, preferred_language, totp_enabled`,
        [avatarUrl, req.user!.userId, req.user!.tenantId!]
      );
      return res.status(201).json({ avatar_url: avatarUrl, profile: upd.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    }
  },
  handleUploadErrors
);

adminRouter.post('/me/password', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || String(new_password).length < 8 || new_password !== confirm_password) {
    return sendTranslatedError(req, res, 400, 'PASSWORD_INVALID');
  }
  try {
    const row = (await pool.query(`SELECT * FROM tenant_staff WHERE id = $1 AND tenant_id = $2`, [userId, tenantId])).rows[0];
    if (!row) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    const ok = await comparePassword(current_password, row.password_hash);
    if (!ok) return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');

    const newHash = await hashPassword(new_password);
    await pool.query(
      `UPDATE tenant_staff SET password_hash = $1, auth_version = auth_version + 1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [newHash, userId, tenantId]
    );
    return res.json({ status: 'PASSWORD_CHANGED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.post('/auth/2fa/setup', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const secret = generateSecret();
  const initialized = await pool.query(`UPDATE tenant_staff SET totp_secret = $1 WHERE id = $2 AND totp_enabled = FALSE RETURNING id`, [secret, userId]);
  if (!initialized.rowCount) return res.status(409).json({ error_code: 'TWO_FACTOR_ALREADY_ENABLED' });
  const otpauth = generateURI({
    secret,
    label: `owner-${userId.slice(0, 8)}`,
    issuer: 'SportsCourtBooking',
  });
  return res.json({ secret, otpauth });
});

adminRouter.post('/auth/2fa/verify', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error_code: 'MISSING_FIELDS' });

  const row = (await pool.query(`SELECT totp_secret FROM tenant_staff WHERE id = $1`, [userId])).rows[0];
  if (!row?.totp_secret) {
    return res.status(400).json({ error_code: '2FA_NOT_INITIALIZED', message: 'Chưa khởi tạo mã bí mật 2FA.' });
  }

  const result = verifySync({ token: String(token).trim(), secret: row.totp_secret, epochTolerance: [30, 0] });
  if (!result.valid) {
    return res.status(400).json({ error_code: 'INVALID_2FA_TOKEN', message: 'Mã 2FA không hợp lệ.' });
  }

  await pool.query(`UPDATE tenant_staff SET totp_enabled = TRUE, updated_at = NOW() WHERE id = $1`, [userId]);
  return res.json({ message: 'Đã kích hoạt bảo mật 2 lớp (2FA) thành công.', totp_enabled: true });
});

// ============================================================================
// 2. VENUES, SPORTS, COURTS & PRICE RULES (A-01, A-04, A-07)
// ============================================================================

adminRouter.get('/sports', requirePortal('admin'), async (_req: AuthenticatedRequest, res: Response) => {
  const sRes = await pool.query(`SELECT id, code, name_i18n, min_duration_mins, step_mins FROM sports ORDER BY code`);
  return res.json({ sports: sRes.rows });
});

adminRouter.get('/venues', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const role = req.user!.role;

  try {
    const permittedVenues = await getAdminPermittedVenues(userId, role, tenantId);
    if (permittedVenues.length === 0) return res.json({ venues: [] });

    const venuesRes = await pool.query(
      `SELECT v.*, COUNT(c.id)::int as court_count
       FROM venues v
       LEFT JOIN courts c ON c.venue_id = v.id AND c.is_active = TRUE
       WHERE v.tenant_id = $1 AND v.id = ANY($2)
       GROUP BY v.id
       ORDER BY v.created_at ASC`,
      [tenantId, permittedVenues]
    );

    return res.json({ venues: venuesRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.get('/courts', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const role = req.user!.role;

  try {
    const permittedVenues = await getAdminPermittedVenues(userId, role, tenantId);
    if (permittedVenues.length === 0) return res.json({ courts: [] });

    const courtsRes = await pool.query(
      `SELECT c.*, s.code as sport_code, s.name_i18n as sport_name, v.name as venue_name
       FROM courts c
       JOIN sports s ON s.id = c.sport_id
       JOIN venues v ON v.id = c.venue_id
       WHERE c.tenant_id = $1 AND c.venue_id = ANY($2)
       ORDER BY v.created_at ASC, c.name ASC`,
      [tenantId, permittedVenues]
    );

    return res.json({ courts: courtsRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.post('/courts', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const role = req.user!.role;
  const { venue_id, sport_id, name, name_en, court_type } = req.body;

  if (!venue_id || !sport_id || !name || !court_type) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'Vui lòng nhập đủ thông tin sân.' });
  }

  const permitted = await getAdminPermittedVenues(userId, role, tenantId);
  if (!permitted.includes(venue_id)) {
    return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
  }

  try {
    const cRes = await pool.query(
      `INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
      [
        tenantId,
        venue_id,
        sport_id,
        String(name).trim(),
        JSON.stringify({ vi: String(name).trim(), en: String(name_en || name).trim() }),
        String(court_type).trim(),
      ]
    );

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: userId,
      action: 'CREATE_COURT',
      targetTable: 'courts',
      targetId: cRes.rows[0].id,
      afterState: cRes.rows[0],
      ipAddress: req.ip,
    });

    return res.status(201).json({ court: cRes.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.get('/price-rules', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);
  if (permitted.length === 0) return res.json({ price_rules: [] });

  const prRes = await pool.query(
    `SELECT pr.*, v.name as venue_name
     FROM price_rules pr
     JOIN venues v ON v.id = pr.venue_id
     WHERE pr.tenant_id = $1 AND pr.venue_id = ANY($2)
     ORDER BY v.name ASC, pr.court_type ASC, pr.priority DESC, pr.start_time ASC`,
    [tenantId, permitted]
  );
  return res.json({ price_rules: prRes.rows });
});

adminRouter.post('/price-rules', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const {
    venue_id,
    court_type,
    start_time,
    end_time,
    price_per_hour,
    is_weekend = false,
    is_peak_hour = false,
    priority = 2,
  } = req.body;

  const safePrice = Number(price_per_hour);
  if (!venue_id || !court_type || !start_time || !end_time || !Number.isSafeInteger(safePrice) || safePrice <= 0) {
    return res.status(400).json({ error_code: 'INVALID_PRICE_RULE', message: 'Thông tin khung giờ hoặc đơn giá không hợp lệ.' });
  }

  const permitted = await getAdminPermittedVenues(userId, req.user!.role, tenantId);
  if (!permitted.includes(venue_id)) {
    return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
  }

  const ins = await pool.query(
    `INSERT INTO price_rules (
       tenant_id, venue_id, court_type, is_weekend, is_peak_hour, start_time, end_time, price_per_hour, priority
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [tenantId, venue_id, court_type, Boolean(is_weekend), Boolean(is_peak_hour), start_time, end_time, safePrice, Number(priority) || 1]
  );

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: userId,
    action: 'CREATE_PRICE_RULE',
    targetTable: 'price_rules',
    targetId: ins.rows[0].id,
    afterState: ins.rows[0],
    ipAddress: req.ip,
  });

  return res.status(201).json({ price_rule: ins.rows[0] });
});

adminRouter.delete('/price-rules/:id', requirePortal('admin'), requireAssignedResource('price_rules'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  await pool.query(`DELETE FROM price_rules WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
  return res.json({ message: 'Đã xóa quy tắc giá.' });
});

adminRouter.put('/price-rules/:id', requirePortal('admin'), requireAssignedResource('price_rules'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const safePrice = Number(req.body?.price_per_hour);
  if (!Number.isSafeInteger(safePrice) || safePrice <= 0) {
    return res.status(400).json({ error_code: 'INVALID_PRICE_RULE', message: 'Đơn giá mới phải là số nguyên dương VND.' });
  }
  const upd = await pool.query(
    `UPDATE price_rules
     SET price_per_hour = $1,
         start_time = COALESCE($2::time, start_time),
         end_time = COALESCE($3::time, end_time)
     WHERE id = $4 AND tenant_id = $5
     RETURNING *`,
    [safePrice, req.body?.start_time || null, req.body?.end_time || null, req.params.id, tenantId]
  );
  if (!upd.rows[0]) return res.status(404).json({ error_code: 'NOT_FOUND' });
  return res.json({ price_rule: upd.rows[0] });
});

adminRouter.put('/courts/:id', requirePortal('admin'), requireAssignedResource('courts'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { name, name_en, court_type, sport_id, is_outdoor, is_active } = req.body;
  const cur = (await pool.query(`SELECT * FROM courts WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])).rows[0];
  if (!cur) return res.status(404).json({ error_code: 'NOT_FOUND' });

  const nextName = typeof name === 'string' && name.trim() ? name.trim() : cur.name;
  const nextI18n = {
    ...(cur.name_i18n || {}),
    vi: nextName,
    ...(typeof name_en === 'string' && name_en.trim() ? { en: name_en.trim() } : {}),
  };

  const upd = await pool.query(
    `UPDATE courts
     SET name = $1,
         name_i18n = $2,
         court_type = COALESCE($3, court_type),
         sport_id = COALESCE($4, sport_id),
         is_outdoor = COALESCE($5, is_outdoor),
         is_active = COALESCE($6, is_active)
     WHERE id = $7 AND tenant_id = $8
     RETURNING *`,
    [
      nextName,
      JSON.stringify(nextI18n),
      typeof court_type === 'string' && court_type.trim() ? court_type.trim() : null,
      sport_id || null,
      typeof is_outdoor === 'boolean' ? is_outdoor : null,
      typeof is_active === 'boolean' ? is_active : null,
      req.params.id,
      tenantId,
    ]
  );
  return res.json({ court: upd.rows[0] });
});

adminRouter.delete('/courts/:id', requirePortal('admin'), requireAssignedResource('courts'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const activeBk = await pool.query(
    `SELECT COUNT(*)::int as cnt
     FROM booking_courts bc
     JOIN bookings b ON b.id = bc.booking_id
     WHERE bc.court_id = $1 AND bc.tenant_id = $2 AND bc.active = TRUE
       AND b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
       AND bc.end_at > NOW()`,
    [req.params.id, tenantId]
  );
  if (Number(activeBk.rows[0]?.cnt || 0) > 0) {
    return res.status(409).json({
      error_code: 'COURT_HAS_UPCOMING_BOOKINGS',
      message: 'Sân đang có lịch đặt sắp diễn ra. Hãy hủy/dời lịch trước khi xóa sân.',
    });
  }
  const del = await pool.query(`DELETE FROM courts WHERE id = $1 AND tenant_id = $2 RETURNING id, name`, [req.params.id, tenantId]);
  if (!del.rows[0]) return res.status(404).json({ error_code: 'NOT_FOUND' });
  return res.json({ status: 'COURT_DELETED', deleted: del.rows[0] });
});

adminRouter.delete('/venues/:id', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  if (req.user!.role !== 'OWNER') {
    return res.status(403).json({ error_code: 'OWNER_REQUIRED', message: 'Chỉ Chủ sân (Owner) mới được xóa cơ sở.' });
  }
  const ownVenue = await pool.query('SELECT id FROM venues WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
  if (!ownVenue.rowCount) return res.status(404).json({ error_code: 'NOT_FOUND' });
  const activeBk = await pool.query(
    `SELECT COUNT(*)::int as cnt
     FROM bookings b
     JOIN booking_courts bc ON bc.booking_id = b.id AND bc.active = TRUE
     WHERE b.venue_id = $1 AND b.tenant_id = $2
       AND b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
       AND bc.end_at > NOW()`,
    [req.params.id, tenantId]
  );
  if (Number(activeBk.rows[0]?.cnt || 0) > 0) {
    return res.status(409).json({
      error_code: 'VENUE_HAS_UPCOMING_BOOKINGS',
      message: 'Cơ sở đang có lịch đặt sắp diễn ra. Hãy xử lý các lịch sắp tới trước khi xóa cơ sở.',
    });
  }
  await databaseScope.run({ service: true }, async () => {
    await pool.query(`DELETE FROM staff_venue_assignments WHERE venue_id = $1 AND EXISTS (SELECT 1 FROM venues WHERE id = $1 AND tenant_id = $2)`, [req.params.id, tenantId]);
  });
  const del = await pool.query(`DELETE FROM venues WHERE id = $1 AND tenant_id = $2 RETURNING id, name`, [req.params.id, tenantId]);
  if (!del.rows[0]) return res.status(404).json({ error_code: 'NOT_FOUND' });
  return res.json({ status: 'VENUE_DELETED', deleted: del.rows[0] });
});

/**
 * POST /api/admin/v1/blocks (Court Block with Composite Court expansion & SSE broadcast)
 */
adminRouter.post('/blocks', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const adminId = req.user!.userId;
  const role = req.user!.role;
  const { venue_id, court_id, start_at, end_at, reason = 'Bảo trì sân' } = req.body;

  if (!venue_id || !court_id || !start_at || !end_at) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  }
  const start = new Date(start_at);
  const end = new Date(end_at);
  if (!(end > start)) {
    return res.status(400).json({ error_code: 'INVALID_DURATION', message: 'Giờ kết thúc phải sau giờ bắt đầu.' });
  }

  const permittedVenues = await getAdminPermittedVenues(adminId, role, tenantId);
  if (!permittedVenues.includes(venue_id)) {
    return res.status(403).json({
      error_code: 'VENUE_ACCESS_DENIED',
      message: 'Bạn không có quyền quản lý cơ sở này.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const court = await client.query('SELECT id FROM courts WHERE id=$1 AND venue_id=$2 AND tenant_id=$3', [court_id, venue_id, tenantId]);
    if (!court.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error_code: 'INVALID_SLOT' });
    }
    const physicalCourtIds = await expandPhysicalCourts(client, court_id);

    const overlapRes = await client.query(
      `SELECT DISTINCT b.id, b.booking_code, b.status
       FROM booking_courts bc
       JOIN bookings b ON b.id = bc.booking_id
       WHERE bc.court_id = ANY($1) AND bc.active = TRUE
         AND tstzrange(bc.start_at, bc.end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [physicalCourtIds, start, end]
    );

    if (overlapRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error_code: 'BLOCK_CONFLICT_EXISTING_BOOKINGS',
        message: 'Khung giờ này đã có khách đặt (hoặc sân thành phần đã có lịch). Vui lòng dời lịch trước khi khóa sân.',
        overlapping_bookings: overlapRes.rows,
      });
    }

    const blockCode = `BLOCK-${Date.now().toString().slice(-6)}`;
    const bRes = await client.query(
      `INSERT INTO bookings (
         tenant_id, venue_id, created_by_staff_id, booking_code, type, status, notes
       ) VALUES ($1, $2, $3, $4, 'BLOCK', 'CONFIRMED', $5)
       RETURNING *`,
      [tenantId, venue_id, adminId, blockCode, reason]
    );

    for (const cid of physicalCourtIds) {
      await client.query(
        `INSERT INTO booking_courts (tenant_id, booking_id, court_id, start_at, end_at, active, is_primary)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
        [tenantId, bRes.rows[0].id, cid, start, end, cid === court_id]
      );
    }

    await client.query('COMMIT');

    for (const cid of physicalCourtIds) {
      broadcastCourtChange({
        venue_id,
        court_id: cid,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: 'BLOCKED',
        timestamp: new Date().toISOString(),
      });
    }

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: adminId,
      action: 'CREATE_COURT_BLOCK',
      targetTable: 'bookings',
      targetId: bRes.rows[0].id,
      afterState: { court_id, physicalCourtIds, start_at, end_at, reason },
      ipAddress: req.ip,
    });

    return res.status(201).json({ message: 'Khóa khung giờ sân thành công.', block: bRes.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 3. STAFF ACCOUNTS MANAGEMENT (A-06)
// ============================================================================

adminRouter.get('/staff', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    const staffRes = await pool.query(
      `SELECT s.id, s.full_name, s.username, s.phone, s.email, s.role, s.status, s.discount_limit, s.created_at,
              COALESCE(json_agg(json_build_object('venue_id', sva.venue_id, 'venue_name', v.name)) FILTER (WHERE sva.venue_id IS NOT NULL), '[]'::json) as assigned_venues
       FROM tenant_staff s
       LEFT JOIN staff_venue_assignments sva ON sva.staff_id = s.id
       LEFT JOIN venues v ON v.id = sva.venue_id
       WHERE s.tenant_id = $1 AND s.status != 'TERMINATED'
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [tenantId]
    );

    return res.json({ staff: staffRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.post('/staff', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const adminId = req.user!.userId;
  const callerRole = req.user!.role;
  const { full_name, username, phone, email, role = 'STAFF', discount_limit = 50000, venue_ids = [] } = req.body;

  if (!full_name || !username || !phone) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'full_name, username, and phone are required.' });
  }

  // Privilege escalation check: MANAGER cannot create OWNER or MANAGER
  if (callerRole !== 'OWNER' && role !== 'STAFF') {
    return res.status(403).json({ error_code: 'FORBIDDEN_ROLE', message: 'Chỉ Chủ sân mới có quyền tạo tài khoản Quản lý.' });
  }
  const safeRole = ['STAFF', 'MANAGER'].includes(role) ? role : 'STAFF';

  const tempPassword = `Pass@${crypto.randomInt(100000, 999999)}`;
  const pwdHash = await hashPassword(tempPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const newStaff = await client.query(
      `INSERT INTO tenant_staff (
         tenant_id, full_name, username, phone, email, password_hash, role, status, discount_limit
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'INVITED', $8)
       RETURNING id, full_name, username, phone, role, status`,
      [tenantId, full_name, String(username).trim().toLowerCase(), phone, email || null, pwdHash, safeRole, Number(discount_limit) || 50000]
    );
    const staffRecord = newStaff.rows[0];

    const permitted = await getAdminPermittedVenues(adminId, callerRole, tenantId);
    if (Array.isArray(venue_ids) && venue_ids.length > 0) {
      for (const vId of venue_ids) {
        if (permitted.includes(vId)) {
          await client.query(
            `INSERT INTO staff_venue_assignments (staff_id, venue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [staffRecord.id, vId]
          );
        }
      }
    }

    await client.query('COMMIT');

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: adminId,
      action: 'CREATE_STAFF_ACCOUNT',
      targetTable: 'tenant_staff',
      targetId: staffRecord.id,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message: 'Tạo tài khoản nhân viên thành công.',
      staff: staffRecord,
      temporary_password: tempPassword,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error_code: 'USERNAME_EXISTS', message: 'Tên đăng nhập đã tồn tại.' });
    }
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

adminRouter.post('/staff/:id/suspend', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const staffId = req.params.id;

  try {
    await pool.query(
      `UPDATE tenant_staff SET status = 'SUSPENDED', auth_version = auth_version + 1, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND role != 'OWNER'`,
      [staffId, tenantId]
    );
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1`, [staffId]);

    return res.json({ message: 'Đã khóa tài khoản nhân viên và thu hồi phiên làm việc.' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 4. OWNER RECEIVING BANK ACCOUNT, RECONCILIATION & REFUNDS (A-08, A-09, Mục 4)
// ============================================================================

adminRouter.get('/settings/bank-account', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const tRes = await pool.query(`SELECT bank_account_info FROM tenants WHERE id = $1`, [tenantId]);
  const info = tRes.rows[0]?.bank_account_info || {};
  return res.json({
    bank_account: {
      bank_id: info.bank_id || '',
      bank_name: info.bank_name || info.bank_id || '',
      account_number: info.account_number || '',
      account_name: info.account_name || '',
      verified_by_owner: Boolean(info.verified_by_owner),
      verified_at: info.verified_at || null,
      sandbox_mode: Boolean(info.sandbox_mode),
    },
    webhook_endpoint: `/webhooks/bank/sepay`,
    webhook_configured: Boolean(process.env.BANK_WEBHOOK_SECRET),
  });
});

adminRouter.put('/settings/bank-account', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'OWNER') {
    return res.status(403).json({
      error_code: 'OWNER_REQUIRED',
      message: 'Chỉ Chủ sân (Owner) mới được phép thay đổi tài khoản nhận tiền.',
    });
  }

  const tenantId = req.user!.tenantId!;
  const { bank_id, bank_name, account_number, account_name, verified_by_owner = false, sandbox_mode = false } = req.body;

  if (!sandbox_mode && (!bank_id || !account_number || !account_name || !verified_by_owner)) {
    return res.status(400).json({
      error_code: 'BANK_CONFIRMATION_REQUIRED',
      message: 'Vui lòng điền đủ Ngân hàng, Số tài khoản, Chủ tài khoản và tích xác nhận chính chủ (hoặc bật Chế độ thử nghiệm Sandbox).',
    });
  }

  const beforeRes = await pool.query(`SELECT bank_account_info FROM tenants WHERE id = $1`, [tenantId]);
  const payload = {
    bank_id: String(bank_id || '').trim().toUpperCase(),
    bank_name: String(bank_name || bank_id || '').trim(),
    account_number: String(account_number || '').trim(),
    account_name: String(account_name || '').trim().toUpperCase(),
    verified_by_owner: Boolean(verified_by_owner && bank_id && account_number && account_name),
    verified_at: verified_by_owner ? new Date().toISOString() : null,
    sandbox_mode: Boolean(sandbox_mode),
  };

  await pool.query(
    `UPDATE tenants SET bank_account_info = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(payload), tenantId]
  );

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: req.user!.userId,
    action: 'UPDATE_BANK_ACCOUNT',
    targetTable: 'tenants',
    targetId: tenantId,
    beforeState: beforeRes.rows[0]?.bank_account_info,
    afterState: payload,
    ipAddress: req.ip,
  });

  return res.json({
    message: payload.verified_by_owner
      ? 'Đã lưu và xác nhận tài khoản nhận tiền VietQR thật thành công!'
      : 'Đã cập nhật chế độ thanh toán thử nghiệm (Sandbox).',
    bank_account: payload,
  });
});

adminRouter.get('/reconciliation', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);
  if (permitted.length === 0) return res.json({ review_bookings: [], refunds: [], unmatched_webhooks: [] });

  try {
    const [reviewRes, refundsRes, unmatchedRes] = await Promise.all([
      pool.query(
        `SELECT b.id, b.booking_code, b.status, b.total_amount, b.deposit_amount, b.paid_amount,
                b.due_at_venue, b.payment_review_reason, b.refund_status, b.refund_amount, b.created_at,
                v.name as venue_name, c.name as court_name, bc.start_at, bc.end_at,
                COALESCE(cp.full_name, ca.username, 'Khách') as customer_name,
                COALESCE(cp.phone_e164, ca.phone_e164, '') as customer_phone
         FROM bookings b
         JOIN venues v ON v.id = b.venue_id
         JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
         JOIN courts c ON c.id = bc.court_id
         LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
         LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2)
           AND (b.payment_review_reason IS NOT NULL OR b.refund_status = 'PENDING')
         ORDER BY b.updated_at DESC LIMIT 50`,
        [tenantId, permitted]
      ),
      pool.query(
        `SELECT r.*, b.booking_code, v.name as venue_name,
                COALESCE(cp.full_name, ca.username, 'Khách') as customer_name,
                COALESCE(cp.phone_e164, ca.phone_e164, '') as customer_phone
         FROM refunds r
         JOIN bookings b ON b.id = r.booking_id
         JOIN venues v ON v.id = b.venue_id
         LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
         LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
         WHERE r.tenant_id = $1 AND b.venue_id = ANY($2)
         ORDER BY CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC
         LIMIT 50`,
        [tenantId, permitted]
      ),
      databaseScope.run({ service: true }, () =>
        pool.query(
          `SELECT id, provider, event_id, payload, status, processed_at
           FROM webhook_events
           WHERE status = 'UNMATCHED_NOTE'
           ORDER BY processed_at DESC LIMIT 20`
        )
      ),
    ]);

    return res.json({
      review_bookings: reviewRes.rows,
      refunds: refundsRes.rows,
      unmatched_webhooks: unmatchedRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.post('/refunds/:id/complete', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const adminId = req.user!.userId;
  const refundId = req.params.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(
      `SELECT * FROM refunds WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [refundId, tenantId]
    );
    if (rRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error_code: 'REFUND_NOT_FOUND' });
    }
    const refund = rRes.rows[0];
    if (refund.status === 'COMPLETED') {
      await client.query('ROLLBACK');
      return res.json({ message: 'Khoản hoàn cọc này đã được xử lý trước đó.', refund });
    }

    const upd = await client.query(
      `UPDATE refunds SET status = 'COMPLETED', approved_by_staff_id = $1 WHERE id = $2 RETURNING *`,
      [adminId, refundId]
    );

    const remainingPending = await client.query(
      `SELECT COUNT(*)::int as cnt FROM refunds WHERE booking_id = $1 AND status = 'PENDING'`,
      [refund.booking_id]
    );
    if (remainingPending.rows[0].cnt === 0) {
      await client.query(
        `UPDATE bookings SET refund_status = 'COMPLETED', payment_review_reason = NULL, updated_at = NOW() WHERE id = $1`,
        [refund.booking_id]
      );
    }

    await client.query('COMMIT');

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: adminId,
      action: 'APPROVE_REFUND',
      targetTable: 'refunds',
      targetId: refundId,
      afterState: upd.rows[0],
      ipAddress: req.ip,
    });

    return res.json({ message: 'Đã xác nhận hoàn tiền thành công.', refund: upd.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 5. ACCURATE REPORTS WITH DATE RANGE & REAL CONFIGURED OCCUPANCY (F-14)
// ============================================================================

adminRouter.get('/reports/revenue', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const role = req.user!.role;

  const todayStr = vietnamDate();
  const defaultStart = vietnamDate(new Date(Date.now() - 29 * 86400000));
  const startDate =
    typeof req.query.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start_date)
      ? req.query.start_date
      : defaultStart;
  const endDate =
    typeof req.query.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end_date)
      ? req.query.end_date
      : todayStr;

  const windowStart = new Date(`${startDate}T00:00:00+07:00`);
  const windowEnd = new Date(Date.parse(`${endDate}T00:00:00+07:00`) + 86400000);

  if (!(windowEnd > windowStart)) {
    return res.status(400).json({ error_code: 'INVALID_DATE_RANGE', message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.' });
  }

  try {
    const allPermittedVenues = await getAdminPermittedVenues(userId, role, tenantId);
    const requestedVenueId = typeof req.query.venue_id === 'string' && req.query.venue_id.trim() ? req.query.venue_id.trim() : '';
    if (requestedVenueId && !allPermittedVenues.includes(requestedVenueId)) {
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
    }
    const permittedVenues = requestedVenueId ? [requestedVenueId] : allPermittedVenues;

    if (permittedVenues.length === 0) {
      return res.json({
        period: { start_date: startDate, end_date: endDate },
        revenue: { gross_revenue_vnd: 0, refunded_vnd: 0, total_revenue_vnd: 0, transaction_count: 0 },
        deposit_total_vnd: 0,
        payment_methods: [],
        bookings_summary: [],
        occupancy_rate: 0,
        no_show_rate: 0,
        daily_series: [],
        court_performance: [],
        hourly_heatmap: [],
        kpis: { receivables_vnd: 0, avg_booking_value_vnd: 0, completion_rate: 0, cancellation_rate: 0, unique_customers: 0 },
        recent_bookings: [],
      });
    }

    const [
      revRes,
      refundSumRes,
      depositRes,
      methodRes,
      bCountRes,
      hoursRes,
      courtsByVenueRes,
      bookedClippedRes,
      noShowRes,
      recentRes,
      dailyPayRes,
      dailyRefundRes,
      dailyBookingsRes,
      courtPerfRes,
      heatmapRes,
      kpiExtraRes,
    ] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(p.amount), 0)::bigint as gross_revenue, COUNT(p.id)::int as transaction_count
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         WHERE p.tenant_id = $1 AND b.venue_id = ANY($2) AND p.status = 'CONFIRMED'
           AND p.created_at >= $3 AND p.created_at < $4`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT COALESCE(SUM(r.amount), 0)::bigint as total_refunded
         FROM refunds r
         JOIN bookings b ON b.id = r.booking_id
         WHERE r.tenant_id = $1 AND b.venue_id = ANY($2) AND r.status = 'COMPLETED'
           AND r.created_at >= $3 AND r.created_at < $4`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT COALESCE(SUM(b.paid_amount), 0)::bigint as paid_total
         FROM bookings b
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND b.type = 'NORMAL'
           AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
           AND b.created_at >= $3 AND b.created_at < $4`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT p.method, COALESCE(SUM(p.amount), 0)::bigint as amount, COUNT(p.id)::int as count
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         WHERE p.tenant_id = $1 AND b.venue_id = ANY($2) AND p.status = 'CONFIRMED'
           AND p.created_at >= $3 AND p.created_at < $4
         GROUP BY p.method`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT b.status, COUNT(b.id)::int as count
         FROM bookings b
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND b.type = 'NORMAL'
           AND b.created_at >= $3 AND b.created_at < $4
         GROUP BY b.status`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT venue_id, day_of_week,
                EXTRACT(EPOCH FROM (close_time - open_time)) / 60.0 as open_mins,
                to_char(open_time, 'HH24:MI') as open_str,
                to_char(close_time, 'HH24:MI') as close_str,
                is_closed
         FROM opening_hours
         WHERE tenant_id = $1 AND venue_id = ANY($2)`,
        [tenantId, permittedVenues]
      ),
      pool.query(
        `SELECT c.venue_id, COUNT(c.id)::int as leaf_court_count
         FROM courts c
         WHERE c.tenant_id = $1 AND c.venue_id = ANY($2) AND c.is_active = TRUE
           AND NOT EXISTS (SELECT 1 FROM court_links cl WHERE cl.parent_court_id = c.id)
         GROUP BY c.venue_id`,
        [tenantId, permittedVenues]
      ),
      pool.query(
        `SELECT COALESCE(SUM(
           GREATEST(0, EXTRACT(EPOCH FROM (LEAST(bc.end_at, $4::timestamptz) - GREATEST(bc.start_at, $3::timestamptz))) / 60.0)
         ), 0) as booked_minutes
         FROM booking_courts bc
         JOIN bookings b ON b.id = bc.booking_id
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND bc.active = TRUE
           AND b.type = 'NORMAL'
           AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
           AND NOT EXISTS (SELECT 1 FROM court_links cl WHERE cl.parent_court_id = bc.court_id)
           AND bc.start_at < $4 AND bc.end_at > $3`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int as no_shows,
           COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'CHECKED_IN', 'NO_SHOW'))::int as total_resolved
         FROM bookings
         WHERE tenant_id = $1 AND venue_id = ANY($2) AND type = 'NORMAL'
           AND created_at >= $3 AND created_at < $4`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT b.id, b.booking_code, b.status, b.total_amount, b.deposit_amount, b.paid_amount, b.due_at_venue, b.created_at,
                c.name as court_name, v.name as venue_name,
                bc.start_at, bc.end_at,
                COALESCE(ca.full_name, cp.full_name, ca.username, 'Khách tại quầy') as customer_name
         FROM bookings b
         JOIN venues v ON v.id = b.venue_id
         JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
         JOIN courts c ON c.id = bc.court_id
         LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
         LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND b.type = 'NORMAL'
         ORDER BY b.created_at DESC LIMIT 15`,
        [tenantId, permittedVenues]
      ),
      pool.query(
        `SELECT to_char(p.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as day,
                COALESCE(SUM(p.amount), 0)::bigint as gross_vnd
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         WHERE p.tenant_id = $1 AND b.venue_id = ANY($2) AND p.status = 'CONFIRMED'
           AND p.created_at >= $3 AND p.created_at < $4
         GROUP BY 1`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT to_char(r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as day,
                COALESCE(SUM(r.amount), 0)::bigint as refunded_vnd
         FROM refunds r
         JOIN bookings b ON b.id = r.booking_id
         WHERE r.tenant_id = $1 AND b.venue_id = ANY($2) AND r.status = 'COMPLETED'
           AND r.created_at >= $3 AND r.created_at < $4
         GROUP BY 1`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT to_char(bc.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as day,
                COUNT(DISTINCT b.id)::int as booking_count,
                COALESCE(SUM(EXTRACT(EPOCH FROM (bc.end_at - bc.start_at)) / 60.0), 0) as booked_mins
         FROM booking_courts bc
         JOIN bookings b ON b.id = bc.booking_id
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND bc.is_primary = TRUE
           AND b.type = 'NORMAL' AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
           AND bc.start_at >= $3 AND bc.start_at < $4
         GROUP BY 1`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT c.id as court_id, c.name as court_name, c.court_type, v.name as venue_name,
                COUNT(b.id) FILTER (WHERE b.id IS NOT NULL)::int as booking_count,
                COALESCE(SUM(EXTRACT(EPOCH FROM (bc.end_at - bc.start_at)) / 3600.0) FILTER (WHERE b.id IS NOT NULL), 0) as booked_hours,
                COALESCE(SUM(b.paid_amount) FILTER (WHERE b.id IS NOT NULL), 0)::bigint as revenue_vnd
         FROM courts c
         JOIN venues v ON v.id = c.venue_id
         LEFT JOIN booking_courts bc ON bc.court_id = c.id AND bc.is_primary = TRUE AND bc.start_at >= $3 AND bc.start_at < $4
         LEFT JOIN bookings b ON b.id = bc.booking_id AND b.type = 'NORMAL' AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
         WHERE c.tenant_id = $1 AND c.venue_id = ANY($2) AND c.is_active = TRUE
         GROUP BY c.id, c.name, c.court_type, v.name
         ORDER BY revenue_vnd DESC, c.name ASC`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT EXTRACT(DOW FROM (bc.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int as dow,
                EXTRACT(HOUR FROM (bc.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int as hr,
                COUNT(DISTINCT b.id)::int as booking_count,
                COALESCE(SUM(EXTRACT(EPOCH FROM (bc.end_at - bc.start_at)) / 60.0), 0) as booked_mins
         FROM booking_courts bc
         JOIN bookings b ON b.id = bc.booking_id
         WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND bc.active = TRUE
           AND b.type = 'NORMAL' AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
           AND NOT EXISTS (SELECT 1 FROM court_links cl WHERE cl.parent_court_id = bc.court_id)
           AND bc.start_at >= $3 AND bc.start_at < $4
         GROUP BY 1, 2`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(due_at_venue) FILTER (WHERE status IN ('CONFIRMED', 'CHECKED_IN')), 0)::bigint as receivables_vnd,
           COALESCE(ROUND(AVG(total_amount) FILTER (WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED'))), 0)::bigint as avg_booking_value_vnd,
           COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed_cnt,
           COUNT(*) FILTER (WHERE status = 'CANCELLED')::int as cancelled_cnt,
           COUNT(*)::int as all_cnt,
           COUNT(DISTINCT COALESCE(customer_id::text, profile_id::text))::int as unique_customers
         FROM bookings
         WHERE tenant_id = $1 AND venue_id = ANY($2) AND type = 'NORMAL'
           AND created_at >= $3 AND created_at < $4`,
        [tenantId, permittedVenues, windowStart, windowEnd]
      ),
    ]);

    const leafMap = new Map<string, number>();
    for (const r of courtsByVenueRes.rows) leafMap.set(r.venue_id, Number(r.leaf_court_count || 0));

    const openMap = new Map<string, number>();
    for (const h of hoursRes.rows) {
      if (!h.is_closed && Number(h.open_mins) > 0) {
        openMap.set(`${h.venue_id}:${h.day_of_week}`, Number(h.open_mins));
      }
    }

    let totalAvailableMinutes = 0;
    const dowOccurrences = [0, 0, 0, 0, 0, 0, 0];
    const payByDay = new Map<string, number>();
    for (const row of dailyPayRes.rows) payByDay.set(row.day, Number(row.gross_vnd || 0));
    const refByDay = new Map<string, number>();
    for (const row of dailyRefundRes.rows) refByDay.set(row.day, Number(row.refunded_vnd || 0));
    const bkByDay = new Map<string, { cnt: number; mins: number }>();
    for (const row of dailyBookingsRes.rows) {
      bkByDay.set(row.day, { cnt: Number(row.booking_count || 0), mins: Math.round(Number(row.booked_mins || 0)) });
    }

    const dailySeries: Array<{
      date: string;
      gross_revenue_vnd: number;
      refunded_vnd: number;
      net_revenue_vnd: number;
      booking_count: number;
      booked_minutes: number;
    }> = [];

    const maxSeriesDays = 90;
    let daySteps = 0;
    for (let ts = windowStart.getTime(); ts < windowEnd.getTime(); ts += 86400000) {
      const dow = new Date(ts + 12 * 3600000).getUTCDay();
      dowOccurrences[dow] += 1;
      for (const vid of permittedVenues) {
        const openMins = openMap.get(`${vid}:${dow}`) || 0;
        const leafCount = leafMap.get(vid) || 0;
        totalAvailableMinutes += openMins * leafCount;
      }
      if (daySteps < maxSeriesDays) {
        const dKey = vietnamDate(new Date(ts + 12 * 3600000));
        const g = payByDay.get(dKey) || 0;
        const rf = refByDay.get(dKey) || 0;
        const bk = bkByDay.get(dKey) || { cnt: 0, mins: 0 };
        dailySeries.push({
          date: dKey,
          gross_revenue_vnd: g,
          refunded_vnd: rf,
          net_revenue_vnd: Math.max(0, g - rf),
          booking_count: bk.cnt,
          booked_minutes: bk.mins,
        });
      }
      daySteps += 1;
    }

    const totalLeafCourts = Array.from(leafMap.values()).reduce((a, b) => a + b, 0);
    const bands = [
      { id: '06-09', label: '06:00–09:00', startHr: 6, endHr: 9, hours: 3 },
      { id: '09-14', label: '09:00–14:00', startHr: 9, endHr: 14, hours: 5 },
      { id: '14-17', label: '14:00–17:00', startHr: 14, endHr: 17, hours: 3 },
      { id: '17-21', label: '17:00–21:00', startHr: 17, endHr: 21, hours: 4 },
      { id: '21-23', label: '21:00–23:00', startHr: 21, endHr: 23, hours: 2 },
    ];

    const hourlyHeatmap = bands.map((band) => {
      const days = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
        const matchingRows = heatmapRes.rows.filter(
          (r: any) => Number(r.dow) === dow && Number(r.hr) >= band.startHr && Number(r.hr) < band.endHr
        );
        const bookedMins = matchingRows.reduce((s: number, r: any) => s + Number(r.booked_mins || 0), 0);
        const bookingsCnt = matchingRows.reduce((s: number, r: any) => s + Number(r.booking_count || 0), 0);
        const capMins = Math.max(0, dowOccurrences[dow] * band.hours * 60 * totalLeafCourts);
        const pct = capMins > 0 ? Math.min(100, Math.round((bookedMins / capMins) * 100)) : 0;
        return { dow, occupancy_pct: pct, booking_count: bookingsCnt };
      });
      return { band_id: band.id, label: band.label, days };
    });

    const bookedMinutes = parseFloat(bookedClippedRes.rows[0]?.booked_minutes || 0);
    const occupancyRate =
      totalAvailableMinutes > 0
        ? Math.min(100, Math.round((bookedMinutes / totalAvailableMinutes) * 1000) / 10)
        : 0;

    const noShows = Number(noShowRes.rows[0]?.no_shows || 0);
    const totalResolved = Number(noShowRes.rows[0]?.total_resolved || 0);
    const noShowRate = totalResolved > 0 ? Math.round((noShows / totalResolved) * 1000) / 10 : 0;

    const grossRev = Number(revRes.rows[0]?.gross_revenue || 0);
    const refundedVnd = Number(refundSumRes.rows[0]?.total_refunded || 0);
    const netRev = Math.max(0, grossRev - refundedVnd);

    const methodsWithPct = methodRes.rows.map((m: any) => ({
      method: m.method,
      amount: Number(m.amount),
      count: Number(m.count),
      percentage: grossRev > 0 ? Math.round((Number(m.amount) / grossRev) * 100) : 0,
    }));

    const kpiRow = kpiExtraRes.rows[0] || {};
    const allCnt = Number(kpiRow.all_cnt || 0);
    const completionRate = allCnt > 0 ? Math.round((Number(kpiRow.completed_cnt || 0) / allCnt) * 1000) / 10 : 0;
    const cancellationRate = allCnt > 0 ? Math.round((Number(kpiRow.cancelled_cnt || 0) / allCnt) * 1000) / 10 : 0;

    return res.json({
      period: { start_date: startDate, end_date: endDate },
      revenue: {
        gross_revenue_vnd: grossRev,
        refunded_vnd: refundedVnd,
        total_revenue_vnd: netRev,
        transaction_count: Number(revRes.rows[0]?.transaction_count || 0),
      },
      deposit_total_vnd: Number(depositRes.rows[0]?.paid_total || 0),
      payment_methods: methodsWithPct,
      bookings_summary: bCountRes.rows,
      occupancy_rate: occupancyRate,
      booked_minutes: Math.round(bookedMinutes),
      available_minutes: Math.round(totalAvailableMinutes),
      no_show_rate: noShowRate,
      daily_series: dailySeries,
      court_performance: courtPerfRes.rows.map((r: any) => ({
        court_id: r.court_id,
        court_name: r.court_name,
        court_type: r.court_type,
        venue_name: r.venue_name,
        booking_count: Number(r.booking_count || 0),
        booked_hours: Math.round(Number(r.booked_hours || 0) * 10) / 10,
        revenue_vnd: Number(r.revenue_vnd || 0),
      })),
      hourly_heatmap: hourlyHeatmap,
      kpis: {
        receivables_vnd: Number(kpiRow.receivables_vnd || 0),
        avg_booking_value_vnd: Number(kpiRow.avg_booking_value_vnd || 0),
        completion_rate: completionRate,
        cancellation_rate: cancellationRate,
        unique_customers: Number(kpiRow.unique_customers || 0),
      },
      recent_bookings: recentRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.get('/audit-logs', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  try {
    const logsRes = await pool.query(
      `SELECT id, actor_portal, actor_id, action, target_table, target_id, ip_address, created_at
       FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 60`,
      [tenantId]
    );
    return res.json({ logs: logsRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/admin/v1/uploads
 * Optimizes uploaded photo to WebP AND persists cover_photo_url onto the selected venue (A-01, F-12)!
 */
adminRouter.post(
  '/uploads',
  requirePortal('admin'),
  uploadRateLimiter,
  uploadMiddleware.array('photos', 10),
  async (req: AuthenticatedRequest, res: Response) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error_code: 'NO_FILES_UPLOADED', message: 'Vui lòng chọn ít nhất 1 ảnh để tải lên.' });
    }

    const tenantId = req.user!.tenantId!;
    const venueId = typeof req.body?.venue_id === 'string' ? req.body.venue_id : '';

    try {
      if (venueId) {
        const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);
        if (!permitted.includes(venueId)) {
          return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
        }
      }

      const results = [];
      for (const file of files) {
        const processed = await optimizeAndSaveImage(file.buffer, file.originalname);
        results.push(processed);
      }

      // Persist multi-photo gallery & cover photo URL onto venue so Customer Discovery loops owner photos!
      let updatedCover: string | null = null;
      let updatedPhotos: string[] = [];
      if (venueId && results.length > 0) {
        const baseUrl = process.env.PUBLIC_API_URL || 'http://localhost:4000';
        const newUrls = results.map((r) => `${baseUrl}${r.url}`);
        const setAsCover = req.body?.set_as_cover === 'true' || req.body?.set_as_cover === true;

        const curRes = await pool.query(
          `SELECT cover_photo_url, photos FROM venues WHERE id = $1 AND tenant_id = $2`,
          [venueId, tenantId]
        );
        const existingPhotos: string[] = Array.isArray(curRes.rows[0]?.photos) ? curRes.rows[0].photos : [];
        const combined = setAsCover ? [...newUrls, ...existingPhotos] : [...existingPhotos, ...newUrls];
        updatedPhotos = Array.from(new Set(combined.filter((u) => typeof u === 'string' && u.trim().length > 0)));
        updatedCover = setAsCover || !curRes.rows[0]?.cover_photo_url ? newUrls[0] : curRes.rows[0].cover_photo_url;

        await pool.query(
          `UPDATE venues
           SET cover_photo_url = $1,
               photos = $2::jsonb,
               updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [updatedCover, JSON.stringify(updatedPhotos), venueId, tenantId]
        );
      }

      await recordAuditLog({
        tenantId,
        actorPortal: 'admin',
        actorId: req.user!.userId,
        action: 'UPLOAD_PHOTOS',
        targetTable: 'venues',
        targetId: venueId || undefined,
        afterState: { count: results.length, files: results.map((r) => r.filename) },
        ipAddress: req.ip,
      });

      return res.status(201).json({
        message: `Đã xử lý nén chuẩn WebP và cập nhật thư viện ảnh cơ sở thành công (+${results.length} ảnh).`,
        photos: results,
        cover_photo_url: updatedCover,
        venue_photos: updatedPhotos,
      });
    } catch (err: any) {
      if (err.message === 'SYSTEM_OVERLOADED') {
        return res.status(503).json({
          error_code: 'SYSTEM_OVERLOADED',
          message: 'Hệ thống đang quá tải xử lý ảnh. Vui lòng thử lại sau ít phút.',
        });
      }
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    }
  },
  handleUploadErrors
);

adminRouter.put('/venues/:id/photos', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const venueId = req.params.id;
  const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) {
    return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
  }

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

  const upd = await pool.query(
    `UPDATE venues
     SET cover_photo_url = $1,
         photos = $2::jsonb,
         updated_at = NOW()
     WHERE id = $3 AND tenant_id = $4
     RETURNING id, name, cover_photo_url, photos`,
    [requestedCover, JSON.stringify(ordered), venueId, tenantId]
  );
  if (!upd.rows[0]) return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });

  return res.json({
    message: 'Đã cập nhật thứ tự và thư viện ảnh cơ sở.',
    venue: upd.rows[0],
  });
});

// ============================================================================
// 8. C-18 VENUE REVIEWS MODERATION & OWNER REPLIES
// ============================================================================

adminRouter.get('/reviews', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);
  if (permitted.length === 0) {
    return res.json({
      stats: { total_count: 0, visible_count: 0, hidden_count: 0, avg_rating: null },
      reviews: [],
    });
  }

  const venueFilter = typeof req.query.venue_id === 'string' && req.query.venue_id.trim() ? req.query.venue_id.trim() : '';
  const visibility = typeof req.query.visibility === 'string' ? req.query.visibility : 'all';

  const targetVenues = venueFilter
    ? permitted.filter((id) => id === venueFilter)
    : permitted;

  if (targetVenues.length === 0) {
    return res.json({
      stats: { total_count: 0, visible_count: 0, hidden_count: 0, avg_rating: null },
      reviews: [],
    });
  }

  try {
    const visSql =
      visibility === 'visible'
        ? 'AND vr.is_visible = TRUE'
        : visibility === 'hidden'
          ? 'AND vr.is_visible = FALSE'
          : '';

    const [statsRes, listRes] = await databaseScope.run({ service: true }, () =>
      Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int as total_count,
             COUNT(*) FILTER (WHERE is_visible = TRUE)::int as visible_count,
             COUNT(*) FILTER (WHERE is_visible = FALSE)::int as hidden_count,
             ROUND(AVG(rating) FILTER (WHERE is_visible = TRUE)::numeric, 1) as avg_rating
           FROM venue_reviews
           WHERE tenant_id = $1 AND venue_id = ANY($2)`,
          [tenantId, targetVenues]
        ),
        pool.query(
          `SELECT vr.id, vr.venue_id, v.name as venue_name, vr.booking_id, b.booking_code,
                  vr.customer_id, vr.rating, vr.comment, vr.is_visible,
                  vr.owner_reply, vr.replied_at, vr.created_at, vr.updated_at,
                  COALESCE(NULLIF(ca.full_name, ''), ca.username, vr.reviewer_name, 'Khách đặt sân') as author_name,
                  ca.avatar_url as author_avatar
           FROM venue_reviews vr
           JOIN venues v ON v.id = vr.venue_id
           LEFT JOIN bookings b ON b.id = vr.booking_id
           LEFT JOIN customer_accounts ca ON ca.id = vr.customer_id
           WHERE vr.tenant_id = $1 AND vr.venue_id = ANY($2) ${visSql}
           ORDER BY vr.created_at DESC
           LIMIT 100`,
          [tenantId, targetVenues]
        ),
      ])
    );

    const st = statsRes.rows[0] || {};
    return res.json({
      stats: {
        total_count: Number(st.total_count || 0),
        visible_count: Number(st.visible_count || 0),
        hidden_count: Number(st.hidden_count || 0),
        avg_rating: st.avg_rating ? Number(st.avg_rating) : null,
      },
      reviews: listRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.patch('/reviews/:id', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const reviewId = req.params.id;
  const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);

  try {
    const curRes = await pool.query(
      `SELECT * FROM venue_reviews WHERE id = $1 AND tenant_id = $2`,
      [reviewId, tenantId]
    );
    const cur = curRes.rows[0];
    if (!cur) return res.status(404).json({ error_code: 'REVIEW_NOT_FOUND' });
    if (!permitted.includes(cur.venue_id)) {
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
    }

    const nextVisible = typeof req.body?.is_visible === 'boolean' ? req.body.is_visible : cur.is_visible;
    const hasReplyField = Object.prototype.hasOwnProperty.call(req.body || {}, 'owner_reply');
    const nextReply = hasReplyField
      ? String(req.body.owner_reply || '').trim().slice(0, 1000) || null
      : cur.owner_reply;
    const nextRepliedAt = hasReplyField
      ? nextReply
        ? new Date()
        : null
      : cur.replied_at;

    const upd = await pool.query(
      `UPDATE venue_reviews
       SET is_visible = $1,
           owner_reply = $2,
           replied_at = $3,
           updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [nextVisible, nextReply, nextRepliedAt, reviewId, tenantId]
    );

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: req.user!.userId,
      action: 'MODERATE_VENUE_REVIEW',
      targetTable: 'venue_reviews',
      targetId: reviewId,
      beforeState: { is_visible: cur.is_visible, owner_reply: cur.owner_reply },
      afterState: { is_visible: nextVisible, owner_reply: nextReply },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Đã cập nhật trạng thái đánh giá thành công.',
      review: upd.rows[0],
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminRouter.delete('/reviews/:id', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const reviewId = req.params.id;
  const permitted = await getAdminPermittedVenues(req.user!.userId, req.user!.role, tenantId);

  try {
    const curRes = await pool.query(
      `SELECT * FROM venue_reviews WHERE id = $1 AND tenant_id = $2`,
      [reviewId, tenantId]
    );
    const cur = curRes.rows[0];
    if (!cur) return res.status(404).json({ error_code: 'REVIEW_NOT_FOUND' });
    if (!permitted.includes(cur.venue_id)) {
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
    }

    await pool.query(`DELETE FROM venue_reviews WHERE id = $1 AND tenant_id = $2`, [reviewId, tenantId]);

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: req.user!.userId,
      action: 'DELETE_VENUE_REVIEW',
      targetTable: 'venue_reviews',
      targetId: reviewId,
      beforeState: cur,
      ipAddress: req.ip,
    });

    return res.json({ status: 'REVIEW_DELETED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});
