const assert=require('node:assert/strict');const {Pool}=require('../backend/node_modules/pg');const crypto=require('crypto');
const path=require('path');require('../backend/node_modules/dotenv').config({path:path.resolve(__dirname,'../.env')});
const admin=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.SUPER_DATABASE_URL||process.env.WORKER_DATABASE_URL||process.env.DATABASE_URL});
const suffix=crypto.randomBytes(5).toString('hex');const email='qa_'+suffix+'@example.invalid';const password='LocalTest!2026';let userId;
async function call(path,body,status=200,token){const r=await fetch('http://localhost:4000/api/customer/v1'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Accept-Language':'en',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,status,path+' '+(d.error_code||''));return d}
(async()=>{try{
 const reg=await call('/auth/register',{username:'qa_'+suffix,email,phone:'+849'+String(crypto.randomInt(10000000,99999999)),password,confirm_password:password,accept_terms:true},201);
 userId=(await admin.query('SELECT id FROM customer_accounts WHERE email=$1',[email])).rows[0].id;
 assert.equal(reg.delivery_mode,'local_preview');assert.match(reg.local_code,/^\d{6}$/);console.log('PASS registration: local-only preview, no email claim');
 await call('/auth/verify-email',{email,otp:'000000'},400);
 const verified=await call('/auth/verify-email',{email,otp:reg.local_code});assert.equal(verified.user.email,email);assert(verified.access_token);console.log('PASS wrong code rejected; verification returns actual user and token');
 await call('/auth/verify-email',{email,otp:reg.local_code},400);
 const login=await call('/auth/login',{identifier:email,password});await call('/me',null,200,login.access_token);
 const reset=await call('/auth/forgot-password',{identifier:email});assert.equal(reset.delivery_mode,'local_preview');
 const proof=await call('/auth/verify-reset-otp',{identifier:email,otp:reset.local_code});
 const nextPassword='ChangedLocal!2026';await call('/auth/reset-password',{reset_token:proof.reset_token,new_password:nextPassword,confirm_password:nextPassword});
 await call('/auth/reset-password',{reset_token:proof.reset_token,new_password:'AnotherLocal!2026',confirm_password:'AnotherLocal!2026'},400);
 await call('/me',null,401,login.access_token);await call('/auth/login',{identifier:email,password},401);await call('/auth/login',{identifier:email,password:nextPassword});
 assert.equal(Number((await admin.query('SELECT count(*) FROM email_outbox WHERE reference_id=$1',[userId])).rows[0].count),0);
 console.log('PASS reset single-use; old session/password revoked; new password works; no local OTP email queued');
 }finally{if(userId){await admin.query('DELETE FROM otp_codes WHERE user_id=$1',[userId]);await admin.query('DELETE FROM customer_accounts WHERE id=$1',[userId]);}await admin.end()}})().catch(e=>{console.error(e.message);process.exitCode=1});
