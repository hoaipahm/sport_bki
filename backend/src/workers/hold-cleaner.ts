import { databaseScope } from '../config/database-scope';
import { pool } from '../config/database';
import { recordAuditLog } from '../common/audit';
import { broadcastCourtChange } from '../common/realtime';

/**
 * Background worker to release expired booking holds (Section 6.3)
 * Runs periodically to move PENDING bookings past hold_expires_at to EXPIRED
 * and broadcasts SSE court_update events (F-11).
 */
export async function cleanExpiredHolds(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expiredRes = await client.query(
      `SELECT id, tenant_id, venue_id FROM bookings
       WHERE status = 'PENDING' AND hold_expires_at IS NOT NULL AND hold_expires_at <= NOW()
       FOR UPDATE SKIP LOCKED`
    );

    if (expiredRes.rows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    const expiredIds = expiredRes.rows.map((r) => r.id);

    const releasedCourts = await client.query(
      `UPDATE booking_courts
       SET active = FALSE
       WHERE booking_id = ANY($1) AND active = TRUE
       RETURNING booking_id, court_id, start_at, end_at`,
      [expiredIds]
    );

    await client.query(
      `UPDATE bookings SET status = 'EXPIRED', updated_at = NOW() WHERE id = ANY($1)`,
      [expiredIds]
    );

    await client.query('COMMIT');

    const venueByBooking = new Map(expiredRes.rows.map((r) => [r.id, r.venue_id]));
    for (const row of releasedCourts.rows) {
      const venueId = venueByBooking.get(row.booking_id);
      if (venueId) {
        broadcastCourtChange({
          venue_id: venueId,
          court_id: row.court_id,
          start_at: new Date(row.start_at).toISOString(),
          end_at: new Date(row.end_at).toISOString(),
          status: 'EXPIRED',
          timestamp: new Date().toISOString(),
        });
      }
    }

    for (const b of expiredRes.rows) {
      await recordAuditLog({
        tenantId: b.tenant_id,
        actorPortal: 'system',
        action: 'EXPIRE_BOOKING_HOLD',
        targetTable: 'bookings',
        targetId: b.id,
      });
    }

    console.log(`[HoldCleaner] Released ${expiredIds.length} expired booking holds.`);
    return expiredIds.length;
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[HoldCleaner] Error cleaning expired holds:', err.code || err.message);
    return 0;
  } finally {
    client.release();
  }
}

export function startHoldCleanerJob(intervalMs: number = 30000) {
  setInterval(async () => {
    await databaseScope
      .run({ service: true }, cleanExpiredHolds)
      .catch((error) => console.error('[Worker] Hold cleaner failed:', error.code || error.name));
  }, intervalMs);
}
