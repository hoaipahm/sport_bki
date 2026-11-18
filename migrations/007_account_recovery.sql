BEGIN;
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
CREATE TABLE IF NOT EXISTS password_resets (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT NOW()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON password_resets TO court_app, court_worker;
COMMIT;
