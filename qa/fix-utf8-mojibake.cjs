const path = require('path');
const { Pool } = require(path.join(__dirname, '../backend/node_modules/pg'));

const WIN1252_EXTRA = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const MOJIBAKE_RE = /(?:Ã[\x80-\xBFa-zA-Z]|Æ[¡°]|á»|Ä[\x80-\xBF‘])/;

function decodeSingleToken(tok) {
  if (!MOJIBAKE_RE.test(tok)) return tok;
  const bytes = [];
  for (let i = 0; i < tok.length; i++) {
    const code = tok.charCodeAt(i);
    if (code <= 0xff) {
      bytes.push(code);
    } else if (WIN1252_EXTRA[code] !== undefined) {
      bytes.push(WIN1252_EXTRA[code]);
    } else {
      return tok;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return tok;
  }
}

function repairMojibakeString(str) {
  if (typeof str !== 'string' || !MOJIBAKE_RE.test(str)) return str;
  const whole = decodeSingleToken(str);
  if (whole !== str) return whole;
  return str.replace(/\S+/g, decodeSingleToken);
}

function repairAnyValue(val) {
  if (typeof val === 'string') return repairMojibakeString(val);
  if (Array.isArray(val)) return val.map(repairAnyValue);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = repairAnyValue(v);
    }
    return out;
  }
  return val;
}

async function main() {
  require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../.env') });
  const pool = new Pool({
    connectionString:
      process.env.SUPER_DATABASE_URL || process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL,
  });

  let fixedRows = 0;
  try {
    await pool.query(`SET client_encoding = 'UTF8'`);

    const tablesRes = await pool.query(`
      SELECT t.table_name, kcu.column_name AS pk
      FROM information_schema.tables t
      JOIN information_schema.table_constraints tc
        ON tc.table_schema = t.table_schema AND tc.table_name = t.table_name AND tc.constraint_type = 'PRIMARY KEY'
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = t.table_schema AND kcu.ordinal_position = 1
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    `);

    for (const { table_name: table, pk } of tablesRes.rows) {
      const colTypesRes = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND data_type IN ('character varying', 'text', 'jsonb')
           AND column_name != $2`,
        [table, pk]
      );
      const validCols = colTypesRes.rows;
      if (!validCols.length) continue;

      const selectCols = validCols.map((c) => `"${c.column_name}"`).join(', ');
      const rows = (await pool.query(`SELECT "${pk}", ${selectCols} FROM "${table}"`)).rows;

      for (const row of rows) {
        const updates = [];
        const vals = [];
        let changed = false;

        for (const { column_name: col, data_type: dtype } of validCols) {
          const orig = row[col];
          if (orig == null) continue;
          const repaired = repairAnyValue(orig);
          if (JSON.stringify(repaired) !== JSON.stringify(orig)) {
            changed = true;
            vals.push(dtype === 'jsonb' ? JSON.stringify(repaired) : repaired);
            updates.push(
              dtype === 'jsonb' ? `"${col}" = $${vals.length}::jsonb` : `"${col}" = $${vals.length}`
            );
          }
        }

        if (changed) {
          vals.push(row[pk]);
          await pool.query(`UPDATE "${table}" SET ${updates.join(', ')} WHERE "${pk}" = $${vals.length}`, vals);
          fixedRows++;
          console.log(`Fixed mojibake in ${table}.${pk}=${row[pk]}`);
        }
      }
    }

    const bk = await pool.query(
      `SELECT status, count(*)::int as cnt, COALESCE(sum(total_amount),0)::bigint as total, COALESCE(sum(paid_amount),0)::bigint as paid FROM bookings GROUP BY status`
    );
    const pm = await pool.query(
      `SELECT status, count(*)::int as cnt, COALESCE(sum(amount),0)::bigint as amount FROM payments GROUP BY status`
    );
    console.log(`Total rows repaired this run: ${fixedRows}`);
    console.log('Bookings:', bk.rows);
    console.log('Payments:', pm.rows);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
