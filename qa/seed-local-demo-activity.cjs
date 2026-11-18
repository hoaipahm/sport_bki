const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require(path.join(__dirname, '../backend/node_modules/pg'));

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.SUPER_DATABASE_URL || process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL,
  });

  const tenantId = 'a0000000-0000-0000-0000-000000000001';
  const venue1 = 'b0000000-0000-0000-0000-000000000001';
  const venue2 = 'b0000000-0000-0000-0000-000000000002';

  try {
    await pool.query(`SET client_encoding = 'UTF8'`);
    await pool.query('BEGIN');

    // 1. Cleanly expire stale unpaid PENDING holds older than 15 minutes
    await pool.query(`
      UPDATE booking_courts SET active = FALSE
      WHERE booking_id IN (
        SELECT id FROM bookings WHERE status = 'PENDING' AND (hold_expires_at IS NULL OR hold_expires_at < NOW())
      )
    `);
    await pool.query(`
      UPDATE bookings SET status = 'EXPIRED', updated_at = NOW()
      WHERE status = 'PENDING' AND (hold_expires_at IS NULL OR hold_expires_at < NOW())
    `);

    // Check if demo analytics bookings are already seeded
    const existingSeed = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bookings WHERE booking_code LIKE 'DS-DEMO%'`
    );
    if (existingSeed.rows[0].cnt === 0) {
      const courtsRes = await pool.query(
        `SELECT c.id, c.venue_id, c.name, c.court_type
         FROM courts c
         WHERE c.tenant_id = $1 AND c.is_active = TRUE
           AND NOT EXISTS (SELECT 1 FROM court_links cl WHERE cl.parent_court_id = c.id)
         ORDER BY c.venue_id, c.name`,
        [tenantId]
      );
      const courts = courtsRes.rows;

      const staffRes = await pool.query(
        `SELECT id FROM tenant_staff WHERE tenant_id = $1 AND role = 'OWNER' LIMIT 1`,
        [tenantId]
      );
      const ownerId = staffRes.rows[0]?.id || null;

      // Seed 5 CRM customer profiles
      const players = [
        { name: 'Đỗ Minh Quân', phone: '+84912880101', email: 'minhquan.demo@local.test' },
        { name: 'Phạm Hoàng Nam', phone: '+84912880102', email: 'hoangnam.demo@local.test' },
        { name: 'Vũ Tuấn Kiệt', phone: '+84912880103', email: 'tuankiet.demo@local.test' },
        { name: 'Ngô Thảo Vy', phone: '+84912880104', email: 'thaovy.demo@local.test' },
        { name: 'Bùi Quốc Khánh', phone: '+84912880105', email: 'quockhanh.demo@local.test' },
      ];
      const profileIds = [];
      for (const pl of players) {
        const ex = await pool.query(
          `SELECT id FROM customer_profiles WHERE tenant_id = $1 AND phone_e164 = $2 LIMIT 1`,
          [tenantId, pl.phone]
        );
        if (ex.rows[0]) {
          profileIds.push(ex.rows[0].id);
        } else {
          const ins = await pool.query(
            `INSERT INTO customer_profiles (tenant_id, full_name, phone_e164, email, language, tags)
             VALUES ($1, $2, $3, $4, 'vi', ARRAY['Khách quen']) RETURNING id`,
            [tenantId, pl.name, pl.phone, pl.email]
          );
          profileIds.push(ins.rows[0].id);
        }
      }

      // Create 18 past & upcoming bookings over the last 13 days for rich Dashboard Charts & Heatmap
      const schedulePlan = [
        { daysAgo: 13, hour: 18, durHrs: 1.5, courtIdx: 0, total: 675000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 12, hour: 19, durHrs: 1.5, courtIdx: 1, total: 675000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 11, hour: 7, durHrs: 1.5, courtIdx: 2, total: 240000, status: 'COMPLETED', method: 'CASH' },
        { daysAgo: 10, hour: 17, durHrs: 2.0, courtIdx: 0, total: 900000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 9, hour: 18, durHrs: 2.0, courtIdx: 3, total: 280000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 8, hour: 20, durHrs: 1.5, courtIdx: 1, total: 675000, status: 'COMPLETED', method: 'CASH' },
        { daysAgo: 7, hour: 8, durHrs: 2.0, courtIdx: 4, total: 280000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 6, hour: 18, durHrs: 1.5, courtIdx: 0, total: 675000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 5, hour: 19, durHrs: 2.0, courtIdx: 5, total: 520000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 4, hour: 14, durHrs: 1.5, courtIdx: 2, total: 240000, status: 'COMPLETED', method: 'CASH' },
        { daysAgo: 4, hour: 18, durHrs: 2.0, courtIdx: 1, total: 900000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 3, hour: 17, durHrs: 2.0, courtIdx: 0, total: 900000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 3, hour: 19, durHrs: 1.5, courtIdx: 3, total: 210000, status: 'COMPLETED', method: 'CASH' },
        { daysAgo: 2, hour: 9, durHrs: 2.0, courtIdx: 5, total: 360000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 2, hour: 18, durHrs: 2.0, courtIdx: 0, total: 900000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 1, hour: 17, durHrs: 1.5, courtIdx: 1, total: 675000, status: 'COMPLETED', method: 'VIETQR' },
        { daysAgo: 1, hour: 19, durHrs: 2.0, courtIdx: 4, total: 280000, status: 'COMPLETED', method: 'CASH' },
        { daysAgo: -1, hour: 19, durHrs: 1.5, courtIdx: 0, total: 675000, status: 'CONFIRMED', method: 'VIETQR' },
      ];

      for (let i = 0; i < schedulePlan.length; i++) {
        const item = schedulePlan[i];
        const court = courts[item.courtIdx % courts.length];
        if (!court) continue;

        const baseDay = new Date(Date.now() - item.daysAgo * 86400000);
        const vnDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(baseDay);

        const startAt = new Date(`${vnDate}T${String(item.hour).padStart(2, '0')}:00:00+07:00`);
        const endAt = new Date(startAt.getTime() + item.durHrs * 3600000);
        const createdAt = new Date(Math.min(Date.now() - 3600000, startAt.getTime() - 6 * 3600000));

        const deposit = Math.round(item.total * 0.3);
        const paidAmt = item.status === 'COMPLETED' ? item.total : deposit;
        const dueAmt = Math.max(0, item.total - paidAmt);
        const code = `DS-DEMO${String(i + 1).padStart(2, '0')}`;
        const profId = profileIds[i % profileIds.length];

        const bkIns = await pool.query(
          `INSERT INTO bookings (
             tenant_id, venue_id, profile_id, created_by_staff_id, booking_code,
             type, status, total_amount, deposit_amount, paid_amount, due_at_venue,
             notes, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'NORMAL', $6, $7, $8, $9, $10, 'Dữ liệu vận hành mẫu cục bộ', $11, $11)
           RETURNING id`,
          [
            tenantId,
            court.venue_id,
            profId,
            ownerId,
            code,
            item.status,
            item.total,
            deposit,
            paidAmt,
            dueAmt,
            createdAt,
          ]
        );
        const bkId = bkIns.rows[0].id;

        await pool.query(
          `INSERT INTO booking_courts (tenant_id, booking_id, court_id, start_at, end_at, active, is_primary, created_at)
           VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, $6)`,
          [tenantId, bkId, court.id, startAt, endAt, createdAt]
        );

        await pool.query(
          `INSERT INTO payments (tenant_id, booking_id, method, amount, transaction_code, status, confirmed_by_staff_id, created_at)
           VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', $6, $7)`,
          [tenantId, bkId, item.method, paidAmt, `TXN-DEMO-${i + 1}`, ownerId, createdAt]
        );
      }
      console.log('Seeded 18 local demo bookings & confirmed ledger payments.');
    }

    // 2. Seed 1 Open Friendly Tournament if none exists so #tournaments-section & Admin Tournaments are rich
    const trnExist = await pool.query(`SELECT COUNT(*)::int as cnt FROM tournaments WHERE tenant_id = $1`, [tenantId]);
    if (trnExist.rows[0].cnt === 0) {
      const tIns = await pool.query(
        `INSERT INTO tournaments (
           tenant_id, venue_id, name_vi, name_en, sport_code, format,
           entry_fee_vnd, max_teams, win_points, draw_points, loss_points, status
         ) VALUES (
           $1, $2,
           'Cúp Giao Hữu Phù Đổng Mở Rộng 2026',
           'Phu Dong Open Friendly Cup 2026',
           'football', 'ROUND_ROBIN', 500000, 8, 3, 1, 0, 'IN_PROGRESS'
         ) RETURNING id`,
        [tenantId, venue1]
      );
      const tId = tIns.rows[0].id;

      const teamData = [
        { name: 'FC Cầu Giấy United', cap: 'Đỗ Minh Quân', phone: '0912880101', p: 2, w: 2, d: 0, l: 0, gf: 6, ga: 2, pts: 6 },
        { name: 'FC Đống Đa Stars', cap: 'Phạm Hoàng Nam', phone: '0912880102', p: 2, w: 1, d: 0, l: 1, gf: 4, ga: 3, pts: 3 },
        { name: 'CLB Thanh Xuân Pro', cap: 'Vũ Tuấn Kiệt', phone: '0912880103', p: 2, w: 0, d: 1, l: 1, gf: 2, ga: 4, pts: 1 },
        { name: 'CLB Bình Minh Hà Nội', cap: 'Bùi Quốc Khánh', phone: '0912880105', p: 2, w: 0, d: 1, l: 1, gf: 1, ga: 4, pts: 1 },
      ];
      const teamIds = [];
      for (const td of teamData) {
        const tm = await pool.query(
          `INSERT INTO tournament_teams (tenant_id, tournament_id, team_name, captain_name, captain_phone, played, wins, draws, losses, goals_for, goals_against, points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [tenantId, tId, td.name, td.cap, td.phone, td.p, td.w, td.d, td.l, td.gf, td.ga, td.pts]
        );
        teamIds.push(tm.rows[0].id);
      }

      await pool.query(
        `INSERT INTO tournament_matches (tenant_id, tournament_id, round_no, match_no, home_team_id, away_team_id, home_score, away_score, winner_team_id, status)
         VALUES
           ($1, $2, 1, 1, $3, $4, 3, 1, $3, 'COMPLETED'),
           ($1, $2, 1, 2, $5, $6, 1, 1, NULL, 'COMPLETED'),
           ($1, $2, 2, 3, $3, $5, 3, 1, $3, 'COMPLETED'),
           ($1, $2, 2, 4, $4, $6, 3, 0, $4, 'COMPLETED'),
           ($1, $2, 3, 5, $3, $6, NULL, NULL, NULL, 'UNSCHEDULED'),
           ($1, $2, 3, 6, $4, $5, NULL, NULL, NULL, 'UNSCHEDULED')`,
        [tenantId, tId, teamIds[0], teamIds[1], teamIds[2], teamIds[3]]
      );
      console.log('Seeded local friendly tournament with 4 teams & live standings.');
    }

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
