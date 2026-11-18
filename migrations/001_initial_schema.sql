-- ==============================================================================
-- SPORTS COURT BOOKING PLATFORM: INITIAL DATABASE MIGRATION (Phase 1)
-- Specification: court-booking-system-spec-en.md v2.0
-- Market: Vietnam (VND integer currency, Asia/Ho_Chi_Minh GMT+7 timezone, VI/EN i18n)
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. ENUMS
DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM ('OWNER', 'MANAGER', 'STAFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE staff_status AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE booking_type AS ENUM ('NORMAL', 'BLOCK', 'SERIES');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('VIETQR', 'CASH', 'BANK_TRANSFER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING', 'CONFIRMED', 'MANUAL_REVIEW', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE shift_status AS ENUM ('OPEN', 'CLOSED', 'REVIEWED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE cash_movement_type AS ENUM ('COLLECT', 'REFUND', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE email_status AS ENUM ('QUEUED', 'SENT', 'FAILED', 'BOUNCED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE otp_purpose AS ENUM ('REGISTER', 'RESET_PASSWORD', 'CHANGE_EMAIL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. CORE TENANT & PLATFORM ENTITIES
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  status tenant_status NOT NULL DEFAULT 'ACTIVE',
  default_language VARCHAR(5) NOT NULL DEFAULT 'vi',
  bank_account_info JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_name VARCHAR(100) NOT NULL DEFAULT 'STANDARD',
  price_per_month BIGINT NOT NULL DEFAULT 350000, -- Integer VND
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(254) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'SUPER_ADMIN',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_language VARCHAR(5) NOT NULL DEFAULT 'vi',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. VENUES & COURTS
CREATE TABLE IF NOT EXISTS sports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) NOT NULL UNIQUE, -- football, badminton, pickleball, tennis, etc.
  name_i18n JSONB NOT NULL, -- {"vi": "Bóng đá mini", "en": "Mini Football"}
  min_duration_mins INT NOT NULL DEFAULT 60,
  step_mins INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  address TEXT NOT NULL,
  address_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  phone VARCHAR(20) NOT NULL,
  google_maps_url TEXT,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  default_language VARCHAR(5) NOT NULL DEFAULT 'vi',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opening_hours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(venue_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS venue_closures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  sport_id UUID NOT NULL REFERENCES sports(id),
  name VARCHAR(100) NOT NULL,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  court_type VARCHAR(50) NOT NULL, -- e.g. 5-a-side, 7-a-side, single, double
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite courts (7-a-side made of two 5-a-side courts)
CREATE TABLE IF NOT EXISTS court_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  child_court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  UNIQUE(parent_court_id, child_court_id)
);

-- 5. PRICING & POLICIES
CREATE TABLE IF NOT EXISTS price_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  court_id UUID REFERENCES courts(id) ON DELETE CASCADE,
  court_type VARCHAR(50),
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
  is_weekend BOOLEAN NOT NULL DEFAULT FALSE,
  is_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  is_peak_hour BOOLEAN NOT NULL DEFAULT FALSE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  price_per_hour BIGINT NOT NULL, -- VND integer
  priority INT NOT NULL DEFAULT 0,
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  hold_duration_mins INT NOT NULL DEFAULT 10,
  deposit_mode VARCHAR(50) NOT NULL DEFAULT 'DEPOSIT_REQUIRED', -- DEPOSIT_REQUIRED, NO_DEPOSIT, MANUAL_APPROVAL
  deposit_percent INT NOT NULL DEFAULT 30 CHECK (deposit_percent BETWEEN 0 AND 100),
  cancellation_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  no_show_threshold INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ACCOUNTS & AUTHENTICATION (4 SEPARATE GROUPS)
-- Group 1: Customer Accounts
CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(20) NOT NULL,
  email VARCHAR(254) NOT NULL,
  email_normalized VARCHAR(254) NOT NULL,
  email_verified_at TIMESTAMPTZ,
  phone_e164 VARCHAR(20) NOT NULL,
  phone_verified_at TIMESTAMPTZ,
  password_hash VARCHAR(255) NOT NULL,
  status user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  preferred_language VARCHAR(5) NOT NULL DEFAULT 'vi',
  terms_version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_username ON customer_accounts(LOWER(username)) WHERE status != 'DELETED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_email_normalized ON customer_accounts(email_normalized) WHERE status != 'DELETED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_phone ON customer_accounts(phone_e164) WHERE status != 'DELETED';

-- CRM Profiles per Tenant (walk-in or registered)
CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID REFERENCES customer_accounts(id) ON DELETE SET NULL,
  full_name VARCHAR(255) NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  email VARCHAR(254),
  language VARCHAR(5) NOT NULL DEFAULT 'vi',
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  no_show_count INT NOT NULL DEFAULT 0,
  is_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cust_profile_tenant_phone ON customer_profiles(tenant_id, phone_e164);

-- Group 2: Tenant Staff (Owner, Manager, Staff)
CREATE TABLE IF NOT EXISTS tenant_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(254),
  password_hash VARCHAR(255) NOT NULL,
  pin_hash VARCHAR(255), -- Quick unlock PIN
  role staff_role NOT NULL DEFAULT 'STAFF',
  status staff_status NOT NULL DEFAULT 'ACTIVE',
  discount_limit BIGINT NOT NULL DEFAULT 50000, -- Max manual discount without manager approval
  preferred_language VARCHAR(5) NOT NULL DEFAULT 'vi',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_venue_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES tenant_staff(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  UNIQUE(staff_id, venue_id)
);

CREATE TABLE IF NOT EXISTS staff_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES tenant_staff(id) ON DELETE CASCADE,
  device_identifier VARCHAR(255) NOT NULL,
  device_name VARCHAR(255) NOT NULL,
  is_approved BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authentication Support
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_identifier VARCHAR(254) NOT NULL, -- Email or normalized phone
  user_id UUID,
  purpose otp_purpose NOT NULL,
  code_hash VARCHAR(255) NOT NULL, -- Never store plain text
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_target_active ON otp_codes(target_identifier, purpose) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  portal VARCHAR(20) NOT NULL, -- 'customer', 'staff', 'admin', 'platform'
  user_id UUID NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  device_info VARCHAR(255),
  ip_address VARCHAR(50),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  portal VARCHAR(20) NOT NULL,
  identifier VARCHAR(254) NOT NULL,
  result VARCHAR(50) NOT NULL, -- SUCCESS, FAILED_PASSWORD, LOCKED, etc.
  ip_address VARCHAR(50),
  device_info VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. SHIFTS & CASH MANAGEMENT
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES tenant_staff(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash BIGINT NOT NULL DEFAULT 0,
  counted_cash BIGINT,
  expected_cash BIGINT,
  variance BIGINT,
  note TEXT,
  approver_id UUID REFERENCES tenant_staff(id),
  status shift_status NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  type cash_movement_type NOT NULL,
  method payment_method NOT NULL,
  amount BIGINT NOT NULL,
  reason TEXT NOT NULL,
  created_by_staff_id UUID NOT NULL REFERENCES tenant_staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. BOOKINGS & SCHEDULE (ZERO DOUBLE-BOOKING CORE)
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customer_accounts(id),
  profile_id UUID REFERENCES customer_profiles(id),
  created_by_staff_id UUID REFERENCES tenant_staff(id),
  shift_id UUID REFERENCES shifts(id),
  booking_code VARCHAR(30) NOT NULL UNIQUE, -- e.g. DS-7K3M9Q
  type booking_type NOT NULL DEFAULT 'NORMAL',
  status booking_status NOT NULL DEFAULT 'PENDING',
  total_amount BIGINT NOT NULL DEFAULT 0,
  deposit_amount BIGINT NOT NULL DEFAULT 0,
  due_at_venue BIGINT NOT NULL DEFAULT 0,
  hold_expires_at TIMESTAMPTZ,
  cancel_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_courts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT end_after_start CHECK (end_at > start_at),
  -- POSTGRESQL ZERO-OVERLAP EXCLUSION CONSTRAINT
  CONSTRAINT no_overlap EXCLUDE USING gist (
    court_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (active)
);

CREATE TABLE IF NOT EXISTS booking_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  item_type VARCHAR(50) NOT NULL, -- 'COURT_SLOT', 'SERVICE' (drinks, bib rental)
  description VARCHAR(255) NOT NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  quantity INT NOT NULL DEFAULT 1,
  unit_price BIGINT NOT NULL, -- Frozen price VND
  total_price BIGINT NOT NULL, -- Frozen price VND
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. PAYMENTS & RECONCILIATION
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id),
  method payment_method NOT NULL,
  amount BIGINT NOT NULL,
  transaction_code VARCHAR(100),
  status payment_status NOT NULL DEFAULT 'PENDING',
  raw_webhook_payload JSONB,
  confirmed_by_staff_id UUID REFERENCES tenant_staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id),
  amount BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
  approved_by_staff_id UUID REFERENCES tenant_staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. NOTIFICATIONS, WEBHOOKS & AUDIT LOGS
CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient VARCHAR(254) NOT NULL,
  template_type VARCHAR(100) NOT NULL,
  language VARCHAR(5) NOT NULL DEFAULT 'vi',
  reference_id UUID,
  template_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key VARCHAR(255) NOT NULL UNIQUE,
  status email_status NOT NULL DEFAULT 'QUEUED',
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id VARCHAR(255),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL, -- e.g. 'casso', 'sepay', 'payos'
  event_id VARCHAR(255) NOT NULL UNIQUE, -- Idempotency key
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PROCESSED',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_portal VARCHAR(20) NOT NULL, -- customer, staff, admin, platform, system
  actor_id UUID,
  action VARCHAR(100) NOT NULL,
  target_table VARCHAR(100) NOT NULL,
  target_id UUID,
  before_state JSONB,
  after_state JSONB,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. ROW-LEVEL SECURITY (RLS) FOR MULTI-TENANT ISOLATION
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE court_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Note: The application connection runs with app.current_tenant_id set per request
-- Example Policy pattern:
DROP POLICY IF EXISTS tenant_isolation_venues ON venues;
CREATE POLICY tenant_isolation_venues ON venues
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_bookings ON bookings;
CREATE POLICY tenant_isolation_bookings ON bookings
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
