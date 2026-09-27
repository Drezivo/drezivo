import type { PoolClient } from 'pg';

export interface ReservationCatalogueSelectionRow {
  product_id: string;
  variant_id: string;
  branch_id: string;
  candidate_asset_ids: string[];
}

export interface ReservationCatalogueQuoteSelectionRow {
  product_id: string;
  product_name: string;
  variant_id: string;
  branch_id: string;
  sku: string;
  size_label: string | null;
  color_label: string | null;
  measurement_mode: 'default_guide' | 'custom' | 'none';
  measurement_guide_id: string | null;
  measurement_unit: 'cm' | 'in';
  measurements: Record<string, number>;
  rental_price_minor: string | number;
  security_deposit_minor: string | number;
  currency: string;
  pricing_mode: 'fixed_duration' | 'daily';
  included_duration_minutes: number;
  extra_day_price_minor: string | number;
  prep_minutes: number;
  turnaround_minutes: number;
  blocked_start: Date;
  blocked_end: Date;
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
     LEFT JOIN category c
       ON c.tenant_id = p.tenant_id
      AND c.id = p.category_id
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
           AND (
             pa.readiness = 'ready'
             OR (
               pa.readiness = 'needs_cleaning'
               AND pa.recovery_managed_readiness = true
               AND NOT EXISTS (
                 SELECT 1
                 FROM maintenance_work_order mwo
                 WHERE mwo.tenant_id = pa.tenant_id
                   AND mwo.branch_id = pa.branch_id
                   AND mwo.asset_id = pa.id
                   AND mwo.status = 'open'
               )
             )
           )
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
       AND (p.category_id IS NULL OR c.status = 'active')
       AND b.status = 'active'
     LIMIT 1`,
    [input.tenantId, input.branchId, input.variantId, input.blockedStart, input.blockedEnd],
  );

  return result.rows[0] ?? null;
}

/**
 * Reservation quote read that derives the blocked window from the variant's current prep/
 * post-return recovery configuration before testing candidate allocations. This remains advisory only;
 * RSV-021 must lock/revalidate the returned assets before it promises capacity.
 */
export async function readReservationCatalogueQuoteSelection(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    variantId: string;
    requestedStart: string;
    requestedEnd: string;
  },
): Promise<ReservationCatalogueQuoteSelectionRow | null> {
  const result = await client.query<ReservationCatalogueQuoteSelectionRow>(
    `SELECT
       p.id AS product_id,
       p.name AS product_name,
       pv.id AS variant_id,
       b.id AS branch_id,
       pv.sku,
       pv.size_label,
       pv.color_label,
       pv.measurement_mode,
       pv.measurement_guide_id,
       pv.measurement_unit,
       pv.measurements,
       pv.rental_price_minor,
       pv.security_deposit_minor,
       pv.currency,
       pv.pricing_mode,
       pv.included_duration_minutes,
       pv.extra_day_price_minor,
       pv.prep_minutes,
       pv.turnaround_minutes,
       booking_window.blocked_start,
       booking_window.blocked_end,
       COALESCE(candidate_assets.asset_ids, ARRAY[]::uuid[]) AS candidate_asset_ids
     FROM product_variant pv
     JOIN product p
       ON p.tenant_id = pv.tenant_id
      AND p.id = pv.product_id
     LEFT JOIN category c
       ON c.tenant_id = p.tenant_id
      AND c.id = p.category_id
     JOIN branch b
       ON b.tenant_id = pv.tenant_id
      AND b.id = $2
     CROSS JOIN LATERAL (
       SELECT
         $4::timestamptz AS blocked_start,
         $5::timestamptz + (pv.turnaround_minutes * interval '1 minute') AS blocked_end
     ) booking_window
     LEFT JOIN LATERAL (
       SELECT array_agg(candidate.id ORDER BY candidate.id) AS asset_ids
       FROM (
         SELECT pa.id
         FROM physical_asset pa
         WHERE pa.tenant_id = $1
           AND pa.branch_id = $2
           AND pa.variant_id = pv.id
           AND pa.lifecycle_status = 'active'
           AND (
             pa.readiness = 'ready'
             OR (
               pa.readiness = 'needs_cleaning'
               AND pa.recovery_managed_readiness = true
               AND NOT EXISTS (
                 SELECT 1
                 FROM maintenance_work_order mwo
                 WHERE mwo.tenant_id = pa.tenant_id
                   AND mwo.branch_id = pa.branch_id
                   AND mwo.asset_id = pa.id
                   AND mwo.status = 'open'
               )
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM asset_allocation aa
             WHERE aa.tenant_id = $1
               AND aa.branch_id = $2
               AND aa.asset_id = pa.id
               AND aa.is_blocking = true
               AND aa.period && tstzrange(
                 booking_window.blocked_start,
                 booking_window.blocked_end,
                 '[)'
               )
           )
         ORDER BY pa.id ASC
         LIMIT 1000
       ) candidate
     ) candidate_assets ON true
     WHERE pv.tenant_id = $1
       AND pv.id = $3
       AND pv.status = 'active'
       AND p.status = 'active'
       AND (p.category_id IS NULL OR c.status = 'active')
       AND b.status = 'active'
       AND $4::timestamptz < $5::timestamptz
     LIMIT 1`,
    [input.tenantId, input.branchId, input.variantId, input.requestedStart, input.requestedEnd],
  );

  return result.rows[0] ?? null;
}
