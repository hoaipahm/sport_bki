-- ==============================================================================
-- SPORTS COURT BOOKING PLATFORM: INITIAL SEED DATA (Phase 1)
-- Sports, Sample Platform Admin, and Test Tenant
-- ==============================================================================

-- 1. SEED SPORTS (Section 0.1 & Section 4)
INSERT INTO sports (code, name_i18n, min_duration_mins, step_mins) VALUES
  ('football', '{"vi": "Bóng đá mini", "en": "Mini Football"}'::jsonb, 60, 30),
  ('badminton', '{"vi": "Cầu lông", "en": "Badminton"}'::jsonb, 60, 30),
  ('pickleball', '{"vi": "Pickleball", "en": "Pickleball"}'::jsonb, 60, 30),
  ('tennis', '{"vi": "Tennis", "en": "Tennis"}'::jsonb, 60, 30),
  ('basketball', '{"vi": "Bóng rổ", "en": "Basketball"}'::jsonb, 60, 30),
  ('billiards', '{"vi": "Bi-a", "en": "Billiards"}'::jsonb, 60, 30),
  ('karaoke', '{"vi": "Karaoke", "en": "Karaoke"}'::jsonb, 60, 30),
  ('gameroom', '{"vi": "Phòng Game", "en": "Game Room"}'::jsonb, 60, 30)
ON CONFLICT (code) DO NOTHING;

-- 2. SEED DEFAULT SUPER ADMIN (console.tenmien.vn)
-- Default pass: SuperAdmin@2026 (hashed with bcrypt / argon2 placeholder for initial bootstrap)
INSERT INTO platform_admins (email, full_name, password_hash, role, is_active, preferred_language)
VALUES (
  'superadmin@tenmien.vn',
  'Platform Super Admin',
  '$2b$10$wK1kC2.rYlWzYxJj0r8L/.Fz8OQdGj3wX8yvL1tC3eB5n7m9k1l2a',
  'SUPER_ADMIN',
  true,
  'vi'
) ON CONFLICT (email) DO NOTHING;

-- 3. SEED INITIAL TENANT (Court Owner Demo)
INSERT INTO tenants (id, name, code, status, default_language, bank_account_info)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Sân Thể Thao Phù Đổng',
  'phudong',
  'ACTIVE',
  'vi',
  '{"bank_id":"MB","account_number":"0912345678","account_name":"SAN THE THAO PHU DONG"}'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- Subscription for Demo Tenant
INSERT INTO subscriptions (tenant_id, plan_name, price_per_month, status, starts_at, expires_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'PRO',
  500000,
  'ACTIVE',
  NOW(),
  NOW() + INTERVAL '1 year'
) ON CONFLICT DO NOTHING;

-- Venue for Demo Tenant
INSERT INTO venues (id, tenant_id, name, name_i18n, address, address_i18n, phone, timezone, default_language)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Cơ sở 1 - Cầu Giấy',
  '{"vi": "Cơ sở 1 - Cầu Giấy", "en": "Cau Giay Venue 1"}'::jsonb,
  'Số 18 đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội',
  '{"vi": "Số 18 đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội", "en": "18 Cau Giay St, Dich Vong, Cau Giay, Hanoi"}'::jsonb,
  '0912345678',
  'Asia/Ho_Chi_Minh',
  'vi'
) ON CONFLICT DO NOTHING;

-- Opening hours: 06:00 to 23:00 everyday
INSERT INTO opening_hours (tenant_id, venue_id, day_of_week, open_time, close_time, is_closed)
SELECT 
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  d,
  '06:00'::time,
  '23:00'::time,
  false
FROM generate_series(0, 6) AS d
ON CONFLICT (venue_id, day_of_week) DO NOTHING;

-- Policy for Demo Venue (hold 10 mins, deposit 30%)
INSERT INTO policies (tenant_id, venue_id, hold_duration_mins, deposit_mode, deposit_percent, cancellation_rules, policy_i18n, no_show_threshold)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  10,
  'DEPOSIT_REQUIRED',
  30,
  '[
    {"hours_before": 24, "refund_percent": 100},
    {"hours_before": 12, "refund_percent": 50},
    {"hours_before": 0, "refund_percent": 0}
  ]'::jsonb,
  '{"vi": "Hủy trước 24h hoàn 100% tiền cọc, trước 12h hoàn 50%, dưới 12h mất cọc.", "en": "Cancel 24h+ before start for 100% deposit refund, 12-24h for 50%, under 12h forfeits deposit."}'::jsonb,
  3
) ON CONFLICT DO NOTHING;

-- Courts for Venue 1:
-- 2 sân bóng đá 5 người (Sân 5A, Sân 5B) và 1 sân ghép 7 người (Sân 7A = 5A + 5B)
DO $$
DECLARE
  v_football_id UUID;
  v_court_5a UUID;
  v_court_5b UUID;
  v_court_7a UUID;
BEGIN
  SELECT id INTO v_football_id FROM sports WHERE code = 'football' LIMIT 1;
  
  -- Sân 5A
  INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', v_football_id, 'Sân 5A', '{"vi": "Sân 5A", "en": "Court 5A"}'::jsonb, '5-a-side')
  RETURNING id INTO v_court_5a;

  -- Sân 5B
  INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', v_football_id, 'Sân 5B', '{"vi": "Sân 5B", "en": "Court 5B"}'::jsonb, '5-a-side')
  RETURNING id INTO v_court_5b;

  -- Sân 7A (Sân ghép)
  INSERT INTO courts (tenant_id, venue_id, sport_id, name, name_i18n, court_type)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', v_football_id, 'Sân 7A (Ghép)', '{"vi": "Sân 7A (Ghép)", "en": "Court 7A (Composite)"}'::jsonb, '7-a-side')
  RETURNING id INTO v_court_7a;

  -- Link Sân 7A với 5A và 5B
  INSERT INTO court_links (tenant_id, parent_court_id, child_court_id) VALUES
    ('a0000000-0000-0000-0000-000000000001', v_court_7a, v_court_5a),
    ('a0000000-0000-0000-0000-000000000001', v_court_7a, v_court_5b)
  ON CONFLICT DO NOTHING;

  -- Bảng giá mẫu cho sân 5 (300.000đ/h ngày thường, 450.000đ/h giờ vàng 17:00-21:00)
  INSERT INTO price_rules (tenant_id, venue_id, court_type, is_weekend, is_holiday, is_peak_hour, start_time, end_time, price_per_hour, priority) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '5-a-side', false, false, false, '06:00'::time, '17:00'::time, 300000, 1),
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '5-a-side', false, false, true,  '17:00'::time, '21:00'::time, 450000, 2),
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '5-a-side', false, false, false, '21:00'::time, '23:00'::time, 350000, 1),
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '5-a-side', true,  false, false, '06:00'::time, '23:00'::time, 450000, 3);
END $$;
