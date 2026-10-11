import type { PoolClient } from 'pg';

/**
 * Writes only the reservation customer snapshot with the optimistic version guard. Returns the
 * new version, or null when another change won the race.
 */
export async function applyReservationCustomerEdit(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    reservationId: string;
    version: number;
    customerSnapshot: Record<string, unknown>;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET customer_snapshot = $5::jsonb,
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND version = $4
        AND status = 'confirmed'
        AND customer_snapshot IS NOT NULL
      RETURNING version`,
    [
      input.tenantId,
      input.branchId,
      input.reservationId,
      input.version,
      JSON.stringify(input.customerSnapshot),
    ],
  );
  return result.rows[0]?.version ?? null;
}
