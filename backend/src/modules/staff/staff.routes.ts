import { Router, Response } from 'express';
import { pool } from '../../config/database';
import {
  hashPassword,
  comparePassword,
  generateBookingCode,
  normalizePhoneNumber,
  signAccessToken,
} from '../../common/jwt';
import {
  AuthenticatedRequest,
  requirePortal,
  sendTranslatedError,
} from '../../common/auth.guard';
import { recordAuditLog } from '../../common/audit';
import { broadcastCourtChange, attachSseStream } from '../../common/realtime';
import { withIdempotency } from '../../common/idempotency';
import { uploadRateLimiter } from '../../common/security';
import { avatarUploadMiddleware, optimizeAvatarImage, handleUploadErrors } from '../../common/uploader';
import { t } from '../../../../shared/i18n';
import { vietnamDate } from '../../../../shared/booking';
import {
  BookingDomainError,
  validateAndQuoteSlot,
  reservePhysicalCourtRows,
} from '../booking/booking.service';

export const staffRouter = Router();

async function getStaffAssignedVenues(staffId: string, role?: string, tenantId?: string): Promise<string[]> {
  if (role === 'OWNER' && tenantId) {
    const allRes = await pool.query(`SELECT id FROM venues WHERE tenant_id = $1`, [tenantId]);
    return allRes.rows.map((r) => r.id);
  }
  const venueRes = await pool.query(
    `SELECT venue_id FROM staff_venue_assignments WHERE staff_id = $1`,
    [staffId]
  );
  return venueRes.rows.map((r) => r.venue_id);
}

// ============================================================================
// 1. STAFF AUTHENTICATION & PIN MANAGEMENT (Section 19 & Section 20)
// ============================================================================

staffRouter.post('/auth/login', async (req: AuthenticatedRequest, res: Response) => {
  const { username, email, phone, password } = req.body;
  const loginIdentifier = String(username || email || phone || '').trim().toLowerCase();
  if (!loginIdentifier || !password) {
    return sendTranslatedError(req, res, 400, 'INVALID_CREDENTIALS');
  }

  try {
    const staffRes = await pool.query(
      `SELECT s.id, s.tenant_id, s.full_name, s.username, s.email, s.phone, s.avatar_url, s.discount_limit,
              s.password_hash, s.pin_hash, s.role, s.status, s.preferred_language, s.created_at,
              t.name as tenant_name
       FROM tenant_staff s
       JOIN tenants t ON t.id = s.tenant_id AND t.status = 'ACTIVE'
       WHERE (LOWER(s.username) = $1 OR LOWER(COALESCE(s.email, '')) = $1 OR s.phone = $1)
         AND s.status IN ('ACTIVE', 'INVITED')`,
      [loginIdentifier]
    );

    if (staffRes.rows.length === 0) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const staff = staffRes.rows[0];
    const isMatch = await comparePassword(password, staff.password_hash);
    if (!isMatch) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const assignedVenues = await getStaffAssignedVenues(staff.id, staff.role, staff.tenant_id);

    const token = signAccessToken({
      userId: staff.id,
      portal: 'staff',
      tenantId: staff.tenant_id,
      role: staff.role,
      preferredLanguage: staff.preferred_language,
    });

    return res.json({
      access_token: token,
      staff: {
        id: staff.id,
        full_name: staff.full_name,
        username: staff.username,
        email: staff.email,
        phone: staff.phone,
        avatar_url: staff.avatar_url || null,
        discount_limit: Number(staff.discount_limit || 0),
        role: staff.role,
        status: staff.status,
        preferred_language: staff.preferred_language,
        created_at: staff.created_at,
        tenant_id: staff.tenant_id,
        tenant_name: staff.tenant_name,
        assigned_venues: assignedVenues,
        needs_password_change: staff.status === 'INVITED',
        has_pin: !!staff.pin_hash,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/auth/pin-unlock', async (req: AuthenticatedRequest, res: Response) => {
  const { staff_id, pin } = req.body;
  if (!staff_id || !pin) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'staff_id and pin required.' });
  }

  try {
    const staffRes = await pool.query(
      `SELECT id, tenant_id, role, preferred_language, pin_hash
       FROM tenant_staff WHERE id = $1 AND status = 'ACTIVE'`,
      [staff_id]
    );

    if (staffRes.rows.length === 0 || !staffRes.rows[0].pin_hash) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const staff = staffRes.rows[0];
    const isPinMatch = await comparePassword(pin.toString(), staff.pin_hash);
    if (!isPinMatch) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }

    const token = signAccessToken({
      userId: staff.id,
      portal: 'staff',
      tenantId: staff.tenant_id,
      role: staff.role,
      preferredLanguage: staff.preferred_language,
    });

    return res.json({ access_token: token, message: 'Unlocked successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/auth/change-password', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const { old_password, new_password, new_pin } = req.body;

  if (!old_password || !new_password || String(new_password).length < 8) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'Valid old_password and new_password (>=8 chars) required.' });
  }

  try {
    const staffRes = await pool.query(`SELECT password_hash FROM tenant_staff WHERE id = $1`, [staffId]);
    if (staffRes.rows.length === 0) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });

    const isMatch = await comparePassword(old_password, staffRes.rows[0].password_hash);
    if (!isMatch) {
      return sendTranslatedError(req, res, 400, 'INVALID_CREDENTIALS');
    }

    const newPwdHash = await hashPassword(new_password);
    const pinHash = new_pin ? await hashPassword(String(new_pin)) : null;

    if (pinHash) {
      await pool.query(
        `UPDATE tenant_staff SET password_hash = $1, pin_hash = $2, status = 'ACTIVE', auth_version = auth_version + 1, updated_at = NOW() WHERE id = $3`,
        [newPwdHash, pinHash, staffId]
      );
    } else {
      await pool.query(
        `UPDATE tenant_staff SET password_hash = $1, status = 'ACTIVE', auth_version = auth_version + 1, updated_at = NOW() WHERE id = $2`,
        [newPwdHash, staffId]
      );
    }

    return res.json({ message: 'Password and PIN updated successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.get('/me', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  try {
    const sRes = await pool.query(
      `SELECT s.id, s.tenant_id, s.full_name, s.username, s.email, s.phone, s.avatar_url,
              s.role, s.status, s.discount_limit, s.preferred_language, s.pin_hash IS NOT NULL as has_pin, s.created_at,
              t.name as tenant_name
       FROM tenant_staff s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [staffId, tenantId]
    );
    if (sRes.rows.length === 0) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    const assignedVenues = await getStaffAssignedVenues(staffId, sRes.rows[0].role, tenantId);
    return res.json({
      profile: {
        ...sRes.rows[0],
        discount_limit: Number(sRes.rows[0].discount_limit || 0),
        assigned_venues: assignedVenues,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.patch('/me', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { full_name, email, preferred_language } = req.body;
  try {
    const curRes = await pool.query(`SELECT * FROM tenant_staff WHERE id = $1 AND tenant_id = $2`, [staffId, tenantId]);
    if (curRes.rows.length === 0) return res.status(404).json({ error_code: 'USER_NOT_FOUND' });
    const cur = curRes.rows[0];

    const nextName = typeof full_name === 'string' && full_name.trim().length >= 2 ? full_name.trim().slice(0, 120) : cur.full_name;
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
       SET full_name = $1, email = $2, preferred_language = $3, updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, tenant_id, full_name, username, email, phone, avatar_url, role, status, discount_limit, preferred_language, created_at`,
      [nextName, nextEmail, nextLang, staffId, tenantId]
    );
    return res.json({ profile: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post(
  '/me/avatar',
  requirePortal('staff'),
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
         RETURNING id, full_name, username, email, phone, avatar_url, role, status, discount_limit, preferred_language`,
        [avatarUrl, req.user!.userId, req.user!.tenantId!]
      );
      return res.status(201).json({ avatar_url: avatarUrl, profile: upd.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    }
  },
  handleUploadErrors
);

// ============================================================================
// 2. ASSIGNED VENUES, COURTS & LIVE PRICING FOR COUNTER BOOKING
// ============================================================================

staffRouter.get('/venues', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const role = req.user!.role;

  try {
    const assigned = await getStaffAssignedVenues(staffId, role, tenantId);
    if (assigned.length === 0) return res.json({ venues: [], courts: [], price_rules: [] });

    const [vRes, cRes, prRes] = await Promise.all([
      pool.query(`SELECT id, name, name_i18n, address, phone FROM venues WHERE tenant_id = $1 AND id = ANY($2) ORDER BY created_at ASC`, [tenantId, assigned]),
      pool.query(
        `SELECT c.id, c.venue_id, c.name, c.name_i18n, c.court_type, s.min_duration_mins, s.step_mins
         FROM courts c JOIN sports s ON s.id = c.sport_id
         WHERE c.tenant_id = $1 AND c.venue_id = ANY($2) AND c.is_active = TRUE
         ORDER BY c.name`,
        [tenantId, assigned]
      ),
      pool.query(
        `SELECT venue_id, court_id, court_type, day_of_week, is_weekend, is_holiday, is_peak_hour,
                start_time, end_time, price_per_hour, priority
         FROM price_rules WHERE tenant_id = $1 AND venue_id = ANY($2) ORDER BY priority DESC, id ASC`,
        [tenantId, assigned]
      ),
    ]);

    return res.json({
      venues: vRes.rows,
      courts: cRes.rows,
      price_rules: prRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.get('/venues/:id/realtime', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const assigned = await getStaffAssignedVenues(req.user!.userId, req.user!.role, req.user!.tenantId);
  if (!assigned.includes(req.params.id)) {
    return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
  }
  attachSseStream(res, req.params.id, true);
});

// ============================================================================
// 3. SHIFTS & CASH RECONCILIATION (S-09, S-10)
// ============================================================================

staffRouter.post('/shifts/open', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const role = req.user!.role;
  const { venue_id, opening_cash = 0 } = req.body;

  if (!venue_id) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'venue_id is required.' });
  }
  const safeOpeningCash = Number(opening_cash);
  if (!Number.isSafeInteger(safeOpeningCash) || safeOpeningCash < 0) {
    return res.status(400).json({ error_code: 'INVALID_AMOUNT', message: 'opening_cash must be a non-negative integer.' });
  }

  try {
    const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
    if (!assignedVenues.includes(venue_id)) {
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED', message: 'Staff is not authorized for this venue.' });
    }

    const existing = await pool.query(`SELECT id FROM shifts WHERE staff_id = $1 AND status = 'OPEN'`, [staffId]);
    if (existing.rows.length > 0) {
      return sendTranslatedError(req, res, 400, 'SHIFT_ALREADY_OPEN');
    }

    const shiftRes = await pool.query(
      `INSERT INTO shifts (tenant_id, venue_id, staff_id, opening_cash, status)
       VALUES ($1, $2, $3, $4, 'OPEN')
       RETURNING id, venue_id, staff_id, opened_at, opening_cash, status`,
      [tenantId, venue_id, staffId, safeOpeningCash]
    );

    await recordAuditLog({
      tenantId,
      actorPortal: 'staff',
      actorId: staffId,
      action: 'OPEN_SHIFT',
      targetTable: 'shifts',
      targetId: shiftRes.rows[0].id,
      ipAddress: req.ip,
    });

    return res.status(201).json({ shift: { ...shiftRes.rows[0], cash_collected: 0, expected_cash: safeOpeningCash } });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.get('/shifts/current', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  try {
    const shiftRes = await pool.query(
      `SELECT s.*, v.name as venue_name
       FROM shifts s
       JOIN venues v ON v.id = s.venue_id
       WHERE s.staff_id = $1 AND s.status = 'OPEN'
       ORDER BY s.opened_at DESC LIMIT 1`,
      [staffId]
    );

    if (shiftRes.rows.length === 0) {
      return res.json({ shift: null });
    }

    const shift = shiftRes.rows[0];
    const cashRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint as cash_collected
       FROM payments
       WHERE shift_id = $1 AND method = 'CASH' AND status = 'CONFIRMED'`,
      [shift.id]
    );

    const cashCollected = Number(cashRes.rows[0].cash_collected || 0);
    const expectedCash = Number(shift.opening_cash) + cashCollected;

    return res.json({
      shift: {
        ...shift,
        cash_collected: cashCollected,
        expected_cash: expectedCash,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/shifts/close', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { shift_id, counted_cash, note = '', handover_note = '' } = req.body;

  const safeCounted = Number(counted_cash);
  if (!shift_id || !Number.isSafeInteger(safeCounted) || safeCounted < 0) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'Valid shift_id and non-negative counted_cash required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shiftRes = await client.query(
      `SELECT * FROM shifts WHERE id = $1 AND staff_id = $2 AND status = 'OPEN' FOR UPDATE`,
      [shift_id, staffId]
    );
    if (shiftRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error_code: 'SHIFT_NOT_FOUND', message: 'Open shift not found.' });
    }
    const shift = shiftRes.rows[0];

    const cashRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint as cash_collected
       FROM payments
       WHERE shift_id = $1 AND method = 'CASH' AND status = 'CONFIRMED'`,
      [shift_id]
    );
    const cashCollected = Number(cashRes.rows[0].cash_collected || 0);
    const expectedCash = Number(shift.opening_cash) + cashCollected;
    const variance = safeCounted - expectedCash;

    if (variance !== 0 && !String(note).trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error_code: 'VARIANCE_NOTE_REQUIRED',
        message: 'Bắt buộc nhập lý do giải trình khi tiền đếm thực tế lệch so với hệ thống.',
        variance,
      });
    }

    const updatedRes = await client.query(
      `UPDATE shifts
       SET status = 'CLOSED', closed_at = NOW(), counted_cash = $1, expected_cash = $2,
           variance = $3, note = $4, handover_note = $5
       WHERE id = $6
       RETURNING *`,
      [safeCounted, expectedCash, variance, String(note).trim(), String(handover_note).trim(), shift_id]
    );

    await client.query('COMMIT');

    await recordAuditLog({
      tenantId,
      actorPortal: 'staff',
      actorId: staffId,
      action: 'CLOSE_SHIFT',
      targetTable: 'shifts',
      targetId: shift_id,
      afterState: { counted_cash: safeCounted, expected_cash: expectedCash, variance },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Đóng ca trực thành công.',
      shift: updatedRes.rows[0],
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 4. CALENDAR, BOOKINGS, WALK-IN COUNTER BOOKING & PAYMENTS (S-01..S-06, F-04..F-08)
// ============================================================================

staffRouter.get('/calendar', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId!;
  const venueId = (req.query.venue || req.query.venue_id) as string;
  const date = (req.query.date as string) || vietnamDate();

  if (!venueId) {
    return res.status(400).json({ error_code: 'MISSING_VENUE', message: 'venue parameter is required.' });
  }

  try {
    const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
    if (!assignedVenues.includes(venueId)) {
      return res.status(403).json({
        error_code: 'VENUE_ACCESS_DENIED',
        message: 'Access denied: staff is not assigned to this venue.',
      });
    }

    const start = `${date}T00:00:00+07:00`;
    const end = new Date(Date.parse(start) + 86400000).toISOString();

    const [courtsRes, bookingsRes, hoursRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.name_i18n, c.court_type, s.name_i18n as sport_name
         FROM courts c
         JOIN sports s ON s.id = c.sport_id
         WHERE c.venue_id = $1 AND c.is_active = TRUE
         ORDER BY c.name`,
        [venueId]
      ),
      pool.query(
        `SELECT b.id as booking_id, b.booking_code, b.status, b.type,
                b.total_amount, b.deposit_amount, b.paid_amount, b.due_at_venue,
                b.refund_status, b.refund_amount, b.payment_review_reason,
                bc.court_id, bc.start_at, bc.end_at, bc.is_primary,
                COALESCE(cp.full_name, ca.username, 'Khách vãng lai') as customer_name,
                COALESCE(cp.phone_e164, ca.phone_e164, '') as customer_phone
         FROM booking_courts bc
         JOIN bookings b ON b.id = bc.booking_id
         LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
         LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
         WHERE b.venue_id = $1 AND bc.active = TRUE AND bc.start_at < $3 AND bc.end_at > $2
         ORDER BY bc.start_at ASC`,
        [venueId, start, end]
      ),
      pool.query(
        `SELECT day_of_week, open_time, close_time, is_closed
         FROM opening_hours WHERE venue_id = $1 ORDER BY day_of_week`,
        [venueId]
      ),
    ]);

    return res.json({
      venue_id: venueId,
      date,
      courts: courtsRes.rows,
      bookings: bookingsRes.rows,
      opening_hours: hoursRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.get('/bookings', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId!;
  const { venue_id, date, q } = req.query;

  try {
    const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
    if (assignedVenues.length === 0) {
      return res.json({ bookings: [] });
    }

    let targetVenues = assignedVenues;
    if (venue_id) {
      if (!assignedVenues.includes(venue_id as string)) {
        return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
      }
      targetVenues = [venue_id as string];
    }

    let sql = `
      SELECT b.id, b.booking_code, b.type, b.status,
             b.total_amount, b.deposit_amount, b.paid_amount, b.due_at_venue,
             b.refund_status, b.refund_amount, b.payment_review_reason,
             b.venue_id, v.name as venue_name,
             bc.court_id, c.name as court_name, bc.start_at, bc.end_at,
             COALESCE(cp.full_name, ca.username, 'Khách vãng lai') as customer_name,
             COALESCE(cp.phone_e164, ca.phone_e164, '') as customer_phone
      FROM bookings b
      JOIN venues v ON v.id = b.venue_id
      JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
      JOIN courts c ON c.id = bc.court_id
      LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
      LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
      WHERE b.tenant_id = $1 AND b.venue_id = ANY($2) AND b.type = 'NORMAL'
    `;
    const params: any[] = [tenantId, targetVenues];

    if (date) {
      params.push(`${date}T00:00:00+07:00`);
      params.push(new Date(Date.parse(`${date}T00:00:00+07:00`) + 86400000).toISOString());
      sql += ` AND bc.start_at < $${params.length} AND bc.end_at > $${params.length - 1}`;
    }

    if (q) {
      params.push(`%${String(q).trim()}%`);
      sql += ` AND (
        b.booking_code ILIKE $${params.length}
        OR COALESCE(cp.phone_e164, ca.phone_e164, '') ILIKE $${params.length}
        OR unaccent(COALESCE(cp.full_name, ca.username, '')) ILIKE unaccent($${params.length})
      )`;
    }

    sql += ` ORDER BY bc.start_at DESC LIMIT 60`;
    const result = await pool.query(sql, params);

    return res.json({ bookings: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/staff/v1/bookings
 * Unified Counter Booking — uses exact same price_rules, composite-court expansion,
 * opening-hours validation, and server-side idempotency as Customer bookings (F-05, F-06, F-07)!
 */
staffRouter.post('/bookings', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId!;
  const {
    venue_id,
    court_id,
    start_at,
    end_at,
    customer_phone,
    customer_name = 'Khách vãng lai',
    collect_mode = 'NONE', // 'NONE' | 'DEPOSIT' | 'FULL'
    payment_method = 'CASH', // 'CASH' | 'VIETQR'
  } = req.body;

  if (!venue_id || !court_id || !start_at || !end_at || !customer_phone) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS', message: 'Vui lòng điền đủ cơ sở, sân, giờ chơi và SĐT khách.' });
  }

  const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
  if (!assignedVenues.includes(venue_id)) {
    return res.status(403).json({
      error_code: 'VENUE_ACCESS_DENIED',
      message: 'Nhân viên không được phân công cơ sở này.',
    });
  }

  try {
    return await withIdempotency(req, res, `staff:booking:${staffId}`, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const quote = await validateAndQuoteSlot(client, {
          venueId: venue_id,
          courtId: court_id,
          startAt: start_at,
          endAt: end_at,
          isStaffCounter: true,
          requirePaymentConfig: false,
        });

        const normPhone = normalizePhoneNumber(String(customer_phone));
        let profileId: string;
        const profRes = await client.query(
          `SELECT id, is_restricted FROM customer_profiles WHERE tenant_id = $1 AND phone_e164 = $2`,
          [tenantId, normPhone]
        );
        if (profRes.rows.length > 0) {
          profileId = profRes.rows[0].id;
        } else {
          const newProf = await client.query(
            `INSERT INTO customer_profiles (tenant_id, full_name, phone_e164)
             VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, String(customer_name).trim() || 'Khách vãng lai', normPhone]
          );
          profileId = newProf.rows[0].id;
        }

        let paidNow = 0;
        if (collect_mode === 'FULL') paidNow = quote.totalAmount;
        else if (collect_mode === 'DEPOSIT') paidNow = quote.depositAmount;

        let activeShiftId: string | null = null;
        if (paidNow > 0 && payment_method === 'CASH') {
          const shiftRes = await client.query(
            `SELECT id FROM shifts WHERE staff_id = $1 AND venue_id = $2 AND status = 'OPEN' LIMIT 1`,
            [staffId, venue_id]
          );
          if (shiftRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return {
              status: 400,
              body: {
                error_code: 'SHIFT_REQUIRED_FOR_CASH',
                message: 'Cần mở ca làm việc tại cơ sở này trước khi thu tiền mặt.',
              },
            };
          }
          activeShiftId = shiftRes.rows[0].id;
        }

        const dueAtVenue = Math.max(0, quote.totalAmount - paidNow);
        const bookingCode = generateBookingCode();

        const bRes = await client.query(
          `INSERT INTO bookings (
             tenant_id, venue_id, profile_id, created_by_staff_id, shift_id,
             booking_code, status, total_amount, deposit_amount, paid_amount, due_at_venue
           ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', $7, $8, $9, $10)
           RETURNING *`,
          [
            tenantId,
            venue_id,
            profileId,
            staffId,
            activeShiftId,
            bookingCode,
            quote.totalAmount,
            quote.depositAmount,
            paidNow,
            dueAtVenue,
          ]
        );
        const booking = bRes.rows[0];

        await client.query(
          `INSERT INTO booking_items (
             tenant_id, booking_id, item_type, description, start_at, end_at, quantity, unit_price, total_price
           ) VALUES ($1, $2, 'COURT_SLOT', $3, $4, $5, 1, $6, $6)`,
          [tenantId, booking.id, `${quote.courtName} (${quote.durationMins}p)`, quote.start, quote.end, quote.totalAmount]
        );

        await reservePhysicalCourtRows(client, {
          tenantId,
          venueId: venue_id,
          bookingId: booking.id,
          primaryCourtId: quote.courtId,
          physicalCourtIds: quote.physicalCourtIds,
          start: quote.start,
          end: quote.end,
        });

        if (paidNow > 0) {
          await client.query(
            `INSERT INTO payments (
               tenant_id, booking_id, shift_id, method, amount, transaction_code, status, mismatch_type, confirmed_by_staff_id
             ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 'EXACT', $7)`,
            [tenantId, booking.id, activeShiftId, payment_method, paidNow, `POS-${bookingCode}`, staffId]
          );
          if (payment_method === 'CASH' && activeShiftId) {
            await client.query(
              `INSERT INTO cash_movements (tenant_id, shift_id, type, method, amount, reason, created_by_staff_id)
               VALUES ($1, $2, 'COLLECT', 'CASH', $3, $4, $5)`,
              [tenantId, activeShiftId, paidNow, `Thu tiền đặt sân tại quầy ${bookingCode}`, staffId]
            );
          }
        }

        await client.query('COMMIT');

        for (const cid of quote.physicalCourtIds) {
          broadcastCourtChange({
            venue_id,
            court_id: cid,
            booking_id: booking.id,
            booking_code: booking.booking_code,
            start_at: quote.start.toISOString(),
            end_at: quote.end.toISOString(),
            status: 'CONFIRMED',
            timestamp: new Date().toISOString(),
          });
        }

        await recordAuditLog({
          tenantId,
          actorPortal: 'staff',
          actorId: staffId,
          action: 'CREATE_COUNTER_BOOKING',
          targetTable: 'bookings',
          targetId: booking.id,
          afterState: { booking_code: bookingCode, total_amount: quote.totalAmount, paid_amount: paidNow, due_at_venue: dueAtVenue },
          ipAddress: req.ip,
        });

        return {
          status: 201,
          body: {
            message: 'Đặt sân tại quầy thành công.',
            booking,
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

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/bookings/:id/check-in', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const bookingId = req.params.id;
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId!;

  try {
    const bCheck = await pool.query(
      `SELECT venue_id, status FROM bookings WHERE id = $1 AND tenant_id = $2`,
      [bookingId, tenantId]
    );
    if (bCheck.rows.length === 0) {
      return res.status(404).json({ error_code: 'NOT_FOUND', message: 'Không tìm thấy lịch đặt sân.' });
    }

    const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
    if (!assignedVenues.includes(bCheck.rows[0].venue_id)) {
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED', message: 'Không có quyền thao tác cơ sở này.' });
    }

    const bRes = await pool.query(
      `UPDATE bookings
       SET status = 'CHECKED_IN', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'CONFIRMED'
       RETURNING id, venue_id, booking_code, status`,
      [bookingId, tenantId]
    );

    if (bRes.rows.length === 0) {
      return res.status(400).json({ error_code: 'INVALID_STATUS', message: 'Chỉ lịch ở trạng thái ĐÃ XÁC NHẬN mới có thể Check-in.' });
    }

    const courtsRes = await pool.query(`SELECT court_id, start_at, end_at FROM booking_courts WHERE booking_id = $1 AND active = TRUE`, [bookingId]);
    for (const r of courtsRes.rows) {
      broadcastCourtChange({
        venue_id: bRes.rows[0].venue_id,
        court_id: r.court_id,
        start_at: new Date(r.start_at).toISOString(),
        end_at: new Date(r.end_at).toISOString(),
        status: 'CHECKED_IN',
        timestamp: new Date().toISOString(),
      });
    }

    await recordAuditLog({
      tenantId,
      actorPortal: 'staff',
      actorId: staffId,
      action: 'CHECK_IN',
      targetTable: 'bookings',
      targetId: bookingId,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Khách đã nhận sân (Check-in).', booking: bRes.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

staffRouter.post('/bookings/:id/complete', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const bookingId = req.params.id;
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId!;

  try {
    const bCheck = await pool.query(
      `SELECT venue_id, status, due_at_venue FROM bookings WHERE id = $1 AND tenant_id = $2`,
      [bookingId, tenantId]
    );
    if (bCheck.rows.length === 0) return res.status(404).json({ error_code: 'NOT_FOUND' });

    const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
    if (!assignedVenues.includes(bCheck.rows[0].venue_id)) {
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });
    }
    if (Number(bCheck.rows[0].due_at_venue) > 0) {
      return res.status(400).json({
        error_code: 'BALANCE_OUTSTANDING',
        message: 'Cần thu hết số tiền còn lại tại sân trước khi hoàn tất đơn.',
      });
    }

    const bRes = await pool.query(
      `UPDATE bookings SET status = 'COMPLETED', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('CHECKED_IN', 'CONFIRMED')
       RETURNING id, venue_id, booking_code, status`,
      [bookingId, tenantId]
    );
    if (bRes.rows.length === 0) {
      return res.status(400).json({ error_code: 'INVALID_STATUS', message: 'Không thể hoàn tất đơn ở trạng thái hiện tại.' });
    }

    await recordAuditLog({
      tenantId,
      actorPortal: 'staff',
      actorId: staffId,
      action: 'COMPLETE_BOOKING',
      targetTable: 'bookings',
      targetId: bookingId,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Đã hoàn tất ca thi đấu.', booking: bRes.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/staff/v1/bookings/:id/no-show
 * Atomic state transition from CONFIRMED only — prevents duplicate no_show_count increments (F-08)!
 */
staffRouter.post('/bookings/:id/no-show', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const bookingId = req.params.id;
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId!;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bCheck = await client.query(
      `SELECT id, venue_id, status, profile_id FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [bookingId, tenantId]
    );
    if (bCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error_code: 'NOT_FOUND', message: 'Booking not found.' });
    }

    const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
    if (!assignedVenues.includes(bCheck.rows[0].venue_id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED', message: 'Staff is not authorized for this venue.' });
    }

    if (bCheck.rows[0].status === 'NO_SHOW') {
      await client.query('ROLLBACK');
      return res.json({ message: 'Lịch này đã được ghi nhận vắng mặt trước đó.', status: 'NO_SHOW' });
    }
    if (bCheck.rows[0].status !== 'CONFIRMED') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error_code: 'INVALID_STATUS',
        message: 'Chỉ những lịch ở trạng thái ĐÃ XÁC NHẬN mới có thể đánh dấu Vắng mặt (No-show).',
      });
    }

    const released = await client.query(
      `UPDATE booking_courts SET active = FALSE WHERE booking_id = $1 AND active = TRUE RETURNING court_id, start_at, end_at`,
      [bookingId]
    );
    await client.query(
      `UPDATE bookings SET status = 'NO_SHOW', due_at_venue = 0, updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );

    if (bCheck.rows[0].profile_id) {
      await client.query(
        `UPDATE customer_profiles
         SET no_show_count = no_show_count + 1,
             is_restricted = (no_show_count + 1 >= 3)
         WHERE id = $1`,
        [bCheck.rows[0].profile_id]
      );
    }

    await client.query('COMMIT');

    for (const r of released.rows) {
      broadcastCourtChange({
        venue_id: bCheck.rows[0].venue_id,
        court_id: r.court_id,
        start_at: new Date(r.start_at).toISOString(),
        end_at: new Date(r.end_at).toISOString(),
        status: 'NO_SHOW',
        timestamp: new Date().toISOString(),
      });
    }

    await recordAuditLog({
      tenantId,
      actorPortal: 'staff',
      actorId: staffId,
      action: 'MARK_NO_SHOW',
      targetTable: 'bookings',
      targetId: bookingId,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Đã đánh dấu khách vắng mặt (No-Show) và giải phóng sân.', status: 'NO_SHOW' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

staffRouter.get('/customers/search', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ customers: [] });

  try {
    const resProf = await pool.query(
      `SELECT id, full_name, phone_e164, notes, no_show_count, is_restricted
       FROM customer_profiles
       WHERE tenant_id = $1 AND (phone_e164 ILIKE $2 OR unaccent(full_name) ILIKE unaccent($2))
       LIMIT 10`,
      [tenantId, `%${q}%`]
    );
    return res.json({ customers: resProf.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/staff/v1/payments
 * Transactional money collection with row locking, active shift check, ledger recalculation,
 * idempotency, and proper lifecycle state transition (Fixes F-04 & F-06)!
 */
staffRouter.post('/payments', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const staffId = req.user!.userId;
  const role = req.user!.role;
  const { booking_id, shift_id, method, amount, transaction_code = '' } = req.body;

  const safeAmount = Number(amount);
  if (
    !booking_id ||
    !['CASH', 'VIETQR', 'BANK_TRANSFER'].includes(method) ||
    !Number.isSafeInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    return res.status(400).json({
      error_code: 'INVALID_PAYMENT_INPUT',
      message: 'Số tiền thu phải là số nguyên dương và phương thức hợp lệ.',
    });
  }

  try {
    return await withIdempotency(req, res, `staff:payment:${staffId}:${booking_id}`, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const bRes = await client.query(
          `SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [booking_id, tenantId]
        );
        if (bRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return { status: 404, body: { error_code: 'NOT_FOUND', message: 'Không tìm thấy lịch đặt sân.' } };
        }
        const booking = bRes.rows[0];

        const assignedVenues = await getStaffAssignedVenues(staffId, role, tenantId);
        if (!assignedVenues.includes(booking.venue_id)) {
          await client.query('ROLLBACK');
          return { status: 403, body: { error_code: 'VENUE_ACCESS_DENIED', message: 'Không thuộc cơ sở được phân công.' } };
        }

        if (['CANCELLED', 'EXPIRED', 'NO_SHOW'].includes(booking.status)) {
          await client.query('ROLLBACK');
          return {
            status: 400,
            body: { error_code: 'INVALID_BOOKING_STATUS', message: 'Không thể thu tiền cho đơn đã hủy hoặc hết hạn.' },
          };
        }

        if (safeAmount > Number(booking.due_at_venue)) {
          await client.query('ROLLBACK');
          return {
            status: 400,
            body: {
              error_code: 'AMOUNT_EXCEEDS_DUE',
              message: `Số tiền thu vượt quá số tiền còn phải thu (${booking.due_at_venue} VND).`,
            },
          };
        }

        let resolvedShiftId: string | null = null;
        if (method === 'CASH') {
          const sQuery = shift_id
            ? await client.query(
                `SELECT id FROM shifts WHERE id = $1 AND staff_id = $2 AND venue_id = $3 AND status = 'OPEN'`,
                [shift_id, staffId, booking.venue_id]
              )
            : await client.query(
                `SELECT id FROM shifts WHERE staff_id = $1 AND venue_id = $2 AND status = 'OPEN' LIMIT 1`,
                [staffId, booking.venue_id]
              );
          if (sQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return {
              status: 400,
              body: {
                error_code: 'ACTIVE_SHIFT_REQUIRED',
                message: 'Nhân viên phải đang mở ca trực tại cơ sở này để thu tiền mặt.',
              },
            };
          }
          resolvedShiftId = sQuery.rows[0].id;
        }

        const txCode = String(transaction_code || '').trim() || `COUNTER-${Date.now()}`;
        const payRes = await client.query(
          `INSERT INTO payments (
             tenant_id, booking_id, shift_id, method, amount, transaction_code,
             status, mismatch_type, confirmed_by_staff_id
           ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 'EXACT', $7)
           RETURNING *`,
          [tenantId, booking_id, resolvedShiftId, method, safeAmount, txCode, staffId]
        );

        if (method === 'CASH' && resolvedShiftId) {
          await client.query(
            `INSERT INTO cash_movements (tenant_id, shift_id, type, method, amount, reason, created_by_staff_id)
             VALUES ($1, $2, 'COLLECT', 'CASH', $3, $4, $5)`,
            [tenantId, resolvedShiftId, safeAmount, `Thu tiền đơn ${booking.booking_code}`, staffId]
          );
        }

        const ledgerRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0)::bigint as total_paid
           FROM payments WHERE booking_id = $1 AND status = 'CONFIRMED'`,
          [booking_id]
        );
        const totalPaid = Number(ledgerRes.rows[0].total_paid || 0);
        const newDue = Math.max(0, Number(booking.total_amount) - totalPaid);

        // Correct state transition (F-04):
        // - PENDING + sufficient deposit -> CONFIRMED
        // - CHECKED_IN + due=0 -> COMPLETED
        // - CONFIRMED + due=0 -> remains CONFIRMED until customer checks in / plays!
        let nextStatus = booking.status;
        if (booking.status === 'PENDING' && totalPaid >= Number(booking.deposit_amount)) {
          nextStatus = 'CONFIRMED';
        } else if (booking.status === 'CHECKED_IN' && newDue === 0) {
          nextStatus = 'COMPLETED';
        }

        const updatedB = await client.query(
          `UPDATE bookings
           SET paid_amount = $1,
               due_at_venue = $2,
               status = $3,
               payment_review_reason = CASE WHEN $1 >= deposit_amount THEN NULL ELSE payment_review_reason END,
               updated_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [totalPaid, newDue, nextStatus, booking_id]
        );

        await client.query('COMMIT');

        await recordAuditLog({
          tenantId,
          actorPortal: 'staff',
          actorId: staffId,
          action: 'COLLECT_COUNTER_PAYMENT',
          targetTable: 'payments',
          targetId: payRes.rows[0].id,
          afterState: { booking_id, method, amount: safeAmount, total_paid: totalPaid, due_at_venue: newDue, status: nextStatus },
          ipAddress: req.ip,
        });

        return {
          status: 201,
          body: {
            payment: payRes.rows[0],
            booking: updatedB.rows[0],
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

staffRouter.post('/iot/devices/:id/manual', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  const { command = 'TURN_ON' } = req.body;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    const devRes = await pool.query(
      `SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2 AND venue_id = ANY($3)`,
      [req.params.id, tenantId, assigned]
    );
    if (devRes.rows.length === 0) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

    const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
    const upd = await pool.query(
      `UPDATE device_integrations
       SET power_state = $1, control_mode = 'MANUAL_OVERRIDE', simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
       WHERE id = $2 RETURNING id, device_name, power_state, control_mode, last_heartbeat_at`,
      [nextPower, req.params.id]
    );

    await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_STAFF', $4, 'ACKED', 1, $5)`,
      [tenantId, req.params.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', staffId, `Nhân viên bật/tắt thủ công tại quầy -> ${nextPower}`]
    );

    return res.json({ device: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});


// ============================================================================
// 6. A-33 STAFF IOT LIGHTING ALERTS & MANUAL OVERRIDE (IOT-03)
// ============================================================================

staffRouter.get('/iot/devices', requirePortal('staff'), async (req: AuthenticatedRequest, res: Response) => {
  const staffId = req.user!.userId;
  const tenantId = req.user!.tenantId!;
  try {
    const assigned = await getStaffAssignedVenues(staffId, req.user!.role, tenantId);
    if (assigned.length === 0) return res.json({ devices: [] });

    const r = await pool.query(
      `SELECT d.id, d.venue_id, d.court_id, d.device_name, d.device_type,
              d.power_state, d.control_mode, d.last_error, d.last_heartbeat_at,
              c.name as court_name, v.name as venue_name
       FROM device_integrations d
       JOIN courts c ON c.id = d.court_id
       JOIN venues v ON v.id = d.venue_id
       WHERE d.tenant_id = $1 AND d.venue_id = ANY($2)
       ORDER BY d.last_error IS NULL ASC, c.name ASC`,
      [tenantId, assigned]
    );
    return res.json({ devices: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});
