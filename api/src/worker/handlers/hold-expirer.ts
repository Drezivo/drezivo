import { db, withSystemTenantTransaction } from '../../db/client.js';
import { tenant } from '../../db/schema/index.js';
import { appendExpiredReservationOutboxEvents } from '../../modules/reservations/reservations.command.repository.js';

/** Legacy discovery retained for rollout/rollback. Request-time capacity reclamation stays live. */
export async function expireDueHoldsForAllTenants(batchSizePerTenant = 100): Promise<number> {
  const tenants = await db.select({ id: tenant.id }).from(tenant);
  let totalReleased = 0;
  for (const { id } of tenants) {
    totalReleased += await expireDueHoldsForTenant(id, batchSizePerTenant);
  }
  return totalReleased;
}

/** Lock reservations before their derived schedule rows, matching the reservation trigger. */
export async function expireDueHoldsForTenant(
  tenantId: string,
  batchSize = 100,
  scheduled = false,
): Promise<number> {
  return withSystemTenantTransaction(tenantId, 'worker:hold-expirer', async (client) => {
    if (scheduled) {
      await client.query(
        `SELECT set_config('statement_timeout', '1000', true),
                set_config('lock_timeout', '500', true),
                set_config('idle_in_transaction_session_timeout', '5000', true)`,
      );
    }
    // The join narrows candidates; current reservation state/deadline still decides expiry.
    const scheduleJoin = scheduled
      ? `JOIN reservation_expiry_schedule s ON s.tenant_id = r.tenant_id AND s.reservation_id = r.id
           AND s.expires_at <= statement_timestamp()`
      : '';
    const { rows: expired } = await client.query<{ reservation_id: string; version: number }>(
      `WITH due AS MATERIALIZED (
         SELECT r.id FROM reservation r ${scheduleJoin}
          WHERE r.tenant_id = $1 AND r.status IN ('held', 'pending_confirmation')
            AND r.hold_expires_at <= statement_timestamp()
          ORDER BY r.hold_expires_at, r.id LIMIT $2
          FOR UPDATE OF r SKIP LOCKED
       )
       UPDATE reservation r SET status = 'expired', version = r.version + 1
        FROM due WHERE r.tenant_id = $1 AND r.id = due.id
          AND r.status IN ('held', 'pending_confirmation')
          AND r.hold_expires_at <= statement_timestamp()
       RETURNING r.id AS reservation_id, r.version`,
      [tenantId, batchSize],
    );
    if (expired.length === 0) return 0;

    const reservationIds = expired.map((row) => row.reservation_id);
    await client.query(
      `UPDATE asset_allocation SET is_blocking = false, released_at = statement_timestamp()
        WHERE tenant_id = $1 AND is_blocking = true AND reservation_line_id IN (
          SELECT id FROM reservation_line WHERE tenant_id = $1 AND reservation_id = ANY($2::uuid[])
        )`,
      [tenantId, reservationIds],
    );
    // Preserve the worker's audit reason/request IDs while writing the whole batch once.
    await client.query(
      `INSERT INTO audit_event
         (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
          redacted_summary, request_id, occurred_at, outcome)
       SELECT $1, 'system', 'system:reservation-expiry', 'reservation.expired', 'reservation',
              expired.id, jsonb_build_object('reason', 'deadline_elapsed', 'version', expired.version),
              'worker:hold-expirer:' || expired.id::text || ':' || expired.version::text,
              statement_timestamp(), 'succeeded'
         FROM unnest($2::uuid[], $3::integer[]) AS expired(id, version)`,
      [tenantId, reservationIds, expired.map((row) => row.version)],
    );
    await appendExpiredReservationOutboxEvents(client, { tenantId, rows: expired });
    return expired.length;
  });
}
