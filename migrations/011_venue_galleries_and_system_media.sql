BEGIN;

CREATE TABLE IF NOT EXISTS platform_media_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hero_slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  auth_slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ops_slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_media_settings (id, hero_slides, auth_slides, ops_slides, updated_at)
VALUES (
  1,
  '[
    "/images/showcase/hero-stadium-night.webp",
    "/images/showcase/venue-football-turf.webp",
    "/images/showcase/venue-pickleball-court.webp",
    "/images/showcase/venue-badminton-arena.webp"
  ]'::jsonb,
  '[
    "/images/showcase/auth-community-players.webp",
    "/images/showcase/ops-clubhouse-overlook.webp",
    "/images/showcase/hero-stadium-night.webp"
  ]'::jsonb,
  '[
    "/images/showcase/ops-clubhouse-overlook.webp",
    "/images/showcase/hero-stadium-night.webp",
    "/images/showcase/venue-badminton-arena.webp"
  ]'::jsonb,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Enrich Venue 1 (Cau Giay: Football + Pickleball) with multi-photo gallery while preserving any owner-uploaded photo
UPDATE venues
SET cover_photo_url = COALESCE(cover_photo_url, '/images/showcase/venue-football-turf.webp'),
    photos = (
      SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (val) val AS elem, ord
        FROM jsonb_array_elements(
          COALESCE(venues.photos, '[]'::jsonb) ||
          '[
            "/images/showcase/venue-football-turf.webp",
            "/images/showcase/venue-pickleball-court.webp",
            "/images/showcase/hero-stadium-night.webp"
          ]'::jsonb
        ) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) dedup
    ),
    updated_at = NOW()
WHERE id = 'b0000000-0000-0000-0000-000000000001';

-- Enrich Venue 2 (Dong Da Arena: Badminton) with multi-photo gallery while preserving any owner-uploaded photo
UPDATE venues
SET cover_photo_url = COALESCE(cover_photo_url, '/images/showcase/venue-badminton-arena.webp'),
    photos = (
      SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (val) val AS elem, ord
        FROM jsonb_array_elements(
          COALESCE(venues.photos, '[]'::jsonb) ||
          '[
            "/images/showcase/venue-badminton-arena.webp",
            "/images/showcase/ops-clubhouse-overlook.webp",
            "/images/showcase/venue-pickleball-court.webp"
          ]'::jsonb
        ) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) dedup
    ),
    updated_at = NOW()
WHERE id = 'b0000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_app') THEN
    GRANT SELECT ON platform_media_settings TO court_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_media_settings TO court_worker;
  END IF;
END $$;

COMMIT;
