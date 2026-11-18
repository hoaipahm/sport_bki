import { Router, Response } from 'express';
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'crypto';
import { pool, withTransaction } from '../../config/database';
import { databaseScope } from '../../config/database-scope';
import {
  normalizeEmail,
  normalizePhoneNumber,
  hashPassword,
  comparePassword,
  generateNumericOtp,
  hashOtp,
  generateBookingCode,
  signAccessToken,
} from '../../common/jwt';
import {
  AuthenticatedRequest,
  requirePortal,
  sendTranslatedError,
} from '../../common/auth.guard';
import { recordAuditLog } from '../../common/audit';
import { generateBookingIcs } from '../../common/ics';
import { broadcastCourtChange, attachSseStream } from '../../common/realtime';
import { authRateLimiter, uploadRateLimiter } from '../../common/security';
import { avatarUploadMiddleware, optimizeAvatarImage, handleUploadErrors } from '../../common/uploader';
import { withIdempotency } from '../../common/idempotency';
import { isSmtpConfigured, dispatchQueuedEmail } from '../../common/email.service';
import { t } from '../../../../shared/i18n';
import { vietnamDate, calculateRefundPolicy } from '../../../../shared/booking';
import { customerAuthRouter } from './auth.routes';
import { customerExtensionsRouter } from './customer.extensions.routes';
import {
  BookingDomainError,
  buildPaymentDescriptor,
  validateAndQuoteSlot,
  reservePhysicalCourtRows,
  formatVnSlotRange,
  processBankPaymentEvent,
} from '../booking/booking.service';

export const customerRouter = Router();
customerRouter.use(customerAuthRouter);
customerRouter.use(customerExtensionsRouter);

// ============================================================================
// 1. LOGIN & PROFILE (Section 16 & Section 24.1)
// ============================================================================

customerRouter.post('/auth/login', authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return sendTranslatedError(req, res, 400, 'INVALID_CREDENTIALS');
  }

  const cleanIdent = String(identifier).trim().toLowerCase();
  const normEmail = normalizeEmail(String(identifier));
  const normPhone = normalizePhoneNumber(String(identifier));

  try {
    const userRes = await pool.query(
      `SELECT id, username, full_name, email, phone_e164, avatar_url, password_hash, status, failed_login_count, locked_until, preferred_language, auth_version, created_at
       FROM customer_accounts
       WHERE (LOWER(username) = $1 OR email_normalized = $2 OR phone_e164 = $3)
         AND status != 'DELETED'`,
      [cleanIdent, normEmail, normPhone]
    );

    if (userRes.rows.length === 0) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const user = userRes.rows[0];

    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      return sendTranslatedError(req, res, 403, 'ACCOUNT_LOCKED');
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      const fails = user.failed_login_count + 1;
      const lockUntil = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await pool.query(
        `UPDATE customer_accounts SET failed_login_count = $1, locked_until = $2 WHERE id = $3`,
        [fails, lockUntil, user.id]
      );
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    if (user.status === 'PENDING_VERIFICATION') {
      return res.status(403).json({
        error_code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        message: t('errors.EMAIL_NOT_VERIFIED', req.lang || 'vi'),
      });
    }
    if (user.status !== 'ACTIVE') {
      return sendTranslatedError(req, res, 403, 'ACCOUNT_NOT_ACTIVE');
    }

    await pool.query(
      `UPDATE customer_accounts SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
      [user.id]
    );

    const token = signAccessToken({
      userId: user.id,
      portal: 'customer',
      sessionVersion: user.auth_version,
      preferredLanguage: user.preferred_language,
    });

    const rawRefresh = randomBytes(40).toString('hex');
    const refreshHash = createHash('sha256').update(rawRefresh).digest('hex');
    const deviceInfo = String(req.headers['user-agent'] || 'Web Browser').slice(0, 240);
    await pool.query(
      `INSERT INTO refresh_tokens (portal, user_id, token_hash, device_info, ip_address, expires_at)
       VALUES ('customer', $1, $2, $3, $4, NOW() + INTERVAL '30 days')`,
      [user.id, refreshHash, deviceInfo, String(req.ip || '').slice(0, 48)]
    );

    return res.json({
      access_token: token,
      refresh_token: rawRefresh,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name || null,
        email: user.email,
        phone_e164: user.phone_e164 || null,
        avatar_url: user.avatar_url || null,
        preferred_language: user.preferred_language,
        created_at: user.created_at,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.get('/me', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [userRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT id, username, full_name, email, email_verified_at, phone_e164, avatar_url, status, preferred_language, terms_version, created_at
         FROM customer_accounts WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN'))::int as upcoming_count,
           COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed_count,
           COUNT(*) FILTER (WHERE status = 'CANCELLED')::int as cancelled_count,
           COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int as no_show_count
         FROM bookings WHERE customer_id = $1 AND type = 'NORMAL'`,
        [userId]
      ),
    ]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    }
    return res.json({
      profile: userRes.rows[0],
      stats: statsRes.rows[0] || { upcoming_count: 0, completed_count: 0, cancelled_count: 0, no_show_count: 0 },
      role_summary: {
        portal: 'customer',
        role: 'CUSTOMER',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.patch('/me', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { full_name, phone, preferred_language } = req.body;

  try {
    const existingRes = await pool.query(
      `SELECT id, username, full_name, email, phone_e164, avatar_url, preferred_language, created_at
       FROM customer_accounts WHERE id = $1`,
      [userId]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    }
    const current = existingRes.rows[0];

    let nextFullName: string | null = current.full_name;
    if (typeof full_name === 'string') {
      const trimmed = full_name.trim();
      if (trimmed.length > 120) {
        return sendTranslatedError(req, res, 400, 'INVALID_REGISTRATION');
      }
      nextFullName = trimmed.length > 0 ? trimmed : null;
    }

    let nextPhone: string = current.phone_e164;
    if (typeof phone === 'string' && phone.trim().length > 0) {
      if (!/^(?:0|\+?84)[35789]\d{8}$/.test(phone.trim())) {
        return sendTranslatedError(req, res, 400, 'INVALID_REGISTRATION');
      }
      nextPhone = normalizePhoneNumber(phone.trim());
    }

    let nextLang: string = current.preferred_language;
    if (preferred_language !== undefined) {
      if (!['vi', 'en'].includes(preferred_language)) {
        return res.status(400).json({ error_code: 'INVALID_LANGUAGE', message: 'Language must be vi or en.' });
      }
      nextLang = preferred_language;
    }

    const upd = await pool.query(
      `UPDATE customer_accounts
       SET full_name = $1, phone_e164 = $2, preferred_language = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, username, full_name, email, email_verified_at, phone_e164, avatar_url, status, preferred_language, created_at`,
      [nextFullName, nextPhone, nextLang, userId]
    );

    await pool.query(
      `UPDATE customer_profiles
       SET full_name = COALESCE($1, full_name), phone_e164 = $2, language = $3
       WHERE account_id = $4`,
      [nextFullName, nextPhone, nextLang, userId]
    );

    return res.json({ profile: upd.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return sendTranslatedError(req, res, 409, 'ACCOUNT_EXISTS');
    }
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.post(
  '/me/avatar',
  requirePortal('customer'),
  uploadRateLimiter,
  avatarUploadMiddleware.single('avatar'),
  async (req: AuthenticatedRequest, res: Response) => {
    const file = req.file;
    if (!file) {
      return sendTranslatedError(req, res, 400, 'MISSING_FIELDS');
    }
    const userId = req.user!.userId;
    try {
      const processed = await optimizeAvatarImage(file.buffer, file.originalname);
      const baseUrl = process.env.PUBLIC_API_URL || 'http://localhost:4000';
      const avatarUrl = `${baseUrl}${processed.url}`;

      const upd = await pool.query(
        `UPDATE customer_accounts
         SET avatar_url = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, username, full_name, email, phone_e164, avatar_url, preferred_language, created_at`,
        [avatarUrl, userId]
      );

      return res.status(201).json({ avatar_url: avatarUrl, profile: upd.rows[0], compression: processed.saved_percent });
    } catch (err: any) {
      if (err.message === 'SYSTEM_OVERLOADED') {
        return res.status(503).json({ error_code: 'SYSTEM_OVERLOADED', message: 'Image optimizer busy.' });
      }
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    }
  },
  handleUploadErrors
);

customerRouter.post('/me/email/request-change', requirePortal('customer'), authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { new_email, current_password } = req.body;
  if (typeof new_email !== 'string' || typeof current_password !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email.trim())) {
    return sendTranslatedError(req, res, 400, 'INVALID_REGISTRATION');
  }

  const cleanEmail = new_email.trim();
  const normEmail = normalizeEmail(cleanEmail);
  const isLocalTestMode = !isSmtpConfigured() || process.env.AUTH_EMAIL_MODE === 'local';
  if (!isSmtpConfigured() && process.env.NODE_ENV === 'production' && process.env.AUTH_EMAIL_MODE !== 'local') {
    return sendTranslatedError(req, res, 503, 'EMAIL_UNAVAILABLE');
  }

  try {
    const result = await withTransaction(null, async (client) => {
      const accRes = await client.query(`SELECT * FROM customer_accounts WHERE id = $1 FOR UPDATE`, [userId]);
      const user = accRes.rows[0];
      if (!user) return { status: 404, code: 'USER_NOT_FOUND' };

      const okPwd = await comparePassword(current_password, user.password_hash);
      if (!okPwd) return { status: 401, code: 'INVALID_CREDENTIALS' };

      if (user.email_normalized === normEmail) {
        return { status: 409, code: 'ACCOUNT_EXISTS' };
      }

      const dupRes = await client.query(
        `SELECT id FROM customer_accounts WHERE email_normalized = $1 AND id != $2 AND status != 'DELETED'`,
        [normEmail, userId]
      );
      if (dupRes.rows.length > 0) {
        return { status: 409, code: 'ACCOUNT_EXISTS' };
      }

      const recent = await client.query(
        `SELECT count(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS hourly,
                max(created_at) AS latest
         FROM otp_codes WHERE user_id = $1 AND purpose = 'CHANGE_EMAIL' AND created_at > NOW() - INTERVAL '1 day'`,
        [userId]
      );
      const quota = recent.rows[0];
      if (quota.latest && Date.now() - new Date(quota.latest).getTime() < 60000) {
        return { status: 429, code: 'OTP_WAIT_RESEND' };
      }
      if (quota.hourly >= 5) {
        return { status: 429, code: 'OTP_QUOTA' };
      }

      await client.query(`UPDATE otp_codes SET used_at = NOW() WHERE user_id = $1 AND purpose = 'CHANGE_EMAIL' AND used_at IS NULL`, [userId]);
      const code = generateNumericOtp();
      const expires = new Date(Date.now() + 600000);
      await client.query(
        `INSERT INTO otp_codes (target_identifier, user_id, purpose, code_hash, expires_at)
         VALUES ($1, $2, 'CHANGE_EMAIL', $3, $4)`,
        [normEmail, userId, hashOtp(code), expires]
      );

      if (!isLocalTestMode) {
        const outboxRes = await client.query(
          `INSERT INTO email_outbox (recipient, template_type, language, reference_id, template_data, dedup_key)
           VALUES ($1, 'REGISTER_OTP', $2, $3, $4, $5) RETURNING id`,
          [cleanEmail, user.preferred_language || 'vi', userId, JSON.stringify({ otp: code, username: user.username }), randomBytes(16).toString('hex')]
        );
        const outboxId = outboxRes.rows[0]?.id;
        if (outboxId) {
          setImmediate(() => {
            dispatchQueuedEmail(outboxId).catch(() => {});
          });
        }
      }

      return {
        ok: true,
        payload: {
          delivery_mode: isLocalTestMode ? 'test_mode' : 'smtp',
          is_test_mode: isLocalTestMode,
          new_email: cleanEmail,
          expires_at: expires.toISOString(),
          retry_after_seconds: 60,
          ...(isLocalTestMode ? { local_code: code } : {}),
        },
      };
    });

    if ('code' in result && result.code) {
      return sendTranslatedError(req, res, result.status, result.code);
    }
    return res.json((result as any).payload);
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.post('/me/email/confirm-change', requirePortal('customer'), authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { new_email, otp } = req.body;
  if (typeof new_email !== 'string' || typeof otp !== 'string') {
    return sendTranslatedError(req, res, 400, 'OTP_INVALID');
  }
  const cleanEmail = new_email.trim();
  const normEmail = normalizeEmail(cleanEmail);

  try {
    const outcome = await withTransaction(null, async (client) => {
      const userRes = await client.query(`SELECT * FROM customer_accounts WHERE id = $1 FOR UPDATE`, [userId]);
      const user = userRes.rows[0];
      if (!user) return { status: 404, code: 'USER_NOT_FOUND' };

      const found = await client.query(
        `SELECT * FROM otp_codes
         WHERE user_id = $1 AND purpose = 'CHANGE_EMAIL' AND target_identifier = $2 AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [userId, normEmail]
      );
      const otpRow = found.rows[0];
      if (!otpRow || new Date(otpRow.expires_at).getTime() <= Date.now()) {
        return { status: 400, code: 'OTP_INVALID' };
      }
      if (otpRow.attempts >= 5) {
        return { status: 429, code: 'OTP_MAX_ATTEMPTS' };
      }

      const actual = Buffer.from(hashOtp(otp.trim()));
      const expected = Buffer.from(otpRow.code_hash);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await client.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otpRow.id]);
        return { status: otpRow.attempts + 1 >= 5 ? 429 : 400, code: otpRow.attempts + 1 >= 5 ? 'OTP_MAX_ATTEMPTS' : 'OTP_INVALID' };
      }

      await client.query(`UPDATE otp_codes SET used_at = NOW() WHERE id = $1`, [otpRow.id]);
      const upd = await client.query(
        `UPDATE customer_accounts
         SET email = $1, email_normalized = $2, email_verified_at = NOW(), auth_version = auth_version + 1, updated_at = NOW()
         WHERE id = $3
         RETURNING id, username, full_name, email, phone_e164, avatar_url, preferred_language, auth_version, created_at`,
        [cleanEmail, normEmail, userId]
      );

      await client.query(`UPDATE customer_profiles SET email = $1 WHERE account_id = $2`, [cleanEmail, userId]);

      const updatedUser = upd.rows[0];
      const freshToken = signAccessToken({
        userId: updatedUser.id,
        portal: 'customer',
        sessionVersion: updatedUser.auth_version,
        preferredLanguage: updatedUser.preferred_language,
      });

      return { ok: true, access_token: freshToken, profile: updatedUser };
    });

    if ('code' in outcome && outcome.code) {
      return sendTranslatedError(req, res, outcome.status, outcome.code);
    }

    await recordAuditLog({
      tenantId: null,
      actorPortal: 'customer',
      actorId: userId,
      action: 'CHANGE_CUSTOMER_EMAIL',
      targetTable: 'customer_accounts',
      targetId: userId,
      afterState: { email: cleanEmail },
      ipAddress: req.ip,
    });

    return res.json({
      access_token: (outcome as any).access_token,
      profile: (outcome as any).profile,
    });
  } catch (err: any) {
    if (err.code === '23505') return sendTranslatedError(req, res, 409, 'ACCOUNT_EXISTS');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.post('/me/password', requirePortal('customer'), authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { current_password, new_password, confirm_password } = req.body;
  if (
    typeof current_password !== 'string' ||
    typeof new_password !== 'string' ||
    new_password.length < 8 ||
    new_password.length > 128 ||
    new_password !== confirm_password
  ) {
    return sendTranslatedError(req, res, 400, 'PASSWORD_INVALID');
  }

  try {
    const accRes = await pool.query(`SELECT * FROM customer_accounts WHERE id = $1`, [userId]);
    const user = accRes.rows[0];
    if (!user) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });

    const okOld = await comparePassword(current_password, user.password_hash);
    if (!okOld) return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');

    if (await comparePassword(new_password, user.password_hash)) {
      return sendTranslatedError(req, res, 400, 'PASSWORD_REUSED');
    }

    const newHash = await hashPassword(new_password);
    const upd = await pool.query(
      `UPDATE customer_accounts
       SET password_hash = $1, auth_version = auth_version + 1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, username, full_name, email, phone_e164, avatar_url, preferred_language, auth_version, created_at`,
      [newHash, userId]
    );
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND portal = 'customer'`, [userId]);

    const updated = upd.rows[0];
    const freshToken = signAccessToken({
      userId: updated.id,
      portal: 'customer',
      sessionVersion: updated.auth_version,
      preferredLanguage: updated.preferred_language,
    });

    await recordAuditLog({
      tenantId: null,
      actorPortal: 'customer',
      actorId: userId,
      action: 'CHANGE_CUSTOMER_PASSWORD',
      targetTable: 'customer_accounts',
      targetId: userId,
      ipAddress: req.ip,
    });

    return res.json({ access_token: freshToken, profile: updated });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.post('/me/logout-all', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    await pool.query(`UPDATE customer_accounts SET auth_version = auth_version + 1, updated_at = NOW() WHERE id = $1`, [userId]);
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND portal = 'customer'`, [userId]);
    return res.json({ status: 'ALL_SESSIONS_REVOKED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.get('/me/export', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [accRes, bRes, revRes] = await Promise.all([
      pool.query(
        `SELECT id, username, full_name, email, email_verified_at, phone_e164, preferred_language, terms_version, created_at
         FROM customer_accounts WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT b.booking_code, b.status, b.total_amount, b.deposit_amount, b.paid_amount, b.created_at,
                v.name as venue_name, c.name as court_name, bc.start_at, bc.end_at
         FROM bookings b
         JOIN venues v ON v.id = b.venue_id
         JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
         JOIN courts c ON c.id = bc.court_id
         WHERE b.customer_id = $1 ORDER BY b.created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT rating, comment, created_at FROM venue_reviews WHERE customer_id = $1 ORDER BY created_at DESC`,
        [userId]
      ),
    ]);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="personal-data-${userId.slice(0, 8)}.json"`);
    return res.send(
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          account: accRes.rows[0] || null,
          bookings: bRes.rows,
          reviews: revRes.rows,
        },
        null,
        2
      )
    );
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.patch('/me/preferences', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { preferred_language } = req.body;

  if (!['vi', 'en'].includes(preferred_language)) {
    return res.status(400).json({ error_code: 'INVALID_LANGUAGE', message: 'Language must be vi or en.' });
  }

  try {
    await pool.query(
      `UPDATE customer_accounts SET preferred_language = $1, updated_at = NOW() WHERE id = $2`,
      [preferred_language, userId]
    );
    return res.json({ message: 'Language preference saved.', preferred_language });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 2. VENUES, SPORTS FILTERING & LIVE AVAILABILITY (C-01, C-03, C-04, C-20)
// ============================================================================

customerRouter.get('/venues', async (req: AuthenticatedRequest, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const sport = typeof req.query.sport === 'string' ? req.query.sport.trim().toLowerCase() : '';

  try {
    const params: any[] = [];
    let filterSql = '';

    if (search) {
      params.push(`%${search}%`);
      filterSql += ` AND (unaccent(v.name) ILIKE unaccent($${params.length}) OR unaccent(v.address) ILIKE unaccent($${params.length}))`;
    }

    if (sport && sport !== 'all') {
      params.push(sport);
      filterSql += ` AND EXISTS (
        SELECT 1 FROM courts c2
        JOIN sports s2 ON s2.id = c2.sport_id
        WHERE c2.venue_id = v.id AND c2.is_active = TRUE AND LOWER(s2.code) = $${params.length}
      )`;
    }

    const sql = `
      SELECT v.id, v.tenant_id, v.name, v.name_i18n, v.address, v.address_i18n,
             v.phone, v.google_maps_url, v.latitude, v.longitude, v.district, v.city,
             v.city_slug, v.slug, v.weather_closure_banner, v.description_i18n,
             v.timezone, v.cover_photo_url, v.photos, v.amenities,
             t.name as tenant_name,
             (SELECT MIN(pr.price_per_hour)::bigint FROM price_rules pr WHERE pr.venue_id = v.id) as min_price,
             (SELECT MAX(pr.price_per_hour)::bigint FROM price_rules pr WHERE pr.venue_id = v.id) as max_price,
             (SELECT COUNT(*)::int FROM courts c WHERE c.venue_id = v.id AND c.is_active = TRUE) as court_count,
             (SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('code', s.code, 'name_i18n', s.name_i18n)), '[]'::json)
              FROM courts c JOIN sports s ON s.id = c.sport_id
              WHERE c.venue_id = v.id AND c.is_active = TRUE) as sports,
             (SELECT jsonb_build_object('open_time', to_char(oh.open_time, 'HH24:MI'), 'close_time', to_char(oh.close_time, 'HH24:MI'))
              FROM opening_hours oh WHERE oh.venue_id = v.id AND oh.is_closed = FALSE ORDER BY oh.day_of_week LIMIT 1) as sample_hours,
             (SELECT COUNT(*)::int FROM venue_reviews vr WHERE vr.venue_id = v.id AND vr.is_visible = TRUE) as review_count,
             (SELECT ROUND(AVG(vr.rating)::numeric, 1) FROM venue_reviews vr WHERE vr.venue_id = v.id AND vr.is_visible = TRUE) as avg_rating
      FROM venues v
      JOIN tenants t ON t.id = v.tenant_id
      WHERE t.status = 'ACTIVE' AND v.status = 'PUBLISHED'
      ${filterSql}
      ORDER BY v.created_at ASC
    `;

    const result = await pool.query(sql, params);
    return res.json({ venues: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.get('/venues/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const venueRes = await pool.query(
      `SELECT v.*, p.hold_duration_mins, p.deposit_mode, p.deposit_percent, p.cancellation_rules, p.policy_i18n
       FROM venues v
       JOIN tenants t ON t.id = v.tenant_id AND t.status = 'ACTIVE'
       LEFT JOIN policies p ON p.venue_id = v.id
       WHERE v.id = $1`,
      [req.params.id]
    );
    if (venueRes.rows.length === 0) {
      return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });
    }

    const [courtsRes, hoursRes, reviewsRes] = await Promise.all([
      pool.query(
        `SELECT c.*, s.code as sport_code, s.name_i18n as sport_name, s.min_duration_mins, s.step_mins
         FROM courts c
         JOIN sports s ON s.id = c.sport_id
         WHERE c.venue_id = $1 AND c.is_active = TRUE
         ORDER BY c.name`,
        [req.params.id]
      ),
      pool.query(
        `SELECT day_of_week, open_time, close_time, is_closed
         FROM opening_hours WHERE venue_id = $1 ORDER BY day_of_week`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, rating, comment, created_at
         FROM venue_reviews
         WHERE venue_id = $1 AND is_visible = TRUE
         ORDER BY created_at DESC LIMIT 10`,
        [req.params.id]
      ),
    ]);

    return res.json({
      venue: venueRes.rows[0],
      courts: courtsRes.rows,
      opening_hours: hoursRes.rows,
      reviews: reviewsRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.get('/venues/:id/availability', async (req: AuthenticatedRequest, res: Response) => {
  const venueId = req.params.id;
  const date = typeof req.query.date === 'string' ? req.query.date : vietnamDate();
  if (
    !/^[0-9a-f-]{36}$/i.test(venueId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    return res.status(400).json({ error_code: 'INVALID_DATE_OR_VENUE' });
  }

  const start = `${date}T00:00:00+07:00`;
  const end = new Date(Date.parse(start) + 86400000).toISOString();

  try {
    const [courts, bookings, prices, deals, hours, policy, closures, links] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.name_i18n, c.court_type, c.is_outdoor, s.code as sport_code, s.name_i18n as sport_name,
                s.min_duration_mins, s.step_mins
         FROM courts c
         JOIN sports s ON s.id = c.sport_id
         JOIN venues v ON v.id = c.venue_id
         JOIN tenants t ON t.id = v.tenant_id AND t.status = 'ACTIVE'
         WHERE c.venue_id = $1 AND c.is_active = TRUE
         ORDER BY c.name`,
        [venueId]
      ),
      // Safe SECURITY DEFINER public projection (F-01 + composite court propagation F-07)
      pool.query(`SELECT * FROM get_public_venue_occupancy($1, $2, $3)`, [venueId, start, end]),
      pool.query(
        `SELECT court_id, court_type, day_of_week, is_weekend, is_holiday,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to,
                is_peak_hour, start_time, end_time, price_per_hour, priority
         FROM price_rules WHERE venue_id = $1 ORDER BY priority DESC, id ASC`,
        [venueId]
      ),
      pool.query(
        `SELECT id, title_vi, title_en, sport_code, court_ids, days_of_week,
                to_char(time_from, 'HH24:MI') as time_from,
                to_char(time_to, 'HH24:MI') as time_to,
                kind, discount_type, discount_value, floor_price_vnd, lead_hours,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to
         FROM deal_rules WHERE venue_id = $1 AND status = 'ACTIVE'`,
        [venueId]
      ),
      pool.query(
        `SELECT day_of_week, open_time, close_time, is_closed
         FROM opening_hours WHERE venue_id = $1 ORDER BY day_of_week`,
        [venueId]
      ),
      pool.query(
        `SELECT deposit_mode, deposit_percent, hold_duration_mins, cancellation_rules, policy_i18n
         FROM policies WHERE venue_id = $1`,
        [venueId]
      ),
      pool.query(
        `SELECT start_at, end_at, reason
         FROM venue_closures WHERE venue_id = $1 AND start_at < $3 AND end_at > $2`,
        [venueId, start, end]
      ),
      pool.query(
        `SELECT cl.parent_court_id, cl.child_court_id, c.name as child_name
         FROM court_links cl
         JOIN courts c ON c.id = cl.child_court_id
         WHERE c.venue_id = $1`,
        [venueId]
      ),
    ]);

    const pol = policy.rows[0];
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      date,
      venue_id: venueId,
      courts: courts.rows,
      court_links: links.rows,
      booked_slots: bookings.rows,
      price_rules: prices.rows,
      deal_rules: deals.rows,
      opening_hours: hours.rows,
      deposit_mode: pol?.deposit_mode || 'DEPOSIT_REQUIRED',
      deposit_percent: pol?.deposit_mode === 'NO_DEPOSIT' ? 0 : (pol?.deposit_percent ?? 30),
      hold_duration_mins: pol?.hold_duration_mins ?? 10,
      cancellation_rules: pol?.cancellation_rules || [],
      policy_i18n: pol?.policy_i18n || {},
      closures: closures.rows,
    });
  } catch {
    return sendTranslatedError(req, res, 500, 'AVAILABILITY_UNAVAILABLE');
  }
});

/**
 * GET /api/customer/v1/venues/:id/realtime
 * Public SSE stream — safe minimal occupancy projection only (F-11)
 */
customerRouter.get('/venues/:id/realtime', (req: AuthenticatedRequest, res: Response) => {
  attachSseStream(res, req.params.id, false);
});

// ============================================================================
// 3. UNIFIED BOOKING HOLD, RESCHEDULE, CANCEL, SANDBOX & ICAL (Mục 3 & Mục 4)
// ============================================================================

customerRouter.post('/bookings', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { venue_id, court_id, start_at, end_at, intervals } = req.body;

  const rawIntervals: Array<{ start_at: string; end_at: string }> =
    Array.isArray(intervals) && intervals.length > 0
      ? intervals
          .filter((it: any) => it && it.start_at && it.end_at)
          .slice(0, 16)
      : start_at && end_at
        ? [{ start_at, end_at }]
        : [];

  if (!venue_id || !court_id || rawIntervals.length === 0) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: t('errors.MISSING_FIELDS', req.lang || 'vi') });
  }

  try {
    return await withIdempotency(req, res, `customer:booking:${userId}`, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const createdBookings: any[] = [];
        const quotes: any[] = [];

        for (const interval of rawIntervals) {
          const quote = await validateAndQuoteSlot(client, {
            venueId: venue_id,
            courtId: court_id,
            startAt: interval.start_at,
            endAt: interval.end_at,
            isStaffCounter: false,
            requirePaymentConfig: true,
          });

          const bookingCode = generateBookingCode();
          const isInstantConfirm = quote.depositMode === 'NO_DEPOSIT' || quote.depositAmount === 0;
          const status = isInstantConfirm ? 'CONFIRMED' : 'PENDING';
          const holdExpiresAt = isInstantConfirm ? null : new Date(Date.now() + quote.holdMins * 60 * 1000);

          const bookingRes = await client.query(
            `INSERT INTO bookings (
               tenant_id, venue_id, customer_id, booking_code, status,
               total_amount, deposit_amount, paid_amount, due_at_venue, hold_expires_at,
               price_snapshot, applied_deal_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11)
             RETURNING id, booking_code, status, total_amount, deposit_amount, paid_amount, due_at_venue, hold_expires_at, price_snapshot, applied_deal_id`,
            [
              quote.tenantId,
              quote.venueId,
              userId,
              bookingCode,
              status,
              quote.totalAmount,
              quote.depositAmount,
              quote.dueAtVenue,
              holdExpiresAt,
              JSON.stringify(quote.priceSnapshot),
              quote.appliedDealId,
            ]
          );
          const booking = bookingRes.rows[0];

          await client.query(
            `INSERT INTO booking_items (
               tenant_id, booking_id, item_type, description, start_at, end_at, quantity, unit_price, total_price
             ) VALUES ($1, $2, 'COURT_SLOT', $3, $4, $5, 1, $6, $6)`,
            [quote.tenantId, booking.id, `${quote.courtName} (${quote.durationMins}p)`, quote.start, quote.end, quote.totalAmount]
          );

          await reservePhysicalCourtRows(client, {
            tenantId: quote.tenantId,
            venueId: quote.venueId,
            bookingId: booking.id,
            primaryCourtId: quote.courtId,
            physicalCourtIds: quote.physicalCourtIds,
            start: quote.start,
            end: quote.end,
          });

          createdBookings.push(booking);
          quotes.push(quote);
        }

        await client.query('COMMIT');

        for (let i = 0; i < quotes.length; i++) {
          const quote = quotes[i];
          const bk = createdBookings[i];
          for (const cid of quote.physicalCourtIds) {
            broadcastCourtChange({
              venue_id: quote.venueId,
              court_id: cid,
              booking_id: bk.id,
              booking_code: bk.booking_code,
              start_at: quote.start.toISOString(),
              end_at: quote.end.toISOString(),
              status: bk.status as any,
              timestamp: new Date().toISOString(),
            });
          }
        }

        const primaryBooking = createdBookings[0];
        const primaryQuote = quotes[0];
        const sumTotal = createdBookings.reduce((s, b) => s + Number(b.total_amount), 0);
        const sumDeposit = createdBookings.reduce((s, b) => s + Number(b.deposit_amount), 0);
        const sumDue = createdBookings.reduce((s, b) => s + Number(b.due_at_venue), 0);
        const combinedNote = createdBookings.map((b) => b.booking_code).join(' ');

        const paymentDesc =
          sumDeposit > 0
            ? buildPaymentDescriptor(primaryQuote.bankAccountInfo, sumDeposit, primaryBooking.booking_code)
            : null;

        await recordAuditLog({
          tenantId: primaryQuote.tenantId,
          actorPortal: 'customer',
          actorId: userId,
          action: 'CREATE_BOOKING_HOLD',
          targetTable: 'bookings',
          targetId: primaryBooking.id,
          afterState: {
            count: createdBookings.length,
            booking_ids: createdBookings.map((b) => b.id),
            total_amount: sumTotal,
          },
          ipAddress: req.ip,
        });

        return {
          status: 201,
          body: {
            booking: {
              id: primaryBooking.id,
              booking_code: primaryBooking.booking_code,
              all_booking_ids: createdBookings.map((b) => b.id),
              all_booking_codes: createdBookings.map((b) => b.booking_code),
              status: primaryBooking.status,
              total_amount: sumTotal,
              deposit_amount: sumDeposit,
              paid_amount: 0,
              due_at_venue: sumDue,
              hold_expires_at: primaryBooking.hold_expires_at,
              payment_mode: paymentDesc?.payment_mode || 'none',
              email_mode: isSmtpConfigured() ? 'smtp' : 'test_mode',
              vietqr_url: paymentDesc?.vietqr_url,
              bank_account: paymentDesc?.bank_account,
              transfer_note: combinedNote,
            },
          },
        };
      } catch (err: any) {
        await client.query('ROLLBACK');
        if (err instanceof BookingDomainError) {
          return {
            status: err.status,
            body: {
              error_code: err.code,
              message: t(`errors.${err.code}`, req.lang || 'vi'),
              ...err.extra,
            },
          };
        }
        if (err.code === '23P01' || String(err.message).includes('no_overlap')) {
          return {
            status: 409,
            body: {
              error_code: 'SLOT_TAKEN',
              message: t('errors.SLOT_TAKEN', req.lang || 'vi'),
            },
          };
        }
        throw err;
      } finally {
        client.release();
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/customer/v1/bookings/:id/reschedule
 * Uses the exact same unified pricing, opening-hours, composite-court & idempotency core (F-05, F-06, F-07)!
 */
customerRouter.post('/bookings/:id/reschedule', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const oldBookingId = req.params.id;
  const userId = req.user!.userId;
  const { new_court_id, new_start_at, new_end_at } = req.body;

  if (!new_court_id || !new_start_at || !new_end_at) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'new_court_id, new_start_at, new_end_at required.' });
  }

  try {
    return await withIdempotency(req, res, `customer:reschedule:${userId}:${oldBookingId}`, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const oldRes = await client.query(
          `SELECT * FROM bookings WHERE id = $1 AND customer_id = $2 AND status = 'CONFIRMED' FOR UPDATE`,
          [oldBookingId, userId]
        );
        if (oldRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return {
            status: 404,
            body: {
              error_code: 'BOOKING_NOT_ELIGIBLE',
              message: req.lang === 'en' ? 'Only confirmed bookings can be rescheduled.' : 'Chỉ những lịch đã xác nhận mới có thể dời lịch.',
            },
          };
        }
        const oldBooking = oldRes.rows[0];

        const oldCourtsRes = await client.query(
          `SELECT court_id, start_at, end_at FROM booking_courts WHERE booking_id = $1 AND active = TRUE`,
          [oldBookingId]
        );
        const primaryOldStart = oldCourtsRes.rows[0]?.start_at;
        if (primaryOldStart && new Date(primaryOldStart).getTime() <= Date.now()) {
          await client.query('ROLLBACK');
          return {
            status: 400,
            body: {
              error_code: 'BOOKING_ALREADY_STARTED',
              message: req.lang === 'en' ? 'Cannot reschedule a booking that has already started.' : 'Không thể dời lịch đã tới giờ thi đấu.',
            },
          };
        }

        // Release old court rows inside transaction so customer can shift their own slot window cleanly
        await client.query(`UPDATE booking_courts SET active = FALSE WHERE booking_id = $1`, [oldBookingId]);
        await client.query(
          `UPDATE bookings SET status = 'CANCELLED', cancel_reason = 'Rescheduled to new booking', updated_at = NOW() WHERE id = $1`,
          [oldBookingId]
        );

        const quote = await validateAndQuoteSlot(client, {
          venueId: oldBooking.venue_id,
          courtId: new_court_id,
          startAt: new_start_at,
          endAt: new_end_at,
          isStaffCounter: false,
          requirePaymentConfig: false,
        });

        const carriedPaid = Number(oldBooking.paid_amount || oldBooking.deposit_amount || 0);
        const newDueAtVenue = Math.max(0, quote.totalAmount - carriedPaid);
        const excessRefund = Math.max(0, carriedPaid - quote.totalAmount);
        const newBookingCode = generateBookingCode();

        const newBRes = await client.query(
          `INSERT INTO bookings (
             tenant_id, venue_id, customer_id, booking_code, status,
             total_amount, deposit_amount, paid_amount, due_at_venue,
             refund_status, refund_amount, rescheduled_from_id, notes
           ) VALUES ($1, $2, $3, $4, 'CONFIRMED', $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            quote.tenantId,
            quote.venueId,
            userId,
            newBookingCode,
            quote.totalAmount,
            quote.depositAmount,
            Math.min(carriedPaid, quote.totalAmount),
            newDueAtVenue,
            excessRefund > 0 ? 'PENDING' : 'NONE',
            excessRefund,
            oldBooking.id,
            `Dời lịch từ mã ${oldBooking.booking_code}`,
          ]
        );
        const newBooking = newBRes.rows[0];

        await client.query(
          `INSERT INTO booking_items (
             tenant_id, booking_id, item_type, description, start_at, end_at, quantity, unit_price, total_price
           ) VALUES ($1, $2, 'COURT_SLOT', $3, $4, $5, 1, $6, $6)`,
          [quote.tenantId, newBooking.id, `${quote.courtName} (${quote.durationMins}p)`, quote.start, quote.end, quote.totalAmount]
        );

        await reservePhysicalCourtRows(client, {
          tenantId: quote.tenantId,
          venueId: quote.venueId,
          bookingId: newBooking.id,
          primaryCourtId: quote.courtId,
          physicalCourtIds: quote.physicalCourtIds,
          start: quote.start,
          end: quote.end,
        });

        if (excessRefund > 0) {
          await client.query(
            `INSERT INTO refunds (tenant_id, booking_id, amount, reason, status)
             VALUES ($1, $2, $3, $4, 'PENDING')`,
            [quote.tenantId, newBooking.id, excessRefund, `Chênh lệch tiền cọc sau khi dời từ đơn ${oldBooking.booking_code}`]
          );
        }

        await client.query('COMMIT');

        // Broadcast both released old slots & newly reserved slots
        for (const r of oldCourtsRes.rows) {
          broadcastCourtChange({
            venue_id: oldBooking.venue_id,
            court_id: r.court_id,
            start_at: new Date(r.start_at).toISOString(),
            end_at: new Date(r.end_at).toISOString(),
            status: 'CANCELLED',
            timestamp: new Date().toISOString(),
          });
        }
        for (const cid of quote.physicalCourtIds) {
          broadcastCourtChange({
            venue_id: quote.venueId,
            court_id: cid,
            booking_id: newBooking.id,
            booking_code: newBooking.booking_code,
            start_at: quote.start.toISOString(),
            end_at: quote.end.toISOString(),
            status: 'CONFIRMED',
            timestamp: new Date().toISOString(),
          });
        }

        await recordAuditLog({
          tenantId: quote.tenantId,
          actorPortal: 'customer',
          actorId: userId,
          action: 'RESCHEDULE_BOOKING',
          targetTable: 'bookings',
          targetId: newBooking.id,
          beforeState: { old_booking_id: oldBookingId, old_code: oldBooking.booking_code },
          afterState: newBooking,
          ipAddress: req.ip,
        });

        return {
          status: 200,
          body: {
            message: req.lang === 'en' ? 'Booking rescheduled successfully.' : 'Dời lịch đặt sân thành công.',
            old_booking_code: oldBooking.booking_code,
            new_booking: {
              ...newBooking,
              court_name: quote.courtName,
              venue_name: quote.venueName,
              start_at: quote.start.toISOString(),
              end_at: quote.end.toISOString(),
            },
          },
        };
      } catch (err: any) {
        await client.query('ROLLBACK');
        if (err instanceof BookingDomainError) {
          return {
            status: err.status,
            body: { error_code: err.code, message: t(`errors.${err.code}`, req.lang || 'vi') },
          };
        }
        if (err.code === '23P01' || String(err.message).includes('no_overlap')) {
          return {
            status: 409,
            body: { error_code: 'SLOT_TAKEN', message: t('errors.SLOT_TAKEN', req.lang || 'vi') },
          };
        }
        throw err;
      } finally {
        client.release();
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/customer/v1/bookings/:id/payment
 * Supports resuming a pending payment from My Bookings + reflects underpayment balance!
 */
customerRouter.get('/bookings/:id/payment', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const bookingId = req.params.id;

  try {
    const bRes = await pool.query(
      `SELECT b.id, b.booking_code, b.status, b.total_amount, b.deposit_amount, b.paid_amount,
              b.due_at_venue, b.hold_expires_at, b.payment_review_reason,
              t.bank_account_info, c.name as court_name, bc.start_at, bc.end_at
       FROM bookings b
       JOIN tenants t ON t.id = b.tenant_id
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
       JOIN courts c ON c.id = bc.court_id
       WHERE b.id = $1 AND b.customer_id = $2`,
      [bookingId, userId]
    );

    if (bRes.rows.length === 0) {
      return res.status(404).json({ error_code: 'NOT_FOUND' });
    }
    const booking = bRes.rows[0];
    const paidAmount = Number(booking.paid_amount || 0);
    const depositAmount = Number(booking.deposit_amount || 0);
    const remainingDeposit = Math.max(0, depositAmount - paidAmount);
    const qrAmount = remainingDeposit > 0 ? remainingDeposit : depositAmount;
    const desc = buildPaymentDescriptor(booking.bank_account_info, qrAmount, booking.booking_code);

    return res.json({
      payment: {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        court_name: booking.court_name,
        start_at: booking.start_at,
        end_at: booking.end_at,
        status: booking.status,
        total_amount_vnd: Number(booking.total_amount),
        deposit_amount_vnd: depositAmount,
        paid_amount_vnd: paidAmount,
        remaining_deposit_vnd: remainingDeposit,
        due_at_venue_vnd: Number(booking.due_at_venue),
        payment_review_reason: booking.payment_review_reason,
        payment_mode: desc.payment_mode,
        email_mode: isSmtpConfigured() ? 'smtp' : 'test_mode',
        vietqr_url: desc.vietqr_url,
        bank_account: desc.bank_account,
        bank_name: desc.bank_account.bank_name,
        account_number: desc.bank_account.account_number,
        account_name: desc.bank_account.account_name,
        transfer_note: booking.booking_code,
        hold_expires_at: booking.hold_expires_at,
      },
    });
  } catch (err: any) {
    if (err instanceof BookingDomainError) {
      return sendTranslatedError(req, res, err.status, err.code);
    }
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/customer/v1/bookings/:id/sandbox-pay
 * Explicitly labeled Sandbox Bank Transfer Simulator for local testing when tenant sandbox_mode=true.
 * Disabled in production or when tenant has disabled sandbox_mode!
 */
customerRouter.post('/bookings/:id/sandbox-pay', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error_code: 'SANDBOX_DISABLED' });
  }

  const userId = req.user!.userId;
  const bookingId = req.params.id;
  const scenario: 'exact' | 'underpay' | 'overpay' | 'late' = req.body?.scenario || 'exact';
  const batchIds: string[] = Array.isArray(req.body?.booking_ids) && req.body.booking_ids.length > 0
    ? req.body.booking_ids
    : [bookingId];

  try {
    const bRes = await pool.query(
      `SELECT b.id, b.booking_code, b.status, b.total_amount, b.deposit_amount, b.paid_amount, t.bank_account_info
       FROM bookings b
       JOIN tenants t ON t.id = b.tenant_id
       WHERE b.id = ANY($1) AND b.customer_id = $2`,
      [batchIds, userId]
    );
    if (bRes.rows.length === 0) {
      return res.status(404).json({ error_code: 'NOT_FOUND' });
    }
    const first = bRes.rows[0];
    if (first.bank_account_info?.sandbox_mode !== true) {
      return res.status(403).json({
        error_code: 'SANDBOX_DISABLED',
        message: 'Chủ sân đã tắt chế độ thử nghiệm để nhận thanh toán thật.',
      });
    }

    let lastResult: any = null;
    let totalSimulated = 0;

    for (const booking of bRes.rows) {
      const remainingDeposit = Math.max(10000, Number(booking.deposit_amount) - Number(booking.paid_amount || 0));
      let simulatedAmount = remainingDeposit;

      if (scenario === 'underpay') {
        simulatedAmount = Math.max(1000, Math.floor(remainingDeposit / 2));
      } else if (scenario === 'overpay') {
        simulatedAmount = Number(booking.total_amount) + 50000;
      } else if (scenario === 'late') {
        await databaseScope.run({ service: true }, async () => {
          await pool.query(`UPDATE booking_courts SET active = FALSE WHERE booking_id = $1`, [booking.id]);
          await pool.query(
            `UPDATE bookings SET status = 'EXPIRED', hold_expires_at = NOW() - INTERVAL '1 minute', updated_at = NOW() WHERE id = $1`,
            [booking.id]
          );
        });
      }

      lastResult = await processBankPaymentEvent({
        provider: 'sandbox_simulator',
        eventId: `SIM-${scenario.toUpperCase()}-${randomUUID().slice(0, 12)}`,
        transferNote: `SANDBOX CHUYEN KHOAN ${booking.booking_code}`,
        transferAmount: simulatedAmount,
        rawPayload: { sandbox: true, scenario, amount: simulatedAmount, content: booking.booking_code },
        ipAddress: req.ip,
      });
      totalSimulated += simulatedAmount;
    }

    return res.json({ simulated: true, scenario, amount: totalSimulated, ...lastResult, paidAmount: totalSimulated });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/customer/v1/bookings/:id/cancel-preview
 * Calculates exact refund consequences BEFORE customer confirms cancellation (F-08, Audit §10.3).
 */
customerRouter.get('/bookings/:id/cancel-preview', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const bookingId = req.params.id;

  try {
    const bRes = await pool.query(
      `SELECT b.id, b.booking_code, b.status, b.total_amount, b.deposit_amount, b.paid_amount,
              bc.start_at, p.cancellation_rules, p.policy_i18n
       FROM bookings b
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
       LEFT JOIN policies p ON p.venue_id = b.venue_id
       WHERE b.id = $1 AND b.customer_id = $2`,
      [bookingId, userId]
    );
    if (bRes.rows.length === 0) {
      return res.status(404).json({ error_code: 'NOT_FOUND' });
    }
    const b = bRes.rows[0];
    const calc = calculateRefundPolicy(b.cancellation_rules, b.start_at, Number(b.paid_amount || 0));
    return res.json({
      preview: {
        booking_id: b.id,
        booking_code: b.booking_code,
        status: b.status,
        paid_amount: Number(b.paid_amount || 0),
        hours_before_start: calc.hoursBefore,
        refund_percent: calc.refundPercent,
        refundable_amount: calc.refundableAmount,
        forfeited_amount: calc.forfeitedAmount,
        policy_i18n: b.policy_i18n || {},
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/customer/v1/bookings/:id/cancel
 * Transactional cancellation with policy refund calculation, court release, SSE & email!
 */
customerRouter.post('/bookings/:id/cancel', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const bookingId = req.params.id;
  const reason = String(req.body?.reason || 'Customer requested cancellation').slice(0, 300);

  try {
    return await withIdempotency(req, res, `customer:cancel:${userId}:${bookingId}`, async () => {
      const client = await pool.connect();
      let outboxToDispatch: string | null = null;
      let releasedRows: Array<{ court_id: string; start_at: Date; end_at: Date }> = [];
      let venueIdForSse = '';
      let tenantIdForAudit = '';
      let refundSummary = { refundPercent: 0, refundableAmount: 0, forfeitedAmount: 0 };

      try {
        await client.query('BEGIN');

        const bRes = await client.query(
          `SELECT b.*, v.name as venue_name, ca.email as customer_email, ca.preferred_language as customer_lang,
                  p.cancellation_rules
           FROM bookings b
           JOIN venues v ON v.id = b.venue_id
           LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
           LEFT JOIN policies p ON p.venue_id = b.venue_id
           WHERE b.id = $1 AND b.customer_id = $2
           FOR UPDATE OF b`,
          [bookingId, userId]
        );

        if (bRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return { status: 404, body: { error_code: 'NOT_FOUND', message: 'Booking not found.' } };
        }

        const booking = bRes.rows[0];
        if (['CANCELLED', 'COMPLETED', 'NO_SHOW', 'CHECKED_IN'].includes(booking.status)) {
          await client.query('ROLLBACK');
          return {
            status: 400,
            body: {
              error_code: 'ALREADY_FINALIZED',
              message: req.lang === 'en' ? 'Booking cannot be cancelled in its current status.' : 'Không thể hủy đặt sân ở trạng thái hiện tại.',
            },
          };
        }

        const courtsRes = await client.query(
          `SELECT bc.court_id, bc.start_at, bc.end_at, bc.is_primary, c.name as court_name
           FROM booking_courts bc
           JOIN courts c ON c.id = bc.court_id
           WHERE bc.booking_id = $1
           ORDER BY bc.is_primary DESC`,
          [bookingId]
        );
        const primaryCourt = courtsRes.rows[0];

        const paidAmount = Number(booking.paid_amount || 0);
        const calc = primaryCourt
          ? calculateRefundPolicy(booking.cancellation_rules, primaryCourt.start_at, paidAmount)
          : { hoursBefore: 0, refundPercent: 0, refundableAmount: 0, forfeitedAmount: paidAmount };
        refundSummary = calc;

        let refundStatus = 'NONE';
        if (paidAmount > 0) {
          if (calc.refundableAmount > 0) {
            refundStatus = 'PENDING';
            await client.query(
              `INSERT INTO refunds (tenant_id, booking_id, amount, reason, status)
               VALUES ($1, $2, $3, $4, 'PENDING')`,
              [
                booking.tenant_id,
                bookingId,
                calc.refundableAmount,
                `Khách hủy trước ${calc.hoursBefore}h — hoàn ${calc.refundPercent}% tiền đã thanh toán`,
              ]
            );
          } else {
            refundStatus = 'FORFEITED';
          }
        }

        const rel = await client.query(
          `UPDATE booking_courts SET active = FALSE WHERE booking_id = $1 AND active = TRUE RETURNING court_id, start_at, end_at`,
          [bookingId]
        );
        releasedRows = rel.rows;
        venueIdForSse = booking.venue_id;
        tenantIdForAudit = booking.tenant_id;

        await client.query(
          `UPDATE bookings
           SET status = 'CANCELLED',
               cancel_reason = $1,
               refund_status = $2,
               refund_amount = $3,
               due_at_venue = 0,
               updated_at = NOW()
           WHERE id = $4`,
          [reason, refundStatus, calc.refundableAmount, bookingId]
        );

        await client.query('COMMIT');

        if (booking.customer_email) {
          await databaseScope.run({ service: true }, async () => {
            const outRes = await pool.query(
              `INSERT INTO email_outbox (recipient, template_type, language, reference_id, template_data, dedup_key)
               VALUES ($1, 'BOOKING_CANCELLED', $2, $3, $4, $5)
               ON CONFLICT (dedup_key) DO NOTHING
               RETURNING id`,
              [
                booking.customer_email,
                booking.customer_lang || 'vi',
                booking.id,
                JSON.stringify({
                  booking_code: booking.booking_code,
                  venue_name: booking.venue_name,
                  court_name: primaryCourt?.court_name || '',
                  refund_percent: calc.refundPercent,
                  refund_amount: calc.refundableAmount,
                }),
                `cancel_email_${booking.id}`,
              ]
            );
            outboxToDispatch = outRes.rows[0]?.id || null;
          });
        }

        for (const r of releasedRows) {
          broadcastCourtChange({
            venue_id: venueIdForSse,
            court_id: r.court_id,
            start_at: new Date(r.start_at).toISOString(),
            end_at: new Date(r.end_at).toISOString(),
            status: 'CANCELLED',
            timestamp: new Date().toISOString(),
          });
        }

        if (outboxToDispatch) {
          setImmediate(() => {
            databaseScope.run({ service: true }, () => dispatchQueuedEmail(outboxToDispatch!)).catch(() => {});
          });
        }

        await recordAuditLog({
          tenantId: tenantIdForAudit,
          actorPortal: 'customer',
          actorId: userId,
          action: 'CANCEL_BOOKING',
          targetTable: 'bookings',
          targetId: bookingId,
          afterState: { status: 'CANCELLED', reason, refundStatus, refundableAmount: calc.refundableAmount },
          ipAddress: req.ip,
        });

        return {
          status: 200,
          body: {
            message: req.lang === 'en' ? 'Booking cancelled successfully.' : 'Đã hủy lịch đặt sân thành công.',
            status: 'CANCELLED',
            refund_status: refundStatus,
            refund_percent: refundSummary.refundPercent,
            refund_amount: refundSummary.refundableAmount,
          },
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

const handleIcsDownload = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const bookingId = req.params.id;

  try {
    const bRes = await pool.query(
      `SELECT b.booking_code, v.name as venue_name, v.address as venue_address,
              c.name as court_name, bc.start_at, bc.end_at, u.username
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
       JOIN courts c ON c.id = bc.court_id
       JOIN customer_accounts u ON u.id = b.customer_id
       WHERE b.id = $1 AND b.customer_id = $2`,
      [bookingId, userId]
    );

    if (bRes.rows.length === 0) {
      return res.status(404).send('Booking not found');
    }

    const b = bRes.rows[0];
    const icsContent = generateBookingIcs({
      bookingCode: b.booking_code,
      venueName: b.venue_name,
      venueAddress: b.venue_address,
      courtName: b.court_name,
      startAt: new Date(b.start_at),
      endAt: new Date(b.end_at),
      customerName: b.username,
      language: req.lang || 'vi',
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="booking-${b.booking_code}.ics"`);
    return res.send(icsContent);
  } catch {
    return res.status(500).send('Error generating calendar file');
  }
};

customerRouter.get('/bookings/:id/ics', requirePortal('customer'), handleIcsDownload);
customerRouter.get('/bookings/:id/calendar.ics', requirePortal('customer'), handleIcsDownload);

customerRouter.get('/bookings', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const result = await pool.query(
      `SELECT b.id, b.venue_id, b.booking_code, b.status,
              b.total_amount, b.deposit_amount, b.paid_amount, b.due_at_venue,
              b.refund_status, b.refund_amount, b.payment_review_reason,
              b.hold_expires_at, b.created_at,
              v.name as venue_name, v.address as venue_address, v.phone as venue_phone,
              bc.court_id, c.name as court_name, c.name_i18n as court_name_i18n,
              bc.start_at, bc.end_at
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
       JOIN courts c ON c.id = bc.court_id
       WHERE b.customer_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );

    return res.json({ bookings: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerRouter.get('/bookings/:id', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const bookingId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT b.*, v.name as venue_name, v.address as venue_address, v.phone as venue_phone,
              bc.court_id, c.name as court_name, bc.start_at, bc.end_at
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
       JOIN courts c ON c.id = bc.court_id
       WHERE b.id = $1 AND b.customer_id = $2`,
      [bookingId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error_code: 'NOT_FOUND', message: 'Booking not found.' });
    }

    return res.json({ booking: result.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});
