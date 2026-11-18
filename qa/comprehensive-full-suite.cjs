const fs = require('fs');
const path = require('path');

process.env.TS_NODE_PROJECT = path.join(__dirname, '../backend/tsconfig.json');
require('../backend/node_modules/ts-node/register');
const { pool } = require('../backend/src/config/database');
const { databaseScope } = require('../backend/src/config/database-scope');
const { computeMergedLightingWindows } = require('../backend/src/modules/admin/extensions.routes');
const { resolveDealPrice } = require('../shared/booking');

const API = process.env.API_URL || 'http://localhost:4000';
const CUST = `${API}/api/customer/v1`;
const STAFF = `${API}/api/staff/v1`;
const ADMIN = `${API}/api/admin/v1`;
const PLAT = `${API}/api/platform/v1`;

// Tiny valid 1x1 PNG buffer for real Sharp WebP avatar upload verification
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function reqJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function run() {
  const results = [];
  const cleanupIds = {
    customerUserId: null,
    avatarFilename: null,
    draftVenueId: null,
    importJobId: null,
    dealId: null,
    campaignId: null,
    tournamentId: null,
    iotCmdIds: [],
  };

  const check = (name, cond, detail = '') => {
    if (!cond) {
      throw new Error(`FAILED [${name}]: ${detail}`);
    }
    results.push(`PASS: ${name}`);
  };

  try {
    // 0. Pure Logic Unit Gates: IoT Lighting Window Coalescer (IOT-01, IOT-02, IOT-04) & Deal Floor Pricing (DEAL-01, DEAL-02)
    const mergedWindows = computeMergedLightingWindows(
      [
        { start_at: '2026-11-20T11:00:00.000Z', end_at: '2026-11-20T12:00:00.000Z', status: 'CONFIRMED' },
        { start_at: '2026-11-20T12:00:00.000Z', end_at: '2026-11-20T13:00:00.000Z', status: 'CONFIRMED' },
        { start_at: '2026-11-20T13:30:00.000Z', end_at: '2026-11-20T14:30:00.000Z', status: 'CANCELLED' },
      ],
      10,
      5
    );
    check(
      'IOT01_IOT02_IOT04_ADJACENT_WINDOWS_COALESCED',
      mergedWindows.length === 1 &&
        mergedWindows[0].merged_sessions === 2 &&
        mergedWindows[0].light_on_at === '2026-11-20T10:50:00.000Z' &&
        mergedWindows[0].light_off_at === '2026-11-20T13:05:00.000Z',
      JSON.stringify(mergedWindows)
    );

    const dealEval = resolveDealPrice(
      300000,
      [
        {
          id: 'd-floor',
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          time_from: '08:00',
          time_to: '16:00',
          kind: 'OFFPEAK',
          discount_type: 'PERCENT',
          discount_value: 50,
          floor_price_vnd: 180000,
          status: 'ACTIVE',
        },
      ],
      'c-1',
      '5-a-side',
      '2026-11-20',
      '10:00'
    );
    check(
      'DEAL01_DEAL02_FLOOR_PRICE_ENFORCED',
      dealEval.finalHourly === 180000 && dealEval.deal?.id === 'd-floor',
      JSON.stringify(dealEval)
    );

    // 1. Source hygiene: Zero pre-filled credentials & 1:1 i18n parity
    const vi = JSON.parse(fs.readFileSync(path.join(__dirname, '../shared/i18n/vi.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../shared/i18n/en.json'), 'utf8'));
    const flattenKeys = (obj, prefix = '') =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
      );
    const viKeys = new Set(flattenKeys(vi));
    const enKeys = new Set(flattenKeys(en));
    const missingInEn = [...viKeys].filter((k) => !enKeys.has(k));
    const missingInVi = [...enKeys].filter((k) => !viKeys.has(k));
    check(
      'I18N-PARITY (vi.json <-> en.json 1:1)',
      missingInEn.length === 0 && missingInVi.length === 0,
      JSON.stringify({ missingInEn, missingInVi })
    );

    for (const rel of [
      'frontend/src/components/AuthModal.tsx',
      'frontend/src/app/staff/page.tsx',
      'frontend/src/app/admin/page.tsx',
      'frontend/src/app/platform/page.tsx',
    ]) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      const hasPrefill =
        /useState\(['"](admin@|nhanvien|superadmin@|Admin@2026|Staff@2026|SuperAdmin@2026)/i.test(src) ||
        /Tài khoản thử nghiệm sẵn sàng/i.test(src);
      check(`ZERO-PREFILL (${rel})`, !hasPrefill, 'Found prefilled demo credentials');
    }

    // 2. Health check
    const health = await reqJson(`${API}/health`);
    check('HEALTH_UP', health.status === 200 && health.data.status === 'UP', JSON.stringify(health.data));

    // 3. C-02 Public Venues with Geo Coordinates & C-24 Published SEO Slug
    const venuesRes = await reqJson(`${CUST}/venues`);
    check('VENUES_GEO_AND_SLUGS', venuesRes.ok && venuesRes.data.venues.length >= 2);
    const v1 = venuesRes.data.venues[0];
    check('VENUE_HAS_LAT_LNG_AND_SLUG', typeof v1.latitude === 'number' && typeof v1.longitude === 'number' && Boolean(v1.slug));

    const pubSeo = await reqJson(`${CUST}/seo/venue/${v1.slug}`);
    check(
      'C24_PUBLISHED_VENUE_SEO_PAYLOAD',
      pubSeo.ok && pubSeo.data.noindex === false && pubSeo.data.venue?.id === v1.id && Array.isArray(pubSeo.data.courts)
    );

    // 4. Customer Full Account Lifecycle: Register -> Verify OTP -> Upload WebP Avatar -> Edit Profile -> 2-Step Email Change -> Refresh Token Rotation -> Export JSON -> C-06 Anonymize/Delete
    const stamp = Date.now().toString().slice(-7);
    const testUser = `qauser_${stamp}`;
    const testEmail = `qa.${stamp}@testmail.local`;
    const nextEmail = `qa.changed.${stamp}@testmail.local`;
    const testPhone = `091${stamp}`;
    const testPass = `SafePass#${stamp}A`;

    const regRes = await reqJson(`${CUST}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUser,
        full_name: 'Người Dùng Kiểm Thử QA',
        email: testEmail,
        phone: testPhone,
        password: testPass,
        confirm_password: testPass,
        accept_terms: true,
        preferred_language: 'vi',
      }),
    });
    check('CUST_REGISTER', regRes.status === 201 && Boolean(regRes.data.local_code), JSON.stringify(regRes.data));
    cleanupIds.customerUserId = regRes.data.user_id || null;

    const verRes = await reqJson(`${CUST}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: regRes.data.local_code }),
    });
    check('CUST_VERIFY_WITH_REFRESH_TOKEN', verRes.ok && Boolean(verRes.data.access_token) && Boolean(verRes.data.refresh_token));
    cleanupIds.customerUserId = verRes.data.user?.id || cleanupIds.customerUserId;

    let custToken = verRes.data.access_token;
    let custRefresh = verRes.data.refresh_token;

    // Upload real WebP avatar
    const fd = new FormData();
    fd.append('avatar', new Blob([TINY_PNG], { type: 'image/png' }), 'avatar.png');
    const avRes = await reqJson(`${CUST}/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${custToken}` },
      body: fd,
    });
    check('CUST_AVATAR_WEBP_UPLOAD', avRes.status === 201 && String(avRes.data.avatar_url).endsWith('.webp'), JSON.stringify(avRes.data));
    cleanupIds.avatarFilename = path.basename(String(avRes.data.avatar_url || ''));

    // Edit profile full_name
    const patchMe = await reqJson(`${CUST}/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ full_name: 'Hồ Sơ Đã Cập Nhật', preferred_language: 'en' }),
    });
    check('CUST_PROFILE_PATCH', patchMe.ok && patchMe.data.profile.full_name === 'Hồ Sơ Đã Cập Nhật');

    // Marketing consent opt-in toggle
    const optInRes = await reqJson(`${CUST}/me/marketing-consent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ opted_in: true }),
    });
    check('A29_CUSTOMER_MARKETING_OPTIN', optInRes.ok && optInRes.data.marketing_opt_in === true);

    // 2-step OTP Email Change
    const reqEmailChange = await reqJson(`${CUST}/me/email/request-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ new_email: nextEmail, current_password: testPass }),
    });
    check('CUST_EMAIL_CHANGE_OTP_ISSUED', reqEmailChange.ok && Boolean(reqEmailChange.data.local_code));

    const confEmailChange = await reqJson(`${CUST}/me/email/confirm-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ new_email: nextEmail, otp: reqEmailChange.data.local_code }),
    });
    check('CUST_EMAIL_CHANGED_AND_REISSUED', confEmailChange.ok && confEmailChange.data.profile.email === nextEmail);
    custToken = confEmailChange.data.access_token;

    // Multi-device Refresh Token Rotation
    const rotRes = await reqJson(`${CUST}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: custRefresh }),
    });
    check('CUST_REFRESH_TOKEN_ROTATION', rotRes.ok && Boolean(rotRes.data.access_token) && rotRes.data.refresh_token !== custRefresh);

    // Old refresh token MUST now be rejected (single-use rotation!)
    const replayRot = await reqJson(`${CUST}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: custRefresh }),
    });
    check('CUST_OLD_REFRESH_REJECTED', replayRot.status === 401);
    custToken = rotRes.data.access_token;

    // C-06 Export Personal Data JSON
    const expRes = await reqJson(`${CUST}/me/export`, {
      headers: { Authorization: `Bearer ${custToken}` },
    });
    check('C06_DATA_EXPORT_JSON', expRes.ok && expRes.data.account?.email === nextEmail);

    // C-06 Delete & Anonymize Account
    const delRes = await reqJson(`${CUST}/me/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ current_password: testPass }),
    });
    check('C06_DELETE_ANONYMIZE_ACCOUNT', delRes.ok && delRes.data.status === 'ACCOUNT_DELETED_ANONYMIZED');

    // Deleted account token must be immediately rejected
    const afterDel = await reqJson(`${CUST}/me`, { headers: { Authorization: `Bearer ${custToken}` } });
    check('C06_DELETED_SESSION_REVOKED', afterDel.status === 401);

    // 5. Admin Login & Executive Dashboard Charts + Extensions Verification
    const admLogin = await reqJson(`${ADMIN}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@phudong.vn', password: 'Admin@2026' }),
    });
    check('ADMIN_LOGIN', admLogin.ok && Boolean(admLogin.data.access_token));
    const admToken = admLogin.data.access_token;
    const admHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` };

    // Admin Profile & Role Responsibilities endpoint
    const admMe = await reqJson(`${ADMIN}/me`, { headers: admHeaders });
    check('ADMIN_PROFILE_ENDPOINT', admMe.ok && admMe.data.profile?.role === 'OWNER');

    // Executive Dashboard Series & Heatmap
    const dash = await reqJson(`${ADMIN}/reports/revenue`, { headers: admHeaders });
    check(
      'ADMIN_DASHBOARD_SERIES_AND_HEATMAP',
      dash.ok &&
        Array.isArray(dash.data.daily_series) &&
        Array.isArray(dash.data.hourly_heatmap) &&
        dash.data.hourly_heatmap.length === 5 &&
        Array.isArray(dash.data.court_performance) &&
        typeof dash.data.kpis?.receivables_vnd === 'number'
    );

    // Staff Login & IMP-08 / CMP-07 Role Enforcement
    const stfLogin = await reqJson(`${STAFF}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nhanvien', password: 'Staff@2026' }),
    });
    check('STAFF_LOGIN', stfLogin.ok && Boolean(stfLogin.data.access_token));
    const stfToken = stfLogin.data.access_token;

    // Staff calling Admin CSV import MUST get 403 FORBIDDEN_PORTAL (IMP-08)
    const stfImportTry = await reqJson(`${ADMIN}/imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stfToken}` },
      body: JSON.stringify({ venue_id: v1.id, csv_content: 'a,b\n1,2' }),
    });
    check('IMP08_STAFF_REJECTED_FROM_ADMIN_IMPORT', stfImportTry.status === 403);

    // 6. A-25 Setup Wizard & C-24 SEO Draft Protection (SET-02, SEO-01)
    const wizStart = await reqJson(`${ADMIN}/wizard/venues`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({
        name: `Cơ Sở Nháp QA ${stamp}`,
        address: '99 Nguyễn Chí Thanh, Hà Nội',
        phone: '0909888777',
      }),
    });
    check('A25_WIZARD_CREATES_DRAFT_VENUE', wizStart.status === 201 && wizStart.data.venue.status === 'DRAFT');
    const draftVenue = wizStart.data.venue;
    cleanupIds.draftVenueId = draftVenue.id;

    // SEO-01: Draft venue MUST return noindex=true and NOT appear in public /venues
    const seoDraft = await reqJson(`${CUST}/seo/venue/${draftVenue.slug}`);
    check('SEO01_DRAFT_VENUE_NOINDEX', seoDraft.ok && seoDraft.data.noindex === true && seoDraft.data.venue === null);

    // Attempt to skip Step 2 (required) MUST be rejected with 400
    const skipReqStep = await reqJson(`${ADMIN}/wizard/${draftVenue.id}/step/2`, {
      method: 'PUT',
      headers: admHeaders,
      body: JSON.stringify({ skip: true }),
    });
    check('A25_REQUIRED_STEP_CANNOT_SKIP', skipReqStep.status === 400);

    // Skip Step 5 (optional payment step) MUST succeed and report counter_only_warning (SET-02)
    const skipStep5 = await reqJson(`${ADMIN}/wizard/${draftVenue.id}/step/5`, {
      method: 'PUT',
      headers: admHeaders,
      body: JSON.stringify({ skip: true }),
    });
    check('SET02_SKIP_STEP5_ALLOWED', skipStep5.ok && skipStep5.data.status === 'SKIPPED');

    // 7. A-26 CSV Dry-Run: Vietnamese headers + Formula Injection Neutralization (IMP-01, IMP-05)
    const csvSample = '\uFEFFHọ và tên,Số điện thoại,Email\n' + `=HYPERLINK("http://evil"),097${stamp},safe@domain.vn\n`;
    const dryRun = await reqJson(`${ADMIN}/imports`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ venue_id: v1.id, csv_content: csvSample }),
    });
    check(
      'IMP01_IMP05_FORMULA_SANITIZED',
      dryRun.status === 201 &&
        dryRun.data.job.ok_rows === 1 &&
        String(dryRun.data.preview_rows[0].payload_json.full_name).startsWith("'=HYPERLINK")
    );
    cleanupIds.importJobId = dryRun.data.job.id;

    // 8. A-27 Auto Suggestion stays DRAFT (DEAL-06) + C-21 Customer Deals Feed
    const sugRes = await reqJson(`${ADMIN}/deals/generate-suggestions`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ venue_id: v1.id }),
    });
    check('DEAL06_SUGGESTION_IS_DRAFT', sugRes.status === 201 && sugRes.data.suggestion.status === 'DRAFT');
    cleanupIds.dealId = sugRes.data.suggestion.id;

    const custDeals = await reqJson(`${CUST}/deals`);
    check('C21_CUSTOMER_DEALS_FEED', custDeals.ok && Array.isArray(custDeals.data.deals));

    // 9. A-29 Segmented Marketing Campaign Preview + Create + Cancel (CMP-01, CMP-06)
    const campPrev = await reqJson(`${ADMIN}/campaigns/preview`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ segment_type: 'ALL_OPTED_IN' }),
    });
    check('A29_CAMPAIGN_PREVIEW', campPrev.ok && typeof campPrev.data.recipient_count === 'number');

    const campCreate = await reqJson(`${ADMIN}/campaigns`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({
        name: `Chiến dịch QA ${stamp}`,
        segment_type: 'ALL_OPTED_IN',
        subject_vi: 'Ưu đãi giờ trống QA',
        subject_en: 'QA Off-peak Deal',
        body_vi: 'Nội dung thử nghiệm QA',
        body_en: 'QA test body',
      }),
    });
    check('A29_CAMPAIGN_CREATED_DRAFT', campCreate.status === 201 && campCreate.data.campaign.status === 'DRAFT');
    cleanupIds.campaignId = campCreate.data.campaign.id;

    const campCancel = await reqJson(`${ADMIN}/campaigns/${cleanupIds.campaignId}/cancel`, {
      method: 'POST',
      headers: admHeaders,
    });
    check('CMP06_CAMPAIGN_CANCELLED_BEFORE_SEND', campCancel.ok && campCancel.data.campaign.status === 'CANCELLED');

    // 10. A-30 Rain Policy Outdoor-Only Filter (RAIN-07)
    const rainCourts = await reqJson(`${ADMIN}/weather/outdoor-courts`, { headers: admHeaders });
    check(
      'RAIN07_ONLY_OUTDOOR_COURTS',
      rainCourts.ok &&
        rainCourts.data.outdoor_courts.length > 0 &&
        rainCourts.data.outdoor_courts.every((c) => c.is_outdoor === true)
    );

    // 11. A-31 Tournaments: Create -> Add 2 Teams -> Generate Matches -> Enter Score -> Standings Updated (TRN-01..03)
    const trnCreate = await reqJson(`${ADMIN}/tournaments`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({
        venue_id: v1.id,
        name_vi: `Giải Đấu QA ${stamp}`,
        name_en: `QA Cup ${stamp}`,
        sport_code: 'football',
        format: 'ROUND_ROBIN',
        max_teams: 4,
      }),
    });
    check('A31_TOURNAMENT_CREATED', trnCreate.status === 201 && trnCreate.data.tournament.status === 'OPEN');
    const trnId = trnCreate.data.tournament.id;
    cleanupIds.tournamentId = trnId;

    const tA = await reqJson(`${ADMIN}/tournaments/${trnId}/teams`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ team_name: 'FC Alpha QA', captain_name: 'Đội trưởng A' }),
    });
    const tB = await reqJson(`${ADMIN}/tournaments/${trnId}/teams`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ team_name: 'FC Beta QA', captain_name: 'Đội trưởng B' }),
    });
    check('A31_TOURNAMENT_TEAMS_ADDED', tA.status === 201 && tB.status === 201);

    const genM = await reqJson(`${ADMIN}/tournaments/${trnId}/generate-matches`, {
      method: 'POST',
      headers: admHeaders,
    });
    check('A31_ROUND_ROBIN_MATCHES_GENERATED', genM.ok && genM.data.matches.length === 1);

    const scoreRes = await reqJson(`${ADMIN}/tournaments/${trnId}/matches/${genM.data.matches[0].id}/score`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ home_score: 3, away_score: 1 }),
    });
    check('A31_MATCH_SCORE_RECORDED', scoreRes.ok && scoreRes.data.match.status === 'COMPLETED');

    const pubTrn = await reqJson(`${CUST}/tournaments`);
    const qaTrn = pubTrn.data.tournaments.find((t) => t.id === trnId);
    check(
      'A31_LIVE_STANDINGS_RECOMPUTED',
      Boolean(qaTrn && qaTrn.standings[0].points === 3 && qaTrn.standings[1].points === 0)
    );

    // 12. A-33 IoT Unreachable Alert -> Staff Manual Override Recovery (IOT-03)
    const iotList = await reqJson(`${ADMIN}/iot/devices`, { headers: admHeaders });
    check('A33_IOT_DEVICES_LOADED', iotList.ok && iotList.data.devices.length > 0);
    const firstDevice = iotList.data.devices[0];

    const iotFail = await reqJson(`${ADMIN}/iot/devices/${firstDevice.id}/command`, {
      method: 'POST',
      headers: admHeaders,
      body: JSON.stringify({ command: 'TURN_ON', simulate_unreachable: true }),
    });
    check('IOT03_UNREACHABLE_TRIGGERS_STAFF_ALERT', iotFail.status === 502);
    if (iotFail.data?.command_log?.id) cleanupIds.iotCmdIds.push(iotFail.data.command_log.id);

    const stfIot = await reqJson(`${STAFF}/iot/devices`, {
      headers: { Authorization: `Bearer ${stfToken}` },
    });
    const alerted = stfIot.data.devices.find((d) => d.id === firstDevice.id);
    check('IOT03_STAFF_SEES_ALERT', Boolean(alerted && alerted.last_error));

    const stfManual = await reqJson(`${STAFF}/iot/devices/${firstDevice.id}/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stfToken}` },
      body: JSON.stringify({ command: 'TURN_OFF' }),
    });
    check('IOT03_STAFF_MANUAL_OVERRIDE_CLEARS_ERROR', stfManual.ok && stfManual.data.device.power_state === 'OFF');
    if (stfManual.data?.command_log?.id) cleanupIds.iotCmdIds.push(stfManual.data.command_log.id);

    // 13. Super Admin Console: Profile + SMTP Config Read (P-02, F-10)
    const platLogin = await reqJson(`${PLAT}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'superadmin@tenmien.vn', password: 'SuperAdmin@2026' }),
    });
    check('PLATFORM_LOGIN', platLogin.ok && Boolean(platLogin.data.access_token));
    const platHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${platLogin.data.access_token}` };

    const platMe = await reqJson(`${PLAT}/me`, { headers: platHeaders });
    check('PLATFORM_PROFILE_ENDPOINT', platMe.ok && platMe.data.profile?.role === 'SUPER_ADMIN');

    const smtpInfo = await reqJson(`${PLAT}/smtp`, { headers: platHeaders });
    check('PLATFORM_SMTP_CONFIG_ENDPOINT', smtpInfo.ok && typeof smtpInfo.data.is_live === 'boolean');

    console.log(`\n=== ALL ${results.length} E2E & UNIT VERIFICATION GATES PASSED ===`);
    for (const line of results) console.log('  ✓', line);
  } finally {
    // Deterministic fixture cleanup so QA runs never pollute demo/production data
    await databaseScope
      .run({ service: true }, async () => {
        if (cleanupIds.tournamentId) {
          await pool.query(`DELETE FROM tournaments WHERE id = $1`, [cleanupIds.tournamentId]);
        }
        if (cleanupIds.campaignId) {
          await pool.query(`DELETE FROM campaigns WHERE id = $1`, [cleanupIds.campaignId]);
        }
        if (cleanupIds.dealId) {
          await pool.query(`DELETE FROM deal_rules WHERE id = $1`, [cleanupIds.dealId]);
        }
        if (cleanupIds.importJobId) {
          await pool.query(`DELETE FROM import_jobs WHERE id = $1`, [cleanupIds.importJobId]);
        }
        if (cleanupIds.draftVenueId) {
          await pool.query(`DELETE FROM staff_venue_assignments WHERE venue_id = $1`, [cleanupIds.draftVenueId]);
          await pool.query(`DELETE FROM venues WHERE id = $1 AND status = 'DRAFT'`, [cleanupIds.draftVenueId]);
        }
        if (cleanupIds.iotCmdIds.length > 0) {
          await pool.query(`DELETE FROM device_commands WHERE id = ANY($1)`, [cleanupIds.iotCmdIds]);
        }
        if (cleanupIds.customerUserId) {
          await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [cleanupIds.customerUserId]);
          await pool.query(`DELETE FROM otp_codes WHERE user_id = $1`, [cleanupIds.customerUserId]);
          await pool.query(`DELETE FROM customer_accounts WHERE id = $1`, [cleanupIds.customerUserId]);
        }
      })
      .catch((cleanupErr) => {
        console.warn('[QA Cleanup Warning]:', cleanupErr.message);
      });

    if (cleanupIds.avatarFilename && cleanupIds.avatarFilename.endsWith('.webp')) {
      for (const candidate of [
        path.join(__dirname, '../backend/uploads', cleanupIds.avatarFilename),
        path.join(__dirname, '../uploads', cleanupIds.avatarFilename),
      ]) {
        if (fs.existsSync(candidate)) {
          try {
            fs.unlinkSync(candidate);
          } catch {}
        }
      }
    }

    await pool.end().catch(() => {});
  }
}

run().catch((err) => {
  console.error('\n❌ QA SUITE FAILED:', err.stack || err.message);
  process.exit(1);
});
