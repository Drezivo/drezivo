import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { CreateAssetMaintenanceBlockRequest } from '@drezivo/contracts';

import { CapacityConflictError, StateConflictError } from '../../shared/errors.js';

export interface AssetOperationalConstraints {
  blockingAllocationCount: number;
  openMaintenanceCount: number;
}

export interface CreatedMaintenanceBlock {
  workOrderId: string;
  allocationId: string;
  assetId: string;
  branchId: string;
  kind: CreateAssetMaintenanceBlockRequest['kind'];
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
}

export async function readAssetOperationalConstraints(
  client: PoolClient,
  input: { tenantId: string; branchId: string; assetId: string },
): Promise<AssetOperationalConstraints> {
  const [allocationResult, maintenanceResult] = await Promise.all([
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM asset_allocation
        WHERE tenant_id = $1
          AND branch_id = $2
          AND asset_id = $3
          AND is_blocking = true`,
      [input.tenantId, input.branchId, input.assetId],
    ),
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM maintenance_work_order
        WHERE tenant_id = $1
          AND branch_id = $2
          AND asset_id = $3
          AND status = 'open'`,
      [input.tenantId, input.branchId, input.assetId],
    ),
  ]);

  return {
    blockingAllocationCount: allocationResult.rows[0]?.count ?? 0,
    openMaintenanceCount: maintenanceResult.rows[0]?.count ?? 0,
  };
}

export async function createDisruptionsForThreatenedReservations(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    reason: string;
  },
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO disruption
       (id, tenant_id, asset_id, reservation_line_id, cause_custody_event_id,
        reason, status, resolved_at, created_at)
     SELECT
       gen_random_uuid(),
       aa.tenant_id,
       aa.asset_id,
       aa.reservation_line_id,
       NULL,
       $4,
       'open',
       NULL,
       now()
       FROM asset_allocation aa
       JOIN reservation_line rl
         ON rl.tenant_id = aa.tenant_id
        AND rl.id = aa.reservation_line_id
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
      WHERE aa.tenant_id = $1
        AND aa.branch_id = $2
        AND aa.asset_id = $3
        AND aa.is_blocking = true
        AND aa.reservation_line_id IS NOT NULL
        AND aa.kind IN ('reservation_hold', 'reservation_confirmed')
        AND r.pickup_at > now()
        AND NOT EXISTS (
          SELECT 1
            FROM disruption d
           WHERE d.tenant_id = aa.tenant_id
             AND d.asset_id = aa.asset_id
             AND d.reservation_line_id = aa.reservation_line_id
             AND d.status = 'open'
        )
     RETURNING id`,
    [input.tenantId, input.branchId, input.assetId, input.reason],
  );
  return result.rowCount ?? 0;
}

export async function createMaintenanceBlock(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    request: CreateAssetMaintenanceBlockRequest;
  },
): Promise<CreatedMaintenanceBlock> {
  const workOrderId = randomUUID();
  const allocationId = randomUUID();

  await client.query('SAVEPOINT catalogue_maintenance_block');
  try {
    await client.query(
      `INSERT INTO maintenance_work_order
         (id, tenant_id, branch_id, asset_id, kind, status, reason, opened_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, now(), NULL)`,
      [
        workOrderId,
        input.tenantId,
        input.branchId,
        input.assetId,
        input.request.kind,
        input.request.reason,
      ],
    );

    const allocation = await client.query<{
      starts_at: Date;
      ends_at: Date;
      created_at: Date;
    }>(
      `INSERT INTO asset_allocation
         (id, tenant_id, branch_id, asset_id, maintenance_id, kind, period,
          is_blocking, released_at, created_at)
       VALUES (
         $1, $2, $3, $4, $5, 'maintenance',
         tstzrange($6::timestamptz, $7::timestamptz, '[)'),
         true, NULL, now()
       )
       RETURNING lower(period) AS starts_at, upper(period) AS ends_at, created_at`,
      [
        allocationId,
        input.tenantId,
        input.branchId,
        input.assetId,
        workOrderId,
        input.request.period.start,
        input.request.period.end,
      ],
    );

    const row = allocation.rows[0];
    if (!row) {
      throw new StateConflictError('The maintenance block could not be created.');
    }
    await client.query('RELEASE SAVEPOINT catalogue_maintenance_block');
    return {
      workOrderId,
      allocationId,
      assetId: input.assetId,
      branchId: input.branchId,
      kind: input.request.kind,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      createdAt: row.created_at,
    };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT catalogue_maintenance_block');
    await client.query('RELEASE SAVEPOINT catalogue_maintenance_block');
    if (isAllocationOverlapViolation(error)) {
      throw new CapacityConflictError(
        'That garment already has blocking work or a reservation during the requested period.',
      );
    }
    throw error;
  }
}

function isAllocationOverlapViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23P01' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'asset_allocation_no_overlap'
  );
}
