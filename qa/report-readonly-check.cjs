const fs = require('node:fs');
const path = require('node:path');
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('../backend/node_modules/pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  const results = {};
  results.role = (await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows;
  results.rls = (await pool.query("SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) as policy_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")).rows;
  results.overlap = (await pool.query("SELECT conname, pg_get_constraintdef(oid) as definition FROM pg_constraint WHERE conname='no_overlap'")).rows;
  results.bank = (await pool.query("SELECT count(*)::int as venues_without_receiving_account FROM venues v JOIN tenants t ON t.id=v.tenant_id WHERE NOT (t.bank_account_info ? 'bank_id')")).rows;
  results.encoding = (await pool.query("SELECT count(*)::int as suspicious_policy_rows FROM policies WHERE policy_i18n::text LIKE '%Ã%' OR policy_i18n::text LIKE '%á»%' OR policy_i18n::text LIKE '%Æ%'")).rows;

  fs.writeFileSync('qa/report-readonly-evidence.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await pool.end();
})().catch(e => {
  console.error(e.message);
  pool.end();
  process.exitCode = 1;
});
