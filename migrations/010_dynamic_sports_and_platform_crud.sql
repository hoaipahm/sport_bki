BEGIN;

DELETE FROM sports
WHERE code IN ('karaoke', 'gameroom')
  AND NOT EXISTS (SELECT 1 FROM courts c WHERE c.sport_id = sports.id);

INSERT INTO sports (code, name_i18n, min_duration_mins, step_mins)
VALUES
  ('football', '{"vi": "Bóng đá mini", "en": "Mini Football"}'::jsonb, 60, 30),
  ('futsal', '{"vi": "Bóng đá Futsal", "en": "Futsal"}'::jsonb, 60, 30),
  ('badminton', '{"vi": "Cầu lông", "en": "Badminton"}'::jsonb, 60, 30),
  ('pickleball', '{"vi": "Pickleball", "en": "Pickleball"}'::jsonb, 60, 30),
  ('tennis', '{"vi": "Quần vợt (Tennis)", "en": "Tennis"}'::jsonb, 60, 30),
  ('basketball', '{"vi": "Bóng rổ", "en": "Basketball"}'::jsonb, 60, 30),
  ('volleyball', '{"vi": "Bóng chuyền", "en": "Volleyball"}'::jsonb, 60, 30),
  ('table-tennis', '{"vi": "Bóng bàn", "en": "Table Tennis"}'::jsonb, 60, 30)
ON CONFLICT (code) DO UPDATE
SET name_i18n = EXCLUDED.name_i18n;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_app') THEN
    GRANT SELECT ON sports TO court_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      sports,
      tenants,
      subscriptions,
      tenant_staff,
      staff_venue_assignments,
      venues,
      opening_hours,
      policies,
      venue_closures,
      courts,
      court_links,
      price_rules,
      customer_profiles,
      bookings,
      booking_courts,
      booking_items,
      payments,
      refunds
    TO court_worker;
  END IF;
END $$;

COMMIT;
