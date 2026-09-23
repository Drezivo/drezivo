import { db, withSystemTenantTransaction } from '../../db/client.js';
import { tenant } from '../../db/schema/index.js';
import {
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
} from '../../modules/reservations/reservations.command.repository.js';
import { logger } from '../../shared/logger.js';

/**
 * Cleanup sweep for expired holds — TRD §5: "The scheduled expiry worker is cleanup;
 * correctness must not depend on it running on time... a hold cannot bypass the database
 * constraint." This worker is NOT what makes expiry safe: a hold's capacity is already
 * transactionally correct at every moment (an expired-but-not-yet-swept hold still legitimately
 * blocks its asset until this job flips `is_blocking`). This job only bounds how long a
 * released asset stays invisible to a fresh checkout attempt (TRD §11 target: p95 expired-hold
 * release ≤60s).
 *
 * Runs per tenant, each in its OWN `withTenantTransaction` — deliberately NOT a single
 * cross-tenant query on a role with BYPASSRLS. TRD §3 is explicit that the runtime role gets
 * "no ownership, DDL, BYPASSRLS, or blanket administrative grant"; that constraint applies to
 * every process using this role, worker included, not only the HTTP API. The tenant list
 * itself comes from the GLOBAL `tenant` table (no RLS — see 0008_rls_policies.sql), so
 * enumerating tenants needs no elevated access; only the per-tenant reservation/allocation
 * writes need `app.tenant_id` set, and each gets it set correctly for exactly one tenant at a
 * time.
 *
 * Unlike outbox events, this is not keyed to one row — it is a periodic batch sweep called
 * directly from `worker.ts`'s own interval loop rather than through `WorkerRunner`'s
 * outbox-claim contract, because there is no per-event payload to dispatch: the due-work query
 * itself (`hold_expires_at < now()`) is the whole job.
 */
export async function expireDueHoldsForAllTenants(batchSizePerTenant = 100): Promise<number> {
  const activeTenants = await db.select({ id: tenant.id }).from(tenant);

  let totalReleased = 0;
  for (const { id: tenantId } of activeTenants) {
    totalReleased += await expireDueHoldsForTenant(tenantId, batchSizePerTenant);
  }
  return totalReleased;
}

async function expireDueHoldsForTenant(tenantId: string, batchSize: number): Promise<number> {
  return withSystemTenantTransaction(tenantId, 'worker:hold-expirer', async (client) => {
    // Conditional transition, not a blind UPDATE: initial `held` reservations and submitted
    // `pending_confirmation` reviews both move to `expired` only after their current persisted
    // deadline. Submission replaces the initial 15-minute deadline with the bounded review
    // deadline, so the same sweep handles both phases without a second source of expiry truth.
    const { rows: expired } = await client.query<{ id: string; version: number }>(
      `UPDATE reservation
       SET status = 'expired', version = version + 1
       WHERE id IN (
         SELECT id FROM reservation
         WHERE tenant_id = $1 AND status IN ('held', 'pending_confirmation')
           AND hold_expires_at IS NOT NULL AND hold_expires_at < now()
         ORDER BY hold_expires_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, version`,
      [tenantId, batchSize],
    );

    if (expired.length > 0) {
      const reservationIds = expired.map((row) => row.id);
      await client.query(
        `UPDATE asset_allocation
         SET is_blocking = false, released_at = now()
         WHERE tenant_id = $1 AND is_blocking = true
           AND reservation_line_id IN (
             SELECT id FROM reservation_line WHERE reservation_id = ANY($2::uuid[])
           )`,
        [tenantId, reservationIds],
      );
      for (const row of expired) {
        const requestId = `worker:hold-expirer:${row.id}:${row.version}`;
        await appendReservationAuditEvent(client, {
          tenantId,
          actorKind: 'system',
          actorKey: 'system:reservation-expiry',
          action: 'reservation.expired',
          entityType: 'reservation',
          entityId: row.id,
          redactedSummary: { reason: 'deadline_elapsed', version: row.version },
          requestId,
        });
        await appendReservationOutboxEvent(client, {
          tenantId,
          dedupeKey: `reservation-expired:${row.id}:${row.version}`,
          eventType: 'reservation.hold_expired',
          payload: { reservationId: row.id, reservationVersion: row.version },
        });
      }
      logger.info({ tenantId, count: expired.length }, 'released expired holds');
    }

    return expired.length;
  });
}
