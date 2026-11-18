const {Pool}=require('../backend/node_modules/pg');
const path=require('path');require('../backend/node_modules/dotenv').config({path:path.resolve(__dirname,'../.env')});
const pool=new Pool({connectionString:process.env.SUPER_DATABASE_URL||process.env.DATABASE_URL});
(async()=>{
 const {rows}=await pool.query('SELECT name FROM venues LIMIT 1');
 console.log('name codepoints',Array.from(rows[0]?.name||'').slice(0,12).map(c=>c.codePointAt(0).toString(16)).join(' '));
 console.log('bank configured',(await pool.query("SELECT (bank_account_info ? 'bank_id') as configured FROM tenants LIMIT 1")).rows);
 await pool.end();
})().catch(e=>{console.error(e.message);pool.end();process.exitCode=1});
