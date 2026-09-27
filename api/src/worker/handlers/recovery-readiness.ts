import { db, withSystemTenantTransaction } from '../../db/client.js';
import { tenant } from '../../db/schema/index.js';
import { logger } from '../../shared/logger.js';

/**
 * Persists the default post-Recovery transition for garments whose `needs_cleaning` readiness
 * came from a normal return. `asset_allocation.period` remains the timing authority; this sweep
 * only reconciles the mutable readiness projection after that canonical block has ended.
 *
 * Reservation reads/creation also understand recovery-managed cleaning, so booking correctness
 * does not depend on this worker running on time.
 */
export async function promoteElapsedRecoveryReadinessForAllTenants(
  batchSizePerTenant = 100,
): Promise<number> {
  const activeTenants = await db.select({ id: tenant.id }).from(tenant);
  let totalPromoted = 0;
  for (const { id: tenantId } of activeTenants) {
    totalPromoted += await promoteElapsedRecoveryReadinessForTenant(tenantId, batchSizePerTenant);
  }
  return totalPromoted;
}

async function promoteElapsedRecoveryReadinessForTenant(
  tenantId: string,
  batchSize: number,
): Promise<number> {
  return withSystemTenantTransaction(tenantId, 'worker:recovery-readiness', async (client) => {
    const result = await client.query<{ id: string }>(
      `WITH due_assets AS (
         SELECT pa.id
           FROM physical_asset pa
          WHERE pa.tenant_id = $1
            AND pa.lifecycle_status = 'active'
            AND pa.custody_kind = 'at_branch'
            AND pa.readiness = 'needs_cleaning'
            AND pa.recovery_managed_readiness = true
            AND NOT EXISTS (
              SELECT 1
                FROM maintenance_work_order mwo
               WHERE mwo.tenant_id = pa.tenant_id
                 AND mwo.branch_id = pa.branch_id
                 AND mwo.asset_id = pa.id
                 AND mwo.status = 'open'
            )
            AND EXISTS (
              SELECT 1
                FROM asset_allocation aa
                JOIN reservation_line rl
                  ON rl.tenant_id = aa.tenant_id
                 AND rl.id = aa.reservation_line_id
                JOIN reservation r
                  ON r.tenant_id = rl.tenant_id
                 AND r.id = rl.reservation_id
               WHERE aa.tenant_id = pa.tenant_id
                 AND aa.branch_id = pa.branch_id
                 AND aa.asset_id = pa.id
                 AND aa.kind = 'reservation_confirmed'
                 AND aa.is_blocking = true
                 AND r.status = 'returned'
                 AND upper(aa.period) <= statement_timestamp()
            )
            AND NOT EXISTS (
              SELECT 1
                FROM asset_allocation aa
                JOIN reservation_line rl
                  ON rl.tenant_id = aa.tenant_id
                 AND rl.id = aa.reservation_line_id
                JOIN reservation r
                  ON r.tenant_id = rl.tenant_id
                 AND r.id = rl.reservation_id
               WHERE aa.tenant_id = pa.tenant_id
                 AND aa.branch_id = pa.branch_id
                 AND aa.asset_id = pa.id
                 AND aa.kind = 'reservation_confirmed'
                 AND aa.is_blocking = true
                 AND r.status = 'returned'
                 AND r.due_at < upper(aa.period)
                 AND upper(aa.period) > statement_timestamp()
            )
          ORDER BY pa.updated_at ASC, pa.id ASC
          LIMIT $2
          FOR UPDATE OF pa SKIP LOCKED
       )
       UPDATE physical_asset pa
          SET readiness = 'ready',
              recovery_managed_readiness = false,
              version = version + 1,
              updated_at = statement_timestamp()
         FROM due_assets
        WHERE pa.tenant_id = $1
          AND pa.id = due_assets.id
       RETURNING pa.id`,
      [tenantId, batchSize],
    );

    if (result.rowCount && result.rowCount > 0) {
      logger.info(
        { tenantId, count: result.rowCount },
        'promoted elapsed recovery cleaning readiness',
      );
    }
    return result.rowCount ?? 0;
  });
}
