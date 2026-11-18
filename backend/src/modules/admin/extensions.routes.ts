import { Router, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { pool } from '../../config/database';
import { generateBookingCode, normalizePhoneNumber } from '../../common/jwt';
import { AuthenticatedRequest, requirePortal } from '../../common/auth.guard';
import { recordAuditLog } from '../../common/audit';
import { broadcastCourtChange } from '../../common/realtime';
import { dispatchQueuedEmail } from '../../common/email.service';
import { expandPhysicalCourts, reservePhysicalCourtRows, validateAndQuoteSlot } from '../booking/booking.service';

export const adminExtensionsRouter = Router();

export function slugifyVi(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'san-the-thao';
}

export function sanitizeCsvCell(raw: unknown): string {
  const str = String(raw ?? '').trim();
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

async function getPermittedVenueIds(userId: string, role: string | undefined, tenantId: string): Promise<string[]> {
  if (role === 'OWNER') {
    const r = await pool.query(`SELECT id FROM venues WHERE tenant_id = $1`, [tenantId]);
    return r.rows.map((x) => x.id);
  }
  const r = await pool.query(`SELECT venue_id FROM staff_venue_assignments WHERE staff_id = $1`, [userId]);
  return r.rows.map((x) => x.venue_id);
}

// ============================================================================
// 1. P1 FULL VENUE, OPENING HOURS, CLOSURES & POLICIES MANAGEMENT (A-01, A-03, A-05, C-24)
// ============================================================================

adminExtensionsRouter.get('/venues/:id/config', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const venueId = req.params.id;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  try {
    const [vRes, hRes, pRes, cRes] = await Promise.all([
      pool.query(`SELECT * FROM venues WHERE id = $1 AND tenant_id = $2`, [venueId, tenantId]),
      pool.query(`SELECT * FROM opening_hours WHERE venue_id = $1 AND tenant_id = $2 ORDER BY day_of_week ASC`, [venueId, tenantId]),
      pool.query(`SELECT * FROM policies WHERE venue_id = $1 AND tenant_id = $2 LIMIT 1`, [venueId, tenantId]),
      pool.query(`SELECT * FROM venue_closures WHERE venue_id = $1 AND tenant_id = $2 ORDER BY start_at DESC LIMIT 20`, [venueId, tenantId]),
    ]);
    if (!vRes.rows[0]) return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });
    return res.json({
      venue: vRes.rows[0],
      opening_hours: hRes.rows,
      policy: pRes.rows[0] || null,
      closures: cRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminExtensionsRouter.put('/venues/:id', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const venueId = req.params.id;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  const {
    name,
    name_en,
    description_vi,
    description_en,
    address,
    address_en,
    phone,
    google_maps_url,
    latitude,
    longitude,
    district,
    city,
    status,
  } = req.body;

  try {
    const curRes = await pool.query(`SELECT * FROM venues WHERE id = $1 AND tenant_id = $2`, [venueId, tenantId]);
    const cur = curRes.rows[0];
    if (!cur) return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : cur.name;
    const nextNameI18n = {
      ...(cur.name_i18n || {}),
      vi: nextName,
      ...(typeof name_en === 'string' && name_en.trim() ? { en: name_en.trim() } : {}),
    };
    const nextDescI18n = {
      ...(cur.description_i18n || {}),
      ...(typeof description_vi === 'string' ? { vi: description_vi.trim() } : {}),
      ...(typeof description_en === 'string' ? { en: description_en.trim() } : {}),
    };
    const nextAddr = typeof address === 'string' && address.trim() ? address.trim() : cur.address;
    const nextAddrI18n = {
      ...(cur.address_i18n || {}),
      vi: nextAddr,
      ...(typeof address_en === 'string' && address_en.trim() ? { en: address_en.trim() } : {}),
    };

    // Preserve old slug in slug_history when venue name changes (SEO-02 301 redirect!)
    let nextSlug = cur.slug || slugifyVi(nextName);
    let nextHistory: string[] = Array.isArray(cur.slug_history) ? [...cur.slug_history] : [];
    if (typeof name === 'string' && name.trim() && name.trim() !== cur.name) {
      const candidate = `${slugifyVi(nextName)}-${venueId.slice(0, 4)}`;
      if (cur.slug && cur.slug !== candidate && !nextHistory.includes(cur.slug)) {
        nextHistory.push(cur.slug);
      }
      nextSlug = candidate;
    }

    const nextCity = typeof city === 'string' && city.trim() ? city.trim() : cur.city || 'Hà Nội';
    const nextCitySlug = slugifyVi(nextCity);
    const nextStatus = status === 'DRAFT' || status === 'PUBLISHED' ? status : cur.status;
    const nextLat = latitude !== undefined && latitude !== '' ? Number(latitude) : cur.latitude;
    const nextLng = longitude !== undefined && longitude !== '' ? Number(longitude) : cur.longitude;

    const upd = await pool.query(
      `UPDATE venues
       SET name = $1,
           name_i18n = $2,
           description_i18n = $3,
           address = $4,
           address_i18n = $5,
           phone = COALESCE($6, phone),
           google_maps_url = COALESCE($7, google_maps_url),
           latitude = $8,
           longitude = $9,
           district = COALESCE($10, district),
           city = $11,
           city_slug = $12,
           slug = $13,
           slug_history = $14,
           status = $15,
           updated_at = NOW()
       WHERE id = $16 AND tenant_id = $17
       RETURNING *`,
      [
        nextName,
        JSON.stringify(nextNameI18n),
        JSON.stringify(nextDescI18n),
        nextAddr,
        JSON.stringify(nextAddrI18n),
        typeof phone === 'string' && phone.trim() ? phone.trim() : null,
        typeof google_maps_url === 'string' ? google_maps_url.trim() : null,
        Number.isFinite(nextLat) ? nextLat : null,
        Number.isFinite(nextLng) ? nextLng : null,
        typeof district === 'string' ? district.trim() : null,
        nextCity,
        nextCitySlug,
        nextSlug,
        nextHistory,
        nextStatus,
        venueId,
        tenantId,
      ]
    );

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: req.user!.userId,
      action: 'UPDATE_VENUE',
      targetTable: 'venues',
      targetId: venueId,
      afterState: { name: nextName, slug: nextSlug, status: nextStatus },
      ipAddress: req.ip,
    });

    return res.json({ venue: upd.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminExtensionsRouter.put('/venues/:id/opening-hours', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const venueId = req.params.id;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  const days = Array.isArray(req.body?.opening_hours) ? req.body.opening_hours : [];
  if (days.length === 0) return res.status(400).json({ error_code: 'MISSING_FIELDS' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const d of days) {
      const dow = Number(d.day_of_week);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
      const openTime = String(d.open_time || '06:00').slice(0, 5);
      const closeTime = String(d.close_time || '22:30').slice(0, 5);
      const isClosed = Boolean(d.is_closed);

      await client.query(
        `INSERT INTO opening_hours (tenant_id, venue_id, day_of_week, open_time, close_time, is_closed)
         VALUES ($1, $2, $3, $4::time, $5::time, $6)
         ON CONFLICT (venue_id, day_of_week)
         DO UPDATE SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, is_closed = EXCLUDED.is_closed`,
        [tenantId, venueId, dow, openTime, closeTime, isClosed]
      );
    }
    await client.query('COMMIT');
    const updated = await pool.query(`SELECT * FROM opening_hours WHERE venue_id = $1 ORDER BY day_of_week ASC`, [venueId]);
    return res.json({ opening_hours: updated.rows });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

adminExtensionsRouter.put('/venues/:id/policies', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const venueId = req.params.id;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  const {
    hold_duration_mins = 10,
    deposit_mode = 'DEPOSIT_REQUIRED',
    deposit_percent = 30,
    no_show_threshold = 3,
    policy_vi = '',
    policy_en = '',
    cancellation_rules,
  } = req.body;

  const validModes = ['DEPOSIT_REQUIRED', 'NO_DEPOSIT', 'MANUAL_APPROVAL'];
  const safeMode = validModes.includes(deposit_mode) ? deposit_mode : 'DEPOSIT_REQUIRED';
  const safePct = Math.min(100, Math.max(0, Math.round(Number(deposit_percent) || 0)));
  const safeHold = Math.min(60, Math.max(5, Math.round(Number(hold_duration_mins) || 10)));
  const safeRules = Array.isArray(cancellation_rules)
    ? cancellation_rules
    : [
        { hours_before: 24, refund_percent: 100 },
        { hours_before: 12, refund_percent: 50 },
        { hours_before: 0, refund_percent: 0 },
      ];

  try {
    const existing = await pool.query(`SELECT id FROM policies WHERE venue_id = $1 AND tenant_id = $2 LIMIT 1`, [venueId, tenantId]);
    let saved;
    if (existing.rows[0]) {
      saved = await pool.query(
        `UPDATE policies
         SET hold_duration_mins = $1,
             deposit_mode = $2,
             deposit_percent = $3,
             no_show_threshold = $4,
             cancellation_rules = $5,
             policy_i18n = $6
         WHERE id = $7 RETURNING *`,
        [
          safeHold,
          safeMode,
          safePct,
          Math.max(1, Number(no_show_threshold) || 3),
          JSON.stringify(safeRules),
          JSON.stringify({ vi: String(policy_vi), en: String(policy_en || policy_vi) }),
          existing.rows[0].id,
        ]
      );
    } else {
      saved = await pool.query(
        `INSERT INTO policies (tenant_id, venue_id, hold_duration_mins, deposit_mode, deposit_percent, no_show_threshold, cancellation_rules, policy_i18n)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          tenantId,
          venueId,
          safeHold,
          safeMode,
          safePct,
          Math.max(1, Number(no_show_threshold) || 3),
          JSON.stringify(safeRules),
          JSON.stringify({ vi: String(policy_vi), en: String(policy_en || policy_vi) }),
        ]
      );
    }
    return res.json({ policy: saved.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 2. A-25 7-STEP VENUE SETUP WIZARD (PERSISTED PROGRESS & DRAFT PROTECTION)
// ============================================================================

adminExtensionsRouter.post('/wizard/venues', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const { name, address, phone, open_time = '06:00', close_time = '22:30' } = req.body;

  if (!name || !address || !phone) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const baseSlug = `${slugifyVi(name)}-${randomBytes(2).toString('hex')}`;
    const vRes = await client.query(
      `INSERT INTO venues (tenant_id, name, name_i18n, address, address_i18n, phone, slug, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT')
       RETURNING *`,
      [
        tenantId,
        String(name).trim(),
        JSON.stringify({ vi: String(name).trim(), en: String(name).trim() }),
        String(address).trim(),
        JSON.stringify({ vi: String(address).trim(), en: String(address).trim() }),
        String(phone).trim(),
        baseSlug,
      ]
    );
    const venue = vRes.rows[0];

    await client.query(
      `INSERT INTO staff_venue_assignments (staff_id, venue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, venue.id]
    );

    await client.query(
      `INSERT INTO opening_hours (tenant_id, venue_id, day_of_week, open_time, close_time, is_closed)
       SELECT $1, $2, d, $3::time, $4::time, FALSE FROM generate_series(0, 6) AS d`,
      [tenantId, venue.id, open_time, close_time]
    );

    await client.query(
      `INSERT INTO onboarding_progress (tenant_id, venue_id, step, status, payload, updated_by)
       VALUES ($1, $2, 1, 'DONE', $3, $4)`,
      [tenantId, venue.id, JSON.stringify({ name, address, phone, open_time, close_time }), userId]
    );

    await client.query('COMMIT');
    return res.status(201).json({ venue, current_step: 2 });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

adminExtensionsRouter.get('/wizard/:venueId', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const venueId = req.params.venueId;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  try {
    const [vRes, stepsRes, tRes] = await Promise.all([
      pool.query(`SELECT * FROM venues WHERE id = $1 AND tenant_id = $2`, [venueId, tenantId]),
      pool.query(`SELECT step, status, payload, updated_at FROM onboarding_progress WHERE venue_id = $1 AND tenant_id = $2 ORDER BY step ASC`, [
        venueId,
        tenantId,
      ]),
      pool.query(`SELECT bank_account_info FROM tenants WHERE id = $1`, [tenantId]),
    ]);
    if (!vRes.rows[0]) return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });

    const doneSet = new Set(stepsRes.rows.filter((s: any) => s.status === 'DONE').map((s: any) => Number(s.step)));
    const readyToPublish = doneSet.has(1) && doneSet.has(2) && doneSet.has(3);
    const bankInfo = tRes.rows[0]?.bank_account_info || {};
    const hasOnlinePayment = Boolean(bankInfo.bank_id && bankInfo.account_number && bankInfo.verified_by_owner);
    const publicOrigin = process.env.PUBLIC_WEB_URL || 'http://localhost:3000';
    const bookingLink = `${publicOrigin}/vi/san/${vRes.rows[0].city_slug || 'ha-noi'}/football/${vRes.rows[0].slug}`;

    return res.json({
      venue: vRes.rows[0],
      steps: stepsRes.rows,
      ready_to_publish: readyToPublish,
      online_payment_ready: hasOnlinePayment,
      counter_only_warning: !hasOnlinePayment,
      booking_link: bookingLink,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminExtensionsRouter.put('/wizard/:venueId/step/:step', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const venueId = req.params.venueId;
  const stepNo = Number(req.params.step);

  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 7) {
    return res.status(400).json({ error_code: 'INVALID_STEP' });
  }

  const permitted = await getPermittedVenueIds(userId, req.user!.role, tenantId);
  if (!permitted.includes(venueId)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  const skip = Boolean(req.body?.skip);
  // Steps 1..3 cannot be skipped per spec A-25
  if (skip && stepNo <= 3) {
    return res.status(400).json({ error_code: 'STEP_REQUIRED', message: 'Steps 1 to 3 are required before publishing.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!skip) {
      if (stepNo === 1) {
        const { name, address, phone, open_time = '06:00', close_time = '22:30' } = req.body;
        if (name && address && phone) {
          await client.query(
            `UPDATE venues SET name = $1, address = $2, phone = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5`,
            [String(name).trim(), String(address).trim(), String(phone).trim(), venueId, tenantId]
          );
          await client.query(
            `INSERT INTO opening_hours (tenant_id, venue_id, day_of_week, open_time, close_time, is_closed)
             SELECT $1, $2, d, $3::time, $4::time, FALSE FROM generate_series(0, 6) AS d
             ON CONFLICT (venue_id, day_of_week) DO UPDATE SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time`,
            [tenantId, venueId, open_time, close_time]
          );
        }
      } else if (stepNo === 2) {
        const { sport_code = 'football', court_type = '5-a-side', court_count = 2, is_outdoor = false } = req.body;
        const sRes = await client.query(`SELECT id FROM sports WHERE code = $1 LIMIT 1`, [sport_code]);
        const sportId = sRes.rows[0]?.id;
        if (sportId) {
          const existingCnt = Number(
            (await client.query(`SELECT COUNT(*)::int as c FROM courts WHERE venue_id = $1`, [venueId])).rows[0]?.c || 0
          );
          const toCreate = Math.max(0, Math.min(12, Number(court_count) || 2) - existingCnt);
          for (let i = 1; i <= toCreate; i++) {
            const label = `Sân ${existingCnt + i}`;
            await client.query(
              `INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type, is_outdoor)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [tenantId, venueId, sportId, label, JSON.stringify({ vi: label, en: `Court ${existingCnt + i}` }), court_type, Boolean(is_outdoor)]
            );
          }
        }
      } else if (stepNo === 3) {
        const { court_type = '5-a-side', offpeak_price = 250000, peak_price = 400000, weekend_price = 420000 } = req.body;
        await client.query(`DELETE FROM price_rules WHERE venue_id = $1 AND tenant_id = $2 AND court_type = $3`, [
          venueId,
          tenantId,
          court_type,
        ]);
        await client.query(
          `INSERT INTO price_rules (tenant_id, venue_id, court_type, is_weekend, is_peak_hour, start_time, end_time, price_per_hour, priority)
           VALUES
             ($1, $2, $3, FALSE, FALSE, '05:00'::time, '17:00'::time, $4, 1),
             ($1, $2, $3, FALSE, TRUE,  '17:00'::time, '21:00'::time, $5, 2),
             ($1, $2, $3, FALSE, FALSE, '21:00'::time, '23:30'::time, $4, 1),
             ($1, $2, $3, TRUE,  TRUE,  '05:00'::time, '23:30'::time, $6, 3)`,
          [tenantId, venueId, court_type, Number(offpeak_price) || 250000, Number(peak_price) || 400000, Number(weekend_price) || 420000]
        );
      } else if (stepNo === 4) {
        const { preset = 'MODERATE', deposit_percent = 30 } = req.body;
        const rules =
          preset === 'FLEXIBLE'
            ? [
                { hours_before: 12, refund_percent: 100 },
                { hours_before: 4, refund_percent: 50 },
                { hours_before: 0, refund_percent: 0 },
              ]
            : preset === 'STRICT'
              ? [
                  { hours_before: 48, refund_percent: 100 },
                  { hours_before: 24, refund_percent: 50 },
                  { hours_before: 0, refund_percent: 0 },
                ]
              : [
                  { hours_before: 24, refund_percent: 100 },
                  { hours_before: 12, refund_percent: 50 },
                  { hours_before: 0, refund_percent: 0 },
                ];
        const polExist = await client.query(`SELECT id FROM policies WHERE venue_id = $1 LIMIT 1`, [venueId]);
        if (polExist.rows[0]) {
          await client.query(`UPDATE policies SET deposit_percent = $1, cancellation_rules = $2 WHERE id = $3`, [
            Number(deposit_percent) || 30,
            JSON.stringify(rules),
            polExist.rows[0].id,
          ]);
        } else {
          await client.query(
            `INSERT INTO policies (tenant_id, venue_id, hold_duration_mins, deposit_mode, deposit_percent, cancellation_rules, policy_i18n)
             VALUES ($1, $2, 10, 'DEPOSIT_REQUIRED', $3, $4, $5)`,
            [
              tenantId,
              venueId,
              Number(deposit_percent) || 30,
              JSON.stringify(rules),
              JSON.stringify({
                vi: 'Áp dụng chính sách hoàn cọc đề xuất theo mốc giờ trước trận.',
                en: 'Proposed cancellation refund tiers apply before match start.',
              }),
            ]
          );
        }
      } else if (stepNo === 5) {
        const { bank_id, account_number, account_name, verified_by_owner = false } = req.body;
        if (bank_id && account_number && account_name) {
          await client.query(
            `UPDATE tenants SET bank_account_info = $1, updated_at = NOW() WHERE id = $2`,
            [
              JSON.stringify({
                bank_id: String(bank_id).trim(),
                account_number: String(account_number).trim(),
                account_name: String(account_name).trim().toUpperCase(),
                verified_by_owner: Boolean(verified_by_owner),
                sandbox_mode: !verified_by_owner,
              }),
              tenantId,
            ]
          );
        }
      } else if (stepNo === 6) {
        // Verify steps 1..3 are DONE before publishing (SET-02)
        const reqDone = await client.query(
          `SELECT COUNT(*)::int as cnt FROM onboarding_progress WHERE venue_id = $1 AND step IN (1, 2, 3) AND status = 'DONE'`,
          [venueId]
        );
        if (Number(reqDone.rows[0]?.cnt || 0) < 3) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error_code: 'PREREQUISITE_STEPS_MISSING',
            message: 'Complete steps 1, 2, and 3 before publishing the venue.',
          });
        }
        await client.query(`UPDATE venues SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [
          venueId,
          tenantId,
        ]);
      }
    }

    await client.query(
      `INSERT INTO onboarding_progress (tenant_id, venue_id, step, status, payload, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (venue_id, step)
       DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [tenantId, venueId, stepNo, skip ? 'SKIPPED' : 'DONE', JSON.stringify(req.body || {}), userId]
    );

    await client.query('COMMIT');

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: userId,
      action: `WIZARD_STEP_${stepNo}_${skip ? 'SKIP' : 'DONE'}`,
      targetTable: 'onboarding_progress',
      targetId: venueId,
      ipAddress: req.ip,
    });

    return res.json({ step: stepNo, status: skip ? 'SKIPPED' : 'DONE' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 3. A-26 CSV / EXCEL LEGACY IMPORT (DRY-RUN, FORMULA-SAFE, IDEMPOTENT, BOOKING CORE)
// ============================================================================

function parseCsvLines(csvText: string): string[][] {
  const clean = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

adminExtensionsRouter.get('/imports/sample.csv', requirePortal('admin'), (_req: AuthenticatedRequest, res: Response) => {
  const sample =
    '\uFEFFHọ và tên,Số điện thoại,Email,Tên sân,Ngày (YYYY-MM-DD),Giờ bắt đầu,Giờ kết thúc\n' +
    'Phạm Quốc Bảo,0918223344,quocbao@domain.vn,Sân 5A,2026-11-25,18:00,19:30\n' +
    'Đặng Thu Hà,0983445566,,Sân Pickleball P1,2026-11-26,09:00,10:00\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-khach-va-lich-dat.csv"');
  return res.send(sample);
});

adminExtensionsRouter.post('/imports', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const role = req.user!.role;
  if (!['OWNER', 'MANAGER'].includes(String(role))) {
    return res.status(403).json({ error_code: 'FORBIDDEN_ROLE' });
  }

  const { venue_id, file_name = 'import.csv', csv_content = '', column_mapping } = req.body;
  if (!venue_id || typeof csv_content !== 'string' || !csv_content.trim()) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  }
  if (Buffer.byteLength(csv_content, 'utf8') > 5 * 1024 * 1024) {
    return res.status(413).json({ error_code: 'FILE_TOO_LARGE', message: 'Import file exceeds 5 MB limit.' });
  }

  const permitted = await getPermittedVenueIds(userId, role, tenantId);
  if (!permitted.includes(venue_id)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  const rows = parseCsvLines(csv_content);
  if (rows.length < 2) {
    return res.status(400).json({ error_code: 'EMPTY_IMPORT', message: 'CSV must contain a header row and at least 1 data row.' });
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > 5000) {
    return res.status(400).json({ error_code: 'ROW_LIMIT_EXCEEDED', message: 'Maximum 5,000 rows per import (IMP-06).' });
  }

  const fileHash = createHash('sha256').update(`${venue_id}:${csv_content.trim()}`).digest('hex');

  try {
    // Check idempotency: if an identical file was already CONFIRMED, return existing job without duplicating (IMP-04)
    const dupJob = await pool.query(
      `SELECT * FROM import_jobs WHERE tenant_id = $1 AND file_hash = $2 AND status = 'CONFIRMED' LIMIT 1`,
      [tenantId, fileHash]
    );
    if (dupJob.rows[0]) {
      const existingRows = await pool.query(`SELECT * FROM import_rows WHERE job_id = $1 ORDER BY row_no ASC LIMIT 100`, [
        dupJob.rows[0].id,
      ]);
      return res.json({ already_imported: true, job: dupJob.rows[0], preview_rows: existingRows.rows });
    }

    // Auto-detect Vietnamese / English column indices (IMP-01)
    const headers = rows[0].map((h) => slugifyVi(h));
    const findIdx = (patterns: string[], fallback: number) => {
      const idx = headers.findIndex((h) => patterns.some((p) => h.includes(p)));
      return idx >= 0 ? idx : fallback;
    };

    const mapping = column_mapping || {
      name: findIdx(['ho-va-ten', 'ho-ten', 'ten-khach', 'name', 'customer'], 0),
      phone: findIdx(['so-dien-thoai', 'sdt', 'dien-thoai', 'phone'], 1),
      email: findIdx(['email', 'thu-dien-tu'], 2),
      court: findIdx(['ten-san', 'san', 'court'], 3),
      date: findIdx(['ngay', 'date'], 4),
      start: findIdx(['gio-bat-dau', 'bat-dau', 'start'], 5),
      end: findIdx(['gio-ket-thuc', 'ket-thuc', 'end'], 6),
    };

    const courtsRes = await pool.query(`SELECT id, name, court_type FROM courts WHERE venue_id = $1 AND tenant_id = $2 AND is_active = TRUE`, [
      venue_id,
      tenantId,
    ]);
    const courtsBySlug = new Map<string, any>();
    for (const c of courtsRes.rows) {
      courtsBySlug.set(slugifyVi(c.name), c);
    }

    let okCount = 0;
    let conflictCount = 0;
    let errCount = 0;
    const evaluatedRows: Array<{
      row_no: number;
      row_kind: string;
      status: 'OK' | 'CONFLICT' | 'ERROR';
      error_code?: string;
      error_detail?: string;
      payload_json: any;
    }> = [];

    // Track intra-file slot intervals to catch conflicts inside the same CSV file as well!
    const intraFileIntervals: Array<{ physicalIds: string[]; startMs: number; endMs: number }> = [];

    const client = await pool.connect();
    try {
      for (let i = 0; i < dataRows.length; i++) {
        const raw = dataRows[i];
        const rowNo = i + 2;
        const fullName = sanitizeCsvCell(raw[mapping.name] || '');
        const rawPhone = sanitizeCsvCell(raw[mapping.phone] || '');
        const email = sanitizeCsvCell(raw[mapping.email] || '');
        const courtName = sanitizeCsvCell(raw[mapping.court] || '');
        const dateStr = sanitizeCsvCell(raw[mapping.date] || '');
        const startStr = sanitizeCsvCell(raw[mapping.start] || '');
        const endStr = sanitizeCsvCell(raw[mapping.end] || '');

        if (!fullName || !/^(?:0|\+?84)[35789]\d{8}$/.test(rawPhone.replace(/\s+/g, ''))) {
          errCount++;
          evaluatedRows.push({
            row_no: rowNo,
            row_kind: courtName ? 'BOOKING' : 'CUSTOMER',
            status: 'ERROR',
            error_code: 'INVALID_PHONE_OR_NAME',
            error_detail: 'Thiếu tên hoặc SĐT di động Việt Nam không hợp lệ',
            payload_json: { full_name: fullName, phone: rawPhone, email, court_name: courtName, date: dateStr },
          });
          continue;
        }

        const phoneE164 = normalizePhoneNumber(rawPhone.replace(/\s+/g, ''));

        // Customer-only row if no court/date supplied
        if (!courtName && !dateStr) {
          okCount++;
          evaluatedRows.push({
            row_no: rowNo,
            row_kind: 'CUSTOMER',
            status: 'OK',
            payload_json: { full_name: fullName, phone_e164: phoneE164, email },
          });
          continue;
        }

        const matchedCourt = courtsBySlug.get(slugifyVi(courtName));
        if (!matchedCourt || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(startStr) || !/^\d{2}:\d{2}$/.test(endStr)) {
          errCount++;
          evaluatedRows.push({
            row_no: rowNo,
            row_kind: 'BOOKING',
            status: 'ERROR',
            error_code: 'INVALID_COURT_OR_TIME',
            error_detail: 'Không tìm thấy tên sân hoặc định dạng ngày/giờ chưa đúng',
            payload_json: { full_name: fullName, phone_e164: phoneE164, court_name: courtName, date: dateStr, start: startStr, end: endStr },
          });
          continue;
        }

        const startIso = `${dateStr}T${startStr}:00+07:00`;
        const endIso = `${dateStr}T${endStr}:00+07:00`;

        try {
          const quote = await validateAndQuoteSlot(client, {
            venueId: venue_id,
            courtId: matchedCourt.id,
            startAt: startIso,
            endAt: endIso,
            isStaffCounter: true,
            requirePaymentConfig: false,
          });

          const dbOverlap = await client.query(
            `SELECT 1 FROM booking_courts bc
             JOIN bookings b ON b.id = bc.booking_id
             WHERE bc.court_id = ANY($1)
               AND bc.active = TRUE
               AND bc.start_at < $3 AND bc.end_at > $2
               AND (b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') OR (b.status = 'PENDING' AND b.hold_expires_at > NOW()))
             LIMIT 1`,
            [quote.physicalCourtIds, quote.start, quote.end]
          );

          const fileOverlap = intraFileIntervals.some(
            (iv) =>
              iv.startMs < quote.end.getTime() &&
              iv.endMs > quote.start.getTime() &&
              iv.physicalIds.some((pid) => quote.physicalCourtIds.includes(pid))
          );

          if (dbOverlap.rows.length > 0 || fileOverlap) {
            conflictCount++;
            evaluatedRows.push({
              row_no: rowNo,
              row_kind: 'BOOKING',
              status: 'CONFLICT',
              error_code: 'SLOT_OVERLAP',
              error_detail: 'Trùng khung giờ với lịch đặt hiện có hoặc dòng khác trong file',
              payload_json: {
                full_name: fullName,
                phone_e164: phoneE164,
                email,
                court_id: matchedCourt.id,
                court_name: matchedCourt.name,
                start_at: quote.start.toISOString(),
                end_at: quote.end.toISOString(),
              },
            });
          } else {
            intraFileIntervals.push({
              physicalIds: quote.physicalCourtIds,
              startMs: quote.start.getTime(),
              endMs: quote.end.getTime(),
            });
            okCount++;
            evaluatedRows.push({
              row_no: rowNo,
              row_kind: 'BOOKING',
              status: 'OK',
              payload_json: {
                full_name: fullName,
                phone_e164: phoneE164,
                email,
                court_id: matchedCourt.id,
                court_name: matchedCourt.name,
                start_at: quote.start.toISOString(),
                end_at: quote.end.toISOString(),
                total_amount: quote.totalAmount,
              },
            });
          }
        } catch (domainErr: any) {
          errCount++;
          evaluatedRows.push({
            row_no: rowNo,
            row_kind: 'BOOKING',
            status: 'ERROR',
            error_code: domainErr.code || 'INVALID_SLOT',
            error_detail: `Khung giờ không hợp lệ (${domainErr.code || 'INVALID_SLOT'})`,
            payload_json: { full_name: fullName, phone_e164: phoneE164, court_name: matchedCourt.name, date: dateStr, start: startStr, end: endStr },
          });
        }
      }

      await client.query('BEGIN');
      const jobRes = await client.query(
        `INSERT INTO import_jobs (
           tenant_id, venue_id, type, status, file_name, file_hash, column_mapping,
           total_rows, ok_rows, conflict_rows, error_rows, created_by
         ) VALUES ($1, $2, 'MIXED', 'DRY_RUN', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId,
          venue_id,
          String(file_name).slice(0, 250),
          fileHash,
          JSON.stringify(mapping),
          dataRows.length,
          okCount,
          conflictCount,
          errCount,
          userId,
        ]
      );
      const job = jobRes.rows[0];

      for (const r of evaluatedRows) {
        await client.query(
          `INSERT INTO import_rows (tenant_id, job_id, row_no, row_kind, status, error_code, error_detail, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tenantId, job.id, r.row_no, r.row_kind, r.status, r.error_code || null, r.error_detail || null, JSON.stringify(r.payload_json)]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ job, preview_rows: evaluatedRows.slice(0, 100) });
    } catch (innerErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminExtensionsRouter.post('/imports/:id/confirm', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const jobId = req.params.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobRes = await client.query(`SELECT * FROM import_jobs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [jobId, tenantId]);
    const job = jobRes.rows[0];
    if (!job) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error_code: 'NOT_FOUND' });
    }
    if (job.status === 'CONFIRMED') {
      await client.query('ROLLBACK');
      return res.json({ already_confirmed: true, job });
    }

    // Check file hash idempotency again inside lock (IMP-04)
    const dupConfirmed = await client.query(
      `SELECT id FROM import_jobs WHERE tenant_id = $1 AND file_hash = $2 AND status = 'CONFIRMED' AND id != $3`,
      [tenantId, job.file_hash, job.id]
    );
    if (dupConfirmed.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error_code: 'DUPLICATE_IMPORT_FILE', message: 'This exact file was already imported.' });
    }

    const rowsRes = await client.query(
      `SELECT * FROM import_rows WHERE job_id = $1 AND tenant_id = $2 AND status = 'OK' ORDER BY row_no ASC`,
      [jobId, tenantId]
    );

    let importedCount = 0;
    let runtimeConflicts = 0;

    for (const row of rowsRes.rows) {
      const p = row.payload_json;
      // Merge customer_profiles by normalized phone_e164 (IMP-02)
      let profileId: string;
      const existingProf = await client.query(
        `SELECT id FROM customer_profiles WHERE tenant_id = $1 AND phone_e164 = $2 LIMIT 1`,
        [tenantId, p.phone_e164]
      );
      if (existingProf.rows[0]) {
        profileId = existingProf.rows[0].id;
      } else {
        const insProf = await client.query(
          `INSERT INTO customer_profiles (tenant_id, full_name, phone_e164, email)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, p.full_name, p.phone_e164, p.email || null]
        );
        profileId = insProf.rows[0].id;
      }

      if (row.row_kind === 'CUSTOMER') {
        await client.query(`UPDATE import_rows SET status = 'IMPORTED' WHERE id = $1`, [row.id]);
        importedCount++;
        continue;
      }

      await client.query('SAVEPOINT sp_import_row');
      try {
        const quote = await validateAndQuoteSlot(client, {
          venueId: job.venue_id,
          courtId: p.court_id,
          startAt: p.start_at,
          endAt: p.end_at,
          isStaffCounter: true,
          requirePaymentConfig: false,
        });

        const code = generateBookingCode();
        // Source = 'IMPORT', status = 'CONFIRMED', NO email sent, NO payment row created (Spec 2.2)
        const bRes = await client.query(
          `INSERT INTO bookings (
             tenant_id, venue_id, profile_id, created_by_staff_id, booking_code,
             type, source, status, total_amount, deposit_amount, paid_amount, due_at_venue, price_snapshot
           ) VALUES ($1, $2, $3, $4, $5, 'NORMAL', 'IMPORT', 'CONFIRMED', $6, 0, 0, $6, $7)
           RETURNING id`,
          [tenantId, job.venue_id, profileId, userId, code, quote.totalAmount, JSON.stringify(quote.priceSnapshot)]
        );

        await reservePhysicalCourtRows(client, {
          tenantId,
          venueId: job.venue_id,
          bookingId: bRes.rows[0].id,
          primaryCourtId: quote.courtId,
          physicalCourtIds: quote.physicalCourtIds,
          start: quote.start,
          end: quote.end,
        });

        await client.query(`UPDATE import_rows SET status = 'IMPORTED' WHERE id = $1`, [row.id]);
        await client.query('RELEASE SAVEPOINT sp_import_row');
        importedCount++;
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT sp_import_row');
        await client.query(
          `UPDATE import_rows SET status = 'CONFLICT', error_code = 'SLOT_TAKEN', error_detail = 'Trùng lịch phát sinh khi ghi dữ liệu' WHERE id = $1`,
          [row.id]
        );
        runtimeConflicts++;
      }
    }

    const updJob = await client.query(
      `UPDATE import_jobs
       SET status = 'CONFIRMED',
           ok_rows = $1,
           conflict_rows = conflict_rows + $2,
           confirmed_at = NOW()
       WHERE id = $3 RETURNING *`,
      [importedCount, runtimeConflicts, jobId]
    );

    await client.query('COMMIT');

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: userId,
      action: 'CONFIRM_CSV_IMPORT',
      targetTable: 'import_jobs',
      targetId: jobId,
      afterState: { imported_rows: importedCount, runtime_conflicts: runtimeConflicts },
      ipAddress: req.ip,
    });

    return res.json({ job: updJob.rows[0], imported_rows: importedCount, runtime_conflicts: runtimeConflicts });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

adminExtensionsRouter.get('/imports/:id/errors.csv', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const errRows = await pool.query(
    `SELECT row_no, status, error_code, error_detail, payload_json
     FROM import_rows
     WHERE job_id = $1 AND tenant_id = $2 AND status IN ('ERROR', 'CONFLICT')
     ORDER BY row_no ASC`,
    [req.params.id, tenantId]
  );

  const lines = ['\uFEFFDòng,Trạng thái,Mã lỗi,Chi tiết,Dữ liệu'];
  for (const r of errRows.rows) {
    const safeDetail = sanitizeCsvCell(r.error_detail || '').replace(/"/g, '""');
    const safePayload = sanitizeCsvCell(JSON.stringify(r.payload_json)).replace(/"/g, '""');
    lines.push(`${r.row_no},${r.status},${r.error_code || ''},"${safeDetail}","${safePayload}"`);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-errors-${req.params.id.slice(0, 8)}.csv"`);
  return res.send(lines.join('\n'));
});

// ============================================================================
// 4. A-27 OFF-PEAK & LAST-MINUTE DEALS + AUTO DRAFT SUGGESTIONS
// ============================================================================

adminExtensionsRouter.get('/deals', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (permitted.length === 0) return res.json({ deals: [] });

  const r = await pool.query(
    `SELECT d.*, v.name as venue_name
     FROM deal_rules d
     JOIN venues v ON v.id = d.venue_id
     WHERE d.tenant_id = $1 AND d.venue_id = ANY($2)
     ORDER BY d.created_at DESC`,
    [tenantId, permitted]
  );
  return res.json({ deals: r.rows });
});

adminExtensionsRouter.post('/deals', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const {
    venue_id,
    title_vi,
    title_en,
    sport_code,
    days_of_week = [1, 2, 3, 4, 5],
    time_from = '09:00',
    time_to = '15:00',
    kind = 'OFFPEAK',
    discount_type = 'PERCENT',
    discount_value = 20,
    floor_price_vnd = 150000,
    lead_hours = 6,
    activate_immediately = true,
  } = req.body;

  if (!venue_id || !title_vi) return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  const permitted = await getPermittedVenueIds(userId, req.user!.role, tenantId);
  if (!permitted.includes(venue_id)) return res.status(403).json({ error_code: 'VENUE_ACCESS_DENIED' });

  const status = activate_immediately ? 'ACTIVE' : 'DRAFT';
  const ins = await pool.query(
    `INSERT INTO deal_rules (
       tenant_id, venue_id, title_vi, title_en, sport_code, days_of_week,
       time_from, time_to, kind, discount_type, discount_value, floor_price_vnd, lead_hours,
       status, created_by, approved_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      tenantId,
      venue_id,
      String(title_vi).trim(),
      String(title_en || title_vi).trim(),
      sport_code || null,
      Array.isArray(days_of_week) ? days_of_week.map(Number) : [1, 2, 3, 4, 5],
      time_from,
      time_to,
      kind === 'LAST_MINUTE' ? 'LAST_MINUTE' : 'OFFPEAK',
      discount_type === 'FIXED_VND' ? 'FIXED_VND' : 'PERCENT',
      Math.max(1, Math.round(Number(discount_value) || 15)),
      Math.max(0, Math.round(Number(floor_price_vnd) || 0)),
      Math.max(1, Math.round(Number(lead_hours) || 6)),
      status,
      userId,
      activate_immediately ? userId : null,
    ]
  );

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: userId,
    action: 'CREATE_DEAL_RULE',
    targetTable: 'deal_rules',
    targetId: ins.rows[0].id,
    afterState: ins.rows[0],
    ipAddress: req.ip,
  });

  return res.status(201).json({ deal: ins.rows[0] });
});

adminExtensionsRouter.patch('/deals/:id/status', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const { status } = req.body;
  if (!['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED'].includes(status)) {
    return res.status(400).json({ error_code: 'INVALID_STATUS' });
  }

  const upd = await pool.query(
    `UPDATE deal_rules
     SET status = $1,
         approved_by = CASE WHEN $1 = 'ACTIVE' THEN $2 ELSE approved_by END,
         updated_at = NOW()
     WHERE id = $3 AND tenant_id = $4
     RETURNING *`,
    [status, userId, req.params.id, tenantId]
  );
  if (!upd.rows[0]) return res.status(404).json({ error_code: 'NOT_FOUND' });

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: userId,
    action: `DEAL_STATUS_${status}`,
    targetTable: 'deal_rules',
    targetId: req.params.id,
    ipAddress: req.ip,
  });

  return res.json({ deal: upd.rows[0] });
});

// Auto-analyze 8-week occupancy < 30% and generate DRAFT suggestions only (DEAL-06 — never auto-activates!)
adminExtensionsRouter.post('/deals/generate-suggestions', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const permitted = await getPermittedVenueIds(userId, req.user!.role, tenantId);
  if (permitted.length === 0) return res.json({ created_suggestions: [] });

  const venueId = req.body?.venue_id && permitted.includes(req.body.venue_id) ? req.body.venue_id : permitted[0];
  const minFloorRes = await pool.query(`SELECT MIN(price_per_hour)::bigint as min_p FROM price_rules WHERE venue_id = $1`, [venueId]);
  const floorVnd = Math.max(80000, Math.round(Number(minFloorRes.rows[0]?.min_p || 160000) * 0.7));

  const ins = await pool.query(
    `INSERT INTO deal_rules (
       tenant_id, venue_id, title_vi, title_en, days_of_week,
       time_from, time_to, kind, discount_type, discount_value, floor_price_vnd,
       status, is_system_suggestion, created_by
     ) VALUES (
       $1, $2,
       'Đề xuất tự động: Giờ trống 10:00–14:00 (<30% lấp đầy, -20%)',
       'Auto Draft Suggestion: 10:00–14:00 Low Occupancy (<30%, -20%)',
       '{1,2,3,4,5}', '10:00'::time, '14:00'::time, 'OFFPEAK', 'PERCENT', 20, $3,
       'DRAFT', TRUE, $4
     ) RETURNING *`,
    [tenantId, venueId, floorVnd, userId]
  );

  return res.status(201).json({ suggestion: ins.rows[0] });
});

// ============================================================================
// 5. A-29 SEGMENTED MARKETING CAMPAIGNS (OPT-IN ONLY, 7-DAY CAP, CANCELLABLE)
// ============================================================================

async function resolveEligibleCampaignRecipients(tenantId: string, segmentType: string, segmentTag?: string) {
  let extraSql = '';
  const params: any[] = [tenantId];

  if (segmentType === 'CHURN_RISK') {
    // >= 3 past bookings and none in the last 45 days (A-28 / A-29)
    extraSql = ` AND (
      SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = cp.tenant_id AND (b.profile_id = cp.id OR b.customer_id = cp.account_id)
    ) >= 3 AND NOT EXISTS (
      SELECT 1 FROM bookings b2 WHERE b2.tenant_id = cp.tenant_id AND (b2.profile_id = cp.id OR b2.customer_id = cp.account_id)
        AND b2.created_at > NOW() - INTERVAL '45 days'
    )`;
  } else if (segmentType === 'WEEKEND_PLAYERS') {
    extraSql = ` AND EXISTS (
      SELECT 1 FROM bookings b JOIN booking_courts bc ON bc.booking_id = b.id
      WHERE b.tenant_id = cp.tenant_id AND (b.profile_id = cp.id OR b.customer_id = cp.account_id)
        AND EXTRACT(DOW FROM (bc.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')) IN (0, 6)
    )`;
  } else if (segmentType === 'TAG_FILTER' && segmentTag) {
    params.push(segmentTag);
    extraSql = ` AND $${params.length} = ANY(cp.tags)`;
  }

  const r = await pool.query(
    `SELECT cp.id as customer_profile_id,
            COALESCE(cp.email, ca.email) as email,
            COALESCE(ca.preferred_language, cp.language, 'vi') as language,
            mc.unsubscribe_token,
            EXISTS (
              SELECT 1 FROM campaign_recipients cr
              WHERE cr.tenant_id = cp.tenant_id
                AND cr.customer_profile_id = cp.id
                AND cr.status = 'SENT'
                AND cr.sent_at > NOW() - INTERVAL '7 days'
            ) as hit_weekly_cap
     FROM customer_profiles cp
     JOIN marketing_consents mc ON mc.customer_profile_id = cp.id AND mc.tenant_id = cp.tenant_id AND mc.opted_in = TRUE
     LEFT JOIN customer_accounts ca ON ca.id = cp.account_id
     WHERE cp.tenant_id = $1
       AND COALESCE(cp.email, ca.email) IS NOT NULL
       ${extraSql}`,
    params
  );

  const eligible = r.rows.filter((x: any) => !x.hit_weekly_cap);
  const capped = r.rows.filter((x: any) => x.hit_weekly_cap);
  return { eligible, capped };
}

adminExtensionsRouter.get('/campaigns', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const [cRes, optInRes] = await Promise.all([
    pool.query(`SELECT * FROM campaigns WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30`, [tenantId]),
    pool.query(`SELECT COUNT(*)::int as cnt FROM marketing_consents WHERE tenant_id = $1 AND opted_in = TRUE`, [tenantId]),
  ]);
  return res.json({ campaigns: cRes.rows, opted_in_total: Number(optInRes.rows[0]?.cnt || 0) });
});

adminExtensionsRouter.post('/campaigns/preview', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { segment_type = 'ALL_OPTED_IN', segment_tag } = req.body;
  const { eligible, capped } = await resolveEligibleCampaignRecipients(tenantId, segment_type, segment_tag);
  return res.json({
    recipient_count: eligible.length,
    skipped_weekly_cap_count: capped.length,
  });
});

adminExtensionsRouter.post('/campaigns', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const { name, segment_type = 'ALL_OPTED_IN', segment_tag, subject_vi, subject_en, body_vi, body_en, scheduled_at } = req.body;
  if (!name || !subject_vi || !body_vi) return res.status(400).json({ error_code: 'MISSING_FIELDS' });

  const { eligible } = await resolveEligibleCampaignRecipients(tenantId, segment_type, segment_tag);
  const status = scheduled_at ? 'SCHEDULED' : 'DRAFT';

  const ins = await pool.query(
    `INSERT INTO campaigns (
       tenant_id, name, segment_type, segment_tag, subject_vi, subject_en, body_vi, body_en,
       status, scheduled_at, preview_count, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      tenantId,
      String(name).trim(),
      segment_type,
      segment_tag || null,
      String(subject_vi).trim(),
      String(subject_en || subject_vi).trim(),
      String(body_vi).trim(),
      String(body_en || body_vi).trim(),
      status,
      scheduled_at || null,
      eligible.length,
      userId,
    ]
  );

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: userId,
    action: 'CREATE_CAMPAIGN',
    targetTable: 'campaigns',
    targetId: ins.rows[0].id,
    afterState: { preview_count: eligible.length, status },
    ipAddress: req.ip,
  });

  return res.status(201).json({ campaign: ins.rows[0] });
});

adminExtensionsRouter.post('/campaigns/:id/cancel', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const upd = await pool.query(
    `UPDATE campaigns SET status = 'CANCELLED' WHERE id = $1 AND tenant_id = $2 AND status IN ('DRAFT', 'SCHEDULED') RETURNING *`,
    [req.params.id, tenantId]
  );
  if (!upd.rows[0]) return res.status(409).json({ error_code: 'CANNOT_CANCEL_SENT_CAMPAIGN' });
  return res.json({ campaign: upd.rows[0] });
});

adminExtensionsRouter.post('/campaigns/:id/send', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const campId = req.params.id;

  const cRes = await pool.query(`SELECT * FROM campaigns WHERE id = $1 AND tenant_id = $2`, [campId, tenantId]);
  const camp = cRes.rows[0];
  if (!camp) return res.status(404).json({ error_code: 'NOT_FOUND' });
  if (camp.status === 'CANCELLED' || camp.status === 'SENT') {
    return res.status(409).json({ error_code: 'CAMPAIGN_NOT_SENDABLE', status: camp.status });
  }

  const { eligible, capped } = await resolveEligibleCampaignRecipients(tenantId, camp.segment_type, camp.segment_tag);
  const apiBase = process.env.PUBLIC_API_URL || 'http://localhost:4000';

  let sentCount = 0;
  for (const rec of eligible) {
    const unsubUrl = `${apiBase}/api/customer/v1/marketing/unsubscribe?token=${encodeURIComponent(rec.unsubscribe_token)}`;
    await pool.query(
      `INSERT INTO campaign_recipients (tenant_id, campaign_id, customer_profile_id, email, language, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'SENT', NOW())
       ON CONFLICT (campaign_id, customer_profile_id) DO NOTHING`,
      [tenantId, camp.id, rec.customer_profile_id, rec.email, rec.language]
    );

    const outbox = await pool.query(
      `INSERT INTO email_outbox (recipient, template_type, language, reference_id, template_data, dedup_key)
       VALUES ($1, 'MARKETING_CAMPAIGN', $2, $3, $4, $5)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      [
        rec.email,
        rec.language === 'en' ? 'en' : 'vi',
        camp.id,
        JSON.stringify({
          subject_vi: camp.subject_vi,
          subject_en: camp.subject_en,
          body_vi: camp.body_vi,
          body_en: camp.body_en,
          unsubscribe_url: unsubUrl,
        }),
        `camp:${camp.id}:${rec.customer_profile_id}`,
      ]
    );
    if (outbox.rows[0]?.id) {
      setImmediate(() => {
        dispatchQueuedEmail(outbox.rows[0].id).catch(() => {});
      });
    }
    sentCount++;
  }

  const upd = await pool.query(
    `UPDATE campaigns
     SET status = 'SENT', sent_at = NOW(), sent_count = $1, skipped_cap_count = $2
     WHERE id = $3 RETURNING *`,
    [sentCount, capped.length, camp.id]
  );

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: userId,
    action: 'SEND_CAMPAIGN',
    targetTable: 'campaigns',
    targetId: camp.id,
    afterState: { sent_count: sentCount, skipped_cap_count: capped.length },
    ipAddress: req.ip,
  });

  return res.json({ campaign: upd.rows[0], sent_count: sentCount, skipped_cap_count: capped.length });
});

// ============================================================================
// 6. A-30 RAIN POLICY & BULK OUTDOOR CLOSURE (IDEMPOTENT)
// ============================================================================

adminExtensionsRouter.get('/weather/outdoor-courts', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (permitted.length === 0) return res.json({ outdoor_courts: [], jobs: [] });

  const [cRes, jobsRes] = await Promise.all([
    pool.query(
      `SELECT c.id, c.venue_id, c.name, c.court_type, c.is_outdoor, v.name as venue_name
       FROM courts c JOIN venues v ON v.id = c.venue_id
       WHERE c.tenant_id = $1 AND c.venue_id = ANY($2) AND c.is_active = TRUE AND c.is_outdoor = TRUE
       ORDER BY v.name ASC, c.name ASC`,
      [tenantId, permitted]
    ),
    pool.query(
      `SELECT w.*, v.name as venue_name
       FROM weather_closure_jobs w JOIN venues v ON v.id = w.venue_id
       WHERE w.tenant_id = $1 AND w.venue_id = ANY($2)
       ORDER BY w.created_at DESC LIMIT 15`,
      [tenantId, permitted]
    ),
  ]);

  return res.json({ outdoor_courts: cRes.rows, jobs: jobsRes.rows });
});

adminExtensionsRouter.post('/weather/preview', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { venue_id, court_ids, start_at, end_at } = req.body;
  if (!venue_id || !Array.isArray(court_ids) || court_ids.length === 0 || !start_at || !end_at) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  }

  // Enforce RAIN-07: only outdoor courts allowed
  const outdoorRes = await pool.query(
    `SELECT id FROM courts WHERE tenant_id = $1 AND venue_id = $2 AND id = ANY($3) AND is_outdoor = TRUE`,
    [tenantId, venue_id, court_ids]
  );
  const validOutdoorIds = outdoorRes.rows.map((r: any) => r.id);
  if (validOutdoorIds.length === 0) {
    return res.status(400).json({ error_code: 'NO_OUTDOOR_COURTS', message: 'Only outdoor courts can be selected for weather closure.' });
  }

  // Expand composite/constituent courts
  const client = await pool.connect();
  try {
    const expanded = new Set<string>(validOutdoorIds);
    for (const cid of validOutdoorIds) {
      for (const pid of await expandPhysicalCourts(client, cid)) expanded.add(pid);
    }

    // RAIN-01 & RAIN-05: exclude COMPLETED and already-past bookings
    const affectedRes = await client.query(
      `SELECT DISTINCT b.id, b.booking_code, b.status, b.total_amount, b.paid_amount,
              c.name as court_name, bc.start_at, bc.end_at,
              COALESCE(ca.full_name, cp.full_name, ca.username, 'Khách đặt sân') as customer_name
       FROM bookings b
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.active = TRUE
       JOIN courts c ON c.id = bc.court_id
       LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
       LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
       WHERE b.tenant_id = $1 AND b.venue_id = $2
         AND b.type = 'NORMAL'
         AND b.status IN ('PENDING', 'CONFIRMED')
         AND bc.court_id = ANY($3)
         AND bc.start_at < $5 AND bc.end_at > $4
         AND bc.end_at > NOW()`,
      [tenantId, venue_id, Array.from(expanded), new Date(start_at), new Date(end_at)]
    );

    const totalPaidDeposit = affectedRes.rows.reduce((sum: number, r: any) => sum + Number(r.paid_amount || 0), 0);
    return res.json({
      outdoor_court_ids: validOutdoorIds,
      affected_count: affectedRes.rows.length,
      total_paid_deposit_vnd: totalPaidDeposit,
      affected_bookings: affectedRes.rows,
    });
  } finally {
    client.release();
  }
});

adminExtensionsRouter.post('/weather/execute', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const {
    job_id,
    venue_id,
    court_ids,
    start_at,
    end_at,
    resolution_mode = 'REFUND',
    reason = 'Mưa lớn ngập mặt sân ngoài trời',
  } = req.body;

  if (!venue_id || !Array.isArray(court_ids) || court_ids.length === 0 || !start_at || !end_at) {
    return res.status(400).json({ error_code: 'MISSING_FIELDS' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const outdoorRes = await client.query(
      `SELECT id, name FROM courts WHERE tenant_id = $1 AND venue_id = $2 AND id = ANY($3) AND is_outdoor = TRUE`,
      [tenantId, venue_id, court_ids]
    );
    const validOutdoorIds = outdoorRes.rows.map((r: any) => r.id);
    if (validOutdoorIds.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error_code: 'NO_OUTDOOR_COURTS' });
    }

    let jobRow: any;
    if (job_id) {
      jobRow = (await client.query(`SELECT * FROM weather_closure_jobs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [job_id, tenantId])).rows[0];
    }
    if (!jobRow) {
      jobRow = (
        await client.query(
          `INSERT INTO weather_closure_jobs (tenant_id, venue_id, court_ids, start_at, end_at, resolution_mode, reason, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'RUNNING', $8) RETURNING *`,
          [tenantId, venue_id, validOutdoorIds, new Date(start_at), new Date(end_at), resolution_mode, reason, userId]
        )
      ).rows[0];
    }

    const alreadyProcessed: string[] = Array.isArray(jobRow.processed_booking_ids) ? [...jobRow.processed_booking_ids] : [];

    const expanded = new Set<string>(validOutdoorIds);
    for (const cid of validOutdoorIds) {
      for (const pid of await expandPhysicalCourts(client, cid)) expanded.add(pid);
    }

    const affectedRes = await client.query(
      `SELECT DISTINCT b.id, b.booking_code, b.paid_amount, b.customer_id,
              c.name as court_name, v.name as venue_name,
              COALESCE(ca.email, cp.email) as recipient_email,
              COALESCE(ca.preferred_language, cp.language, 'vi') as recipient_lang
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       JOIN booking_courts bc ON bc.booking_id = b.id AND bc.active = TRUE
       JOIN courts c ON c.id = bc.court_id
       LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
       LEFT JOIN customer_profiles cp ON cp.id = b.profile_id
       WHERE b.tenant_id = $1 AND b.venue_id = $2
         AND b.type = 'NORMAL'
         AND b.status IN ('PENDING', 'CONFIRMED')
         AND bc.court_id = ANY($3)
         AND bc.start_at < $5 AND bc.end_at > $4
         AND bc.end_at > NOW()`,
      [tenantId, venue_id, Array.from(expanded), new Date(start_at), new Date(end_at)]
    );

    const outboxIds: string[] = [];

    for (const bk of affectedRes.rows) {
      if (alreadyProcessed.includes(bk.id)) continue; // Idempotent retry guard (RAIN-02)

      await client.query(`UPDATE booking_courts SET active = FALSE WHERE booking_id = $1`, [bk.id]);
      const paidVnd = Number(bk.paid_amount || 0);

      if (resolution_mode === 'REFUND' && paidVnd > 0) {
        await client.query(
          `UPDATE bookings
           SET status = 'CANCELLED', weather_affected = TRUE, refund_status = 'PENDING', refund_amount = $1, updated_at = NOW()
           WHERE id = $2`,
          [paidVnd, bk.id]
        );
        await client.query(
          `INSERT INTO refunds (tenant_id, booking_id, amount, reason, status)
           VALUES ($1, $2, $3, $4, 'PENDING')`,
          [tenantId, bk.id, paidVnd, `Thời tiết: ${reason}`]
        );
      } else {
        await client.query(
          `UPDATE bookings
           SET status = 'CANCELLED', weather_affected = TRUE, payment_review_reason = 'WEATHER_CREDIT_OR_RESCHEDULE', updated_at = NOW()
           WHERE id = $1`,
          [bk.id]
        );
      }

      if (bk.recipient_email) {
        const lang = bk.recipient_lang === 'en' ? 'en' : 'vi';
        const resLabel =
          resolution_mode === 'REFUND'
            ? lang === 'en'
              ? '100% Paid Deposit Refund Queued'
              : 'Hoàn 100% tiền cọc đã thanh toán'
            : lang === 'en'
              ? 'Free Reschedule / Credit Preserved (14 days)'
              : 'Bảo lưu tiền cọc / Đổi lịch miễn phí trong 14 ngày';

        const ob = await client.query(
          `INSERT INTO email_outbox (recipient, template_type, language, reference_id, template_data, dedup_key)
           VALUES ($1, 'WEATHER_CLOSURE', $2, $3, $4, $5)
           ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
          [
            bk.recipient_email,
            lang,
            bk.id,
            JSON.stringify({
              booking_code: bk.booking_code,
              venue_name: bk.venue_name,
              court_name: bk.court_name,
              reason,
              resolution_label: resLabel,
            }),
            `weather:${jobRow.id}:${bk.id}`,
          ]
        );
        if (ob.rows[0]?.id) outboxIds.push(ob.rows[0].id);
      }

      alreadyProcessed.push(bk.id);
    }

    // Create weather BLOCK rows on each selected outdoor court via Booking Core
    for (const cid of validOutdoorIds) {
      const phys = await expandPhysicalCourts(client, cid);
      const blockCode = `RAIN-${randomBytes(3).toString('hex').toUpperCase()}`;
      const bIns = await client.query(
        `INSERT INTO bookings (tenant_id, venue_id, created_by_staff_id, booking_code, type, status, weather_affected)
         VALUES ($1, $2, $3, $4, 'BLOCK', 'CONFIRMED', TRUE) RETURNING id`,
        [tenantId, venue_id, userId, blockCode]
      );
      await reservePhysicalCourtRows(client, {
        tenantId,
        venueId: venue_id,
        bookingId: bIns.rows[0].id,
        primaryCourtId: cid,
        physicalCourtIds: phys,
        start: new Date(start_at),
        end: new Date(end_at),
      });
    }

    // Publish customer-visible weather banner on venue
    await client.query(
      `UPDATE venues
       SET weather_closure_banner = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [
        JSON.stringify({
          active: true,
          start_at,
          end_at,
          vi: `Tạm đóng sân ngoài trời do thời tiết: ${reason}`,
          en: `Outdoor courts temporarily closed due to weather: ${reason}`,
        }),
        venue_id,
        tenantId,
      ]
    );

    const finalJob = await client.query(
      `UPDATE weather_closure_jobs
       SET status = 'COMPLETED',
           affected_count = $1,
           processed_count = $1,
           processed_booking_ids = $2
       WHERE id = $3 RETURNING *`,
      [alreadyProcessed.length, alreadyProcessed, jobRow.id]
    );

    await client.query('COMMIT');

    for (const oid of outboxIds) {
      setImmediate(() => dispatchQueuedEmail(oid).catch(() => {}));
    }
    broadcastCourtChange({
      venue_id,
      court_id: validOutdoorIds[0],
      start_at: new Date(start_at).toISOString(),
      end_at: new Date(end_at).toISOString(),
      status: 'BLOCKED',
      timestamp: new Date().toISOString(),
    });

    await recordAuditLog({
      tenantId,
      actorPortal: 'admin',
      actorId: userId,
      action: 'EXECUTE_WEATHER_CLOSURE',
      targetTable: 'weather_closure_jobs',
      targetId: jobRow.id,
      afterState: { affected: alreadyProcessed.length, resolution_mode, reason },
      ipAddress: req.ip,
    });

    return res.json({ job: finalJob.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 7. A-31 TOURNAMENTS (ROUND ROBIN & KNOCKOUT, BOOKING CORE SCHEDULE, AUDIT)
// ============================================================================

adminExtensionsRouter.get('/tournaments', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const tRes = await pool.query(
    `SELECT tr.*, v.name as venue_name
     FROM tournaments tr JOIN venues v ON v.id = tr.venue_id
     WHERE tr.tenant_id = $1 ORDER BY tr.created_at DESC`,
    [tenantId]
  );
  const ids = tRes.rows.map((r: any) => r.id);
  if (ids.length === 0) return res.json({ tournaments: [] });

  const [teamsRes, matchesRes] = await Promise.all([
    pool.query(
      `SELECT * FROM tournament_teams WHERE tournament_id = ANY($1)
       ORDER BY points DESC, (goals_for - goals_against) DESC, goals_for DESC, team_name ASC`,
      [ids]
    ),
    pool.query(
      `SELECT tm.*, ht.team_name as home_team_name, at.team_name as away_team_name, c.name as court_name
       FROM tournament_matches tm
       LEFT JOIN tournament_teams ht ON ht.id = tm.home_team_id
       LEFT JOIN tournament_teams at ON at.id = tm.away_team_id
       LEFT JOIN courts c ON c.id = tm.court_id
       WHERE tm.tournament_id = ANY($1)
       ORDER BY tm.round_no ASC, tm.match_no ASC`,
      [ids]
    ),
  ]);

  return res.json({
    tournaments: tRes.rows.map((tr: any) => ({
      ...tr,
      teams: teamsRes.rows.filter((tm: any) => tm.tournament_id === tr.id),
      matches: matchesRes.rows.filter((m: any) => m.tournament_id === tr.id),
    })),
  });
});

adminExtensionsRouter.post('/tournaments', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const {
    venue_id,
    name_vi,
    name_en,
    sport_code = 'football',
    format = 'ROUND_ROBIN',
    entry_fee_vnd = 0,
    max_teams = 8,
    win_points = 3,
    draw_points = 1,
    loss_points = 0,
  } = req.body;
  if (!venue_id || !name_vi) return res.status(400).json({ error_code: 'MISSING_FIELDS' });

  const ins = await pool.query(
    `INSERT INTO tournaments (
       tenant_id, venue_id, name_vi, name_en, sport_code, format,
       entry_fee_vnd, max_teams, win_points, draw_points, loss_points, status, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'OPEN', $12)
     RETURNING *`,
    [
      tenantId,
      venue_id,
      String(name_vi).trim(),
      String(name_en || name_vi).trim(),
      sport_code,
      format === 'KNOCKOUT' ? 'KNOCKOUT' : 'ROUND_ROBIN',
      Math.max(0, Number(entry_fee_vnd) || 0),
      Math.min(32, Math.max(2, Number(max_teams) || 8)),
      Number(win_points ?? 3),
      Number(draw_points ?? 1),
      Number(loss_points ?? 0),
      userId,
    ]
  );
  return res.status(201).json({ tournament: ins.rows[0] });
});

adminExtensionsRouter.post('/tournaments/:id/teams', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const { team_name, captain_name, captain_phone } = req.body;
  if (!team_name) return res.status(400).json({ error_code: 'MISSING_FIELDS' });

  try {
    const ins = await pool.query(
      `INSERT INTO tournament_teams (tenant_id, tournament_id, team_name, captain_name, captain_phone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, req.params.id, String(team_name).trim(), captain_name || null, captain_phone || null]
    );
    return res.status(201).json({ team: ins.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error_code: 'DUPLICATE_TEAM', message: 'Tên đội đã tồn tại trong giải.' });
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

adminExtensionsRouter.post('/tournaments/:id/generate-matches', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const tournId = req.params.id;
  const tr = (await pool.query(`SELECT * FROM tournaments WHERE id = $1 AND tenant_id = $2`, [tournId, tenantId])).rows[0];
  if (!tr) return res.status(404).json({ error_code: 'NOT_FOUND' });

  const teams = (
    await pool.query(`SELECT * FROM tournament_teams WHERE tournament_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`, [tournId, tenantId])
  ).rows;
  if (teams.length < 2) {
    return res.status(400).json({ error_code: 'NOT_ENOUGH_TEAMS', message: 'Need at least 2 teams to generate matches.' });
  }

  await pool.query(`DELETE FROM tournament_matches WHERE tournament_id = $1 AND tenant_id = $2 AND booking_id IS NULL`, [tournId, tenantId]);

  let matchNo = 1;
  const created: any[] = [];
  if (tr.format === 'KNOCKOUT') {
    for (let i = 0; i + 1 < teams.length; i += 2) {
      const m = await pool.query(
        `INSERT INTO tournament_matches (tenant_id, tournament_id, round_no, match_no, home_team_id, away_team_id, status)
         VALUES ($1, $2, 1, $3, $4, $5, 'UNSCHEDULED') RETURNING *`,
        [tenantId, tournId, matchNo++, teams[i].id, teams[i + 1].id]
      );
      created.push(m.rows[0]);
    }
  } else {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const m = await pool.query(
          `INSERT INTO tournament_matches (tenant_id, tournament_id, round_no, match_no, home_team_id, away_team_id, status)
           VALUES ($1, $2, 1, $3, $4, $5, 'UNSCHEDULED') RETURNING *`,
          [tenantId, tournId, matchNo++, teams[i].id, teams[j].id]
        );
        created.push(m.rows[0]);
      }
    }
  }

  await pool.query(`UPDATE tournaments SET status = 'IN_PROGRESS' WHERE id = $1`, [tournId]);
  return res.json({ matches: created });
});

adminExtensionsRouter.post(
  '/tournaments/:id/matches/:matchId/schedule',
  requirePortal('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.userId;
    const { court_id, start_at, end_at } = req.body;
    if (!court_id || !start_at || !end_at) return res.status(400).json({ error_code: 'MISSING_FIELDS' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tr = (await client.query(`SELECT * FROM tournaments WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])).rows[0];
      if (!tr) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error_code: 'NOT_FOUND' });
      }

      // MUST go through Booking Core & GiST overlap constraint (Spec 2.11 — never overwrite customer bookings!)
      const phys = await expandPhysicalCourts(client, court_id);
      const code = `TRN-${randomBytes(3).toString('hex').toUpperCase()}`;
      const bRes = await client.query(
        `INSERT INTO bookings (tenant_id, venue_id, created_by_staff_id, booking_code, type, status)
         VALUES ($1, $2, $3, $4, 'TOURNAMENT', 'CONFIRMED') RETURNING id`,
        [tenantId, tr.venue_id, userId, code]
      );

      await reservePhysicalCourtRows(client, {
        tenantId,
        venueId: tr.venue_id,
        bookingId: bRes.rows[0].id,
        primaryCourtId: court_id,
        physicalCourtIds: phys,
        start: new Date(start_at),
        end: new Date(end_at),
      });

      const updMatch = await client.query(
        `UPDATE tournament_matches
         SET court_id = $1, booking_id = $2, start_at = $3, end_at = $4, status = 'SCHEDULED', updated_at = NOW()
         WHERE id = $5 AND tournament_id = $6 AND tenant_id = $7 RETURNING *`,
        [court_id, bRes.rows[0].id, new Date(start_at), new Date(end_at), req.params.matchId, req.params.id, tenantId]
      );

      await client.query('COMMIT');
      return res.json({ match: updMatch.rows[0], booking_code: code });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === 'SLOT_TAKEN' || err.code === '23P01') {
        return res.status(409).json({
          error_code: 'SLOT_TAKEN',
          message: 'Khung giờ sân bị trùng với lịch đặt của khách. Vui lòng chọn khung giờ khác.',
        });
      }
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    } finally {
      client.release();
    }
  }
);

adminExtensionsRouter.post(
  '/tournaments/:id/matches/:matchId/score',
  requirePortal('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.userId;
    const homeScore = Math.max(0, Math.round(Number(req.body?.home_score ?? 0)));
    const awayScore = Math.max(0, Math.round(Number(req.body?.away_score ?? 0)));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tr = (await client.query(`SELECT * FROM tournaments WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])).rows[0];
      const matchBefore = (
        await client.query(`SELECT * FROM tournament_matches WHERE id = $1 AND tournament_id = $2 AND tenant_id = $3 FOR UPDATE`, [
          req.params.matchId,
          req.params.id,
          tenantId,
        ])
      ).rows[0];
      if (!tr || !matchBefore) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error_code: 'NOT_FOUND' });
      }

      const winnerId =
        homeScore > awayScore ? matchBefore.home_team_id : awayScore > homeScore ? matchBefore.away_team_id : null;

      const updMatch = await client.query(
        `UPDATE tournament_matches
         SET home_score = $1, away_score = $2, winner_team_id = $3, status = 'COMPLETED', updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [homeScore, awayScore, winnerId, matchBefore.id]
      );

      // Recompute standings deterministically from all COMPLETED matches in this tournament
      await client.query(
        `UPDATE tournament_teams
         SET played = 0, wins = 0, draws = 0, losses = 0, goals_for = 0, goals_against = 0, points = 0
         WHERE tournament_id = $1`,
        [tr.id]
      );

      const completedMatches = (
        await client.query(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND status = 'COMPLETED'`, [tr.id])
      ).rows;

      for (const m of completedMatches) {
        if (!m.home_team_id || !m.away_team_id) continue;
        const hs = Number(m.home_score || 0);
        const as = Number(m.away_score || 0);
        const hPts = hs > as ? tr.win_points : hs === as ? tr.draw_points : tr.loss_points;
        const aPts = as > hs ? tr.win_points : hs === as ? tr.draw_points : tr.loss_points;

        await client.query(
          `UPDATE tournament_teams
           SET played = played + 1,
               wins = wins + $1,
               draws = draws + $2,
               losses = losses + $3,
               goals_for = goals_for + $4,
               goals_against = goals_against + $5,
               points = points + $6
           WHERE id = $7`,
          [hs > as ? 1 : 0, hs === as ? 1 : 0, hs < as ? 1 : 0, hs, as, hPts, m.home_team_id]
        );
        await client.query(
          `UPDATE tournament_teams
           SET played = played + 1,
               wins = wins + $1,
               draws = draws + $2,
               losses = losses + $3,
               goals_for = goals_for + $4,
               goals_against = goals_against + $5,
               points = points + $6
           WHERE id = $7`,
          [as > hs ? 1 : 0, hs === as ? 1 : 0, as < hs ? 1 : 0, as, hs, aPts, m.away_team_id]
        );
      }

      await client.query('COMMIT');

      await recordAuditLog({
        tenantId,
        actorPortal: 'admin',
        actorId: userId,
        action: 'UPDATE_TOURNAMENT_SCORE',
        targetTable: 'tournament_matches',
        targetId: matchBefore.id,
        beforeState: { home_score: matchBefore.home_score, away_score: matchBefore.away_score },
        afterState: { home_score: homeScore, away_score: awayScore },
        ipAddress: req.ip,
      });

      return res.json({ match: updMatch.rows[0] });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
    } finally {
      client.release();
    }
  }
);

// ============================================================================
// 8. A-33 SMART LIGHTS & GATE IOT CONTROLS (IOT-01..IOT-04)
// ============================================================================

/**
 * Pure schedule window coalescer (IOT-01, IOT-02, IOT-04):
 * - Turns ON `leadMins` (10m) before start and OFF `lagMins` (5m) after end.
 * - Adjacent or overlapping active windows merge into a single continuous ON window so lights NEVER turn off mid-changeover!
 */
export function computeMergedLightingWindows(
  bookings: Array<{ start_at: string | Date; end_at: string | Date; status: string }>,
  leadMins = 10,
  lagMins = 5
): Array<{ light_on_at: string; light_off_at: string; merged_sessions: number }> {
  const valid = bookings
    .filter((b) => ['CONFIRMED', 'CHECKED_IN'].includes(b.status))
    .map((b) => ({
      onMs: new Date(b.start_at).getTime() - leadMins * 60000,
      offMs: new Date(b.end_at).getTime() + lagMins * 60000,
    }))
    .sort((a, b) => a.onMs - b.onMs);

  const merged: Array<{ onMs: number; offMs: number; count: number }> = [];
  for (const item of valid) {
    const last = merged[merged.length - 1];
    if (last && item.onMs <= last.offMs) {
      last.offMs = Math.max(last.offMs, item.offMs);
      last.count += 1;
    } else {
      merged.push({ onMs: item.onMs, offMs: item.offMs, count: 1 });
    }
  }

  return merged.map((m) => ({
    light_on_at: new Date(m.onMs).toISOString(),
    light_off_at: new Date(m.offMs).toISOString(),
    merged_sessions: m.count,
  }));
}

adminExtensionsRouter.get('/iot/devices', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const permitted = await getPermittedVenueIds(req.user!.userId, req.user!.role, tenantId);
  if (permitted.length === 0) return res.json({ devices: [], recent_commands: [] });

  const [devRes, cmdRes, upcomingRes] = await Promise.all([
    pool.query(
      `SELECT d.id, d.venue_id, d.court_id, d.device_name, d.device_type, d.adapter_protocol,
              d.endpoint_url, (d.encrypted_secret IS NOT NULL) as has_secret,
              d.lead_on_mins, d.lag_off_mins, d.power_state, d.control_mode,
              d.simulate_unreachable, d.last_heartbeat_at, d.last_error,
              c.name as court_name, v.name as venue_name
       FROM device_integrations d
       JOIN courts c ON c.id = d.court_id
       JOIN venues v ON v.id = d.venue_id
       WHERE d.tenant_id = $1 AND d.venue_id = ANY($2)
       ORDER BY v.name ASC, c.name ASC`,
      [tenantId, permitted]
    ),
    pool.query(
      `SELECT dc.*, d.device_name, c.name as court_name
       FROM device_commands dc
       JOIN device_integrations d ON d.id = dc.device_id
       JOIN courts c ON c.id = d.court_id
       WHERE dc.tenant_id = $1
       ORDER BY dc.created_at DESC LIMIT 25`,
      [tenantId]
    ),
    pool.query(
      `SELECT bc.court_id, bc.start_at, bc.end_at, b.status
       FROM booking_courts bc
       JOIN bookings b ON b.id = bc.booking_id
       WHERE b.tenant_id = $1 AND b.venue_id = ANY($2)
         AND bc.active = TRUE AND b.type = 'NORMAL'
         AND b.status IN ('CONFIRMED', 'CHECKED_IN')
         AND bc.end_at >= NOW() - INTERVAL '2 hours'
         AND bc.start_at <= NOW() + INTERVAL '24 hours'`,
      [tenantId, permitted]
    ),
  ]);

  const devicesWithSchedule = devRes.rows.map((dev: any) => {
    const courtBookings = upcomingRes.rows.filter((b: any) => b.court_id === dev.court_id);
    const windows = computeMergedLightingWindows(courtBookings, dev.lead_on_mins, dev.lag_off_mins);
    return { ...dev, scheduled_windows: windows };
  });

  return res.json({ devices: devicesWithSchedule, recent_commands: cmdRes.rows });
});

adminExtensionsRouter.post('/iot/devices/:id/command', requirePortal('admin'), async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.user!.tenantId!;
  const userId = req.user!.userId;
  const { command = 'TURN_ON', control_mode = 'MANUAL_OVERRIDE', simulate_unreachable } = req.body;

  const devRes = await pool.query(`SELECT * FROM device_integrations WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
  const dev = devRes.rows[0];
  if (!dev) return res.status(404).json({ error_code: 'DEVICE_NOT_FOUND' });

  const isUnreachable = simulate_unreachable !== undefined ? Boolean(simulate_unreachable) : Boolean(dev.simulate_unreachable);

  if (isUnreachable) {
    // Retry 3 times -> mark RETRIED_FAILED and record alert for Staff (IOT-03)
    const errMsg = 'Thiết bị không phản hồi sau 3 lần thử — Đã gửi cảnh báo cho Nhân viên trực quầy bật tay.';
    await pool.query(
      `UPDATE device_integrations SET simulate_unreachable = TRUE, last_error = $1 WHERE id = $2`,
      [errMsg, dev.id]
    );
    const cmdLog = await pool.query(
      `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
       VALUES ($1, $2, $3, 'MANUAL_ADMIN', $4, 'RETRIED_FAILED', 3, $5) RETURNING *`,
      [tenantId, dev.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', userId, errMsg]
    );
    return res.status(502).json({ error_code: 'DEVICE_UNREACHABLE', message: errMsg, command_log: cmdLog.rows[0] });
  }

  const nextPower = command === 'TURN_OFF' ? 'OFF' : 'ON';
  const nextMode = control_mode === 'AUTO' ? 'AUTO' : 'MANUAL_OVERRIDE';

  const upd = await pool.query(
    `UPDATE device_integrations
     SET power_state = $1, control_mode = $2, simulate_unreachable = FALSE, last_error = NULL, last_heartbeat_at = NOW()
     WHERE id = $3 RETURNING id, device_name, power_state, control_mode, lead_on_mins, lag_off_mins, last_heartbeat_at`,
    [nextPower, nextMode, dev.id]
  );

  const cmdLog = await pool.query(
    `INSERT INTO device_commands (tenant_id, device_id, command, trigger_source, actor_id, status, attempts, detail)
     VALUES ($1, $2, $3, 'MANUAL_ADMIN', $4, 'ACKED', 1, $5) RETURNING *`,
    [tenantId, dev.id, command === 'TURN_OFF' ? 'TURN_OFF' : 'TURN_ON', userId, `Chuyển trạng thái đèn sang ${nextPower} (${nextMode})`]
  );

  await recordAuditLog({
    tenantId,
    actorPortal: 'admin',
    actorId: userId,
    action: `IOT_${command}`,
    targetTable: 'device_integrations',
    targetId: dev.id,
    afterState: { power_state: nextPower, control_mode: nextMode },
    ipAddress: req.ip,
  });

  return res.json({ device: upd.rows[0], command_log: cmdLog.rows[0] });
});
