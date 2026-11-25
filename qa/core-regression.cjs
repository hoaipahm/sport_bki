const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../backend/tsconfig.json');
require('../backend/node_modules/ts-node/register');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { Pool } = require('../backend/node_modules/pg');
const { signAccessToken, verifyToken } = require('../backend/src/common/jwt');
const { buildPaymentDescriptor, processBankPaymentEvent } = require('../backend/src/modules/booking/booking.service');
const { pool } = require('../backend/src/config/database');
const { canPreviewLocalOtp } = require('../backend/src/common/local-preview');

async function run() {
  let passed = 0;
  const check = (name, work) => { work(); passed++; console.log(`PASS ${name}`); };
  const payload = { userId: randomUUID(), portal: 'customer' };
  check('valid portal token', () => assert.equal(verifyToken(signAccessToken(payload), 'customer').userId, payload.userId));
  check('wrong portal rejected', () => assert.throws(() => verifyToken(signAccessToken(payload), 'staff'), /FORBIDDEN_PORTAL/));
  for (const [name, options] of [['mismatched audience', { audience: 'staff' }], ['missing audience', {}], ['wrong algorithm', { audience: 'customer', algorithm: 'HS384' }]]) {
    check(name, () => assert.throws(() => verifyToken(jwt.sign(payload, process.env.JWT_SECRET, { issuer: 'court-booking-auth', ...options }))));
  }
  check('unverified receiving bank rejected', () => assert.throws(() => buildPaymentDescriptor({ bank_id: 'MB', account_number: '123', account_name: 'Test' }, 10000, 'DS-ABC123'), /PAYMENT_NOT_CONFIGURED/));
  const fakeRequest = (address, origin) => ({ socket: { remoteAddress: address }, get: () => origin });
  const previousMode = process.env.AUTH_EMAIL_MODE;
  const previousEnv = process.env.NODE_ENV;
  process.env.AUTH_EMAIL_MODE = 'local';
  process.env.NODE_ENV = 'development';
  check('loopback test OTP allowed', () => assert.equal(canPreviewLocalOtp(fakeRequest('127.0.0.1', 'http://localhost:3000')), true));
  check('remote test OTP blocked', () => assert.equal(canPreviewLocalOtp(fakeRequest('192.0.2.1')), false));
  check('untrusted origin blocked', () => assert.equal(canPreviewLocalOtp(fakeRequest('127.0.0.1', 'https://untrusted.example')), false));
  process.env.NODE_ENV = 'production';
  check('production local mode blocked', () => assert.equal(canPreviewLocalOtp(fakeRequest('127.0.0.1')), false));
  if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
  if (previousMode === undefined) delete process.env.AUTH_EMAIL_MODE; else process.env.AUTH_EMAIL_MODE = previousMode;

  const db = new Pool({ connectionString: process.env.SUPER_DATABASE_URL });
  const bookingId = randomUUID();
  const code = `DS-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  const eventIds = [randomUUID(), randomUUID(), randomUUID()];
  try {
    const venue = (await db.query('SELECT id, tenant_id FROM venues ORDER BY id LIMIT 1')).rows[0];
    assert(venue, 'Run migrations on a disposable local database first.');
    await db.query(`INSERT INTO bookings(id, tenant_id, venue_id, booking_code, status, total_amount, deposit_amount, due_at_venue, hold_expires_at)
      VALUES ($1,$2,$3,$4,'PENDING',100000,30000,100000,NOW()+INTERVAL '10 minutes')`, [bookingId, venue.tenant_id, venue.id, code]);
    const event = (eventId, amount) => processBankPaymentEvent({ provider: 'qa', eventId, transferNote: code, transferAmount: amount, rawPayload: { qa: true } });
    const concurrent = await Promise.all([event(eventIds[0], 150000), event(eventIds[0], 150000)]);
    check('concurrent duplicate webhook processed once', () => assert.deepEqual(concurrent.map(row => row.outcome).sort(), ['ALREADY_PROCESSED', 'OVERPAID_CONFIRMED']));
    await event(eventIds[1], 20000);
    const summary = (await db.query(`SELECT paid_amount, refund_amount, (SELECT SUM(amount) FROM refunds WHERE booking_id=$1) AS queued FROM bookings WHERE id=$1`, [bookingId])).rows[0];
    check('repeated excess transfer refunds only incremental excess', () => {
      assert.equal(Number(summary.paid_amount), 170000);
      assert.equal(Number(summary.refund_amount), 70000);
      assert.equal(Number(summary.queued), 70000);
    });
    await db.query(`UPDATE bookings SET status='CANCELLED' WHERE id=$1`, [bookingId]);
    const late = await event(eventIds[2], 10000);
    check('cancelled booking never reactivated by payment', () => assert.equal(late.outcome, 'LATE_PAYMENT_REVIEW'));
  } finally {
    await db.query('DELETE FROM refunds WHERE booking_id=$1', [bookingId]);
    await db.query('DELETE FROM payments WHERE booking_id=$1', [bookingId]);
    await db.query('DELETE FROM bookings WHERE id=$1', [bookingId]);
    await db.query('DELETE FROM audit_logs WHERE target_id=$1', [bookingId]);
    await db.query('DELETE FROM webhook_events WHERE event_id=ANY($1)', [eventIds]);
    await db.end();
    await pool.end();
  }
  console.log(`${passed} core regression checks passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
