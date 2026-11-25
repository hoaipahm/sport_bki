const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
require('../backend/node_modules/dotenv').config({ path: path.join(root, '.env') });
const { Client } = require('../backend/node_modules/pg');

async function migrate() {
  const connectionString = process.env.SUPER_DATABASE_URL;
  if (!connectionString) throw new Error('SUPER_DATABASE_URL is required for migrations.');
  const target = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && !process.argv.includes('--allow-remote')) {
    throw new Error('Remote database requires explicit --allow-remote.');
  }
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query(`SELECT pg_advisory_lock(728194021)`);
    const previousSchema = (await db.query(`SELECT to_regclass('public.tenants') AS tenants, to_regclass('public.schema_migrations') AS history`)).rows[0];
    if (previousSchema.tenants && !previousSchema.history) {
      throw new Error('Existing database has no migration history. Apply reviewed delta migrations with qa/apply-sql.cjs; do not replay seed migrations.');
    }
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // Existing migrations reference the worker role before creating it. Provision both roles first.
    for (const [role, key, bypass] of [['court_app', 'DATABASE_URL', false], ['court_worker', 'WORKER_DATABASE_URL', true]]) {
      if (!process.env[key]) throw new Error(`${key} is required.`);
      const password = decodeURIComponent(new URL(process.env[key]).password);
      if (!password) throw new Error(`${key} must include a password.`);
      const exists = (await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount;
      const sql = (await db.query(`SELECT format('%s ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT %s', $1::text, $2::text, $3::text, $4::text) AS sql`, [exists ? 'ALTER' : 'CREATE', role, password, bypass ? 'BYPASSRLS' : 'NOBYPASSRLS'])).rows[0].sql;
      await db.query(sql);
      if (role === 'court_app') await db.query(`SELECT set_config('app.db_role_password', $1, false)`, [password]);
    }
    const dir = path.join(root, 'migrations');
    for (const name of fs.readdirSync(dir).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const previous = (await db.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name])).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        console.log(`Skipped ${name}`);
        continue;
      }
      // Migrations may own BEGIN/COMMIT; do not wrap them in another transaction.
      // An enum addition needs its own committed query before its first use.
      const enumAdditions = sql.match(/^ALTER TYPE \w+ ADD VALUE IF NOT EXISTS '[^']+';\r?$/gm) || [];
      for (const statement of enumAdditions) await db.query(statement);
      await db.query(sql.replace(/^ALTER TYPE \w+ ADD VALUE IF NOT EXISTS '[^']+';\r?$/gm, ''));
      await db.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      console.log(`Applied ${name}`);
    }
    await db.query(`GRANT USAGE ON SCHEMA public TO court_worker;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO court_worker;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO court_worker;
      REVOKE ALL ON schema_migrations FROM court_app, court_worker`);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.query('SELECT pg_advisory_unlock(728194021)').catch(() => {});
    await db.end();
  }
}
migrate().catch(error => { console.error(error.message); process.exitCode = 1; });
