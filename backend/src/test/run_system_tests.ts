import { pool } from '../config/database';
import {
  normalizeEmail,
  normalizePhoneNumber,
  generateNumericOtp,
  hashOtp,
  generateBookingCode,
  signAccessToken,
  verifyToken,
} from '../common/jwt';
import { generateBookingIcs } from '../common/ics';
import { formatCurrencyVnd } from '../common/email.service';
import { t } from '../../../shared/i18n';

async function runTests() {
  console.log('--- RUNNING COMPLETE SYSTEM SPECIFICATION TESTS (Phase 1) ---');
  let passed = 0;
  let total = 0;

  function assert(name: string, condition: boolean, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details ? ': ' + details : ''}`);
    }
  }

  // 1. REG-05: Gmail dot and alias normalization
  const norm1 = normalizeEmail('t.est+booking@gmail.com');
  const norm2 = normalizeEmail('test@gmail.com');
  assert('REG-05: Gmail dot and plus-alias normalization', norm1 === norm2, `${norm1} vs ${norm2}`);

  // 2. REG-07: Phone format normalization to E.164
  const phone1 = normalizePhoneNumber('0912345678');
  const phone2 = normalizePhoneNumber('84912345678');
  const phone3 = normalizePhoneNumber('+84912345678');
  assert('REG-07: Vietnamese phone format normalization', phone1 === '+84912345678' && phone1 === phone2 && phone2 === phone3);

  // 3. OTP-01 & OTP-03: OTP Generation & Storage
  const otp = generateNumericOtp();
  const otpHash = hashOtp(otp);
  assert('OTP-01: 6-digit numeric OTP generation', otp.length === 6 && /^\d{6}$/.test(otp));
  assert('OTP-03: OTP HMAC hashing', otpHash.length === 64);

  // 4. I18N-09: Localized business errors (VI & EN)
  const slotTakenVi = t('errors.SLOT_TAKEN', 'vi');
  const slotTakenEn = t('errors.SLOT_TAKEN', 'en');
  assert(
    'I18N-09: Localized business errors (VI & EN)',
    slotTakenVi.includes('Khung giờ này vừa có người đặt') &&
    slotTakenEn.includes('This time slot was just booked')
  );

  // 5. CUR-01: VND currency integer validation (Section 0.1, Section 6.2)
  const vndFormattedVi = formatCurrencyVnd(350000, 'vi');
  const vndFormattedEn = formatCurrencyVnd(350000, 'en');
  assert('CUR-01: Integer VND currency formatting', vndFormattedVi.includes('350.000') && vndFormattedEn.includes('350,000 VND'));

  // 6. BKG-05: iCalendar generator (.ics in GMT+7)
  const ics = generateBookingIcs({
    bookingCode: 'DS-TEST01',
    venueName: 'Sân Cầu Giấy',
    venueAddress: '18 Cầu Giấy, Hà Nội',
    courtName: 'Sân 5A',
    startAt: new Date('2026-11-21T19:00:00+07:00'),
    endAt: new Date('2026-11-21T20:30:00+07:00'),
    customerName: 'Hoai Nguyen',
    language: 'vi',
  });
  assert('BKG-05: iCalendar (.ics) generation with Asia/Ho_Chi_Minh', ics.includes('BEGIN:VCALENDAR') && ics.includes('DS-TEST01') && ics.includes('END:VCALENDAR'));

  // 7. PRT-01: Portal token separation (Customer token rejected by Staff requirement)
  const custToken = signAccessToken({ userId: 'user-123', portal: 'customer' });
  let customerRejectedOnStaff = false;
  try {
    verifyToken(custToken, 'staff');
  } catch (err: any) {
    if (err.message === 'FORBIDDEN_PORTAL') {
      customerRejectedOnStaff = true;
    }
  }
  assert('PRT-01: Customer token cannot access staff portal', customerRejectedOnStaff);

  // 8. BKG-17: POSTGRESQL ZERO DOUBLE-BOOKING CONCURRENCY TEST
  console.log('--- Testing PostgreSQL Exclusion Constraint (Zero Double-Booking) ---');
  const client1 = await pool.connect();
  const client2 = await pool.connect();

  const testCourtRes = await pool.query(`SELECT id, tenant_id, venue_id FROM courts LIMIT 1`);
  const testCourt = testCourtRes.rows[0];

  // Random future time to guarantee isolation between test runs
  const randomOffset = 100000000 + Math.floor(Math.random() * 500000000);
  const testStart = new Date(Date.now() + randomOffset);
  const testEnd = new Date(testStart.getTime() + 3600000);

  let booking1Success = false;
  let booking2Conflict = false;

  try {
    const b1 = await client1.query(
      `INSERT INTO bookings (tenant_id, venue_id, booking_code, status, total_amount)
       VALUES ($1, $2, $3, 'PENDING', 350000) RETURNING id`,
      [testCourt.tenant_id, testCourt.venue_id, generateBookingCode()]
    );
    await client1.query(
      `INSERT INTO booking_courts (tenant_id, booking_id, court_id, start_at, end_at, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [testCourt.tenant_id, b1.rows[0].id, testCourt.id, testStart, testEnd]
    );
    booking1Success = true;

    try {
      const b2 = await client2.query(
        `INSERT INTO bookings (tenant_id, venue_id, booking_code, status, total_amount)
         VALUES ($1, $2, $3, 'PENDING', 350000) RETURNING id`,
        [testCourt.tenant_id, testCourt.venue_id, generateBookingCode()]
      );
      await client2.query(
        `INSERT INTO booking_courts (tenant_id, booking_id, court_id, start_at, end_at, active)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [testCourt.tenant_id, b2.rows[0].id, testCourt.id, testStart, testEnd]
      );
    } catch (overlapErr: any) {
      if (overlapErr.code === '23P01' || overlapErr.message.includes('no_overlap')) {
        booking2Conflict = true;
      }
    }
  } finally {
    client1.release();
    client2.release();
  }

  assert(
    'BKG-17: Database-level exclusion constraint prevents double booking',
    booking1Success && booking2Conflict
  );

  // 9. BKG-03: Webhook idempotency test
  console.log('--- Testing Webhook Idempotency ---');
  const eventId = `test_evt_${Date.now()}`;
  let evt1Inserted = false;
  let evt2DuplicatePrevented = false;

  try {
    await pool.query(
      `INSERT INTO webhook_events (provider, event_id, payload, status) VALUES ('sepay', $1, '{}'::jsonb, 'PROCESSED')`,
      [eventId]
    );
    evt1Inserted = true;

    try {
      await pool.query(
        `INSERT INTO webhook_events (provider, event_id, payload, status) VALUES ('sepay', $1, '{}'::jsonb, 'PROCESSED')`,
        [eventId]
      );
    } catch (dupErr: any) {
      if (dupErr.code === '23505') {
        evt2DuplicatePrevented = true;
      }
    }
  } catch (err: any) {
    console.error('Webhook test error:', err);
  }

  assert('BKG-03: Webhook idempotency prevents duplicate transaction processing', evt1Inserted && evt2DuplicatePrevented);

  console.log(`\n========================================`);
  console.log(`TEST RESULTS: ${passed}/${total} PASSED`);
  console.log(`========================================`);

  await pool.end();
  process.exit(passed === total ? 0 : 1);
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
