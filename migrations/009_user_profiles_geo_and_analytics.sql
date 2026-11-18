-- ==============================================================================
-- MIGRATION 009: USER PROFILES, MULTI-DEVICE SESSIONS, GEO MAP (C-02), SEO (C-24),
--                SMTP CONFIG & OUTBOX RETRIES (F-10), SETUP WIZARD (A-25),
--                CSV/EXCEL IMPORT (A-26), DEALS (A-27/C-21), CAMPAIGNS (A-29),
--                RAIN POLICY (A-30), TOURNAMENTS (A-31), AND IOT CONTROLS (A-33)
-- ==============================================================================

-- Add TOURNAMENT enum value outside transaction block if needed (PG 16 supports IF NOT EXISTS)
ALTER TYPE booking_type ADD VALUE IF NOT EXISTS 'TOURNAMENT';

BEGIN;

-- ==============================================================================
-- 1. USER PROFILES, DATA RIGHTS (C-05, C-06) & AVATARS
-- ==============================================================================
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS full_name VARCHAR(120);
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS avatar_url TEXT;

DROP POLICY IF EXISTS customer_own_profiles_sync ON customer_profiles;
CREATE POLICY customer_own_profiles_sync ON customer_profiles
  FOR UPDATE
  USING (
    current_setting('app.current_portal', true) = 'customer'
    AND account_id IS NOT NULL
    AND account_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.current_portal', true) = 'customer'
    AND account_id IS NOT NULL
    AND account_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

-- ==============================================================================
-- 2. VENUE GEO COORDINATES (C-02), SEO SLUGS (C-24), DRAFT STATUS (A-25) & RAIN (A-30)
-- ==============================================================================
ALTER TABLE venues ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS city_slug VARCHAR(100) NOT NULL DEFAULT 'ha-noi';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS slug VARCHAR(180);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS slug_history TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS description_i18n JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS weather_policy JSONB NOT NULL DEFAULT '{"reschedule_window_days": 14, "refund_allowed": true}'::jsonb;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS weather_closure_banner JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_slug_unique ON venues(slug) WHERE slug IS NOT NULL;

ALTER TABLE courts ADD COLUMN IF NOT EXISTS is_outdoor BOOLEAN NOT NULL DEFAULT FALSE;

-- Update public read policy on venues so DRAFT venues are hidden from public/customer portals (SET-02, SEO-01)
DROP POLICY IF EXISTS public_read_venues ON venues;
CREATE POLICY public_read_venues ON venues
  FOR SELECT
  USING (
    current_setting('app.current_portal', true) IN ('public', 'customer')
    AND status = 'PUBLISHED'
    AND tenant_id IN (SELECT id FROM tenants WHERE status = 'ACTIVE')
  );

-- Populate Hanoi coordinates, SEO slugs, descriptions & outdoor flags for seeded venues
UPDATE venues
SET latitude = COALESCE(latitude, 21.0338),
    longitude = COALESCE(longitude, 105.8001),
    district = COALESCE(district, 'Cầu Giấy'),
    city = COALESCE(city, 'Hà Nội'),
    city_slug = 'ha-noi',
    slug = COALESCE(slug, 'co-so-1-cau-giay'),
    status = 'PUBLISHED',
    description_i18n = CASE
      WHEN description_i18n = '{}'::jsonb THEN jsonb_build_object(
        'vi', 'Tổ hợp sân bóng đá cỏ nhân tạo 5 người, sân ghép 7 người và sân Pickleball tiêu chuẩn tại trung tâm quận Cầu Giấy.',
        'en', 'Standard 5-a-side, composite 7-a-side artificial turf football and Pickleball complex in central Cau Giay District.'
      )
      ELSE description_i18n
    END
WHERE id = 'b0000000-0000-0000-0000-000000000001';

UPDATE venues
SET latitude = COALESCE(latitude, 21.0089),
    longitude = COALESCE(longitude, 105.8189),
    district = COALESCE(district, 'Đống Đa'),
    city = COALESCE(city, 'Hà Nội'),
    city_slug = 'ha-noi',
    slug = COALESCE(slug, 'co-so-2-dong-da-arena'),
    status = 'PUBLISHED',
    description_i18n = CASE
      WHEN description_i18n = '{}'::jsonb THEN jsonb_build_object(
        'vi', 'Tổ hợp sân Cầu lông thảm Yonex và sân Pickleball mái che điều hòa tại Ngã Tư Sở, Đống Đa.',
        'en', 'Air-conditioned indoor Yonex badminton mats and covered Pickleball courts in Dong Da District.'
      )
      ELSE description_i18n
    END
WHERE id = 'b0000000-0000-0000-0000-000000000002';

-- Backfill slug for any other existing venues
UPDATE venues
SET slug = 'san-' || SUBSTRING(id::text, 1, 8)
WHERE slug IS NULL;

-- Set Venue 1 football courts as outdoor (so Rain Policy A-30 / RAIN-07 distinguishes outdoor vs indoor!)
UPDATE courts
SET is_outdoor = TRUE
WHERE venue_id = 'b0000000-0000-0000-0000-000000000001'
  AND court_type IN ('5-a-side', '7-a-side');

-- ==============================================================================
-- 3. SMTP SETTINGS & RELIABLE EMAIL OUTBOX RETRIES (F-10)
-- ==============================================================================
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS platform_smtp_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  host VARCHAR(255) NOT NULL DEFAULT '',
  port INT NOT NULL DEFAULT 587,
  secure BOOLEAN NOT NULL DEFAULT FALSE,
  username VARCHAR(255) NOT NULL DEFAULT '',
  password VARCHAR(512) NOT NULL DEFAULT '',
  from_email VARCHAR(254) NOT NULL DEFAULT 'noreply@sportscourt.vn',
  from_name VARCHAR(120) NOT NULL DEFAULT 'Sports Court Booking',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_smtp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 4. A-25 SETUP WIZARD PROGRESS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  step INT NOT NULL CHECK (step BETWEEN 1 AND 7),
  status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SKIPPED')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id, step)
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_onboarding ON onboarding_progress;
CREATE POLICY tenant_isolation_onboarding ON onboarding_progress
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==============================================================================
-- 5. A-26 CSV / EXCEL LEGACY IMPORT JOBS & ROWS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('CUSTOMERS', 'BOOKINGS', 'MIXED')),
  status VARCHAR(30) NOT NULL DEFAULT 'DRY_RUN' CHECK (status IN ('DRY_RUN', 'CONFIRMED', 'FAILED')),
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_rows INT NOT NULL DEFAULT 0,
  ok_rows INT NOT NULL DEFAULT 0,
  conflict_rows INT NOT NULL DEFAULT 0,
  error_rows INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_hash ON import_jobs(tenant_id, file_hash, status);

CREATE TABLE IF NOT EXISTS import_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_no INT NOT NULL,
  row_kind VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
  status VARCHAR(20) NOT NULL CHECK (status IN ('OK', 'CONFLICT', 'ERROR', 'IMPORTED')),
  error_code VARCHAR(60),
  error_detail TEXT,
  payload_json JSONB NOT NULL
);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_import_jobs ON import_jobs;
CREATE POLICY tenant_isolation_import_jobs ON import_jobs
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_import_rows ON import_rows;
CREATE POLICY tenant_isolation_import_rows ON import_rows
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==============================================================================
-- 6. A-27 OFF-PEAK & LAST-MINUTE DEALS + C-21 CUSTOMER DEALS TAB
-- ==============================================================================
CREATE TABLE IF NOT EXISTS deal_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  title_vi VARCHAR(160) NOT NULL,
  title_en VARCHAR(160) NOT NULL,
  sport_code VARCHAR(50),
  court_ids UUID[] NOT NULL DEFAULT '{}',
  days_of_week INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  time_from TIME NOT NULL,
  time_to TIME NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('OFFPEAK', 'LAST_MINUTE')),
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED_VND')),
  discount_value BIGINT NOT NULL CHECK (discount_value > 0),
  floor_price_vnd BIGINT NOT NULL CHECK (floor_price_vnd >= 0),
  lead_hours INT NOT NULL DEFAULT 6,
  valid_from DATE,
  valid_to DATE,
  stackable_with_voucher BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED')),
  is_system_suggestion BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'ONLINE';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_snapshot JSONB;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS applied_deal_id UUID REFERENCES deal_rules(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS weather_affected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE deal_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_deal_rules ON deal_rules;
CREATE POLICY tenant_isolation_deal_rules ON deal_rules
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS public_read_active_deals ON deal_rules;
CREATE POLICY public_read_active_deals ON deal_rules
  FOR SELECT
  USING (
    current_setting('app.current_portal', true) IN ('public', 'customer')
    AND status = 'ACTIVE'
    AND tenant_id IN (SELECT id FROM tenants WHERE status = 'ACTIVE')
  );

-- Seed 1 ACTIVE Off-Peak Deal and 1 DRAFT Suggested Deal on Venue 1 & Venue 2 if none exist
DO $$
DECLARE
  v_tenant UUID := 'a0000000-0000-0000-0000-000000000001';
  v_venue1 UUID := 'b0000000-0000-0000-0000-000000000001';
  v_venue2 UUID := 'b0000000-0000-0000-0000-000000000002';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deal_rules WHERE tenant_id = v_tenant) THEN
    INSERT INTO deal_rules (
      tenant_id, venue_id, title_vi, title_en, sport_code, days_of_week,
      time_from, time_to, kind, discount_type, discount_value, floor_price_vnd, lead_hours, status, is_system_suggestion
    ) VALUES
      (
        v_tenant, v_venue1,
        'Ưu đãi khung giờ trưa ngày thường (-20%)',
        'Weekday Midday Off-Peak Deal (-20%)',
        'football', '{1,2,3,4,5}',
        '09:00'::time, '15:00'::time, 'OFFPEAK', 'PERCENT', 20, 220000, 6, 'ACTIVE', FALSE
      ),
      (
        v_tenant, v_venue2,
        'Deal phút chót Pickleball & Cầu lông (-25%)',
        'Last-Minute Badminton & Pickleball (-25%)',
        NULL, '{0,1,2,3,4,5,6}',
        '06:00'::time, '22:00'::time, 'LAST_MINUTE', 'PERCENT', 25, 80000, 8, 'ACTIVE', FALSE
      ),
      (
        v_tenant, v_venue1,
        'Gợi ý tự động: Giờ trống sáng sớm T2–T6 (-15%)',
        'Auto Suggestion: Early Morning Mon–Fri (-15%)',
        'pickleball', '{1,2,3,4,5}',
        '06:00'::time, '09:00'::time, 'OFFPEAK', 'PERCENT', 15, 130000, 6, 'DRAFT', TRUE
      );
  END IF;
END $$;

-- ==============================================================================
-- 7. A-29 SEGMENTED MARKETING CAMPAIGNS & CONSENTS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS marketing_consents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  opted_in BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(60) NOT NULL DEFAULT 'CUSTOMER_PORTAL',
  unsubscribe_token VARCHAR(96) NOT NULL UNIQUE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, customer_profile_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
  segment_type VARCHAR(40) NOT NULL CHECK (segment_type IN ('ALL_OPTED_IN', 'CHURN_RISK', 'WEEKEND_PLAYERS', 'TAG_FILTER')),
  segment_tag VARCHAR(60),
  subject_vi VARCHAR(200) NOT NULL,
  subject_en VARCHAR(200) NOT NULL,
  body_vi TEXT NOT NULL,
  body_en TEXT NOT NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  preview_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  skipped_cap_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  email VARCHAR(254) NOT NULL,
  language VARCHAR(5) NOT NULL DEFAULT 'vi',
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED_CAP')),
  sent_at TIMESTAMPTZ,
  error_code VARCHAR(80),
  UNIQUE(campaign_id, customer_profile_id)
);

ALTER TABLE marketing_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_marketing_consents ON marketing_consents;
CREATE POLICY tenant_isolation_marketing_consents ON marketing_consents
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_campaigns ON campaigns;
CREATE POLICY tenant_isolation_campaigns ON campaigns
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_campaign_recipients ON campaign_recipients;
CREATE POLICY tenant_isolation_campaign_recipients ON campaign_recipients
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==============================================================================
-- 8. A-30 WEATHER / RAIN BULK CLOSURE JOBS (IDEMPOTENT)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS weather_closure_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  court_ids UUID[] NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  resolution_mode VARCHAR(30) NOT NULL CHECK (resolution_mode IN ('REFUND', 'CREDIT_RESCHEDULE', 'NOTIFY_ONLY')),
  reason TEXT NOT NULL DEFAULT 'Đóng sân ngoài trời do thời tiết xấu',
  affected_count INT NOT NULL DEFAULT 0,
  processed_count INT NOT NULL DEFAULT 0,
  processed_booking_ids UUID[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL_FAILURE')),
  created_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE weather_closure_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_closure_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_weather_jobs ON weather_closure_jobs;
CREATE POLICY tenant_isolation_weather_jobs ON weather_closure_jobs
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==============================================================================
-- 9. A-31 TOURNAMENTS (ROUND ROBIN & KNOCKOUT MVP)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name_vi VARCHAR(180) NOT NULL,
  name_en VARCHAR(180) NOT NULL,
  sport_code VARCHAR(50) NOT NULL DEFAULT 'football',
  format VARCHAR(30) NOT NULL CHECK (format IN ('ROUND_ROBIN', 'KNOCKOUT')),
  entry_fee_vnd BIGINT NOT NULL DEFAULT 0,
  max_teams INT NOT NULL DEFAULT 8 CHECK (max_teams BETWEEN 2 AND 32),
  win_points INT NOT NULL DEFAULT 3,
  draw_points INT NOT NULL DEFAULT 1,
  loss_points INT NOT NULL DEFAULT 0,
  status VARCHAR(25) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED')),
  starts_at TIMESTAMPTZ,
  created_by UUID REFERENCES tenant_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_name VARCHAR(120) NOT NULL,
  captain_name VARCHAR(120),
  captain_phone VARCHAR(25),
  seed_no INT,
  played INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  goals_for INT NOT NULL DEFAULT 0,
  goals_against INT NOT NULL DEFAULT 0,
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, team_name)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no INT NOT NULL DEFAULT 1,
  match_no INT NOT NULL DEFAULT 1,
  home_team_id UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,
  away_team_id UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,
  court_id UUID REFERENCES courts(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  home_score INT,
  away_score INT,
  winner_team_id UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('UNSCHEDULED', 'SCHEDULED', 'COMPLETED')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tournaments ON tournaments;
CREATE POLICY tenant_isolation_tournaments ON tournaments
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS public_read_tournaments ON tournaments;
CREATE POLICY public_read_tournaments ON tournaments
  FOR SELECT
  USING (current_setting('app.current_portal', true) IN ('public', 'customer') AND status != 'DRAFT');

ALTER TABLE tournament_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tournament_teams ON tournament_teams;
CREATE POLICY tenant_isolation_tournament_teams ON tournament_teams
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS public_read_tournament_teams ON tournament_teams;
CREATE POLICY public_read_tournament_teams ON tournament_teams
  FOR SELECT
  USING (current_setting('app.current_portal', true) IN ('public', 'customer'));

ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tournament_matches ON tournament_matches;
CREATE POLICY tenant_isolation_tournament_matches ON tournament_matches
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS public_read_tournament_matches ON tournament_matches;
CREATE POLICY public_read_tournament_matches ON tournament_matches
  FOR SELECT
  USING (current_setting('app.current_portal', true) IN ('public', 'customer'));

-- ==============================================================================
-- 10. A-33 SMART LIGHTS & GATE IOT INTEGRATIONS (VENDOR-NEUTRAL ADAPTER)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS device_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  device_name VARCHAR(120) NOT NULL,
  device_type VARCHAR(30) NOT NULL DEFAULT 'LIGHTING' CHECK (device_type IN ('LIGHTING', 'GATE_LOCK')),
  adapter_protocol VARCHAR(30) NOT NULL DEFAULT 'SIMULATED_RELAY' CHECK (adapter_protocol IN ('SIMULATED_RELAY', 'HTTP_WEBHOOK', 'MQTT_BRIDGE')),
  endpoint_url TEXT,
  encrypted_secret TEXT,
  lead_on_mins INT NOT NULL DEFAULT 10,
  lag_off_mins INT NOT NULL DEFAULT 5,
  power_state VARCHAR(15) NOT NULL DEFAULT 'OFF' CHECK (power_state IN ('ON', 'OFF')),
  control_mode VARCHAR(20) NOT NULL DEFAULT 'AUTO' CHECK (control_mode IN ('AUTO', 'MANUAL_OVERRIDE')),
  simulate_unreachable BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(court_id, device_type)
);

CREATE TABLE IF NOT EXISTS device_commands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES device_integrations(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  command VARCHAR(25) NOT NULL CHECK (command IN ('TURN_ON', 'TURN_OFF', 'EXTEND_SESSION')),
  trigger_source VARCHAR(30) NOT NULL CHECK (trigger_source IN ('AUTO_SCHEDULE', 'MANUAL_ADMIN', 'MANUAL_STAFF')),
  actor_id UUID,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ACKED', 'RETRIED_FAILED')),
  attempts INT NOT NULL DEFAULT 1,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_devices ON device_integrations;
CREATE POLICY tenant_isolation_devices ON device_integrations
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_commands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_device_commands ON device_commands;
CREATE POLICY tenant_isolation_device_commands ON device_commands
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Seed vendor-neutral simulated smart lighting relays on Venue 1 courts so IoT rules (IOT-01..04) are immediately operable
INSERT INTO device_integrations (tenant_id, venue_id, court_id, device_name, device_type, adapter_protocol, lead_on_mins, lag_off_mins)
SELECT
  c.tenant_id,
  c.venue_id,
  c.id,
  'Tủ điều khiển đèn LED ' || c.name,
  'LIGHTING',
  'SIMULATED_RELAY',
  10,
  5
FROM courts c
WHERE c.venue_id = 'b0000000-0000-0000-0000-000000000001'
ON CONFLICT (court_id, device_type) DO NOTHING;

-- ==============================================================================
-- 11. GRANTS FOR NON-SUPERUSER APPLICATION & WORKER ROLES
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      onboarding_progress,
      import_jobs,
      import_rows,
      deal_rules,
      marketing_consents,
      campaigns,
      campaign_recipients,
      weather_closure_jobs,
      tournaments,
      tournament_teams,
      tournament_matches,
      device_integrations,
      device_commands,
      platform_smtp_settings
    TO court_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      onboarding_progress,
      import_jobs,
      import_rows,
      deal_rules,
      marketing_consents,
      campaigns,
      campaign_recipients,
      weather_closure_jobs,
      tournaments,
      tournament_teams,
      tournament_matches,
      device_integrations,
      device_commands,
      platform_smtp_settings
    TO court_worker;
  END IF;
END $$;

-- Ensure get_public_venue_occupancy also marks TOURNAMENT bookings as occupied on public calendars
CREATE OR REPLACE FUNCTION get_public_venue_occupancy(
  p_venue_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  court_id UUID,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  status TEXT,
  hold_expires_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH direct_occupancy AS (
    SELECT
      bc.court_id,
      bc.start_at,
      bc.end_at,
      CASE WHEN b.type IN ('BLOCK', 'TOURNAMENT') THEN 'BLOCKED' ELSE b.status::text END AS status,
      b.hold_expires_at
    FROM booking_courts bc
    JOIN bookings b ON b.id = bc.booking_id
    JOIN tenants t ON t.id = b.tenant_id AND t.status = 'ACTIVE'
    WHERE b.venue_id = p_venue_id
      AND bc.active = TRUE
      AND bc.start_at < p_end
      AND bc.end_at > p_start
      AND (
        b.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
        OR (b.status = 'PENDING' AND (b.hold_expires_at IS NULL OR b.hold_expires_at > NOW()))
      )
  ),
  parent_propagated AS (
    SELECT
      cl.parent_court_id AS court_id,
      d.start_at,
      d.end_at,
      d.status,
      d.hold_expires_at
    FROM direct_occupancy d
    JOIN court_links cl ON cl.child_court_id = d.court_id
  ),
  child_propagated AS (
    SELECT
      cl.child_court_id AS court_id,
      d.start_at,
      d.end_at,
      d.status,
      d.hold_expires_at
    FROM direct_occupancy d
    JOIN court_links cl ON cl.parent_court_id = d.court_id
  )
  SELECT DISTINCT court_id, start_at, end_at, status, hold_expires_at FROM direct_occupancy
  UNION
  SELECT DISTINCT court_id, start_at, end_at, status, hold_expires_at FROM parent_propagated
  UNION
  SELECT DISTINCT court_id, start_at, end_at, status, hold_expires_at FROM child_propagated;
$$;

COMMIT;
