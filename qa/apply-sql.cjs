const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require(path.join(__dirname, '../backend/node_modules/pg'));

async function main() {
  const rel = process.argv[2] || 'migrations/010_dynamic_sports_and_platform_crud.sql';
  const sql = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
  const pool = new Pool({
    connectionString:
      process.env.SUPER_DATABASE_URL || process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL,
  });
  try {
    await pool.query(`SET client_encoding = 'UTF8'`);
    const client = await pool.connect();
    try {
      const additions = sql.match(/^ALTER TYPE \w+ ADD VALUE IF NOT EXISTS '[^']+';\r?$/gm) || [];
      for (const statement of additions) await client.query(statement);
      await client.query(sql.replace(/^ALTER TYPE \w+ ADD VALUE IF NOT EXISTS '[^']+';\r?$/gm, ''));
    } finally { client.release(); }
    console.log(`Applied ${rel}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
