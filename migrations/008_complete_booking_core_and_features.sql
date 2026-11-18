-- ==============================================================================
-- MIGRATION 008: UNIFIED BOOKING CORE, COMPOSITE COURTS, IDEMPOTENCY,
--                RECONCILIATION/REFUNDS, PUBLIC OCCUPANCY PROJECTION & SEEDS
-- ==============================================================================

BEGIN;

-- 1. SCHEMA ENHANCEMENTS FOR BOOKINGS, PAYMENTS, VENUES, SHIFTS & STAFF
ALTER TABLE booking_courts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_status VARCHAR(40) NOT NULL DEFAULT 'NONE';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_review_reason VARCHAR(100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_from_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS mismatch_type VARCHAR(50);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciliation_note TEXT;

ALTER TABLE venues ADD COLUMN IF NOT EXISTS cover_photo_url TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS handover_note TEXT;

ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(128);
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant_staff ADD COLUMN IF NOT EXISTS auth_version INT NOT NULL DEFAULT 0;

ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(128);
ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill paid_amount from confirmed payments for any existing bookings
UPDATE bookings b
SET paid_amount = COALESCE((
  SELECT SUM(p.amount) FROM payments p
  WHERE p.booking_id = b.id AND p.status = 'CONFIRMED'
), 0)
WHERE b.paid_amount = 0;

-- 2. IDEMPOTENCY KEYS TABLE (F-06)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope VARCHAR(140) NOT NULL,
  idem_key VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status_code INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  UNIQUE(scope, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- 3. PERSISTED TIME-LIMITED SUPPORT SESSIONS (P-02)
CREATE TABLE IF NOT EXISTS support_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  read_only BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. VERIFIED COMPLETED-BOOKING REVIEWS (C-18, F-12)
CREATE TABLE IF NOT EXISTS venue_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE venue_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_venue_reviews ON venue_reviews;
CREATE POLICY tenant_isolation_venue_reviews ON venue_reviews
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS public_read_venue_reviews ON venue_reviews;
CREATE POLICY public_read_venue_reviews ON venue_reviews
  FOR SELECT
  USING (is_visible = TRUE AND current_setting('app.current_portal', true) IN ('public', 'customer'));

DROP POLICY IF EXISTS customer_insert_venue_reviews ON venue_reviews;
CREATE POLICY customer_insert_venue_reviews ON venue_reviews
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_portal', true) = 'customer'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = venue_reviews.booking_id
        AND b.customer_id = venue_reviews.customer_id
        AND b.status = 'COMPLETED'
    )
  );

-- Allow customer cancellation to create PENDING refund requests on their own bookings (F-08)
DROP POLICY IF EXISTS customer_refunds_insert ON refunds;
CREATE POLICY customer_refunds_insert ON refunds
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_portal', true) = 'customer'
    AND status = 'PENDING'
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = refunds.booking_id
        AND b.tenant_id = refunds.tenant_id
        AND b.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- 5. SAFE PUBLIC VENUE OCCUPANCY PROJECTION & EXPIRED HOLD RECLAMATION (F-01, F-07, Mandatory #3)
-- Exposes ONLY court_id, start_at, end_at, status, hold_expires_at (never booking_code, customer_id, or amounts)
-- Also propagates child court occupancy up to composite parent courts automatically!
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
      CASE WHEN b.type = 'BLOCK' THEN 'BLOCKED' ELSE b.status::text END AS status,
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

-- Reclaim expired PENDING holds on a venue atomically before a new booking insert
CREATE OR REPLACE FUNCTION reclaim_expired_holds_for_venue(p_venue_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(id) INTO v_ids
  FROM (
    SELECT id FROM bookings
    WHERE venue_id = p_venue_id
      AND status = 'PENDING'
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at <= NOW()
    FOR UPDATE SKIP LOCKED
  ) locked_expired;

  IF v_ids IS NULL OR ARRAY_LENGTH(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE booking_courts SET active = FALSE WHERE booking_id = ANY(v_ids);
  UPDATE bookings SET status = 'EXPIRED', updated_at = NOW() WHERE id = ANY(v_ids);
  RETURN ARRAY_LENGTH(v_ids, 1);
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys, support_sessions, venue_reviews TO court_app, court_worker;
GRANT EXECUTE ON FUNCTION get_public_venue_occupancy(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO court_app, court_worker;
GRANT EXECUTE ON FUNCTION reclaim_expired_holds_for_venue(UUID) TO court_app, court_worker;

-- 6. SEED COMPLETE PRICE RULES (7-A-SIDE, BADMINTON, PICKLEBALL) & OPERATIONAL ACCOUNTS
DO $$
DECLARE
  v_tenant UUID := 'a0000000-0000-0000-0000-000000000001';
  v_venue1 UUID := 'b0000000-0000-0000-0000-000000000001';
  v_venue2 UUID := 'b0000000-0000-0000-0000-000000000002';
  v_badminton UUID;
  v_pickleball UUID;
BEGIN
  -- Ensure sandbox_mode flag is set ONLY when bank_account_info is empty (never overwrite owner's live bank)
  UPDATE tenants
  SET bank_account_info = '{"sandbox_mode": true, "verified_by_owner": false}'::jsonb
  WHERE id = v_tenant AND (bank_account_info IS NULL OR bank_account_info = '{}'::jsonb);

  -- Enrich Venue 1 amenities
  UPDATE venues
  SET amenities = '[
    {"code": "wifi", "vi": "Wi-Fi tốc độ cao", "en": "High-speed Wi-Fi"},
    {"code": "parking", "vi": "Bãi đỗ ô tô & xe máy miễn phí", "en": "Free Car & Motorbike Parking"},
    {"code": "lighting", "vi": "Đèn LED tiêu chuẩn chống chói", "en": "Anti-glare Stadium LED"},
    {"code": "locker", "vi": "Phòng thay đồ & Tắm nước nóng", "en": "Lockers & Hot Showers"}
  ]'::jsonb,
  google_maps_url = COALESCE(google_maps_url, 'https://maps.google.com/?q=18+Cau+Giay+Ha+Noi')
  WHERE id = v_venue1;

  -- Add 7-a-side price rules on Venue 1 if missing
  IF NOT EXISTS (SELECT 1 FROM price_rules WHERE venue_id = v_venue1 AND court_type = '7-a-side') THEN
    INSERT INTO price_rules (tenant_id, venue_id, court_type, is_weekend, is_holiday, is_peak_hour, start_time, end_time, price_per_hour, priority) VALUES
      (v_tenant, v_venue1, '7-a-side', false, false, false, '06:00'::time, '17:00'::time, 550000, 1),
      (v_tenant, v_venue1, '7-a-side', false, false, true,  '17:00'::time, '21:00'::time, 800000, 2),
      (v_tenant, v_venue1, '7-a-side', false, false, false, '21:00'::time, '23:00'::time, 600000, 1),
      (v_tenant, v_venue1, '7-a-side', true,  false, true,  '06:00'::time, '23:00'::time, 800000, 3);
  END IF;

  -- Add Pickleball court on Venue 1 if missing so multi-sport selection works seamlessly
  SELECT id INTO v_pickleball FROM sports WHERE code = 'pickleball' LIMIT 1;
  IF v_pickleball IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courts WHERE venue_id = v_venue1 AND court_type = 'pickleball-standard') THEN
    INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type)
    VALUES (v_tenant, v_venue1, v_pickleball, 'Sân Pickleball P1', '{"vi": "Sân Pickleball P1", "en": "Pickleball Court P1"}'::jsonb, 'pickleball-standard');

    INSERT INTO price_rules (tenant_id, venue_id, court_type, is_weekend, is_holiday, is_peak_hour, start_time, end_time, price_per_hour, priority) VALUES
      (v_tenant, v_venue1, 'pickleball-standard', false, false, false, '06:00'::time, '17:00'::time, 160000, 1),
      (v_tenant, v_venue1, 'pickleball-standard', false, false, true,  '17:00'::time, '21:00'::time, 240000, 2),
      (v_tenant, v_venue1, 'pickleball-standard', false, false, false, '21:00'::time, '23:00'::time, 180000, 1),
      (v_tenant, v_venue1, 'pickleball-standard', true,  false, true,  '06:00'::time, '23:00'::time, 240000, 3);
  END IF;

  -- Add Venue 2 (Cầu lông & Pickleball Đống Đa) so multi-venue discovery & venue scoping tests are real
  SELECT id INTO v_badminton FROM sports WHERE code = 'badminton' LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM venues WHERE id = v_venue2) THEN
    INSERT INTO venues (id, tenant_id, name, name_i18n, address, address_i18n, phone, google_maps_url, amenities)
    VALUES (
      v_venue2,
      v_tenant,
      'Cơ sở 2 - Đống Đa Arena',
      '{"vi": "Cơ sở 2 - Đống Đa Arena", "en": "Dong Da Arena - Venue 2"}'::jsonb,
      'Số 102 Thái Thịnh, Ngã Tư Sở, Đống Đa, Hà Nội',
      '{"vi": "Số 102 Thái Thịnh, Ngã Tư Sở, Đống Đa, Hà Nội", "en": "102 Thai Thinh St, Dong Da, Hanoi"}'::jsonb,
      '0987654321',
      'https://maps.google.com/?q=102+Thai+Thinh+Ha+Noi',
      '[
        {"code": "indoor", "vi": "Sân thảm PVC trong nhà điều hòa", "en": "Air-conditioned Indoor PVC Courts"},
        {"code": "wifi", "vi": "Wi-Fi miễn phí", "en": "Free Wi-Fi"},
        {"code": "drinks", "vi": "Quầy nước thể thao & Thuê vợt", "en": "Refreshments & Racket Rental"}
      ]'::jsonb
    );

    INSERT INTO opening_hours (tenant_id, venue_id, day_of_week, open_time, close_time, is_closed)
    SELECT v_tenant, v_venue2, d, '05:30'::time, '22:30'::time, false
    FROM generate_series(0, 6) AS d
    ON CONFLICT (venue_id, day_of_week) DO NOTHING;

    INSERT INTO policies (tenant_id, venue_id, hold_duration_mins, deposit_mode, deposit_percent, cancellation_rules, policy_i18n, no_show_threshold)
    VALUES (
      v_tenant, v_venue2, 10, 'DEPOSIT_REQUIRED', 30,
      '[{"hours_before": 24, "refund_percent": 100}, {"hours_before": 12, "refund_percent": 50}, {"hours_before": 0, "refund_percent": 0}]'::jsonb,
      '{"vi": "Hủy trước 24h hoàn 100% tiền cọc, từ 12h–24h hoàn 50%, dưới 12h không hoàn cọc.", "en": "Cancel 24h+ before start for 100% refund, 12–24h for 50%, under 12h non-refundable."}'::jsonb,
      3
    );

    IF v_badminton IS NOT NULL THEN
      INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type) VALUES
        (v_tenant, v_venue2, v_badminton, 'Sân Cầu Lông B1 (Thảm Yonex)', '{"vi": "Sân Cầu Lông B1 (Thảm Yonex)", "en": "Badminton Court B1 (Yonex Mat)"}'::jsonb, 'badminton-pro'),
        (v_tenant, v_venue2, v_badminton, 'Sân Cầu Lông B2 (Thảm Yonex)', '{"vi": "Sân Cầu Lông B2 (Thảm Yonex)", "en": "Badminton Court B2 (Yonex Mat)"}'::jsonb, 'badminton-pro');

      INSERT INTO price_rules (tenant_id, venue_id, court_type, is_weekend, is_holiday, is_peak_hour, start_time, end_time, price_per_hour, priority) VALUES
        (v_tenant, v_venue2, 'badminton-pro', false, false, false, '05:30'::time, '17:00'::time, 100000, 1),
        (v_tenant, v_venue2, 'badminton-pro', false, false, true,  '17:00'::time, '21:00'::time, 140000, 2),
        (v_tenant, v_venue2, 'badminton-pro', false, false, false, '21:00'::time, '22:30'::time, 110000, 1),
        (v_tenant, v_venue2, 'badminton-pro', true,  false, true,  '05:30'::time, '22:30'::time, 140000, 3);
    END IF;

    IF v_pickleball IS NOT NULL THEN
      INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type) VALUES
        (v_tenant, v_venue2, v_pickleball, 'Sân Pickleball Mái Che D1', '{"vi": "Sân Pickleball Mái Che D1", "en": "Covered Pickleball Court D1"}'::jsonb, 'pickleball-indoor');

      INSERT INTO price_rules (tenant_id, venue_id, court_type, is_weekend, is_holiday, is_peak_hour, start_time, end_time, price_per_hour, priority) VALUES
        (v_tenant, v_venue2, 'pickleball-indoor', false, false, false, '05:30'::time, '17:00'::time, 180000, 1),
        (v_tenant, v_venue2, 'pickleball-indoor', false, false, true,  '17:00'::time, '21:00'::time, 260000, 2),
        (v_tenant, v_venue2, 'pickleball-indoor', false, false, false, '21:00'::time, '22:30'::time, 200000, 1),
        (v_tenant, v_venue2, 'pickleball-indoor', true,  false, true,  '05:30'::time, '22:30'::time, 260000, 3);
    END IF;
  END IF;

  -- Seed Owner, Manager & Counter Staff accounts with valid bcrypt hashes
  -- Admin@2026, Manager@2026, Staff@2026 (PIN: 1234)
  INSERT INTO tenant_staff (tenant_id, full_name, username, phone, email, password_hash, role, status, discount_limit)
  VALUES
    (v_tenant, 'Nguyễn Hoàng Chủ Sân', 'chusan', '0901112222', 'admin@phudong.vn', '$2a$10$yu3oXuMo8u0KKiIQ.xY4UOoxAsUMG8EBIbfDUD1oyG0Q8xHu84IpS', 'OWNER', 'ACTIVE', 500000),
    (v_tenant, 'Trần Minh Quản Lý', 'quanly', '0902223333', 'quanly@phudong.vn', '$2a$10$Hfs8k/EuRWKIgETbbGVa4OLKviavRODL8HlZI8nc/rAZ81GG/Vz.C', 'MANAGER', 'ACTIVE', 200000)
  ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    email = EXCLUDED.email,
    status = 'ACTIVE';

  INSERT INTO tenant_staff (tenant_id, full_name, username, phone, email, password_hash, pin_hash, role, status, discount_limit)
  VALUES
    (v_tenant, 'Lê Thu Ngân Quầy 1', 'nhanvien', '0903334444', 'nhanvien@phudong.vn', '$2a$10$Gde0sy6S/3huOsgcbVCh1epFGQ1kXE3EanhXzHXsTI75IJER4FdJK', '$2a$10$e8qWcoa/3RkP/HANgrj1peA14sFIVy8OyY3wIoGK3C2ZHCLlOzglC', 'STAFF', 'ACTIVE', 50000)
  ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    pin_hash = EXCLUDED.pin_hash,
    status = 'ACTIVE';

  -- Assign Owner & Manager to both venues; assign 'nhanvien' to Venue 1 (so STF-04 venue scoping is verifiable!)
  INSERT INTO staff_venue_assignments (staff_id, venue_id)
  SELECT s.id, v_venue1 FROM tenant_staff s WHERE s.tenant_id = v_tenant
  ON CONFLICT (staff_id, venue_id) DO NOTHING;

  INSERT INTO staff_venue_assignments (staff_id, venue_id)
  SELECT s.id, v_venue2 FROM tenant_staff s WHERE s.tenant_id = v_tenant AND s.role IN ('OWNER', 'MANAGER')
  ON CONFLICT (staff_id, venue_id) DO NOTHING;

  -- Update SuperAdmin@2026 valid bcrypt hash
  UPDATE platform_admins
  SET password_hash = '$2a$10$u9DwZvFjbBbxxcOFVUEVk.LUhdwlUcyAKfWVK28pdeFZQhkSfRZ4q'
  WHERE email = 'superadmin@tenmien.vn';
END $$;

COMMIT;
