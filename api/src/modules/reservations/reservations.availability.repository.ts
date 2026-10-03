import type { PoolClient } from 'pg';

export interface StaffVariantCalendarMetadataRow {
  variant_id: string;
  timezone: string;
  pricing_mode: 'fixed_duration' | 'daily';
  rental_price_minor: string | number;
  security_deposit_minor: string | number;
  currency: string;
  included_duration_minutes: number;
  extra_day_price_minor: string | number;
  turnaround_minutes: number;
  active_assets: number;
  ready_assets: number;
}

export interface StaffVariantCalendarDayRow {
  date: string;
  active_assets: number;
  ready_assets: number;
  available_assets: number;
  reserved_assets: number;
  rented_assets: number;
  fitting_assets: number;
  maintenance_assets: number;
  transfer_assets: number;
}

export interface StaffVariantCalendarReadModel {
  metadata: StaffVariantCalendarMetadataRow;
  days: StaffVariantCalendarDayRow[];
}

/**
 * Reads a bounded, branch-local calendar projection for one active variant without per-day queries. Each day
 * asks whether an operationally eligible serialized garment is free for that local calendar day. Normal
 * Recovery-managed cleaning remains eligible for future dates because the authoritative reservation
 * allocation already carries its post-return Recovery occupancy; persistent repair/manual readiness stays
 * excluded. `ready_assets` still reports only pieces physically Ready now. This projection is advisory;
 * reservation create still revalidates the exact timestamp interval plus Recovery under asset locks.
 */
export async function readStaffVariantCalendarAvailability(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    variantId: string;
    startDate: string;
    endDate: string;
  },
): Promise<StaffVariantCalendarReadModel | null> {
  const metadataResult = await client.query<StaffVariantCalendarMetadataRow>(
    `SELECT
       pv.id AS variant_id,
       b.timezone,
       pv.pricing_mode,
       pv.rental_price_minor,
       pv.security_deposit_minor,
       pv.currency,
       pv.included_duration_minutes,
       pv.extra_day_price_minor,
       pv.turnaround_minutes,
       count(pa.id) FILTER (WHERE pa.lifecycle_status = 'active')::int AS active_assets,
       count(pa.id) FILTER (
         WHERE pa.lifecycle_status = 'active' AND pa.readiness = 'ready'
       )::int AS ready_assets
     FROM product_variant pv
     JOIN product p
       ON p.tenant_id = pv.tenant_id
      AND p.id = pv.product_id
     LEFT JOIN category c
       ON c.tenant_id = p.tenant_id
      AND c.id = p.category_id
     JOIN branch b
       ON b.tenant_id = pv.tenant_id
      AND b.id = $2::uuid
      AND b.status = 'active'
     LEFT JOIN physical_asset pa
       ON pa.tenant_id = pv.tenant_id
      AND pa.variant_id = pv.id
      AND pa.branch_id = b.id
     WHERE pv.tenant_id = $1::uuid
       AND pv.id = $3::uuid
       AND pv.status = 'active'
       AND p.status = 'active'
       AND (p.category_id IS NULL OR c.status = 'active')
     GROUP BY
       pv.id,
       b.timezone,
       pv.pricing_mode,
       pv.rental_price_minor,
       pv.security_deposit_minor,
       pv.currency,
       pv.included_duration_minutes,
       pv.extra_day_price_minor,
       pv.turnaround_minutes
     LIMIT 1`,
    [input.tenantId, input.branchId, input.variantId],
  );
  const metadata = metadataResult.rows[0];
  if (!metadata) return null;

  const daysResult = await client.query<StaffVariantCalendarDayRow>(
    `WITH calendar_days AS (
       SELECT
         gs::date AS day_date,
         (gs::date::timestamp AT TIME ZONE $6) AS blocked_start,
         ((gs::date + 1)::timestamp AT TIME ZONE $6) AS blocked_end
       FROM generate_series($4::date, $5::date, interval '1 day') AS gs
     ),
     eligible_assets AS (
       SELECT pa.id
       FROM physical_asset pa
       WHERE pa.tenant_id = $1::uuid
         AND pa.branch_id = $2::uuid
         AND pa.variant_id = $3::uuid
         AND pa.lifecycle_status = 'active'
         AND (
           pa.readiness = 'ready'
           OR (
             pa.readiness = 'needs_cleaning'
             AND pa.recovery_managed_readiness = true
             AND NOT EXISTS (
               SELECT 1 FROM maintenance_work_order mwo
               WHERE mwo.tenant_id = pa.tenant_id
                 AND mwo.branch_id = pa.branch_id
                 AND mwo.asset_id = pa.id
                 AND mwo.status = 'open'
             )
           )
         )
     )
     SELECT
       to_char(day.day_date, 'YYYY-MM-DD') AS date,
       $7::int AS active_assets,
       $8::int AS ready_assets,
       count(DISTINCT asset.id) FILTER (WHERE allocation.id IS NULL)::int AS available_assets,
       count(DISTINCT asset.id) FILTER (
         WHERE allocation.kind IN ('reservation_hold', 'reservation_confirmed')
           AND reservation.status IS DISTINCT FROM 'picked_up'
       )::int AS reserved_assets,
       count(DISTINCT asset.id) FILTER (
         WHERE allocation.kind IN ('reservation_hold', 'reservation_confirmed')
           AND reservation.status = 'picked_up'
       )::int AS rented_assets,
       count(DISTINCT asset.id) FILTER (WHERE allocation.kind = 'fitting')::int AS fitting_assets,
       count(DISTINCT asset.id) FILTER (WHERE allocation.kind = 'maintenance')::int AS maintenance_assets,
       count(DISTINCT asset.id) FILTER (WHERE allocation.kind = 'transfer')::int AS transfer_assets
     FROM calendar_days day
     LEFT JOIN eligible_assets asset ON true
     LEFT JOIN asset_allocation allocation
       ON allocation.tenant_id = $1::uuid
      AND allocation.branch_id = $2::uuid
      AND allocation.asset_id = asset.id
      AND allocation.is_blocking = true
      AND allocation.period && tstzrange(day.blocked_start, day.blocked_end, '[)')
      AND NOT (
        allocation.kind = 'reservation_hold'
        AND EXISTS (
          SELECT 1
          FROM reservation_line expired_line
          JOIN reservation expired_reservation
            ON expired_reservation.tenant_id = expired_line.tenant_id
           AND expired_reservation.id = expired_line.reservation_id
          WHERE expired_line.tenant_id = allocation.tenant_id
            AND expired_line.id = allocation.reservation_line_id
            AND expired_reservation.status = 'held'
            AND expired_reservation.hold_expires_at IS NOT NULL
            AND expired_reservation.hold_expires_at <= statement_timestamp()
        )
      )
     LEFT JOIN reservation_line line
       ON line.tenant_id = allocation.tenant_id
      AND line.id = allocation.reservation_line_id
     LEFT JOIN reservation reservation
       ON reservation.tenant_id = line.tenant_id
      AND reservation.id = line.reservation_id
     GROUP BY day.day_date
     ORDER BY day.day_date ASC`,
    [
      input.tenantId,
      input.branchId,
      input.variantId,
      input.startDate,
      input.endDate,
      metadata.timezone,
      metadata.active_assets,
      metadata.ready_assets,
    ],
  );

  return { metadata, days: daysResult.rows };
}

/**
 * Counts operationally eligible physical pieces free for one exact buffered interval. Recovery-managed
 * cleaning can satisfy a later non-overlapping interval even before the cleanup worker reconciles the
 * readiness projection. Expired reservation holds are treated as logically released using database time,
 * matching the authoritative create transaction which releases those holds under the asset lock before
 * claiming capacity.
 */
export async function countStaffVariantAvailableAssets(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    variantId: string;
    blockedStart: string;
    blockedEnd: string;
  },
): Promise<number> {
  const result = await client.query<{ available_assets: number }>(
    `SELECT count(*)::int AS available_assets
       FROM physical_asset pa
      WHERE pa.tenant_id = $1::uuid
        AND pa.branch_id = $2::uuid
        AND pa.variant_id = $3::uuid
        AND pa.lifecycle_status = 'active'
        AND (
          pa.readiness = 'ready'
          OR (
            pa.readiness = 'needs_cleaning'
            AND pa.recovery_managed_readiness = true
            AND NOT EXISTS (
              SELECT 1 FROM maintenance_work_order mwo
              WHERE mwo.tenant_id = pa.tenant_id
                AND mwo.branch_id = pa.branch_id
                AND mwo.asset_id = pa.id
                AND mwo.status = 'open'
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM asset_allocation allocation
           WHERE allocation.tenant_id = pa.tenant_id
             AND allocation.branch_id = pa.branch_id
             AND allocation.asset_id = pa.id
             AND allocation.is_blocking = true
             AND allocation.period && tstzrange($4::timestamptz, $5::timestamptz, '[)')
             AND NOT (
               allocation.kind = 'reservation_hold'
               AND EXISTS (
                 SELECT 1
                   FROM reservation_line expired_line
                   JOIN reservation expired_reservation
                     ON expired_reservation.tenant_id = expired_line.tenant_id
                    AND expired_reservation.id = expired_line.reservation_id
                  WHERE expired_line.tenant_id = allocation.tenant_id
                    AND expired_line.id = allocation.reservation_line_id
                    AND expired_reservation.status = 'held'
                    AND expired_reservation.hold_expires_at IS NOT NULL
                    AND expired_reservation.hold_expires_at <= statement_timestamp()
               )
             )
        )`,
    [input.tenantId, input.branchId, input.variantId, input.blockedStart, input.blockedEnd],
  );
  return result.rows[0]?.available_assets ?? 0;
}

/** The active branch's IANA timezone, which decides the local dates rental days are counted on. */
export async function readActiveBranchTimezone(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<string | null> {
  const result = await client.query<{ timezone: string }>(
    `SELECT timezone
       FROM branch
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
        AND status = 'active'`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0]?.timezone ?? null;
}
