-- ==============================================================================
-- MIGRATION 004: COMPREHENSIVE RLS, DATABASE ROLES, VENUE SCOPING & ENCODING FIXES
-- ==============================================================================

BEGIN;

-- 1. REPAIR VIETNAMESE ENCODING IN POLICIES & SEED RECEIVING BANK ACCOUNT
UPDATE policies
SET policy_i18n = jsonb_build_object(
  'vi', 'Hủy trước 24h hoàn 100% tiền cọc, trước 12h hoàn 50%, dưới 12h mất cọc.',
  'en', 'Cancel 24h+ before start for 100% deposit refund, 12-24h for 50%, under 12h forfeits deposit.'
)
WHERE venue_id = 'b0000000-0000-0000-0000-000000000001';

UPDATE tenants
SET name = 'Sân Thể Thao Phù Đổng',
    bank_account_info = jsonb_build_object(
      'bank_id', 'MB',
      'account_number', '0912345678',
      'account_name', 'SAN THE THAO PHU DONG'
    )
WHERE id = 'a0000000-0000-0000-0000-000000000001';

UPDATE venues
SET name = 'Cơ sở 1 - Cầu Giấy',
    name_i18n = jsonb_build_object('vi', 'Cơ sở 1 - Cầu Giấy', 'en', 'Cau Giay Venue 1'),
    address = 'Số 18 đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội',
    address_i18n = jsonb_build_object('vi', 'Số 18 đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội', 'en', '18 Cau Giay St, Dich Vong, Cau Giay, Hanoi')
WHERE id = 'b0000000-0000-0000-0000-000000000001';

UPDATE courts
SET name = 'Sân 5A',
    name_i18n = jsonb_build_object('vi', 'Sân 5A', 'en', 'Court 5A')
WHERE venue_id = 'b0000000-0000-0000-0000-000000000001' AND court_type = '5-a-side' AND name LIKE '%5A%';

UPDATE courts
SET name = 'Sân 5B',
    name_i18n = jsonb_build_object('vi', 'Sân 5B', 'en', 'Court 5B')
WHERE venue_id = 'b0000000-0000-0000-0000-000000000001' AND court_type = '5-a-side' AND name LIKE '%5B%';

UPDATE courts
SET name = 'Sân 7A (Ghép)',
    name_i18n = jsonb_build_object('vi', 'Sân 7A (Ghép)', 'en', 'Court 7A (Composite)')
WHERE venue_id = 'b0000000-0000-0000-0000-000000000001' AND court_type = '7-a-side';

-- 2. CREATE NON-SUPERUSER DATABASE APP ROLE (NOBYPASSRLS)
-- Set `SET app.db_role_password = '<secret>';` before running to assign a specific password.
DO $$
DECLARE
  v_configured_password TEXT := NULLIF(current_setting('app.db_role_password', true), '');
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'court_app') THEN
    EXECUTE format(
      'CREATE ROLE court_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
      COALESCE(v_configured_password, md5(random()::text || clock_timestamp()::text))
    );
  ELSIF v_configured_password IS NOT NULL THEN
    EXECUTE format(
      'ALTER ROLE court_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
      v_configured_password
    );
  ELSE
    ALTER ROLE court_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO court_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO court_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO court_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO court_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO court_app;

-- 3. ENABLE AND FORCE ROW-LEVEL SECURITY ON ALL MULTI-TENANT TABLES
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues FORCE ROW LEVEL SECURITY;

ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts FORCE ROW LEVEL SECURITY;

ALTER TABLE court_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE court_links FORCE ROW LEVEL SECURITY;

ALTER TABLE opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_hours FORCE ROW LEVEL SECURITY;

ALTER TABLE venue_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_closures FORCE ROW LEVEL SECURITY;

ALTER TABLE price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies FORCE ROW LEVEL SECURITY;

ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_staff FORCE ROW LEVEL SECURITY;

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements FORCE ROW LEVEL SECURITY;

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

ALTER TABLE booking_courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_courts FORCE ROW LEVEL SECURITY;

ALTER TABLE booking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_items FORCE ROW LEVEL SECURITY;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- 4. CREATE POLICIES FOR ALL TABLES
-- When app.current_tenant_id is set, row must match tenant_id.
-- When app.current_tenant_id is NULL or empty (system / platform level / public browsing), all rows visible.

-- venues
DROP POLICY IF EXISTS tenant_isolation_venues ON venues;
CREATE POLICY tenant_isolation_venues ON venues
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- courts
DROP POLICY IF EXISTS tenant_isolation_courts ON courts;
CREATE POLICY tenant_isolation_courts ON courts
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- court_links
DROP POLICY IF EXISTS tenant_isolation_court_links ON court_links;
CREATE POLICY tenant_isolation_court_links ON court_links
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- opening_hours
DROP POLICY IF EXISTS tenant_isolation_opening_hours ON opening_hours;
CREATE POLICY tenant_isolation_opening_hours ON opening_hours
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- venue_closures
DROP POLICY IF EXISTS tenant_isolation_venue_closures ON venue_closures;
CREATE POLICY tenant_isolation_venue_closures ON venue_closures
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- price_rules
DROP POLICY IF EXISTS tenant_isolation_price_rules ON price_rules;
CREATE POLICY tenant_isolation_price_rules ON price_rules
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- policies
DROP POLICY IF EXISTS tenant_isolation_policies ON policies;
CREATE POLICY tenant_isolation_policies ON policies
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- customer_profiles
DROP POLICY IF EXISTS tenant_isolation_customer_profiles ON customer_profiles;
CREATE POLICY tenant_isolation_customer_profiles ON customer_profiles
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- tenant_staff
DROP POLICY IF EXISTS tenant_isolation_tenant_staff ON tenant_staff;
CREATE POLICY tenant_isolation_tenant_staff ON tenant_staff
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- shifts
DROP POLICY IF EXISTS tenant_isolation_shifts ON shifts;
CREATE POLICY tenant_isolation_shifts ON shifts
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- cash_movements
DROP POLICY IF EXISTS tenant_isolation_cash_movements ON cash_movements;
CREATE POLICY tenant_isolation_cash_movements ON cash_movements
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- bookings
DROP POLICY IF EXISTS tenant_isolation_bookings ON bookings;
CREATE POLICY tenant_isolation_bookings ON bookings
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- booking_courts
DROP POLICY IF EXISTS tenant_isolation_booking_courts ON booking_courts;
CREATE POLICY tenant_isolation_booking_courts ON booking_courts
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- booking_items
DROP POLICY IF EXISTS tenant_isolation_booking_items ON booking_items;
CREATE POLICY tenant_isolation_booking_items ON booking_items
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- payments
DROP POLICY IF EXISTS tenant_isolation_payments ON payments;
CREATE POLICY tenant_isolation_payments ON payments
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- refunds
DROP POLICY IF EXISTS tenant_isolation_refunds ON refunds;
CREATE POLICY tenant_isolation_refunds ON refunds
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- audit_logs
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- 5. ENSURE STAFF VENUE ASSIGNMENTS FOR DEMO STAFF & MANAGER
INSERT INTO staff_venue_assignments (staff_id, venue_id)
SELECT s.id, 'b0000000-0000-0000-0000-000000000001'::uuid
FROM tenant_staff s
WHERE s.tenant_id = 'a0000000-0000-0000-0000-000000000001'
ON CONFLICT (staff_id, venue_id) DO NOTHING;

COMMIT;
