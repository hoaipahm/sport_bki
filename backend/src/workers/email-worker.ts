import { databaseScope } from '../config/database-scope';
import { pool } from '../config/database';
import { dispatchQueuedEmail, getActiveSmtpConfig } from '../common/email.service';

/**
 * Background worker to atomically claim and process email_outbox jobs (Section 17.1, Audit F-10)
 */
export async function processEmailOutbox(): Promise<number> {
  try {
    const smtp = await getActiveSmtpConfig();
    if (!smtp.enabled) return 0;

    // Atomic single-statement claim prevents two workers from selecting the same row
    const claimRes = await pool.query(
      `WITH candidate AS (
         SELECT id FROM email_outbox
         WHERE status = 'QUEUED'
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
           AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '3 minutes')
         ORDER BY created_at ASC
         LIMIT 10
         FOR UPDATE SKIP LOCKED
       )
       UPDATE email_outbox eo
       SET claimed_at = NOW()
       FROM candidate c
       WHERE eo.id = c.id
       RETURNING eo.id`
    );

    if (claimRes.rows.length === 0) return 0;

    for (const row of claimRes.rows) {
      await dispatchQueuedEmail(row.id);
    }

    return claimRes.rows.length;
  } catch (err: any) {
    console.error('[EmailWorker] Error processing email outbox:', err.code || err.message);
    return 0;
  }
}

export function startEmailWorkerJob(intervalMs: number = 5000) {
  setInterval(async () => {
    await databaseScope.run({ service: true }, processEmailOutbox).catch((error) =>
      console.error('[Worker] Email job failed:', error.code || error.name)
    );
  }, intervalMs);
}
