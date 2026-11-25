const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../backend/tsconfig.json');
require('../backend/node_modules/ts-node/register');
const { hashPassword } = require('../backend/src/common/jwt');
const { pool } = require('../backend/src/config/database');
const { Pool } = require('../backend/node_modules/pg');
const db = new Pool({ connectionString: process.env.SUPER_DATABASE_URL });
const base = `${process.env.API_URL || 'http://localhost:4000'}/api/customer/v1`;
const users = [crypto.randomUUID(), crypto.randomUUID()];
const suffix = crypto.randomBytes(4).toString('hex');
const password = `Booking!${suffix}`;
const bookings = [];
let checks = 0;
async function request(route, token, body, key) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
function check(name, condition, actual) { assert(condition, `${name}: ${JSON.stringify(actual)}`); checks++; console.log(`PASS ${name}`); }
async function run() {
  try {
    const hash = await hashPassword(password);
    const tokens = [];
    for (let i = 0; i < users.length; i++) {
      const username = `bqa_${suffix}_${i}`, email = `${username}@example.invalid`;
      await db.query(`INSERT INTO customer_accounts(id,username,email,email_normalized,phone_e164,password_hash,status,email_verified_at) VALUES($1,$2,$3,$3,$4,$5,'ACTIVE',NOW())`, [users[i], username, email, `+849${crypto.randomInt(10000000, 99999999)}`, hash]);
      const login = await request('/auth/login', null, { identifier: email, password });
      check('real customer login', login.status === 200, login.body);
      tokens.push(login.body.access_token);
    }
    const link = (await db.query(`SELECT l.parent_court_id, l.child_court_id, c.venue_id FROM court_links l JOIN courts c ON c.id=l.parent_court_id LIMIT 1`)).rows[0];
    assert(link, 'Composite court seed required');
    const date = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    const payload = { venue_id: link.venue_id, court_id: link.parent_court_id, start_at: `${date}T10:00:00+07:00`, end_at: `${date}T11:00:00+07:00` };
    const holds = await Promise.all(tokens.map(token => request('/bookings', token, payload)));
    check('concurrent composite hold has one winner', holds.filter(row => row.status === 201).length === 1 && holds.filter(row => row.status === 409).length === 1, holds);
    const winnerIndex = holds.findIndex(row => row.status === 201), winner = holds[winnerIndex].body.booking;
    bookings.push(winner.id);
    const owner = tokens[winnerIndex], stranger = tokens[1 - winnerIndex];
    const child = await request('/bookings', stranger, { ...payload, court_id: link.child_court_id });
    check('parent reservation blocks constituent court', child.status === 409 && child.body.error_code === 'SLOT_TAKEN', child);
    const denied = await request(`/bookings/${winner.id}/cancel`, stranger, { reason: 'Ownership test' });
    check('other customer cannot cancel booking', denied.status === 404, denied);
    const invalid = await request('/bookings', owner, { ...payload, intervals: Array(17).fill({ start_at: payload.start_at, end_at: payload.end_at }) });
    check('oversized interval batch rejected', invalid.status === 400, invalid);
    const payment = await request(`/bookings/${winner.id}/sandbox-pay`, owner, { scenario: 'exact' });
    check('explicit sandbox deposit confirms hold', payment.status === 200 && payment.body.bookingStatus === 'CONFIRMED', payment);
    const calendar = await fetch(`${base}/bookings/${winner.id}/calendar.ics`, { headers: { Authorization: `Bearer ${owner}` } });
    check('calendar export', calendar.status === 200 && (await calendar.text()).includes('BEGIN:VCALENDAR'));
    const rescheduled = await request(`/bookings/${winner.id}/reschedule`, owner, {
      new_court_id: link.parent_court_id, new_start_at: `${date}T12:00:00+07:00`, new_end_at: `${date}T13:00:00+07:00`
    });
    check('reschedule preserves booking and payment identity', rescheduled.status === 200 && rescheduled.body.new_booking.id === winner.id, rescheduled);
    const balance = (await db.query(`SELECT paid_amount, (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id=$1 AND status='CONFIRMED') AS ledger FROM bookings WHERE id=$1`, [winner.id])).rows[0];
    check('rescheduled paid balance equals payment ledger', Number(balance.paid_amount) === Number(balance.ledger) && Number(balance.ledger) > 0, balance);
    const cancellation = await request(`/bookings/${winner.id}/cancel`, owner, { reason: 'QA cleanup' });
    check('owner cancellation releases occupancy', cancellation.status === 200, cancellation);
    const key = `booking-qa-${suffix}`;
    const rebook = await request('/bookings', owner, payload, key);
    check('released composite slot can be rebooked', rebook.status === 201, rebook);
    bookings.push(rebook.body.booking.id);
    const replay = await request('/bookings', owner, payload, key);
    check('idempotent retry returns same booking', replay.status === 201 && replay.body.booking.id === rebook.body.booking.id, replay);
    const overpaid = await request(`/bookings/${rebook.body.booking.id}/sandbox-pay`, owner, { scenario: 'overpay' });
    check('overpayment creates refund', overpaid.status === 200 && overpaid.body.refundQueued > 0, overpaid);
    const cancelOverpaid = await request(`/bookings/${rebook.body.booking.id}/cancel`, owner, { reason: 'QA overpayment cancellation' });
    check('overpaid booking cancellation succeeds', cancelOverpaid.status === 200, cancelOverpaid);
    const refundLedger = (await db.query(`SELECT paid_amount, refund_amount, (SELECT SUM(amount) FROM refunds WHERE booking_id=$1) AS refunds FROM bookings WHERE id=$1`, [rebook.body.booking.id])).rows[0];
    check('cancellation never refunds more than paid', Number(refundLedger.refunds) === Number(refundLedger.paid_amount) && Number(refundLedger.refund_amount) === Number(refundLedger.refunds), refundLedger);
  } finally {
    const ids = (await db.query('SELECT id FROM bookings WHERE customer_id=ANY($1)', [users])).rows.map(row => row.id);
    await db.query('DELETE FROM webhook_events WHERE event_id IN (SELECT transaction_code FROM payments WHERE booking_id=ANY($1))', [ids]);
    await db.query('DELETE FROM refunds WHERE booking_id=ANY($1)', [ids]);
    await db.query('DELETE FROM payments WHERE booking_id=ANY($1)', [ids]);
    await db.query('DELETE FROM email_outbox WHERE reference_id=ANY($1)', [ids]);
    await db.query('DELETE FROM bookings WHERE id=ANY($1)', [ids]);
    await db.query('DELETE FROM audit_logs WHERE actor_id=ANY($1) OR target_id=ANY($2)', [users, ids]);
    await db.query('DELETE FROM idempotency_keys WHERE scope=ANY($1)', [users.map(id => `customer:booking:${id}`)]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id=ANY($1)', [users]);
    await db.query('DELETE FROM customer_accounts WHERE id=ANY($1)', [users]);
    await db.end(); await pool.end();
  }
  console.log(`${checks} booking flow checks passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
