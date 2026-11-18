const fs = require('fs');
const path = require('path');
const { Pool } = require(path.join(__dirname, '../backend/node_modules/pg'));

const ROOT = path.resolve(__dirname, '..');
const vi = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/i18n/vi.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/i18n/en.json'), 'utf8'));

function getKey(obj, dotPath) {
  return dotPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

function walkFiles(dir, exts, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next' || ent.name === 'dist') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, exts, out);
    else if (exts.some((ext) => ent.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const MOJIBAKE_RE = /(?:Ã[\x80-\xBFa-zA-Z]|Æ[¡°]|á»|Ä[\x80-\xBF‘]|\uFFFD)/;

async function main() {
  const files = [
    ...walkFiles(path.join(ROOT, 'frontend/src'), ['.ts', '.tsx', '.css']),
    ...walkFiles(path.join(ROOT, 'backend/src'), ['.ts']),
    ...walkFiles(path.join(ROOT, 'shared'), ['.ts', '.json']),
  ];

  const badEncodingFiles = [];
  const missingI18n = [];
  const leadingNoneTruncate = [];
  const svgTextLocations = [];

  const tCallRe = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      // Skip regex definition lines in healer files
      if (MOJIBAKE_RE.test(line) && !rel.includes('GlassInteractiveRuntime')) {
        badEncodingFiles.push(`${rel}:${idx + 1}: ${line.trim().slice(0, 100)}`);
      }
      if (line.includes('leading-none') && (line.includes('truncate') || line.includes('overflow-hidden'))) {
        leadingNoneTruncate.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
      if (/<text\b/.test(line)) {
        svgTextLocations.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });

    let m;
    while ((m = tCallRe.exec(content)) !== null) {
      const key = m[1];
      if (!key.includes('.')) continue;
      if (getKey(vi, key) === undefined || getKey(en, key) === undefined) {
        missingI18n.push({ file: rel, key, inVi: getKey(vi, key) !== undefined, inEn: getKey(en, key) !== undefined });
      }
    }
  }

  console.log('1. Source encoding / mojibake issues:', badEncodingFiles);
  console.log('2. Missing i18n keys in t(...) calls:', missingI18n);
  console.log('3. leading-none + truncate/overflow-hidden:', leadingNoneTruncate);
  console.log('4. SVG <text> occurrences:', svgTextLocations);

  // Check DB
  require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../.env') });
  const pool = new Pool({
    connectionString:
      process.env.SUPER_DATABASE_URL || process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL,
  });
  try {
    await pool.query(`SET client_encoding = 'UTF8'`);
    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const dbIssues = [];
    for (const { table_name: t } of tablesRes.rows) {
      const cols = (
        await pool.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('character varying', 'text', 'jsonb')`,
          [t]
        )
      ).rows;
      for (const { column_name: c } of cols) {
        const rows = (await pool.query(`SELECT "${c}" FROM "${t}" WHERE "${c}" IS NOT NULL`)).rows;
        for (const r of rows) {
          const s = typeof r[c] === 'string' ? r[c] : JSON.stringify(r[c]);
          if (MOJIBAKE_RE.test(s)) {
            dbIssues.push({ table: t, col: c, sample: s.slice(0, 120) });
          }
        }
      }
    }
    console.log('5. Database encoding / mojibake issues:', dbIssues);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
