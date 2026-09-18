import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';

import { config } from '../config/index.js';
import * as schema from './schema/index.js';

/**
 * One shared pg Pool and Drizzle instance serve the whole process. Never construct a second
 * `Pool` inside a feature module.
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

/**
 * Runs a tenant-scoped transaction with an explicit system actor namespace. Worker jobs use
 * this instead of impersonating an account so tenant audit rows retain a durable system actor.
 */
export async function withSystemTenantTransaction<T>(
  tenantId: string,
  systemKey: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantTransaction(tenantId, systemKey, async (client) => {
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'system']);
    return fn(client);
  });
}

/**
 * Runs `fn` inside a transaction with the authenticated account's `app.principal_id` and
 * `app.actor_kind = 'account'` set — the default pre-tenant execution context for global
 * records. Account-owned global records use both values in their RLS policy; provider-only
 * records such as webhook_inbox have their own restricted access path.
 *
 * Deliberately sets NO `app.tenant_id`: every tenant-owned RLS policy (0008) then matches zero
 * rows, so this can never become a side door into tenant data — the same fail-closed property
 * `withTenantTransaction` documents, but reached from the other direction. A query against a
 * tenant-owned table returns empty, while a principal-scoped global table is limited by its own
 * RLS policy, which integration tests assert rather than assume.
 */
export async function withGlobalTransaction<T>(
  principalId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!principalId) {
    throw new Error('withGlobalTransaction: principalId is required (never an anonymous write)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', principalId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'account']);
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
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

/**
 * Keeps actor resolution on one checked-out connection. The transaction starts in the global
 * account namespace, then the resolver may enter one tenant namespace for membership, branch,
 * subscription, and entitlement reads. Tenant context is always cleared before the callback
 * returns so a later global query in the same transaction cannot accidentally inherit it.
 */
export interface ActorTenantResolutionContext {
  client: PoolClient;
  setTenantContext(tenantId: string): Promise<void>;
  clearTenantContext(): Promise<void>;
}

export async function withActorTenantResolutionTransaction<T>(
  principalId: string,
  fn: (context: ActorTenantResolutionContext) => Promise<T>,
): Promise<T> {
  if (!principalId) {
    throw new Error('withActorTenantResolutionTransaction: principalId is required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', principalId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'account']);
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
    const context: ActorTenantResolutionContext = {
      client,
      setTenantContext: async (tenantId) => {
        if (!tenantId) throw new Error('Actor tenant context requires a tenant ID');
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      },
      clearTenantContext: async () => {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
      },
    };
    const result = await fn(context);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * System counterpart used by provider-webhook reconciliation. It keeps tenant lookup and the
 * tenant-scoped claim on one checked-out connection while making the actor namespace explicit in
 * RLS and audit rows.
 */
export async function withSystemTenantResolutionTransaction<T>(
  systemKey: string,
  fn: (context: ActorTenantResolutionContext) => Promise<T>,
): Promise<T> {
  if (!systemKey) {
    throw new Error('withSystemTenantResolutionTransaction: systemKey is required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', systemKey]);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'system']);
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
    const context: ActorTenantResolutionContext = {
      client,
      setTenantContext: async (tenantId) => {
        if (!tenantId) throw new Error('System tenant context requires a tenant ID');
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      },
      clearTenantContext: async () => {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
      },
    };
    const result = await fn(context);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transaction context used by owner tenant bootstrap. It starts in the account/global
 * namespace, can enter exactly one tenant namespace for tenant-owned writes, and can return to
 * the global namespace before finalizing account-scoped records. The caller keeps one checked-out
 * connection for the entire graph so no partial tenant can escape a rollback.
 */
export interface BootstrapTransactionContext {
  client: PoolClient;
  setTenantContext(tenantId: string): Promise<void>;
  clearTenantContext(): Promise<void>;
}

export async function withBootstrapTransaction<T>(
  principalId: string,
  fn: (context: BootstrapTransactionContext) => Promise<T>,
): Promise<T> {
  if (!principalId) {
    throw new Error('withBootstrapTransaction: principalId is required (never an anonymous write)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', principalId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'account']);
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
    const context: BootstrapTransactionContext = {
      client,
      setTenantContext: async (tenantId) => {
        if (!tenantId) {
          throw new Error('Bootstrap tenant context requires a tenant ID');
        }
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      },
      clearTenantContext: async () => {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
      },
    };
    const result = await fn(context);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs a pre-tenant operator operation with an explicit actor namespace. The caller must have
 * already verified the platform-operator allowlist; this helper only makes that decision
 * visible to PostgreSQL RLS and keeps the context transaction-local.
 */
export async function withOperatorGlobalTransaction<T>(
  operatorSubject: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withGlobalTransaction(operatorSubject, async (client) => {
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'operator']);
    return fn(client);
  });
}

/** Runs a pre-tenant system operation with an explicit system actor namespace. */
export async function withSystemGlobalTransaction<T>(
  systemKey: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withGlobalTransaction(systemKey, async (client) => {
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_kind', 'system']);
    return fn(client);
  });
}

export async function closePool(): Promise<void> {
  await pool.end();
}
