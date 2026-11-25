import { PoolClient } from 'pg';
import { databaseScope } from '../../config/database-scope';
import { pool } from '../../config/database';
import { generateBookingCode } from '../../common/jwt';
import { broadcastCourtChange } from '../../common/realtime';
import { recordAuditLog } from '../../common/audit';
import { dispatchQueuedEmail } from '../../common/email.service';
import {
  resolvePrice,
  vietnamDate,
  vietnamTime,
  calculateRefundPolicy,
  CancellationRule,
} from '../../../../shared/booking';

export class BookingDomainError extends Error {
  constructor(
    public code: string,
    public status: number = 400,
    public extra?: Record<string, any>
  ) {
    super(code);
  }
}

export interface PaymentDescriptor {
  payment_mode: 'live' | 'sandbox';
  vietqr_url?: string;
  bank_account: {
    bank_name: string;
    bin: string;
    account_number: string;
    account_name: string;
  };
  transfer_note: string;
}

export function buildPaymentDescriptor(
  bankInfo: any,
  amountVnd: number,
  bookingCode: string
): PaymentDescriptor {
  const hasLiveBank = Boolean(
    bankInfo?.bank_id &&
    bankInfo?.account_number &&
    bankInfo?.account_name &&
    bankInfo?.verified_by_owner === true
  );

  if (hasLiveBank) {
    const vietqr_url =
      amountVnd > 0
        ? `https://img.vietqr.io/image/${encodeURIComponent(bankInfo.bank_id)}-${encodeURIComponent(bankInfo.account_number)}-compact2.png?amount=${amountVnd}&addInfo=${encodeURIComponent(bookingCode)}&accountName=${encodeURIComponent(bankInfo.account_name)}`
        : undefined;
    return {
      payment_mode: 'live',
      vietqr_url,
      bank_account: {
        bank_name: bankInfo.bank_name || bankInfo.bank_id,
        bin: bankInfo.bank_id,
        account_number: bankInfo.account_number,
        account_name: bankInfo.account_name,
      },
      transfer_note: bookingCode,
    };
  }

  if (bankInfo?.sandbox_mode === true && process.env.NODE_ENV !== 'production') {
    return {
      payment_mode: 'sandbox',
      vietqr_url: undefined,
      bank_account: {
        bank_name: 'CHẾ ĐỘ THỬ NGHIỆM (SANDBOX)',
        bin: 'SANDBOX',
        account_number: '0000-SANDBOX-TEST',
        account_name: 'MO PHONG THANH TOAN - KHONG CHUYEN TIEN THAT',
      },
      transfer_note: bookingCode,
    };
  }

  throw new BookingDomainError('PAYMENT_NOT_CONFIGURED', 409);
}

/**
 * Expand a selected court to its constituent physical leaf courts (F-07 & A-02).
 * Booking a composite 7-a-side court reserves [7A, 5A, 5B]; booking 5A reserves [5A],
 * allowing 5A and 5B concurrently while atomically preventing 5A vs 7A overlap via GiST!
 */
export async function expandPhysicalCourts(
  client: PoolClient,
  courtId: string
): Promise<string[]> {
  const links = await client.query(
    `SELECT child_court_id FROM court_links WHERE parent_court_id = $1`,
    [courtId]
  );
  const set = new Set<string>([courtId]);
  for (const row of links.rows) {
    set.add(row.child_court_id);
  }
  return Array.from(set);
}

export interface ValidatedQuote {
  tenantId: string;
  venueId: string;
  venueName: string;
  venueAddress: string;
  courtId: string;
  courtName: string;
  courtType: string;
  physicalCourtIds: string[];
  start: Date;
  end: Date;
  durationMins: number;
  originalTotalAmount: number;
  discountAmount: number;
  appliedDealId: string | null;
  appliedDealTitle: { vi: string; en: string } | null;
  priceSnapshot: Record<string, any>;
  totalAmount: number;
  depositMode: string;
  depositPercent: number;
  depositAmount: number;
  dueAtVenue: number;
  holdMins: number;
  cancellationRules: CancellationRule[];
  bankAccountInfo: any;
  slotsBreakdown: Array<{ time: string; originalPricePerHour: number; pricePerHour: number; slotPrice: number; dealApplied?: boolean }>;
}

/**
 * Single authoritative quote, opening-hours, closure, court-membership & policy engine (F-05).
 * Shared across Customer Hold, Customer Reschedule, Staff Walk-in Booking, and Quote Previews.
 */
export async function validateAndQuoteSlot(
  client: PoolClient,
  params: {
    venueId: string;
    courtId: string;
    startAt: string | Date;
    endAt: string | Date;
    isStaffCounter?: boolean;
    requirePaymentConfig?: boolean;
  }
): Promise<ValidatedQuote> {
  const { venueId, courtId, isStaffCounter = false, requirePaymentConfig = true } = params;

  const venueRes = await client.query(
    `SELECT v.id, v.tenant_id, v.name, v.address, t.bank_account_info,
            p.hold_duration_mins, p.deposit_mode, p.deposit_percent, p.cancellation_rules
     FROM venues v
     JOIN tenants t ON t.id = v.tenant_id AND t.status = 'ACTIVE'
     LEFT JOIN policies p ON p.venue_id = v.id
     WHERE v.id = $1`,
    [venueId]
  );

  if (venueRes.rows.length === 0) {
    throw new BookingDomainError('VENUE_NOT_FOUND', 404);
  }

  const venue = venueRes.rows[0];
  const start = new Date(params.startAt);
  const end = new Date(params.endAt);
  const durationMs = end.getTime() - start.getTime();
  const durationMins = durationMs / 60000;

  // Allow counter walk-ins starting within the current 30-min block; customer holds must be in the future
  const minAllowedStart = isStaffCounter ? Date.now() - 25 * 60 * 1000 : Date.now();
  if (
    !Number.isFinite(durationMins) ||
    durationMins <= 0 ||
    start.getTime() <= minAllowedStart ||
    end.getTime() <= Date.now()
  ) {
    throw new BookingDomainError('INVALID_DURATION', 400);
  }

  const courtRes = await client.query(
    `SELECT c.id, c.name, c.court_type, s.code as sport_code, s.min_duration_mins, s.step_mins
     FROM courts c
     JOIN sports s ON s.id = c.sport_id
     WHERE c.id = $1 AND c.venue_id = $2 AND c.is_active = TRUE`,
    [courtId, venueId]
  );
  const court = courtRes.rows[0];
  if (!court) {
    throw new BookingDomainError('INVALID_SLOT', 400);
  }

  const startMinPart = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', minute: '2-digit' }).format(start)
  );
  const sameVnDay = vietnamDate(start) === vietnamDate(new Date(end.getTime() - 1));

  if (
    durationMins < court.min_duration_mins ||
    durationMins % court.step_mins !== 0 ||
    startMinPart % court.step_mins !== 0 ||
    start.getSeconds() !== 0 ||
    start.getMilliseconds() !== 0 ||
    !sameVnDay
  ) {
    throw new BookingDomainError('INVALID_SLOT', 400);
  }

  const dayOfWeek = new Date(`${vietnamDate(start)}T12:00:00+07:00`).getUTCDay();
  const hoursRes = await client.query(
    `SELECT open_time, close_time, is_closed FROM opening_hours WHERE venue_id = $1 AND day_of_week = $2`,
    [venueId, dayOfWeek]
  );
  const opening = hoursRes.rows[0];
  const closuresRes = await client.query(
    `SELECT id FROM venue_closures WHERE venue_id = $1 AND start_at < $3 AND end_at > $2`,
    [venueId, start, end]
  );

  const startTimeStr = vietnamTime(start);
  const endTimeStr = vietnamTime(end);
  if (
    !opening ||
    opening.is_closed ||
    startTimeStr < opening.open_time.slice(0, 5) ||
    endTimeStr > opening.close_time.slice(0, 5) ||
    closuresRes.rows.length > 0
  ) {
    throw new BookingDomainError('VENUE_CLOSED', 409);
  }

  const [rulesRes, dealsRes] = await Promise.all([
    client.query(
      `SELECT id, court_id, court_type, day_of_week, is_weekend, is_holiday, is_peak_hour,
              start_time, end_time, price_per_hour, priority,
              to_char(valid_from, 'YYYY-MM-DD') as valid_from,
              to_char(valid_to, 'YYYY-MM-DD') as valid_to
       FROM price_rules
       WHERE venue_id = $1
       ORDER BY priority DESC, id ASC`,
      [venueId]
    ),
    client.query(
      `SELECT id, title_vi, title_en, sport_code, court_ids, days_of_week,
              to_char(time_from, 'HH24:MI') as time_from,
              to_char(time_to, 'HH24:MI') as time_to,
              kind, discount_type, discount_value, floor_price_vnd, lead_hours,
              to_char(valid_from, 'YYYY-MM-DD') as valid_from,
              to_char(valid_to, 'YYYY-MM-DD') as valid_to
       FROM deal_rules
       WHERE venue_id = $1 AND status = 'ACTIVE'`,
      [venueId]
    ),
  ]);

  let originalTotalAmount = 0;
  let totalAmount = 0;
  let appliedDealId: string | null = null;
  let appliedDealTitle: { vi: string; en: string } | null = null;
  const slotsBreakdown: Array<{
    time: string;
    originalPricePerHour: number;
    pricePerHour: number;
    slotPrice: number;
    dealApplied?: boolean;
  }> = [];

  const nowMs = Date.now();

  for (let offset = 0; offset < durationMins; offset += 30) {
    const point = new Date(start.getTime() + offset * 60000);
    const pointDate = vietnamDate(point);
    const pointTime = vietnamTime(point);
    const pointDow = new Date(`${pointDate}T12:00:00+07:00`).getUTCDay();
    const baseHourly = resolvePrice(rulesRes.rows, courtId, court.court_type, pointDate, pointTime);
    if (baseHourly == null) {
      throw new BookingDomainError('PRICE_UNAVAILABLE', 409);
    }

    let bestHourly = baseHourly;
    let bestDeal: any = null;
    const hoursUntilSlot = (point.getTime() - nowMs) / 3600000;

    for (const d of dealsRes.rows) {
      if (d.valid_from && pointDate < d.valid_from) continue;
      if (d.valid_to && pointDate > d.valid_to) continue;
      if (d.sport_code && String(d.sport_code).toLowerCase() !== String(court.sport_code).toLowerCase()) continue;
      if (Array.isArray(d.court_ids) && d.court_ids.length > 0 && !d.court_ids.includes(courtId)) continue;
      if (Array.isArray(d.days_of_week) && d.days_of_week.length > 0 && !d.days_of_week.includes(pointDow)) continue;
      if (pointTime < d.time_from || pointTime >= d.time_to) continue;
      if (d.kind === 'LAST_MINUTE' && hoursUntilSlot > Number(d.lead_hours || 6)) continue;

      const rawDiscounted =
        d.discount_type === 'PERCENT'
          ? Math.round(baseHourly * (1 - Number(d.discount_value) / 100))
          : baseHourly - Number(d.discount_value);
      const clampedHourly = Math.min(baseHourly, Math.max(Number(d.floor_price_vnd || 0), rawDiscounted));
      if (clampedHourly < bestHourly) {
        bestHourly = clampedHourly;
        bestDeal = d;
      }
    }

    if (bestDeal && !appliedDealId) {
      appliedDealId = bestDeal.id;
      appliedDealTitle = { vi: bestDeal.title_vi, en: bestDeal.title_en };
    }

    originalTotalAmount += Math.round(baseHourly / 2);
    const slotPrice = Math.round(bestHourly / 2);
    totalAmount += slotPrice;
    slotsBreakdown.push({
      time: pointTime,
      originalPricePerHour: baseHourly,
      pricePerHour: bestHourly,
      slotPrice,
      dealApplied: Boolean(bestDeal),
    });
  }

  const discountAmount = Math.max(0, originalTotalAmount - totalAmount);
  const priceSnapshot = {
    quoted_at: new Date().toISOString(),
    original_total_amount: originalTotalAmount,
    discount_amount: discountAmount,
    final_total_amount: totalAmount,
    applied_deal_id: appliedDealId,
    applied_deal_title: appliedDealTitle,
    slots: slotsBreakdown,
  };

  const depositMode = venue.deposit_mode || 'DEPOSIT_REQUIRED';
  const depositPercent = depositMode === 'NO_DEPOSIT' ? 0 : (venue.deposit_percent ?? 30);
  const depositAmount = Math.round((totalAmount * depositPercent) / 100);
  const dueAtVenue = totalAmount - depositAmount;
  const holdMins = venue.hold_duration_mins || 10;

  if (requirePaymentConfig && depositAmount > 0 && !isStaffCounter) {
    // Verify payment configuration exists (either verified live bank or explicit sandbox mode)
    buildPaymentDescriptor(venue.bank_account_info, depositAmount, 'DS-000000');
  }

  const physicalCourtIds = await expandPhysicalCourts(client, courtId);

  return {
    tenantId: venue.tenant_id,
    venueId: venue.id,
    venueName: venue.name,
    venueAddress: venue.address,
    courtId: court.id,
    courtName: court.name,
    courtType: court.court_type,
    physicalCourtIds,
    start,
    end,
    durationMins,
    originalTotalAmount,
    discountAmount,
    appliedDealId,
    appliedDealTitle,
    priceSnapshot,
    totalAmount,
    depositMode,
    depositPercent,
    depositAmount,
    dueAtVenue,
    holdMins,
    cancellationRules: venue.cancellation_rules || [],
    bankAccountInfo: venue.bank_account_info || {},
    slotsBreakdown,
  };
}

/**
 * Insert court occupancy rows for primary + constituent leaf courts after reclaiming expired holds.
 */
export async function reservePhysicalCourtRows(
  client: PoolClient,
  params: {
    tenantId: string;
    venueId: string;
    bookingId: string;
    primaryCourtId: string;
    physicalCourtIds: string[];
    start: Date;
    end: Date;
  }
): Promise<void> {
  // Reclaim any expired PENDING holds on this venue before attempting GiST exclusion insert (Mandatory Case #3)
  await client.query(`SELECT reclaim_expired_holds_for_venue($1)`, [params.venueId]);

  for (const cid of params.physicalCourtIds) {
    await client.query(
      `INSERT INTO booking_courts (tenant_id, booking_id, court_id, start_at, end_at, active, is_primary)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [params.tenantId, params.bookingId, cid, params.start, params.end, cid === params.primaryCourtId]
    );
  }
}

export function formatVnSlotRange(start: Date, end: Date, lang: 'vi' | 'en' = 'vi'): string {
  const locale = lang === 'en' ? 'en-US' : 'vi-VN';
  const sTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(start);
  const eTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(end);
  const dayStr = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(start);
  return `${sTime} – ${eTime}, ${dayStr}`;
}

/**
 * Authoritative Bank Payment & Reconciliation State Machine (Mục 4, F-04, Mandatory Case #8).
 * Handles: Idempotency, Exact Deposit, Underpayment, Overpayment (<= total & > total),
 * Late Payment (never reactivates expired/cancelled slots), and Wrong Transfer Note!
 */
export async function processBankPaymentEvent(params: {
  provider: string;
  eventId: string;
  transferNote: string;
  transferAmount: number;
  rawPayload: any;
  ipAddress?: string;
}): Promise<{
  outcome:
    | 'ALREADY_PROCESSED'
    | 'UNMATCHED_NOTE'
    | 'BOOKING_NOT_FOUND'
    | 'CONFIRMED'
    | 'UNDERPAID'
    | 'OVERPAID_CONFIRMED'
    | 'LATE_PAYMENT_REVIEW';
  bookingCode?: string;
  bookingStatus?: string;
  paidAmount?: number;
  remainingDeposit?: number;
  dueAtVenue?: number;
  refundQueued?: number;
}> {
  const { provider, eventId, transferNote, transferAmount, rawPayload, ipAddress } = params;

  const client = await databaseScope.run({ service: true }, () => pool.connect());
  let outboxToDispatch: string | null = null;
  let sseEvents: Array<{
    venue_id: string;
    court_id: string;
    start_at: string;
    end_at: string;
    status: 'CONFIRMED' | 'PENDING';
  }> = [];
  let auditPayload: any = null;

  try {
    await client.query('BEGIN');

    // 1. Idempotency check on eventId
    // Serialize retries before inspecting the unique event key, including concurrent deliveries.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [eventId]);
    const existingEvent = await client.query(`SELECT id FROM webhook_events WHERE event_id = $1`, [eventId]);
    if (existingEvent.rows.length > 0) {
      await client.query('ROLLBACK');
      return { outcome: 'ALREADY_PROCESSED' };
    }

    const codeMatch = transferNote.match(/DS-[A-Z0-9]{6}/i);
    if (!codeMatch) {
      await client.query(
        `INSERT INTO webhook_events (provider, event_id, payload, status) VALUES ($1, $2, $3, 'UNMATCHED_NOTE')`,
        [provider, eventId, JSON.stringify(rawPayload)]
      );
      await client.query('COMMIT');
      return { outcome: 'UNMATCHED_NOTE' };
    }

    const bookingCode = codeMatch[0].toUpperCase();

    await client.query(
      `INSERT INTO webhook_events (provider, event_id, payload, status) VALUES ($1, $2, $3, 'PROCESSED')`,
      [provider, eventId, JSON.stringify(rawPayload)]
    );

    // 2. Lock booking and load full context for accurate reconciliation + confirmation email
    const bRes = await client.query(
      `SELECT b.*,
              v.name as venue_name, v.address as venue_address,
              ca.email as customer_email, ca.username as customer_username, ca.preferred_language as customer_lang
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       LEFT JOIN customer_accounts ca ON ca.id = b.customer_id
       WHERE UPPER(b.booking_code) = $1
       FOR UPDATE OF b`,
      [bookingCode]
    );

    if (bRes.rows.length === 0) {
      await client.query('COMMIT');
      return { outcome: 'BOOKING_NOT_FOUND', bookingCode };
    }

    const booking = bRes.rows[0];
    const courtRowsRes = await client.query(
      `SELECT bc.court_id, bc.start_at, bc.end_at, bc.is_primary, c.name as court_name
       FROM booking_courts bc
       JOIN courts c ON c.id = bc.court_id
       WHERE bc.booking_id = $1
       ORDER BY bc.is_primary DESC`,
      [booking.id]
    );
    const primaryCourtRow = courtRowsRes.rows[0];

    const isHoldExpired =
      booking.status === 'EXPIRED' ||
      booking.status === 'CANCELLED' ||
      booking.status === 'NO_SHOW' ||
      (booking.status === 'PENDING' &&
        booking.hold_expires_at &&
        new Date(booking.hold_expires_at).getTime() <= Date.now());

    // CASE A: LATE PAYMENT (after hold expired or booking cancelled) — NEVER reactivate court!
    if (isHoldExpired) {
      if (booking.status === 'PENDING') {
        await client.query(`UPDATE booking_courts SET active = FALSE WHERE booking_id = $1`, [booking.id]);
        await client.query(`UPDATE bookings SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`, [booking.id]);
      }

      const payInsert = await client.query(
        `INSERT INTO payments (
           tenant_id, booking_id, method, amount, transaction_code, status,
           mismatch_type, reconciliation_note, raw_webhook_payload
         ) VALUES ($1, $2, 'VIETQR', $3, $4, 'MANUAL_REVIEW', 'LATE_PAYMENT', $5, $6)
         RETURNING id`,
        [
          booking.tenant_id,
          booking.id,
          transferAmount,
          eventId,
          'Chuyển khoản đến muộn sau khi hết thời gian giữ chỗ / đơn đã hủy.',
          JSON.stringify(rawPayload),
        ]
      );

      await client.query(
        `INSERT INTO refunds (tenant_id, booking_id, payment_id, amount, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
        [
          booking.tenant_id,
          booking.id,
          payInsert.rows[0].id,
          transferAmount,
          'Hoàn tiền do khách chuyển khoản muộn sau khi hết giữ chỗ 10 phút',
        ]
      );

      const newPaid = Number(booking.paid_amount || 0) + transferAmount;
      const newRefundAmt = Number(booking.refund_amount || 0) + transferAmount;
      await client.query(
        `UPDATE bookings
         SET paid_amount = $1,
             payment_review_reason = 'LATE_PAYMENT',
             refund_status = 'PENDING',
             refund_amount = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [newPaid, newRefundAmt, booking.id]
      );

      await client.query('COMMIT');

      await databaseScope.run({ service: true }, () =>
        recordAuditLog({
          tenantId: booking.tenant_id,
          actorPortal: 'system',
          action: 'LATE_PAYMENT_FLAGGED_FOR_REFUND',
          targetTable: 'bookings',
          targetId: booking.id,
          afterState: { transferAmount, eventId },
          ipAddress,
        })
      );

      return {
        outcome: 'LATE_PAYMENT_REVIEW',
        bookingCode,
        bookingStatus: booking.status === 'PENDING' ? 'EXPIRED' : booking.status,
        paidAmount: newPaid,
        refundQueued: transferAmount,
      };
    }

    // CASE B: Active PENDING or CONFIRMED booking
    const previousPaidRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint as paid FROM payments WHERE booking_id = $1 AND status = 'CONFIRMED'`,
      [booking.id]
    );
    const previousPaid = Number(previousPaidRes.rows[0].paid || 0);
    const newPaid = previousPaid + transferAmount;
    const totalAmount = Number(booking.total_amount);
    const depositRequired = Number(booking.deposit_amount);

    let mismatchType = 'EXACT';
    let reconciliationNote: string | null = null;
    let paymentReviewReason: string | null = null;
    let refundQueued = 0;

    if (newPaid < depositRequired) {
      mismatchType = 'UNDERPAID';
      reconciliationNote = `Thanh toán thiếu tiền cọc: đã nhận ${newPaid}/${depositRequired} VND`;
      paymentReviewReason = 'UNDERPAID';
    } else if (newPaid > totalAmount) {
      mismatchType = 'OVERPAID_EXCESS';
      // Only refund this event's additional excess; previous excess already has a ledger entry.
      refundQueued = Math.max(0, newPaid - totalAmount) - Math.max(0, previousPaid - totalAmount);
      reconciliationNote = `Thanh toán vượt tổng tiền sân ${refundQueued} VND — chờ hoàn tiền thừa`;
      paymentReviewReason = 'OVERPAID_REFUND_DUE';
    } else if (newPaid > depositRequired) {
      mismatchType = 'OVERPAID_APPLIED_TO_TOTAL';
      reconciliationNote = `Thanh toán nhiều hơn tiền cọc — đã trừ trực tiếp vào số tiền còn phải thu tại sân`;
    }

    const payInsert = await client.query(
      `INSERT INTO payments (
         tenant_id, booking_id, method, amount, transaction_code, status,
         mismatch_type, reconciliation_note, raw_webhook_payload
       ) VALUES ($1, $2, 'VIETQR', $3, $4, 'CONFIRMED', $5, $6, $7)
       RETURNING id`,
      [
        booking.tenant_id,
        booking.id,
        transferAmount,
        eventId,
        mismatchType,
        reconciliationNote,
        JSON.stringify(rawPayload),
      ]
    );

    if (refundQueued > 0) {
      await client.query(
        `INSERT INTO refunds (tenant_id, booking_id, payment_id, amount, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
        [
          booking.tenant_id,
          booking.id,
          payInsert.rows[0].id,
          refundQueued,
          `Hoàn tiền chuyển thừa (${newPaid} VND > tổng đơn ${totalAmount} VND)`,
        ]
      );
    }

    const newDueAtVenue = Math.max(0, totalAmount - newPaid);
    const nextStatus =
      newPaid >= depositRequired && booking.status === 'PENDING' ? 'CONFIRMED' : booking.status;

    await client.query(
      `UPDATE bookings
       SET status = $1,
           paid_amount = $2,
           due_at_venue = $3,
           payment_review_reason = $4,
           refund_status = CASE WHEN $5 > 0 THEN 'PENDING' ELSE refund_status END,
           refund_amount = refund_amount + $5,
           updated_at = NOW()
       WHERE id = $6`,
      [nextStatus, newPaid, newDueAtVenue, paymentReviewReason, refundQueued, booking.id]
    );

    // Queue complete BOOKING_CONFIRMED email if newly confirmed (Fixes F-10 incomplete template data!)
    if (booking.status === 'PENDING' && nextStatus === 'CONFIRMED' && booking.customer_email) {
      const lang = (booking.customer_lang === 'en' ? 'en' : 'vi') as 'vi' | 'en';
      const outboxRes = await client.query(
        `INSERT INTO email_outbox (recipient, template_type, language, reference_id, template_data, dedup_key)
         VALUES ($1, 'BOOKING_CONFIRMED', $2, $3, $4, $5)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING id`,
        [
          booking.customer_email,
          lang,
          booking.id,
          JSON.stringify({
            booking_code: booking.booking_code,
            customer_name: booking.customer_username || 'Quý khách',
            venue_name: booking.venue_name,
            venue_address: booking.venue_address,
            court_name: primaryCourtRow?.court_name || 'Sân thể thao',
            time_str: primaryCourtRow
              ? formatVnSlotRange(new Date(primaryCourtRow.start_at), new Date(primaryCourtRow.end_at), lang)
              : '',
            start_at: primaryCourtRow?.start_at,
            end_at: primaryCourtRow?.end_at,
            total_amount: totalAmount,
            deposit_amount: depositRequired,
            paid_amount: newPaid,
            due_at_venue: newDueAtVenue,
            status: 'CONFIRMED',
          }),
          `confirm_email_${booking.id}`,
        ]
      );
      outboxToDispatch = outboxRes.rows[0]?.id || null;
    }

    if (nextStatus === 'CONFIRMED' && booking.status === 'PENDING') {
      sseEvents = courtRowsRes.rows.map((r) => ({
        venue_id: booking.venue_id,
        court_id: r.court_id,
        start_at: new Date(r.start_at).toISOString(),
        end_at: new Date(r.end_at).toISOString(),
        status: 'CONFIRMED' as const,
      }));
    }

    auditPayload = {
      tenantId: booking.tenant_id,
      bookingId: booking.id,
      action:
        mismatchType === 'UNDERPAID'
          ? 'PAYMENT_UNDERPAID_RECORDED'
          : refundQueued > 0
          ? 'PAYMENT_OVERPAID_CONFIRMED'
          : 'PAYMENT_CONFIRMED',
      afterState: { nextStatus, newPaid, newDueAtVenue, mismatchType, refundQueued },
    };

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  for (const ev of sseEvents) {
    broadcastCourtChange({ ...ev, timestamp: new Date().toISOString() });
  }

  if (outboxToDispatch) {
    setImmediate(() => {
      databaseScope
        .run({ service: true }, () => dispatchQueuedEmail(outboxToDispatch!))
        .catch(() => {});
    });
  }

  if (auditPayload) {
    await databaseScope.run({ service: true }, () =>
      recordAuditLog({
        tenantId: auditPayload.tenantId,
        actorPortal: 'system',
        action: auditPayload.action,
        targetTable: 'bookings',
        targetId: auditPayload.bookingId,
        afterState: auditPayload.afterState,
        ipAddress,
      })
    );
  }

  if (auditPayload?.action === 'PAYMENT_UNDERPAID_RECORDED') {
    return {
      outcome: 'UNDERPAID',
      bookingStatus: 'PENDING',
      paidAmount: auditPayload.afterState.newPaid,
      dueAtVenue: auditPayload.afterState.newDueAtVenue,
    };
  }
  if (auditPayload?.afterState?.refundQueued > 0) {
    return {
      outcome: 'OVERPAID_CONFIRMED',
      bookingStatus: 'CONFIRMED',
      paidAmount: auditPayload.afterState.newPaid,
      dueAtVenue: 0,
      refundQueued: auditPayload.afterState.refundQueued,
    };
  }
  return {
    outcome: 'CONFIRMED',
    bookingStatus: 'CONFIRMED',
    paidAmount: auditPayload?.afterState?.newPaid,
    dueAtVenue: auditPayload?.afterState?.newDueAtVenue,
  };
}
