import { Router, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { pool, withTransaction } from '../../config/database';
import { databaseScope } from '../../config/database-scope';
import { comparePassword, signAccessToken, verifyToken } from '../../common/jwt';
import { AuthenticatedRequest, requirePortal, sendTranslatedError } from '../../common/auth.guard';
import { recordAuditLog } from '../../common/audit';
import { authRateLimiter } from '../../common/security';
import { resolvePrice, vietnamDate } from '../../../../shared/booking';

export const customerExtensionsRouter = Router();

// ============================================================================
// 1. MULTI-DEVICE REFRESH TOKEN ROTATION & DEVICE SESSIONS (Section 16.2 / 16.5)
// ============================================================================

customerExtensionsRouter.post('/auth/refresh', authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { refresh_token } = req.body;
  if (typeof refresh_token !== 'string' || refresh_token.length < 32) {
    return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
  }

  const tokenHash = createHash('sha256').update(refresh_token.trim()).digest('hex');

  try {
    const rotated = await withTransaction(null, async (client) => {
      const rtRes = await client.query(
        `SELECT * FROM refresh_tokens
         WHERE token_hash = $1 AND portal = 'customer'
         FOR UPDATE`,
        [tokenHash]
      );
      const rt = rtRes.rows[0];
      if (!rt || rt.revoked_at || new Date(rt.expires_at).getTime() <= Date.now()) {
        return null;
      }

      const accRes = await client.query(
        `SELECT id, username, full_name, email, phone_e164, avatar_url, preferred_language, status, auth_version, created_at
         FROM customer_accounts WHERE id = $1`,
        [rt.user_id]
      );
      const user = accRes.rows[0];
      if (!user || user.status !== 'ACTIVE') {
        await client.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [rt.id]);
        return null;
      }

      // Rotate refresh token atomically
      await client.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [rt.id]);

      const nextRaw = randomBytes(40).toString('hex');
      const nextHash = createHash('sha256').update(nextRaw).digest('hex');
      const deviceInfo = String(req.headers['user-agent'] || rt.device_info || 'Web Browser').slice(0, 240);

      await client.query(
        `INSERT INTO refresh_tokens (portal, user_id, token_hash, device_info, ip_address, expires_at)
         VALUES ('customer', $1, $2, $3, $4, NOW() + INTERVAL '30 days')`,
        [user.id, nextHash, deviceInfo, String(req.ip || '').slice(0, 48)]
      );

      const accessToken = signAccessToken({
        userId: user.id,
        portal: 'customer',
        sessionVersion: user.auth_version,
        preferredLanguage: user.preferred_language,
      });

      return { access_token: accessToken, refresh_token: nextRaw, user };
    });

    if (!rotated) {
      return sendTranslatedError(req, res, 401, 'INVALID_CREDENTIALS');
    }
    return res.json(rotated);
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerExtensionsRouter.get('/me/sessions', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sRes = await pool.query(
      `SELECT id, device_info, ip_address, created_at, expires_at
       FROM refresh_tokens
       WHERE portal = 'customer' AND user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 20`,
      [req.user!.userId]
    );
    return res.json({ sessions: sRes.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerExtensionsRouter.delete('/me/sessions/:id', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND portal = 'customer'`,
      [req.params.id, req.user!.userId]
    );
    return res.json({ status: 'SESSION_REVOKED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 2. C-06 ACCOUNT DELETION / ANONYMIZATION & MARKETING CONSENT (A-29)
// ============================================================================

customerExtensionsRouter.post('/me/delete', requirePortal('customer'), authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { current_password } = req.body;
  if (typeof current_password !== 'string' || !current_password) {
    return sendTranslatedError(req, res, 400, 'MISSING_FIELDS');
  }

  try {
    const result = await withTransaction(null, async (client) => {
      const accRes = await client.query(`SELECT * FROM customer_accounts WHERE id = $1 FOR UPDATE`, [userId]);
      const user = accRes.rows[0];
      if (!user) return { status: 404, code: 'USER_NOT_FOUND' };

      const okPwd = await comparePassword(current_password, user.password_hash);
      if (!okPwd) return { status: 401, code: 'INVALID_CREDENTIALS' };

      const activeBookings = await client.query(
        `SELECT COUNT(*)::int as cnt
         FROM bookings b
         JOIN booking_courts bc ON bc.booking_id = b.id AND bc.is_primary = TRUE
         WHERE b.customer_id = $1
           AND b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
           AND bc.end_at > NOW()`,
        [userId]
      );
      if (Number(activeBookings.rows[0]?.cnt || 0) > 0) {
        return {
          status: 409,
          customMsg:
            req.lang === 'en'
              ? 'Please cancel or complete your upcoming active bookings before deleting your account.'
              : 'Vui lòng hoàn tất hoặc hủy các lịch đặt sân sắp tới trước khi xóa tài khoản.',
        };
      }

      const anonSuffix = userId.replace(/-/g, '').slice(0, 12);
      await client.query(
        `UPDATE customer_accounts
         SET username = $1,
             full_name = 'Anonymized User',
             email = $2,
             email_normalized = $2,
             phone_e164 = $3,
             avatar_url = NULL,
             marketing_opt_in = FALSE,
             status = 'DELETED',
             deleted_at = NOW(),
             auth_version = auth_version + 1,
             updated_at = NOW()
         WHERE id = $4`,
        [`del_${anonSuffix}`, `deleted+${anonSuffix}@anonymized.invalid`, `+84000${anonSuffix.slice(0, 7)}`, userId]
      );

      await client.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND portal = 'customer'`, [userId]);
      await client.query(`UPDATE otp_codes SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
      return { ok: true };
    });

    if ('customMsg' in result && result.customMsg) {
      return res.status(result.status).json({ error_code: 'ACTIVE_BOOKINGS_EXIST', message: result.customMsg });
    }
    if ('code' in result && result.code) {
      return sendTranslatedError(req, res, result.status, result.code);
    }

    await recordAuditLog({
      tenantId: null,
      actorPortal: 'customer',
      actorId: userId,
      action: 'DELETE_ANONYMIZE_ACCOUNT',
      targetTable: 'customer_accounts',
      targetId: userId,
      ipAddress: req.ip,
    });

    return res.json({ status: 'ACCOUNT_DELETED_ANONYMIZED' });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerExtensionsRouter.put('/me/marketing-consent', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const optedIn = Boolean(req.body?.opted_in);
  try {
    await pool.query(
      `UPDATE customer_accounts SET marketing_opt_in = $1, updated_at = NOW() WHERE id = $2`,
      [optedIn, userId]
    );

    // Sync tenant-scoped marketing_consents for all venues where this customer has a profile
    await databaseScope.run({ service: true }, async () => {
      const profs = await pool.query(`SELECT id, tenant_id FROM customer_profiles WHERE account_id = $1`, [userId]);
      for (const p of profs.rows) {
        await pool.query(
          `INSERT INTO marketing_consents (tenant_id, customer_profile_id, opted_in, source, unsubscribe_token, changed_at)
           VALUES ($1, $2, $3, 'CUSTOMER_PORTAL', $4, NOW())
           ON CONFLICT (tenant_id, customer_profile_id)
           DO UPDATE SET opted_in = EXCLUDED.opted_in, changed_at = NOW()`,
          [p.tenant_id, p.id, optedIn, randomBytes(24).toString('hex')]
        );
      }
    });

    return res.json({ marketing_opt_in: optedIn });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// Public 1-click Unsubscribe endpoint (CMP-02)
customerExtensionsRouter.get('/marketing/unsubscribe', async (req: AuthenticatedRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) {
    return res.status(400).json({ error_code: 'INVALID_TOKEN', message: 'Missing unsubscribe token.' });
  }

  try {
    const updated = await databaseScope.run({ service: true }, async () => {
      const r = await pool.query(
        `UPDATE marketing_consents
         SET opted_in = FALSE, changed_at = NOW()
         WHERE unsubscribe_token = $1
         RETURNING customer_profile_id`,
        [token]
      );
      if (r.rows[0]?.customer_profile_id) {
        const p = await pool.query(`SELECT account_id FROM customer_profiles WHERE id = $1`, [r.rows[0].customer_profile_id]);
        if (p.rows[0]?.account_id) {
          await pool.query(`UPDATE customer_accounts SET marketing_opt_in = FALSE WHERE id = $1`, [p.rows[0].account_id]);
        }
      }
      return r.rowCount || 0;
    });

    if (!updated) {
      return res.status(404).json({ error_code: 'NOT_FOUND', message: 'Unsubscribe link invalid or already processed.' });
    }

    return res.json({
      status: 'UNSUBSCRIBED',
      message:
        req.lang === 'en'
          ? 'You have been unsubscribed from promotional messages immediately.'
          : 'Bạn đã hủy nhận tin khuyến mãi thành công ngay lập tức.',
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 3. C-21 CUSTOMER DEALS FEED (LIVE AVAILABLE DISCOUNTED SLOTS ONLY)
// ============================================================================

customerExtensionsRouter.get('/deals', async (req: AuthenticatedRequest, res: Response) => {
  const sportFilter = typeof req.query.sport === 'string' ? req.query.sport.trim().toLowerCase() : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  try {
    const [dealsRes, venuesRes, courtsRes, pricesRes] = await Promise.all([
      pool.query(
        `SELECT id, venue_id, title_vi, title_en, sport_code, court_ids, days_of_week,
                to_char(time_from, 'HH24:MI') as time_from,
                to_char(time_to, 'HH24:MI') as time_to,
                kind, discount_type, discount_value, floor_price_vnd, lead_hours,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to
         FROM deal_rules WHERE status = 'ACTIVE'`
      ),
      pool.query(
        `SELECT v.id, v.name, v.name_i18n, v.address, v.address_i18n, v.district, v.city, v.slug, v.city_slug
         FROM venues v JOIN tenants t ON t.id = v.tenant_id
         WHERE t.status = 'ACTIVE' AND v.status = 'PUBLISHED'`
      ),
      pool.query(
        `SELECT c.id, c.venue_id, c.name, c.name_i18n, c.court_type, s.code as sport_code, s.name_i18n as sport_name
         FROM courts c JOIN sports s ON s.id = c.sport_id WHERE c.is_active = TRUE`
      ),
      pool.query(
        `SELECT venue_id, court_id, court_type, day_of_week, is_weekend, is_holiday, is_peak_hour,
                start_time, end_time, price_per_hour, priority,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to
         FROM price_rules ORDER BY priority DESC, id ASC`
      ),
    ]);

    const venueMap = new Map<string, any>();
    for (const v of venuesRes.rows) venueMap.set(v.id, v);

    const normalize = (str: string) =>
      str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .toLowerCase();

    const nowMs = Date.now();
    const datesToScan = [vietnamDate(new Date(nowMs)), vietnamDate(new Date(nowMs + 86400000))];

    // Load live occupancy per venue across the 2-day window
    const occupancyByVenue = new Map<string, any[]>();
    const scanStart = `${datesToScan[0]}T00:00:00+07:00`;
    const scanEnd = new Date(Date.parse(`${datesToScan[1]}T00:00:00+07:00`) + 86400000).toISOString();

    await Promise.all(
      venuesRes.rows.map(async (v: any) => {
        const occ = await pool.query(`SELECT * FROM get_public_venue_occupancy($1, $2, $3)`, [v.id, scanStart, scanEnd]);
        occupancyByVenue.set(v.id, occ.rows);
      })
    );

    const offers: any[] = [];

    for (const dateStr of datesToScan) {
      const dow = new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
      for (const deal of dealsRes.rows) {
        const venue = venueMap.get(deal.venue_id);
        if (!venue) continue;
        if (deal.valid_from && dateStr < deal.valid_from) continue;
        if (deal.valid_to && dateStr > deal.valid_to) continue;
        if (Array.isArray(deal.days_of_week) && deal.days_of_week.length > 0 && !deal.days_of_week.includes(dow)) continue;

        if (search) {
          const hay = normalize(`${venue.name} ${venue.address} ${venue.district || ''} ${deal.title_vi} ${deal.title_en}`);
          if (!hay.includes(normalize(search))) continue;
        }

        const venueCourts = courtsRes.rows.filter((c: any) => {
          if (c.venue_id !== venue.id) return false;
          if (sportFilter !== 'all' && String(c.sport_code).toLowerCase() !== sportFilter) return false;
          if (deal.sport_code && String(c.sport_code).toLowerCase() !== String(deal.sport_code).toLowerCase()) return false;
          if (Array.isArray(deal.court_ids) && deal.court_ids.length > 0 && !deal.court_ids.includes(c.id)) return false;
          return true;
        });

        const venuePrices = pricesRes.rows.filter((p: any) => p.venue_id === venue.id);
        const venueOcc = occupancyByVenue.get(venue.id) || [];

        const [fromH] = String(deal.time_from).split(':').map(Number);
        const [toH] = String(deal.time_to).split(':').map(Number);

        for (const court of venueCourts) {
          // Offer clean 60-minute bookable blocks inside the deal window
          for (let h = fromH; h + 1 <= toH; h += 1) {
            const pad = (n: number) => String(n).padStart(2, '0');
            const slotStartIso = `${dateStr}T${pad(h)}:00:00+07:00`;
            const slotEndIso = `${dateStr}T${pad(h + 1)}:00:00+07:00`;
            const startMs = Date.parse(slotStartIso);
            const endMs = Date.parse(slotEndIso);

            if (startMs <= nowMs + 10 * 60000) continue;

            const hoursUntilStart = (startMs - nowMs) / 3600000;
            if (deal.kind === 'LAST_MINUTE' && hoursUntilStart > Number(deal.lead_hours || 6)) continue;

            const isOccupied = venueOcc.some(
              (o: any) => o.court_id === court.id && Date.parse(o.start_at) < endMs && Date.parse(o.end_at) > startMs
            );
            if (isOccupied) continue;

            const baseHourly = resolvePrice(venuePrices, court.id, court.court_type, dateStr, `${pad(h)}:00`);
            if (!baseHourly) continue;

            const rawDisc =
              deal.discount_type === 'PERCENT'
                ? Math.round(baseHourly * (1 - Number(deal.discount_value) / 100))
                : baseHourly - Number(deal.discount_value);
            const dealHourly = Math.min(baseHourly, Math.max(Number(deal.floor_price_vnd || 0), rawDisc));
            if (dealHourly >= baseHourly) continue;

            offers.push({
              offer_key: `${deal.id}:${court.id}:${slotStartIso}`,
              deal_id: deal.id,
              kind: deal.kind,
              title_vi: deal.title_vi,
              title_en: deal.title_en,
              venue_id: venue.id,
              venue_name: venue.name,
              venue_name_i18n: venue.name_i18n,
              venue_address: venue.address,
              venue_district: venue.district,
              court_id: court.id,
              court_name: court.name,
              court_name_i18n: court.name_i18n,
              sport_code: court.sport_code,
              sport_name: court.sport_name,
              date: dateStr,
              time_label: `${pad(h)}:00 – ${pad(h + 1)}:00`,
              start_at: new Date(startMs).toISOString(),
              end_at: new Date(endMs).toISOString(),
              original_price_vnd: baseHourly,
              deal_price_vnd: dealHourly,
              saved_percent: Math.round(((baseHourly - dealHourly) / baseHourly) * 100),
            });

            // Keep top 2 soonest free slots per (deal, court, day) so feed stays diverse & snappy
            if (offers.filter((x) => x.deal_id === deal.id && x.court_id === court.id && x.date === dateStr).length >= 2) {
              break;
            }
          }
        }
      }
    }

    offers.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    return res.json({ deals: offers.slice(0, 24) });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 4. C-24 VENUE SEO PAGES, SITEMAP PROJECTION & 301 SLUG REDIRECTS
// ============================================================================

customerExtensionsRouter.get('/seo/venues', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT v.id, v.slug, v.city_slug, v.name, v.name_i18n, v.updated_at,
              COALESCE(
                (SELECT s.code FROM courts c JOIN sports s ON s.id = c.sport_id WHERE c.venue_id = v.id AND c.is_active = TRUE ORDER BY c.created_at ASC LIMIT 1),
                'football'
              ) as primary_sport
       FROM venues v
       JOIN tenants t ON t.id = v.tenant_id
       WHERE t.status = 'ACTIVE' AND v.status = 'PUBLISHED' AND v.slug IS NOT NULL`
    );
    return res.json({ venues: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerExtensionsRouter.get('/seo/venue/:slug', async (req: AuthenticatedRequest, res: Response) => {
  const requestedSlug = String(req.params.slug || '').trim().toLowerCase();
  if (!requestedSlug) return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });

  try {
    // Check current slug OR historical slug (for 301 redirect SEO-02) and draft/suspended status (for noindex SEO-01)
    const meta = await databaseScope.run({ service: true }, async () => {
      const direct = await pool.query(
        `SELECT v.id, v.slug, v.city_slug, v.status as venue_status, t.status as tenant_status
         FROM venues v JOIN tenants t ON t.id = v.tenant_id
         WHERE v.slug = $1`,
        [requestedSlug]
      );
      if (direct.rows[0]) return { kind: 'direct' as const, row: direct.rows[0] };

      const moved = await pool.query(
        `SELECT v.id, v.slug, v.city_slug, v.status as venue_status, t.status as tenant_status,
                COALESCE(
                  (SELECT s.code FROM courts c JOIN sports s ON s.id = c.sport_id WHERE c.venue_id = v.id AND c.is_active = TRUE LIMIT 1),
                  'football'
                ) as primary_sport
         FROM venues v JOIN tenants t ON t.id = v.tenant_id
         WHERE $1 = ANY(v.slug_history)`,
        [requestedSlug]
      );
      if (moved.rows[0]) return { kind: 'redirect' as const, row: moved.rows[0] };
      return null;
    });

    if (!meta) {
      return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });
    }

    if (meta.kind === 'redirect') {
      return res.json({
        redirect_301: true,
        canonical_slug: meta.row.slug,
        city_slug: meta.row.city_slug || 'ha-noi',
        primary_sport: meta.row.primary_sport || 'football',
      });
    }

    // Draft or suspended venues MUST return noindex and not expose private draft details (SEO-01)
    if (meta.row.venue_status !== 'PUBLISHED' || meta.row.tenant_status !== 'ACTIVE') {
      return res.json({
        noindex: true,
        is_draft_or_locked: true,
        venue: null,
      });
    }

    const [venueRes, courtsRes, hoursRes, reviewsRes, tournamentsRes] = await Promise.all([
      pool.query(
        `SELECT v.id, v.name, v.name_i18n, v.description_i18n, v.address, v.address_i18n,
                v.phone, v.google_maps_url, v.latitude, v.longitude, v.district, v.city,
                v.city_slug, v.slug, v.cover_photo_url, v.photos, v.amenities, v.weather_closure_banner,
                p.hold_duration_mins, p.deposit_percent, p.policy_i18n,
                (SELECT MIN(pr.price_per_hour)::bigint FROM price_rules pr WHERE pr.venue_id = v.id) as min_price,
                (SELECT MAX(pr.price_per_hour)::bigint FROM price_rules pr WHERE pr.venue_id = v.id) as max_price,
                (SELECT COUNT(*)::int FROM venue_reviews vr WHERE vr.venue_id = v.id AND vr.is_visible = TRUE) as review_count,
                (SELECT ROUND(AVG(vr.rating)::numeric, 1) FROM venue_reviews vr WHERE vr.venue_id = v.id AND vr.is_visible = TRUE) as avg_rating
         FROM venues v
         LEFT JOIN policies p ON p.venue_id = v.id
         WHERE v.id = $1`,
        [meta.row.id]
      ),
      pool.query(
        `SELECT c.id, c.name, c.name_i18n, c.court_type, c.is_outdoor, s.code as sport_code, s.name_i18n as sport_name
         FROM courts c JOIN sports s ON s.id = c.sport_id
         WHERE c.venue_id = $1 AND c.is_active = TRUE ORDER BY c.name`,
        [meta.row.id]
      ),
      pool.query(`SELECT day_of_week, open_time, close_time, is_closed FROM opening_hours WHERE venue_id = $1 ORDER BY day_of_week`, [
        meta.row.id,
      ]),
      databaseScope.run({ service: true }, () =>
        pool.query(
          `SELECT vr.id, vr.rating, vr.comment, vr.owner_reply, vr.replied_at, vr.created_at,
                  (vr.booking_id IS NOT NULL) as verified_booking,
                  COALESCE(NULLIF(ca.full_name, ''), ca.username, vr.reviewer_name, 'Khách đặt sân') as author_name
           FROM venue_reviews vr
           LEFT JOIN customer_accounts ca ON ca.id = vr.customer_id
           WHERE vr.venue_id = $1 AND vr.is_visible = TRUE
           ORDER BY vr.created_at DESC LIMIT 12`,
          [meta.row.id]
        )
      ),
      pool.query(
        `SELECT id, name_vi, name_en, sport_code, format, status, starts_at FROM tournaments WHERE venue_id = $1 AND status != 'DRAFT' ORDER BY created_at DESC LIMIT 5`,
        [meta.row.id]
      ),
    ]);

    return res.json({
      noindex: false,
      redirect_301: false,
      venue: venueRes.rows[0],
      courts: courtsRes.rows,
      opening_hours: hoursRes.rows,
      reviews: reviewsRes.rows,
      tournaments: tournamentsRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 5. A-31 PUBLIC BILINGUAL TOURNAMENTS & STANDINGS
// ============================================================================

customerExtensionsRouter.get('/tournaments', async (req: AuthenticatedRequest, res: Response) => {
  const venueId = typeof req.query.venue_id === 'string' ? req.query.venue_id.trim() : '';
  try {
    const params: any[] = [];
    let filter = '';
    if (venueId) {
      params.push(venueId);
      filter = ` AND tr.venue_id = $1`;
    }

    const tRes = await pool.query(
      `SELECT tr.*, v.name as venue_name, v.name_i18n as venue_name_i18n
       FROM tournaments tr
       JOIN venues v ON v.id = tr.venue_id
       JOIN tenants tn ON tn.id = tr.tenant_id AND tn.status = 'ACTIVE'
       WHERE tr.status != 'DRAFT' ${filter}
       ORDER BY tr.created_at DESC LIMIT 12`,
      params
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

    const enriched = tRes.rows.map((tr: any) => ({
      ...tr,
      standings: teamsRes.rows.filter((tm: any) => tm.tournament_id === tr.id),
      matches: matchesRes.rows.filter((m: any) => m.tournament_id === tr.id),
    }));

    return res.json({ tournaments: enriched });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

// ============================================================================
// 6. DYNAMIC PUBLIC SPORTS CATALOG
// ============================================================================

customerExtensionsRouter.get('/sports', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT s.id, s.code, s.name_i18n, s.min_duration_mins, s.step_mins,
              (SELECT COUNT(c.id)::int
               FROM courts c
               JOIN venues v ON v.id = c.venue_id AND v.status = 'PUBLISHED'
               JOIN tenants t ON t.id = c.tenant_id AND t.status = 'ACTIVE'
               WHERE c.sport_id = s.id AND c.is_active = TRUE) as active_court_count
       FROM sports s
       ORDER BY
         CASE s.code
           WHEN 'football' THEN 1
           WHEN 'badminton' THEN 2
           WHEN 'pickleball' THEN 3
           WHEN 'tennis' THEN 4
           WHEN 'futsal' THEN 5
           WHEN 'basketball' THEN 6
           WHEN 'volleyball' THEN 7
           WHEN 'table-tennis' THEN 8
           ELSE 20
         END ASC,
         s.created_at ASC`
    );
    return res.json({ sports: r.rows });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

const DEFAULT_HERO_SLIDES = [
  '/images/showcase/hero-stadium-night.webp',
  '/images/showcase/venue-football-turf.webp',
  '/images/showcase/venue-pickleball-court.webp',
  '/images/showcase/venue-badminton-arena.webp',
];

const DEFAULT_AUTH_SLIDES = [
  '/images/showcase/auth-community-players.webp',
  '/images/showcase/ops-clubhouse-overlook.webp',
  '/images/showcase/hero-stadium-night.webp',
];

const DEFAULT_OPS_SLIDES = [
  '/images/showcase/ops-clubhouse-overlook.webp',
  '/images/showcase/hero-stadium-night.webp',
  '/images/showcase/venue-badminton-arena.webp',
];

customerExtensionsRouter.get('/media-showcase', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT hero_slides, auth_slides, ops_slides FROM platform_media_settings WHERE id = 1`);
    const row = r.rows[0];
    const hero = Array.isArray(row?.hero_slides) && row.hero_slides.length > 0 ? row.hero_slides : DEFAULT_HERO_SLIDES;
    const auth = Array.isArray(row?.auth_slides) && row.auth_slides.length > 0 ? row.auth_slides : DEFAULT_AUTH_SLIDES;
    const ops = Array.isArray(row?.ops_slides) && row.ops_slides.length > 0 ? row.ops_slides : DEFAULT_OPS_SLIDES;
    return res.json({ hero_slides: hero, auth_slides: auth, ops_slides: ops });
  } catch {
    return res.json({
      hero_slides: DEFAULT_HERO_SLIDES,
      auth_slides: DEFAULT_AUTH_SLIDES,
      ops_slides: DEFAULT_OPS_SLIDES,
    });
  }
});

// ============================================================================
// 7. C-18 VENUE REVIEWS & 1–5 STAR RATINGS
// ============================================================================

async function buildPublicVenueReviewSummary(venueId: string) {
  const aggRes = await databaseScope.run({ service: true }, () =>
    pool.query(
      `SELECT
         COUNT(*)::int as review_count,
         ROUND(AVG(rating)::numeric, 1) as avg_rating,
         COUNT(*) FILTER (WHERE rating = 5)::int as r5,
         COUNT(*) FILTER (WHERE rating = 4)::int as r4,
         COUNT(*) FILTER (WHERE rating = 3)::int as r3,
         COUNT(*) FILTER (WHERE rating = 2)::int as r2,
         COUNT(*) FILTER (WHERE rating = 1)::int as r1
       FROM venue_reviews
       WHERE venue_id = $1 AND is_visible = TRUE`,
      [venueId]
    )
  );
  const row = aggRes.rows[0] || {};
  return {
    review_count: Number(row.review_count || 0),
    avg_rating: row.avg_rating ? Number(row.avg_rating) : null,
    distribution: {
      5: Number(row.r5 || 0),
      4: Number(row.r4 || 0),
      3: Number(row.r3 || 0),
      2: Number(row.r2 || 0),
      1: Number(row.r1 || 0),
    },
  };
}

customerExtensionsRouter.get('/venues/:id/reviews', async (req: AuthenticatedRequest, res: Response) => {
  const venueId = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(venueId)) {
    return res.status(400).json({ error_code: 'INVALID_VENUE' });
  }

  let callerCustomerId: string | null = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const tok = verifyToken(authHeader.slice(7));
      if (tok.portal === 'customer' && tok.userId) {
        callerCustomerId = tok.userId;
      }
    }
  } catch {
    // Public anonymous view
  }

  try {
    const [summary, listRes, myRes] = await Promise.all([
      buildPublicVenueReviewSummary(venueId),
      databaseScope.run({ service: true }, () =>
        pool.query(
          `SELECT vr.id, vr.customer_id, vr.rating, vr.comment, vr.is_visible,
                  vr.owner_reply, vr.replied_at, vr.created_at, vr.updated_at,
                  (vr.booking_id IS NOT NULL) as verified_booking,
                  COALESCE(NULLIF(ca.full_name, ''), ca.username, vr.reviewer_name, 'Khách đặt sân') as author_name,
                  ca.avatar_url as author_avatar
           FROM venue_reviews vr
           LEFT JOIN customer_accounts ca ON ca.id = vr.customer_id
           WHERE vr.venue_id = $1 AND vr.is_visible = TRUE
           ORDER BY vr.created_at DESC
           LIMIT 40`,
          [venueId]
        )
      ),
      callerCustomerId
        ? databaseScope.run({ service: true }, () =>
            pool.query(
              `SELECT id, rating, comment, is_visible, owner_reply, replied_at,
                      (booking_id IS NOT NULL) as verified_booking, created_at, updated_at
               FROM venue_reviews
               WHERE venue_id = $1 AND customer_id = $2
               ORDER BY updated_at DESC LIMIT 1`,
              [venueId, callerCustomerId]
            )
          )
        : Promise.resolve({ rows: [] }),
    ]);

    return res.json({
      summary,
      reviews: listRes.rows,
      my_review: myRes.rows[0] || null,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerExtensionsRouter.post('/venues/:id/reviews', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const venueId = req.params.id;
  const customerId = req.user!.userId;
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment || '').trim();

  if (!/^[0-9a-f-]{36}$/i.test(venueId)) {
    return res.status(400).json({ error_code: 'INVALID_VENUE' });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({
      error_code: 'INVALID_RATING',
      message: req.lang === 'en' ? 'Please choose a star rating from 1 to 5.' : 'Vui lòng chọn mức chấm sao từ 1 đến 5 sao.',
    });
  }
  if (comment.length < 2 || comment.length > 1000) {
    return res.status(400).json({
      error_code: 'INVALID_COMMENT',
      message:
        req.lang === 'en'
          ? 'Please enter a review comment between 2 and 1,000 characters.'
          : 'Vui lòng nhập nội dung nhận xét từ 2 đến 1.000 ký tự.',
    });
  }

  try {
    const result = await databaseScope.run({ service: true }, async () => {
      const vRes = await pool.query(
        `SELECT v.id, v.tenant_id, v.name
         FROM venues v
         JOIN tenants t ON t.id = v.tenant_id AND t.status = 'ACTIVE'
         WHERE v.id = $1 AND v.status = 'PUBLISHED'`,
        [venueId]
      );
      const venue = vRes.rows[0];
      if (!venue) return null;

      const custRes = await pool.query(
        `SELECT id, full_name, username, status FROM customer_accounts WHERE id = $1`,
        [customerId]
      );
      const cust = custRes.rows[0];
      if (!cust || cust.status !== 'ACTIVE') {
        throw new Error('ACCOUNT_NOT_ACTIVE');
      }
      const reviewerName = (cust.full_name || cust.username || 'Khách đặt sân').slice(0, 120);

      // Check if customer already has a review on this venue
      const existingRes = await pool.query(
        `SELECT id, booking_id FROM venue_reviews WHERE venue_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [venueId, customerId]
      );

      // Find an unreviewed real booking by this customer at this venue to attach verified player badge
      let verifiedBookingId: string | null = existingRes.rows[0]?.booking_id || null;
      if (!verifiedBookingId) {
        const bkRes = await pool.query(
          `SELECT b.id
           FROM bookings b
           LEFT JOIN venue_reviews vr ON vr.booking_id = b.id
           WHERE b.venue_id = $1
             AND b.customer_id = $2
             AND b.type = 'NORMAL'
             AND b.status IN ('COMPLETED', 'CHECKED_IN', 'CONFIRMED')
             AND vr.id IS NULL
           ORDER BY CASE b.status WHEN 'COMPLETED' THEN 1 WHEN 'CHECKED_IN' THEN 2 ELSE 3 END, b.created_at DESC
           LIMIT 1`,
          [venueId, customerId]
        );
        verifiedBookingId = bkRes.rows[0]?.id || null;
      }

      let saved;
      if (existingRes.rows[0]) {
        const upd = await pool.query(
          `UPDATE venue_reviews
           SET rating = $1,
               comment = $2,
               reviewer_name = $3,
               booking_id = COALESCE(booking_id, $4),
               is_visible = TRUE,
               updated_at = NOW()
           WHERE id = $5
           RETURNING *`,
          [rating, comment, reviewerName, verifiedBookingId, existingRes.rows[0].id]
        );
        saved = upd.rows[0];
      } else {
        const ins = await pool.query(
          `INSERT INTO venue_reviews (tenant_id, venue_id, booking_id, customer_id, reviewer_name, rating, comment, is_visible, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
           RETURNING *`,
          [venue.tenant_id, venueId, verifiedBookingId, customerId, reviewerName, rating, comment]
        );
        saved = ins.rows[0];
      }

      return { venue, saved, isUpdate: Boolean(existingRes.rows[0]) };
    });

    if (!result) {
      return res.status(404).json({ error_code: 'VENUE_NOT_FOUND' });
    }

    await recordAuditLog({
      tenantId: result.venue.tenant_id,
      actorPortal: 'customer',
      actorId: customerId,
      action: result.isUpdate ? 'UPDATE_VENUE_REVIEW' : 'CREATE_VENUE_REVIEW',
      targetTable: 'venue_reviews',
      targetId: result.saved.id,
      afterState: { venue_id: venueId, rating, comment },
      ipAddress: req.ip,
    });

    const summary = await buildPublicVenueReviewSummary(venueId);
    return res.status(result.isUpdate ? 200 : 201).json({
      status: result.isUpdate ? 'REVIEW_UPDATED' : 'REVIEW_CREATED',
      review: result.saved,
      summary,
    });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

customerExtensionsRouter.delete('/venues/:id/reviews/:reviewId', requirePortal('customer'), async (req: AuthenticatedRequest, res: Response) => {
  const { id: venueId, reviewId } = req.params;
  const customerId = req.user!.userId;
  try {
    const del = await databaseScope.run({ service: true }, () =>
      pool.query(
        `DELETE FROM venue_reviews WHERE id = $1 AND venue_id = $2 AND customer_id = $3 RETURNING id`,
        [reviewId, venueId, customerId]
      )
    );
    if (!del.rows[0]) {
      return res.status(404).json({ error_code: 'NOT_FOUND' });
    }
    const summary = await buildPublicVenueReviewSummary(venueId);
    return res.json({ status: 'REVIEW_DELETED', summary });
  } catch (err: any) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});
