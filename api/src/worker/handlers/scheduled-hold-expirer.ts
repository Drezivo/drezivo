import { pool } from '../../db/client.js';
import { logger } from '../../shared/logger.js';
import { expireDueHoldsForTenant } from './hold-expirer.js';

interface DueTenant {
  tenant_id: string;
  lag_ms: number;
}

/** One small discovery read; reservations remain unreadable without tenant context. */
export async function discoverDueHoldTenants(cursor: string | null): Promise<DueTenant[]> {
  const result = await pool.query<DueTenant>(
    `SELECT tenant_id,
            (extract(epoch FROM (statement_timestamp() - min(expires_at))) * 1000)::float8 AS lag_ms
       FROM reservation_expiry_schedule WHERE expires_at <= statement_timestamp()
      GROUP BY tenant_id
      ORDER BY CASE WHEN $1::uuid IS NULL OR tenant_id > $1::uuid THEN 0 ELSE 1 END, tenant_id
      LIMIT 10`,
    [cursor],
  );
  return result.rows;
}

interface ExpiryDependencies {
  discover: typeof discoverDueHoldTenants;
  expire: (tenantId: string) => Promise<number>;
  now: () => number;
}

function failureKind(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === '55P03') return 'lock_timeout';
  if (code === '57014') return 'statement_timeout';
  if (code === '42501') return 'permissions';
  if (code === '42P01' || code === '42703' || code === '42883') return 'schema';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === '57P01')
    return 'connection';
  return 'unexpected';
}

/** Bounded round-robin passes; retries survive restarts through the durable schedule. */
export function createScheduledHoldExpirer(dependencies: Partial<ExpiryDependencies> = {}): {
  run: () => Promise<number>;
  stop: () => void;
} {
  const { discover, expire, now }: ExpiryDependencies = {
    discover: discoverDueHoldTenants,
    expire: (tenantId) => expireDueHoldsForTenant(tenantId, 100, true),
    now: Date.now,
    ...dependencies,
  };
  let cursor: string | null = null;
  let stopped = false;
  let active: Promise<number> | null = null;
  let reportedAt = now();
  const metrics = { discoveries: 0, businesses: 0, expired: 0, failures: 0, maxObservedLagMs: 0 };
  let failureKinds: Record<string, number> = {};

  function recordFailure(error: unknown): void {
    metrics.failures += 1;
    const kind = failureKind(error);
    failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
  }

  function report(force = false): void {
    if (!force && now() - reportedAt < 300_000) return;
    logger.info(
      { ...metrics, failureKinds, windowMs: now() - reportedAt },
      'scheduled hold expiry activity',
    );
    metrics.discoveries =
      metrics.businesses =
      metrics.expired =
      metrics.failures =
      metrics.maxObservedLagMs =
        0;
    reportedAt = now();
    failureKinds = {};
  }

  async function pass(): Promise<number> {
    if (stopped) return 0;
    const startedAt = now();
    let released = 0;
    let failures = 0;
    try {
      metrics.discoveries += 1;
      let tenants: DueTenant[] | undefined;
      try {
        tenants = await discover(cursor);
      } catch (error) {
        recordFailure(error);
      }
      if (!tenants) throw new Error('Scheduled hold expiry discovery failed; due work retained for retry');
      for (const tenant of tenants) {
        if (stopped || now() - startedAt >= 5_000) break;
        // Advance even on failure/locked rows so the next pass serves other tenants.
        cursor = tenant.tenant_id;
        metrics.businesses += 1;
        metrics.maxObservedLagMs = Math.max(metrics.maxObservedLagMs, tenant.lag_ms);
        try {
          const count = await expire(tenant.tenant_id);
          released += count;
          metrics.expired += count;
        } catch (error) {
          recordFailure(error);
          failures += 1;
        }
      }
      if (failures > 0)
        throw new Error('Scheduled hold expiry failed; due work retained for retry');
      return released;
    } finally {
      report(stopped);
    }
  }

  return {
    run() {
      if (!active)
        active = pass().finally(() => {
          active = null;
        });
      return active;
    },
    stop() {
      stopped = true;
      if (!active) report(true);
    },
  };
}
