import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';

import { config } from '../config/index.js';
import * as schema from './schema/index.js';

/**
 * Single shared pg Pool + drizzle instance for the whole process (AGENTS.md: "Use a single
 * shared PrismaClient instance" — the Drizzle equivalent is one shared Pool). Never construct
 * a second `Pool` inside a feature module.
 *
 * TRD §9 (Neon operations): Neon's pooler is transaction-based, so session-level state must
 * not be assumed to survive a checkout — `app.tenant_id` is therefore set with `SET LOCAL`
 * (transaction-scoped, auto-reset on commit/rollback) on the SAME checked-out connection as
 * the queries that follow it, never as a separate `SET` on the pool.
 */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
});

/** Unscoped drizzle instance — only for global (non-tenant-owned) tables: tenant, plan, plan_entitlement, webhook_inbox. */
export const db = drizzle(pool, { schema });

export type Db = typeof db;

/**
 * Runs `fn` inside a transaction with `app.tenant_id` and `app.principal_id` set
 * transaction-locally via `SET LOCAL`, so PostgreSQL row-level security policies (see
 * 0008_rls_policies.sql) actually apply to every query `fn` issues on the returned client.
 *
 * Fails closed: a missing/empty `tenantId` throws rather than silently running unscoped —
 * TRD §3 requires denying any request whose tenant cannot be resolved, and an unscoped query
 * against a tenant-owned table under FORCE ROW LEVEL SECURITY would otherwise just return
 * zero rows, which is indistinguishable from "no data" and would hide the real bug.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  principalId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!tenantId) {
    throw new Error('withTenantTransaction: tenantId is required (fail closed, never unscoped)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Parameterized `set_config` (not string-interpolated `SET LOCAL`) so a malicious or
    // malformed tenant/principal id can never become a SQL injection vector.
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', principalId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
