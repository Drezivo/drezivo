import type { PoolClient } from 'pg';

export interface ReservationCatalogueSelectionRow {
  product_id: string;
  variant_id: string;
  branch_id: string;
  candidate_asset_ids: string[];
}

/**
 * Best-effort candidate read for the Reservation allocator. It intentionally does not lock or
 * claim capacity. The Reservation transaction must lock/revalidate candidates and insert the
 * authoritative blocking asset_allocation before it can promise availability.
 */
export async function readReservationCatalogueSelection(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    variantId: string;
    blockedStart: string;
    blockedEnd: string;
  },
): Promise<ReservationCatalogueSelectionRow | null> {
  const result = await client.query<ReservationCatalogueSelectionRow>(
    `SELECT
       p.id AS product_id,
       pv.id AS variant_id,
       b.id AS branch_id,
       COALESCE(candidate_assets.asset_ids, ARRAY[]::uuid[]) AS candidate_asset_ids
     FROM product_variant pv
     JOIN product p
       ON p.tenant_id = pv.tenant_id
      AND p.id = pv.product_id
     JOIN branch b
       ON b.tenant_id = pv.tenant_id
      AND b.id = $2
     LEFT JOIN LATERAL (
       SELECT array_agg(candidate.id ORDER BY candidate.id) AS asset_ids
       FROM (
         SELECT pa.id
         FROM physical_asset pa
         WHERE pa.tenant_id = $1
           AND pa.branch_id = $2
           AND pa.variant_id = pv.id
           AND pa.lifecycle_status = 'active'
           AND pa.readiness = 'ready'
           AND NOT EXISTS (
             SELECT 1
             FROM asset_allocation aa
             WHERE aa.tenant_id = $1
               AND aa.branch_id = $2
               AND aa.asset_id = pa.id
               AND aa.is_blocking = true
               AND aa.period && tstzrange($4::timestamptz, $5::timestamptz, '[)')
           )
         ORDER BY pa.id ASC
         LIMIT 1000
       ) candidate
     ) candidate_assets ON true
     WHERE pv.tenant_id = $1
       AND pv.id = $3
       AND pv.status = 'active'
       AND p.status = 'active'
       AND b.status = 'active'
     LIMIT 1`,
    [input.tenantId, input.branchId, input.variantId, input.blockedStart, input.blockedEnd],
  );

  return result.rows[0] ?? null;
}
