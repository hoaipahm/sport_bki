const assert=require('node:assert/strict');
require('../backend/node_modules/ts-node/register');
const {signAccessToken}=require('../backend/src/common/jwt');
(async()=>{
 const base='http://localhost:4000/api/customer/v1';
 const token=signAccessToken({userId:'00000000-0000-0000-0000-000000000099',portal:'customer'});
 const result=await fetch(base+'/bookings',{headers:{Authorization:'Bearer '+token}});
 assert.equal(result.status,200);assert.deepEqual((await result.json()).bookings,[]);
 const hold=await fetch(base+'/bookings',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Accept-Language':'en'},body:JSON.stringify({venue_id:'b0000000-0000-0000-0000-000000000001',court_id:'12a56fa3-b2d2-4ef8-baff-d800d803a5c3',start_at:'2026-11-18T06:00:00+07:00',end_at:'2026-11-18T07:00:00+07:00'})});
 assert.equal(hold.status,409);assert.equal((await hold.json()).error_code,'PAYMENT_NOT_CONFIGURED');
 console.log('Authenticated booking API responds; unconfigured bank prevents fake payment holds: passed (read-only)');
})().catch(e=>{console.error(e);process.exitCode=1});
