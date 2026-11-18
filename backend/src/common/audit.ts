import { pool } from '../config/database';

export interface AuditParams {
  tenantId?: string | null;
  actorPortal: string;
  actorId?: string | null;
  action: string;
  targetTable: string;
  targetId?: string | null;
  beforeState?: any;
  afterState?: any;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write immutable audit log for money, booking, or security changes (Section 0.3 Rule 8)
 */
export async function recordAuditLog(params: AuditParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
        tenant_id, actor_portal, actor_id, action, target_table, target_id,
        before_state, after_state, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.tenantId || null,
        params.actorPortal,
        params.actorId || null,
        params.action,
        params.targetTable,
        params.targetId || null,
        params.beforeState ? JSON.stringify(params.beforeState) : null,
        params.afterState ? JSON.stringify(params.afterState) : null,
        params.ipAddress || null,
        params.userAgent || null,
      ]
    );
  } catch (err: any) {
    console.error('[AuditLog] Failed to write log:', err.message);
  }
}
