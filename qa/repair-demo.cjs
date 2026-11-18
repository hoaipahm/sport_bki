const fs=require('node:fs');const {Pool}=require('../backend/node_modules/pg');
const path=require('path');require('../backend/node_modules/dotenv').config({path:path.resolve(__dirname,'../.env')});
const pool=new Pool({connectionString:process.env.SUPER_DATABASE_URL||process.env.DATABASE_URL});
(async()=>{const results=await pool.query(fs.readFileSync('migrations/003_repair_demo_encoding.sql','utf8'));console.log('UTF-8 demo data repair:',results.map(r=>({command:r.command,rows:r.rowCount})));await pool.end()})().catch(e=>{console.error(e.message);pool.end();process.exitCode=1});
