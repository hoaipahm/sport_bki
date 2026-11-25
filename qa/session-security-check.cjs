const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../backend/tsconfig.json');
require('../backend/node_modules/ts-node/register');
const { hashPassword } = require('../backend/src/common/jwt');
const { generateSync } = require('../backend/node_modules/otplib');
const { Pool } = require('../backend/node_modules/pg');
const { pool } = require('../backend/src/config/database');
const db = new Pool({ connectionString: process.env.SUPER_DATABASE_URL });
const base = process.env.API_URL || 'http://localhost:4000';
let checks = 0;
async function call(portal, route, body, token, expected = 200) {
  const response = await fetch(`${base}/api/${portal}/v1${route}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${portal}${route}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
async function run() {
  const suffix = crypto.randomBytes(5).toString('hex');
  const staffId = crypto.randomUUID(), platformId = crypto.randomUUID();
  const password = `Qa!${crypto.randomBytes(12).toString('hex')}`;
  const nextPassword = `New${password}`;
  const username = `session_${suffix}`, email = `${username}@example.invalid`;
  try {
    const tenant = (await db.query('SELECT id FROM tenants ORDER BY id LIMIT 1')).rows[0];
    const hash = await hashPassword(password);
    await db.query(`INSERT INTO tenant_staff(id, tenant_id, full_name, username, phone, email, password_hash, role, status) VALUES($1,$2,'QA Session',$3,'0900000000',$4,$5,'OWNER','ACTIVE')`, [staffId, tenant.id, username, email, hash]);
    await db.query(`INSERT INTO platform_admins(id,email,full_name,password_hash,role,is_active) VALUES($1,$2,'QA Platform',$3,'SUPER_ADMIN',TRUE)`, [platformId, email, hash]);
    const staff = await call('staff', '/auth/login', { username, password });
    const admin = await call('admin', '/auth/login', { username, password });
    await call('staff', '/me', null, staff.access_token);
    await call('admin', '/me', null, admin.access_token);
    await call('staff', '/auth/change-password', { old_password: password, new_password: nextPassword }, staff.access_token);
    await call('staff', '/me', null, staff.access_token, 401);
    await call('admin', '/me', null, admin.access_token, 401);
    const fresh = await call('admin', '/auth/login', { username, password: nextPassword });
    await call('admin', '/me', null, fresh.access_token);
    console.log('PASS staff password change revokes both staff/admin tokens; fresh login works');
    await db.query(`UPDATE tenant_staff SET role='MANAGER' WHERE id=$1`, [staffId]);
    const court = (await db.query('SELECT id FROM courts WHERE tenant_id=$1 LIMIT 1', [tenant.id])).rows[0];
    const denied = await fetch(`${base}/api/admin/v1/courts/${court.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh.access_token}` }, body: JSON.stringify({ name: 'Forbidden edit' })
    });
    assert.equal(denied.status, 403, 'Manager must not edit an unassigned venue court'); checks++;
    console.log('PASS manager cannot mutate courts at unassigned venues');
    const platform = await call('platform', '/auth/login', { email, password });
    const setup = await call('platform', '/auth/2fa/setup', {}, platform.access_token);
    const code = generateSync({ secret: setup.secret });
    await call('platform', '/auth/2fa/verify', { token: code }, platform.access_token);
    await call('platform', '/auth/2fa/setup', {}, platform.access_token, 409);
    await call('platform', '/auth/login', { email, password }, null, 403);
    await call('platform', '/auth/login', { email, password, totp_code: 'invalid' }, null, 401);
    const secured = await call('platform', '/auth/login', { email, password, totp_code: generateSync({ secret: setup.secret }) });
    await call('platform', '/me/password', { current_password: password, new_password: nextPassword, confirm_password: nextPassword }, secured.access_token);
    await call('platform', '/me', null, secured.access_token, 401);
    await call('platform', '/me', null, platform.access_token, 401);
    console.log('PASS platform TOTP enrollment/login, enrolled secret replacement blocked, password revokes sessions');
  } finally {
    await db.query('DELETE FROM tenant_staff WHERE id=$1', [staffId]);
    await db.query('DELETE FROM platform_admins WHERE id=$1', [platformId]);
    await db.end();
    await pool.end();
  }
  console.log(`${checks} session security HTTP checks passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
