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
    [input.fittingId, input.tenantId, input.branchId, input.customerId, input.startsAt, input.endsAt, input.timezoneSnapshot, input.currency, input.feeMinor, input.internalNote, input.businessKey],
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
      [input.chargeId, input.tenantId, input.fittingId, input.feeMinor, input.currency, `fitting:${input.fittingId}:fee`],
    );
  }
}

export async function appendFittingCreateAudit(
  client: PoolClient,
  input: { tenantId: string; actorKey: string; fittingId: string; branchId: string; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,'fitting.created','fitting',$3::uuid,$4::jsonb,$5,statement_timestamp(),'succeeded')`,
    [input.tenantId, input.actorKey, input.fittingId, JSON.stringify({ status: 'pending', branch_id: input.branchId }), input.requestId],
  );
}
