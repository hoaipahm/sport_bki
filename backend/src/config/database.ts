import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { databaseScope } from './database-scope';

// Resolve configuration from working directory or project root in both source and compiled startup.
for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
]) {
  dotenv.config({ path: candidate });
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Copy .env.example to .env and configure credentials.');
}

const applicationPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'court-booking-api',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const workerPool = process.env.WORKER_DATABASE_URL ? new Pool({ connectionString: process.env.WORKER_DATABASE_URL, application_name: 'court-booking-worker', max: 4, connectionTimeoutMillis: 5000 }) : null;
for (const connectionPool of [applicationPool, workerPool]) {
  connectionPool?.on('error', (error: Error & { code?: string }) => {
    console.error('[Database] Idle connection lost:', error.code || error.name);
  });
}

async function connectScoped(): Promise<PoolClient> {
  const scope = databaseScope.getStore() || {};
  if (scope.service && !workerPool) throw new Error('WORKER_DATABASE_URL_REQUIRED');
  const client = await (scope.service ? workerPool! : applicationPool).connect();
  const release = client.release.bind(client);
  try {
    await client.query(`SELECT set_config('app.current_tenant_id', $1, false), set_config('app.current_user_id', $2, false), set_config('app.current_portal', $3, false), set_config('app.auth_identifier', $4, false)`, [scope.tenantId || '', scope.userId || '', scope.portal || '', scope.identifier || '']);
  } catch (error) { release(error as Error); throw error; }
  client.release = (error?: Error | boolean) => {
    client.release = release;
    if (error) { release(error); return; }
    void client.query(`RESET app.current_tenant_id; RESET app.current_user_id; RESET app.current_portal; RESET app.auth_identifier`).then(() => release(), failure => release(failure));
  };
  return client;
}

export const pool = {
  connect: connectScoped,
  async query(text: string, params?: any[]) {
    const client = await connectScoped();
    try { return await client.query(text, params); } finally { client.release(); }
  },
  async end() { await Promise.all([applicationPool.end(), workerPool?.end()]); },
};

/**
 * Execute a query with tenant isolation (RLS)
 */
export async function queryWithTenant<T = any>(
  tenantId: string | null,
  text: string,
  params: any[] = []
): Promise<T[]> {
  return withTransaction(tenantId, async (client) => {
    const res = await client.query(text, params);
    return res.rows;
  });
}

/**
 * Run a transaction with tenant isolation
 */
export async function withTransaction<T>(
  tenantId: string | null,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId) {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
