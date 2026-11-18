BEGIN;

ALTER TABLE venue_reviews
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE venue_reviews
  ADD COLUMN IF NOT EXISTS reviewer_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS owner_reply TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure at most one general (unlinked-booking) review per customer per venue
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_reviews_customer_venue_general
  ON venue_reviews (venue_id, customer_id)
  WHERE booking_id IS NULL;

-- Update RLS policies so authenticated customers can submit/edit/delete their own venue reviews
-- and Tenant Admins can moderate (show/hide/reply/delete) all reviews on their tenant's venues.
DROP POLICY IF EXISTS tenant_isolation_venue_reviews ON venue_reviews;
CREATE POLICY tenant_isolation_venue_reviews ON venue_reviews
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS public_read_venue_reviews ON venue_reviews;
CREATE POLICY public_read_venue_reviews ON venue_reviews
  FOR SELECT
  USING (
    (is_visible = TRUE AND current_setting('app.current_portal', true) IN ('public', 'customer'))
    OR (
      current_setting('app.current_portal', true) = 'customer'
      AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS customer_insert_venue_reviews ON venue_reviews;
DROP POLICY IF EXISTS customer_write_venue_reviews ON venue_reviews;
CREATE POLICY customer_write_venue_reviews ON venue_reviews
  FOR ALL
  USING (
    current_setting('app.current_portal', true) = 'customer'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.current_portal', true) = 'customer'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON venue_reviews TO court_app, court_worker;

COMMIT;
