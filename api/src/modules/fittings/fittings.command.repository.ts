import type { PoolClient } from 'pg';

export interface FittingCreateSettingsRow {
  enabled: boolean;
  capacity: number;
  duration_minutes: number;
  fee_minor: string | number;
  currency: string;
  timezone: string;
}

export interface FittingCreateCustomerRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export interface FittingCreateVariantRow {
  id: string;
}

export interface FittingScheduleValidationRow {
  is_future: boolean;
  within_weekly_hours: boolean;
  closure_free: boolean;
}

/** Locks settings so create/reschedule serialize with configuration and later capacity work. */
export async function lockFittingCreateSettings(
  client: PoolClient,
  input: { tenantId: string; branchId: string },
): Promise<FittingCreateSettingsRow | null> {
  const result = await client.query<FittingCreateSettingsRow>(
    `SELECT fs.enabled, fs.capacity, fs.duration_minutes, fs.fee_minor, fs.currency, b.timezone
       FROM fitting_settings fs
       JOIN branch b ON b.tenant_id = fs.tenant_id AND b.id = fs.branch_id
      WHERE fs.tenant_id = $1 AND fs.branch_id = $2
      LIMIT 1
      FOR UPDATE OF fs`,
    [input.tenantId, input.branchId],
  );
  return result.rows[0] ?? null;
}

export async function readFittingCustomerForCreate(
  client: PoolClient,
  input: { tenantId: string; customerId: string },
): Promise<FittingCreateCustomerRow | null> {
  const result = await client.query<FittingCreateCustomerRow>(
    `SELECT id, full_name, phone, lower(email) AS email
       FROM customer
      WHERE tenant_id = $1 AND id = $2::uuid AND anonymized_at IS NULL AND archived_at IS NULL
      LIMIT 1
      FOR SHARE`,
    [input.tenantId, input.customerId],
  );
  return result.rows[0] ?? null;
}

export async function createFittingCustomer(
  client: PoolClient,
  input: {
    tenantId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    socialMedia: string | null;
  },
): Promise<FittingCreateCustomerRow> {
  const result = await client.query<FittingCreateCustomerRow>(
    `INSERT INTO customer (tenant_id, full_name, phone, email, address, social_media)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, full_name, phone, lower(email) AS email`,
    [input.tenantId, input.fullName, input.phone, input.email, input.address, input.socialMedia],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Fitting customer insert returned no row.');
  return row;
}

/** Validates every requested variant in one bounded tenant-scoped catalogue read. */
export async function readFittingVariantsForCreate(
  client: PoolClient,
  input: { tenantId: string; variantIds: string[] },
): Promise<FittingCreateVariantRow[]> {
  const result = await client.query<FittingCreateVariantRow>(
    `SELECT pv.id
       FROM product_variant pv
       JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
       LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
      WHERE pv.tenant_id = $1
        AND pv.id = ANY($2::uuid[])
        AND pv.status = 'active'
        AND p.status = 'active'
        AND (p.category_id IS NULL OR c.status = 'active')
      ORDER BY pv.id`,
    [input.tenantId, input.variantIds],
  );
  return result.rows;
}

export interface LockedFittingAssetRow {
  id: string;
  variant_id: string;
}

export type FittingAppointmentStatus =
  'pending' | 'confirmed' | 'completed' | 'rejected' | 'cancelled' | 'no_show';

export interface LockedFittingAppointmentRow {
  id: string;
  status: FittingAppointmentStatus;
  starts_at: Date;
  ends_at: Date;
  timezone_snapshot: string;
  version: string | number;
  before_start: boolean;
  at_or_after_start: boolean;
  at_or_after_end: boolean;
}

export interface ActiveFittingLineRow {
  id: string;
  variant_id: string;
  asset_id: string | null;
  garment_guaranteed: boolean;
}

/** Locks all eligible serialized garments for the requested variants in deterministic order. */
export async function lockEligibleFittingAssets(
  client: PoolClient,
  input: { tenantId: string; branchId: string; variantIds: string[] },
): Promise<LockedFittingAssetRow[]> {
  if (input.variantIds.length === 0) return [];
  const result = await client.query<LockedFittingAssetRow>(
    `SELECT pa.id, pa.variant_id
       FROM physical_asset pa
       JOIN product_variant pv
         ON pv.tenant_id = pa.tenant_id AND pv.id = pa.variant_id
       JOIN product p
         ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
       LEFT JOIN category c
         ON c.tenant_id = p.tenant_id AND c.id = p.category_id
      WHERE pa.tenant_id = $1
        AND pa.branch_id = $2
        AND pa.variant_id = ANY($3::uuid[])
        AND pa.lifecycle_status = 'active'
        AND pa.readiness = 'ready'
        AND pv.status = 'active'
        AND p.status = 'active'
        AND (p.category_id IS NULL OR c.status = 'active')
      ORDER BY pa.id ASC
      FOR UPDATE OF pa`,
    [input.tenantId, input.branchId, input.variantIds],
  );
  return result.rows;
}

/** Chooses a locked asset that has no overlapping blocking allocation, optionally ignoring one old claim. */
export async function chooseAvailableFittingAsset(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    variantId: string;
    candidateAssetIds: string[];
    startsAt: string;
    endsAt: string;
    excludedAssetIds: string[];
    ignoredAllocationId?: string;
    preferredAssetId?: string | null;
  },
): Promise<string | null> {
  if (input.candidateAssetIds.length === 0) return null;
  const result = await client.query<{ id: string }>(
    `SELECT pa.id
       FROM physical_asset pa
      WHERE pa.tenant_id = $1
        AND pa.branch_id = $2
        AND pa.variant_id = $3
        AND pa.id = ANY($4::uuid[])
        AND NOT (pa.id = ANY($7::uuid[]))
        AND pa.lifecycle_status = 'active'
        AND pa.readiness = 'ready'
        AND NOT EXISTS (
          SELECT 1
            FROM asset_allocation aa
           WHERE aa.tenant_id = pa.tenant_id
             AND aa.branch_id = pa.branch_id
             AND aa.asset_id = pa.id
             AND aa.is_blocking
             AND ($8::uuid IS NULL OR aa.id <> $8::uuid)
             AND aa.period && tstzrange($5::timestamptz, $6::timestamptz, '[)')
        )
      ORDER BY (pa.id = $9::uuid) DESC, pa.id ASC
      LIMIT 1`,
    [
      input.tenantId,
      input.branchId,
      input.variantId,
      input.candidateAssetIds,
      input.startsAt,
      input.endsAt,
      input.excludedAssetIds,
      input.ignoredAllocationId ?? null,
      input.preferredAssetId ?? null,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function insertFittingAssetAllocation(
  client: PoolClient,
  input: {
    allocationId: string;
    tenantId: string;
    branchId: string;
    assetId: string;
    fittingLineId: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO asset_allocation
       (id, tenant_id, branch_id, asset_id, fitting_line_id, kind, period, is_blocking)
     VALUES ($1,$2,$3,$4,$5,'fitting',tstzrange($6::timestamptz,$7::timestamptz,'[)'),true)`,
    [
      input.allocationId,
      input.tenantId,
      input.branchId,
      input.assetId,
      input.fittingLineId,
      input.startsAt,
      input.endsAt,
    ],
  );
}

export async function lockFittingAppointmentForMutation(
  client: PoolClient,
  input: { tenantId: string; branchId: string; fittingId: string },
): Promise<LockedFittingAppointmentRow | null> {
  const result = await client.query<LockedFittingAppointmentRow>(
    `SELECT id, status, lower(period) AS starts_at, upper(period) AS ends_at,
            timezone_snapshot, version,
            lower(period) > statement_timestamp() AS before_start,
            lower(period) <= statement_timestamp() AS at_or_after_start,
            upper(period) <= statement_timestamp() AS at_or_after_end
       FROM fitting_appointment
      WHERE tenant_id = $1 AND branch_id = $2 AND id = $3::uuid
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.branchId, input.fittingId],
  );
  return result.rows[0] ?? null;
}

export async function verifyFittingRequiredClaims(
  client: PoolClient,
  input: { tenantId: string; branchId: string; fittingId: string },
): Promise<boolean> {
  const result = await client.query<{ claims_valid: boolean }>(
    `SELECT
       (
         SELECT count(*) = 1
           FROM fitting_slot_allocation fsa
           JOIN fitting_capacity_slot fcs
             ON fcs.tenant_id = fsa.tenant_id AND fcs.id = fsa.slot_id
          WHERE fsa.tenant_id = $1
            AND fsa.fitting_id = $3::uuid
            AND fsa.is_blocking
            AND fcs.active
            AND fcs.branch_id = $2
            AND fsa.period = fa.period
       )
       AND NOT EXISTS (
         SELECT 1
           FROM fitting_line fl
          WHERE fl.tenant_id = $1
            AND fl.fitting_id = $3::uuid
            AND fl.removed_at IS NULL
            AND fl.garment_guaranteed
            AND NOT EXISTS (
              SELECT 1
                FROM asset_allocation aa
               WHERE aa.tenant_id = fl.tenant_id
                 AND aa.fitting_line_id = fl.id
                 AND aa.is_blocking
                 AND aa.kind = 'fitting'
                 AND aa.asset_id = fl.asset_id
                 AND aa.branch_id = $2
                 AND aa.period = fa.period
            )
       ) AS claims_valid
       FROM fitting_appointment fa
      WHERE fa.tenant_id = $1 AND fa.branch_id = $2 AND fa.id = $3::uuid
      LIMIT 1`,
    [input.tenantId, input.branchId, input.fittingId],
  );
  return result.rows[0]?.claims_valid ?? false;
}

export async function releaseFittingBlockingClaims(
  client: PoolClient,
  input: { tenantId: string; fittingId: string },
): Promise<{ capacityReleased: number; assetClaimsReleased: number }> {
  const capacity = await client.query(
    `UPDATE fitting_slot_allocation
        SET is_blocking = false, released_at = statement_timestamp()
      WHERE tenant_id = $1 AND fitting_id = $2::uuid AND is_blocking`,
    [input.tenantId, input.fittingId],
  );
  const assets = await client.query(
    `UPDATE asset_allocation aa
        SET is_blocking = false, released_at = statement_timestamp()
       FROM fitting_line fl
      WHERE fl.tenant_id = $1
        AND fl.fitting_id = $2::uuid
        AND aa.tenant_id = fl.tenant_id
        AND aa.fitting_line_id = fl.id
        AND aa.is_blocking`,
    [input.tenantId, input.fittingId],
  );
  return {
    capacityReleased: capacity.rowCount ?? 0,
    assetClaimsReleased: assets.rowCount ?? 0,
  };
}

export type FittingLifecycleTimingGuard =
  'none' | 'before_start' | 'at_or_after_start' | 'at_or_after_end';

export async function transitionFittingLifecycle(
  client: PoolClient,
  input: {
    tenantId: string;
    fittingId: string;
    version: number;
    expectedStatus: 'pending' | 'confirmed';
    nextStatus: 'confirmed' | 'completed' | 'rejected' | 'cancelled' | 'no_show';
    reason: string | null;
    timingGuard: FittingLifecycleTimingGuard;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE fitting_appointment
        SET status = $5,
            terminal_reason = $6,
            version = version + 1
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND version = $3
        AND status = $4
        AND CASE $7::text
              WHEN 'none' THEN true
              WHEN 'before_start' THEN lower(period) > statement_timestamp()
              WHEN 'at_or_after_start' THEN lower(period) <= statement_timestamp()
              WHEN 'at_or_after_end' THEN upper(period) <= statement_timestamp()
              ELSE false
            END
      RETURNING version`,
    [
      input.tenantId,
      input.fittingId,
      input.version,
      input.expectedStatus,
      input.nextStatus,
      input.reason,
      input.timingGuard,
    ],
  );
  return result.rows[0]?.version ?? null;
}

export async function lockActiveFittingLines(
  client: PoolClient,
  input: { tenantId: string; fittingId: string },
): Promise<ActiveFittingLineRow[]> {
  const result = await client.query<ActiveFittingLineRow>(
    `SELECT id, variant_id, asset_id, garment_guaranteed
       FROM fitting_line
      WHERE tenant_id = $1 AND fitting_id = $2::uuid AND removed_at IS NULL
      ORDER BY created_at ASC, id ASC
      FOR UPDATE`,
    [input.tenantId, input.fittingId],
  );
  return result.rows;
}

export async function readBlockingFittingAssetAllocation(
  client: PoolClient,
  input: { tenantId: string; fittingLineId: string },
): Promise<{ id: string; asset_id: string } | null> {
  const result = await client.query<{ id: string; asset_id: string }>(
    `SELECT id, asset_id
       FROM asset_allocation
      WHERE tenant_id = $1 AND fitting_line_id = $2::uuid AND is_blocking
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.fittingLineId],
  );
  return result.rows[0] ?? null;
}

export async function moveFittingCapacityClaim(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    fittingId: string;
    newAllocationId: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<string | null> {
  const current = await client.query<{ id: string }>(
    `SELECT id
       FROM fitting_slot_allocation
      WHERE tenant_id = $1 AND fitting_id = $2::uuid AND is_blocking
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.fittingId],
  );
  const allocationId = current.rows[0]?.id;
  if (!allocationId) return null;

  const candidate = await client.query<{ id: string }>(
    `SELECT fcs.id
       FROM fitting_capacity_slot fcs
      WHERE fcs.tenant_id = $1
        AND fcs.branch_id = $2
        AND fcs.active
        AND NOT EXISTS (
          SELECT 1
            FROM fitting_slot_allocation other
           WHERE other.tenant_id = fcs.tenant_id
             AND other.slot_id = fcs.id
             AND other.is_blocking
             AND other.id <> $3::uuid
             AND other.period && tstzrange($4::timestamptz,$5::timestamptz,'[)')
        )
      ORDER BY fcs.slot_number ASC, fcs.id ASC
      LIMIT 1
      FOR UPDATE OF fcs`,
    [input.tenantId, input.branchId, allocationId, input.startsAt, input.endsAt],
  );
  const slotId = candidate.rows[0]?.id;
  if (!slotId) return null;

  await client.query(
    `UPDATE fitting_slot_allocation
        SET is_blocking = false, released_at = statement_timestamp()
      WHERE tenant_id = $1 AND fitting_id = $2::uuid AND id = $3::uuid AND is_blocking`,
    [input.tenantId, input.fittingId, allocationId],
  );
  await client.query(
    `INSERT INTO fitting_slot_allocation
       (id, tenant_id, slot_id, fitting_id, period, is_blocking)
     VALUES ($1,$2,$3,$4,tstzrange($5::timestamptz,$6::timestamptz,'[)'),true)`,
    [input.newAllocationId, input.tenantId, slotId, input.fittingId, input.startsAt, input.endsAt],
  );
  return slotId;
}

export async function moveFittingAssetClaim(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    fittingLineId: string;
    allocationId: string;
    newAllocationId: string;
    assetId: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE asset_allocation
        SET is_blocking = false, released_at = statement_timestamp()
      WHERE tenant_id = $1 AND fitting_line_id = $2::uuid AND id = $3::uuid AND is_blocking`,
    [input.tenantId, input.fittingLineId, input.allocationId],
  );
  await client.query(
    `UPDATE fitting_line
        SET asset_id = $3::uuid
      WHERE tenant_id = $1 AND id = $2::uuid AND removed_at IS NULL`,
    [input.tenantId, input.fittingLineId, input.assetId],
  );
  await insertFittingAssetAllocation(client, {
    allocationId: input.newAllocationId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    assetId: input.assetId,
    fittingLineId: input.fittingLineId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
}

export async function updateFittingPeriodAndVersion(
  client: PoolClient,
  input: {
    tenantId: string;
    fittingId: string;
    version: number;
    startsAt: string;
    endsAt: string;
    timezoneSnapshot: string;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE fitting_appointment
        SET period = tstzrange($4::timestamptz,$5::timestamptz,'[)'),
            timezone_snapshot = $6,
            version = version + 1
      WHERE tenant_id = $1 AND id = $2::uuid AND version = $3
        AND status IN ('pending','confirmed')
      RETURNING version`,
    [
      input.tenantId,
      input.fittingId,
      input.version,
      input.startsAt,
      input.endsAt,
      input.timezoneSnapshot,
    ],
  );
  return result.rows[0]?.version ?? null;
}

export async function insertFittingLine(
  client: PoolClient,
  input: {
    lineId: string;
    tenantId: string;
    fittingId: string;
    variantId: string;
    guaranteed: boolean;
    assetId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO fitting_line
       (id, tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.lineId,
      input.tenantId,
      input.fittingId,
      input.variantId,
      input.assetId,
      input.guaranteed,
    ],
  );
}

export async function retireFittingLine(
  client: PoolClient,
  input: { tenantId: string; fittingLineId: string },
): Promise<void> {
  await client.query(
    `UPDATE asset_allocation
        SET is_blocking = false, released_at = statement_timestamp()
      WHERE tenant_id = $1 AND fitting_line_id = $2::uuid AND is_blocking`,
    [input.tenantId, input.fittingLineId],
  );
  await client.query(
    `UPDATE fitting_line
        SET removed_at = statement_timestamp()
      WHERE tenant_id = $1 AND id = $2::uuid AND removed_at IS NULL`,
    [input.tenantId, input.fittingLineId],
  );
}

export async function updateFittingInternalNote(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    fittingId: string;
    version: number;
    internalNote: string | null;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE fitting_appointment
        SET internal_note = $5,
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND version = $4
        AND status IN ('pending','confirmed')
      RETURNING version`,
    [input.tenantId, input.branchId, input.fittingId, input.version, input.internalNote],
  );
  return result.rows[0]?.version ?? null;
}

export async function bumpFittingVersion(
  client: PoolClient,
  input: { tenantId: string; fittingId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE fitting_appointment
        SET version = version + 1
      WHERE tenant_id = $1 AND id = $2::uuid AND version = $3
        AND status IN ('pending','confirmed')
      RETURNING version`,
    [input.tenantId, input.fittingId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function appendFittingMutationAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action:
      | 'fitting.rescheduled'
      | 'fitting.note_updated'
      | 'fitting.garment_changed'
      | 'fitting.confirmed'
      | 'fitting.rejected'
      | 'fitting.cancelled'
      | 'fitting.completed'
      | 'fitting.marked_no_show';
    fittingId: string;
    branchId: string;
    requestId: string;
    version: number;
    status?: FittingAppointmentStatus;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,$3,'fitting',$4::uuid,$5::jsonb,$6,statement_timestamp(),'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.fittingId,
      JSON.stringify({
        branch_id: input.branchId,
        version: input.version,
        ...(input.status ? { status: input.status } : {}),
      }),
      input.requestId,
    ],
  );
}

export async function validateFittingScheduleForCreate(
  client: PoolClient,
  input: { tenantId: string; branchId: string; startsAt: string; endsAt: string },
): Promise<FittingScheduleValidationRow> {
  const result = await client.query<FittingScheduleValidationRow>(
    `SELECT
       $3::timestamptz > statement_timestamp() AS is_future,
       EXISTS (
         SELECT 1
           FROM branch b
           JOIN fitting_hours fh
             ON fh.tenant_id = b.tenant_id
            AND fh.branch_id = b.id
          WHERE b.tenant_id = $1
            AND b.id = $2
            AND extract(isodow FROM ($3::timestamptz AT TIME ZONE b.timezone))::integer = fh.weekday
            AND ($3::timestamptz AT TIME ZONE b.timezone)::date =
                ($4::timestamptz AT TIME ZONE b.timezone)::date
            AND ($3::timestamptz AT TIME ZONE b.timezone)::time >= fh.starts_local
            AND ($4::timestamptz AT TIME ZONE b.timezone)::time <= fh.ends_local
       ) AS within_weekly_hours,
       NOT EXISTS (
         SELECT 1
           FROM fitting_closure fc
          WHERE fc.tenant_id = $1
            AND fc.branch_id = $2
            AND fc.period && tstzrange($3::timestamptz, $4::timestamptz, '[)')
       ) AS closure_free`,
    [input.tenantId, input.branchId, input.startsAt, input.endsAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Fitting schedule validation returned no row.');
  return row;
}

/**
 * Materializes the branch's hidden concurrency slots under the already-held fitting-settings lock.
 * Re-activating an existing slot is safe; the persistence guard prevents active slots above the
 * configured capacity.
 */
export async function ensureFittingCapacitySlots(
  client: PoolClient,
  input: { tenantId: string; branchId: string; capacity: number },
): Promise<void> {
  await client.query(
    `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
     SELECT $1, $2, series.slot_number, true
       FROM generate_series(1, $3::integer) AS series(slot_number)
     ON CONFLICT (tenant_id, branch_id, slot_number)
     DO UPDATE SET active = true`,
    [input.tenantId, input.branchId, input.capacity],
  );
}

/**
 * Claims one hidden branch slot for the exact appointment period. The settings row lock serializes
 * cooperating booking/configuration commands, while the GiST exclusion remains the database-level
 * final arbiter against any competing writer.
 */
export async function claimFittingCapacitySlot(
  client: PoolClient,
  input: {
    allocationId: string;
    tenantId: string;
    branchId: string;
    fittingId: string;
    startsAt: string;
    endsAt: string;
  },
): Promise<string | null> {
  const result = await client.query<{ slot_id: string }>(
    `WITH candidate AS (
       SELECT fcs.id
         FROM fitting_capacity_slot fcs
        WHERE fcs.tenant_id = $2
          AND fcs.branch_id = $3
          AND fcs.active
          AND NOT EXISTS (
            SELECT 1
              FROM fitting_slot_allocation existing
             WHERE existing.tenant_id = fcs.tenant_id
               AND existing.slot_id = fcs.id
               AND existing.is_blocking
               AND existing.period && tstzrange($5::timestamptz, $6::timestamptz, '[)')
          )
        ORDER BY fcs.slot_number ASC, fcs.id ASC
        LIMIT 1
        FOR UPDATE OF fcs
     )
     INSERT INTO fitting_slot_allocation
       (id, tenant_id, slot_id, fitting_id, period, is_blocking)
     SELECT $1, $2, candidate.id, $4,
            tstzrange($5::timestamptz, $6::timestamptz, '[)'), true
       FROM candidate
     RETURNING slot_id`,
    [
      input.allocationId,
      input.tenantId,
      input.branchId,
      input.fittingId,
      input.startsAt,
      input.endsAt,
    ],
  );
  return result.rows[0]?.slot_id ?? null;
}

export async function createFittingAppointmentBase(
  client: PoolClient,
  input: {
    fittingId: string;
    tenantId: string;
    branchId: string;
    customerId: string;
    startsAt: string;
    endsAt: string;
    timezoneSnapshot: string;
    currency: string;
    feeMinor: number;
    internalNote: string | null;
    businessKey: string;
    garments: Array<{
      lineId: string;
      variantId: string;
      guaranteed: boolean;
      assetId: string | null;
    }>;
    chargeId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO fitting_appointment
       (id, tenant_id, branch_id, customer_id, booking_channel, status, period,
        timezone_snapshot, currency, fee_minor, internal_note, business_key, version)
     VALUES ($1,$2,$3,$4,'staff','pending',tstzrange($5::timestamptz,$6::timestamptz,'[)'),$7,$8,$9,$10,$11,1)`,
    [
      input.fittingId,
      input.tenantId,
      input.branchId,
      input.customerId,
      input.startsAt,
      input.endsAt,
      input.timezoneSnapshot,
      input.currency,
      input.feeMinor,
      input.internalNote,
      input.businessKey,
    ],
  );

  for (const line of input.garments) {
    await client.query(
      `INSERT INTO fitting_line (id, tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [line.lineId, input.tenantId, input.fittingId, line.variantId, line.assetId, line.guaranteed],
    );
  }

  if (input.feeMinor > 0) {
    await client.query(
      `INSERT INTO charge (id, tenant_id, fitting_id, kind, amount_minor, currency, business_key)
       VALUES ($1,$2,$3,'fitting_fee',$4,$5,$6)`,
      [
        input.chargeId,
        input.tenantId,
        input.fittingId,
        input.feeMinor,
        input.currency,
        `fitting:${input.fittingId}:fee`,
      ],
    );
  }
}

export async function appendFittingCreateAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    fittingId: string;
    branchId: string;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,'fitting.created','fitting',$3::uuid,$4::jsonb,$5,statement_timestamp(),'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.fittingId,
      JSON.stringify({ status: 'pending', branch_id: input.branchId }),
      input.requestId,
    ],
  );
}
