import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { pool } from '../config/database';

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj)
    .filter(k => k !== 'idempotency_key')
    .sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function extractIdempotencyKey(req: Request): string | null {
  const header = req.get('Idempotency-Key') || req.get('X-Idempotency-Key');
  const bodyKey = typeof req.body?.idempotency_key === 'string' ? req.body.idempotency_key : null;
  const raw = (header || bodyKey || '').trim();
  if (!raw) return null;
  return raw.slice(0, 200);
}

export function hashRequestPayload(path: string, body: any): string {
  return createHash('sha256')
    .update(`${path}:${stableStringify(body || {})}`)
    .digest('hex');
}

/**
 * Execute a mutation with server-side idempotency protection (F-06).
 * - If no Idempotency-Key is supplied, executes normally.
 * - If supplied with a matching payload and finished response, replays stored status + JSON.
 * - If supplied with a DIFFERENT payload, rejects with 422 IDEMPOTENCY_KEY_CONFLICT.
 */
export async function withIdempotency(
  req: Request,
  res: Response,
  scope: string,
  handler: () => Promise<{ status: number; body: any }>
): Promise<Response> {
  const idemKey = extractIdempotencyKey(req);
  if (!idemKey) {
    const result = await handler();
    return res.status(result.status).json(result.body);
  }

  const reqHash = hashRequestPayload(req.originalUrl || req.path, req.body);

  // Clean expired keys opportunistically and attempt atomic claim
  const claimRes = await pool.query(
    `INSERT INTO idempotency_keys (scope, idem_key, request_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (scope, idem_key) DO NOTHING
     RETURNING id`,
    [scope, idemKey, reqHash]
  );

  if (claimRes.rows.length === 0) {
    // Key already exists — inspect existing entry
    const existingRes = await pool.query(
      `SELECT request_hash, status_code, response_body, expires_at
       FROM idempotency_keys
       WHERE scope = $1 AND idem_key = $2`,
      [scope, idemKey]
    );
    const existing = existingRes.rows[0];
    if (existing) {
      if (existing.request_hash !== reqHash) {
        return res.status(422).json({
          error_code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Idempotency-Key đã được sử dụng với dữ liệu yêu cầu khác.',
        });
      }
      if (existing.status_code && existing.response_body) {
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(existing.status_code).json(existing.response_body);
      }
      return res.status(409).json({
        error_code: 'REQUEST_IN_PROGRESS',
        message: 'Yêu cầu đang được xử lý, vui lòng không bấm lặp lại.',
      });
    }
  }

  try {
    const result = await handler();
    // Persist deterministic business responses (2xx and 4xx business conflicts)
    if (result.status < 500) {
      await pool.query(
        `UPDATE idempotency_keys
         SET status_code = $1, response_body = $2
         WHERE scope = $3 AND idem_key = $4`,
        [result.status, JSON.stringify(result.body), scope, idemKey]
      );
    } else {
      await pool.query(`DELETE FROM idempotency_keys WHERE scope = $1 AND idem_key = $2`, [scope, idemKey]);
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    await pool.query(`DELETE FROM idempotency_keys WHERE scope = $1 AND idem_key = $2`, [scope, idemKey]).catch(() => {});
    throw err;
  }
}
