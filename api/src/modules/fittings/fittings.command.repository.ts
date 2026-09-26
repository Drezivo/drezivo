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
      WHERE tenant_id = $1 AND id = $2::uuid AND anonymized_at IS NULL
      LIMIT 1
      FOR SHARE`,
    [input.tenantId, input.customerId],
  );
  return result.rows[0] ?? null;
}

export async function createFittingCustomer(
  client: PoolClient,
  input: { tenantId: string; fullName: string; phone: string | null; email: string | null },
): Promise<FittingCreateCustomerRow> {
  const result = await client.query<FittingCreateCustomerRow>(
    `INSERT INTO customer (tenant_id, full_name, phone, email)
     VALUES ($1, $2, $3, $4)
     RETURNING id, full_name, phone, lower(email) AS email`,
    [input.tenantId, input.fullName, input.phone, input.email],
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
    garments: Array<{ lineId: string; variantId: string; guaranteed: boolean }>;
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
       VALUES ($1,$2,$3,$4,NULL,$5)`,
      [line.lineId, input.tenantId, input.fittingId, line.variantId, line.guaranteed],
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
