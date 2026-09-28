import type { PoolClient } from 'pg';

export interface ReservationCustomerSnapshotRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface ExpiredReservationHoldRow {
  reservation_id: string;
  version: number;
}

export interface CreatedReservationGraphRow {
  reservation_id: string;
  reservation_line_id: string;
  allocation_id: string;
  payment_id: string | null;
  hold_expires_at: Date;
  version: number;
  created_at: Date;
}

/**
 * Locks every V1-eligible serialized asset for the chosen variant in deterministic UUID order.
 * The lock is the transaction boundary used by RSV-021; the GiST allocation insert remains the
 * final authority because maintenance or legacy writers that do not take this row lock can still
 * race us and must be rejected by the database constraint.
 */
export async function lockEligibleReservationAssets(
  client: PoolClient,
  input: { tenantId: string; branchId: string; variantId: string },
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT pa.id
       FROM physical_asset pa
       JOIN product_variant pv
         ON pv.tenant_id = pa.tenant_id
        AND pv.id = pa.variant_id
       JOIN product p
         ON p.tenant_id = pv.tenant_id
        AND p.id = pv.product_id
       LEFT JOIN category c
         ON c.tenant_id = p.tenant_id
        AND c.id = p.category_id
      WHERE pa.tenant_id = $1
        AND pa.branch_id = $2
        AND pa.variant_id = $3
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
        AND pv.status = 'active'
        AND p.status = 'active'
        AND (p.category_id IS NULL OR c.status = 'active')
      ORDER BY pa.id ASC
      LIMIT 1000
      FOR UPDATE OF pa`,
    [input.tenantId, input.branchId, input.variantId],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Releases already-expired reservation holds on locked assets using PostgreSQL time. The caller
 * owns the asset locks before entering this function, so two booking transactions cannot both
 * reclaim and allocate the same garment without serializing on the physical asset row.
 */
export async function releaseExpiredReservationHolds(
  client: PoolClient,
  input: { tenantId: string; branchId: string; assetIds: string[] },
): Promise<ExpiredReservationHoldRow[]> {
  if (input.assetIds.length === 0) return [];

  const expired = await client.query<{ reservation_id: string }>(
    `SELECT r.id AS reservation_id
       FROM reservation r
      WHERE r.tenant_id = $1
        AND r.branch_id = $2
        AND r.status = 'held'
        AND r.hold_expires_at IS NOT NULL
        AND r.hold_expires_at <= statement_timestamp()
        AND EXISTS (
          SELECT 1
            FROM reservation_line rl
            JOIN asset_allocation aa
              ON aa.tenant_id = rl.tenant_id
             AND aa.reservation_line_id = rl.id
           WHERE rl.tenant_id = r.tenant_id
             AND rl.reservation_id = r.id
             AND aa.branch_id = $2
             AND aa.asset_id = ANY($3::uuid[])
             AND aa.kind = 'reservation_hold'
             AND aa.is_blocking = true
        )
      ORDER BY r.id ASC
      FOR UPDATE OF r`,
    [input.tenantId, input.branchId, input.assetIds],
  );
  const reservationIds = expired.rows.map((row) => row.reservation_id);
  if (reservationIds.length === 0) return [];

  await client.query(
    `UPDATE asset_allocation aa
        SET is_blocking = false,
            released_at = statement_timestamp()
       FROM reservation_line rl
      WHERE aa.tenant_id = $1
        AND aa.branch_id = $2
        AND aa.reservation_line_id = rl.id
        AND rl.tenant_id = aa.tenant_id
        AND rl.reservation_id = ANY($3::uuid[])
        AND aa.kind = 'reservation_hold'
        AND aa.is_blocking = true`,
    [input.tenantId, input.branchId, reservationIds],
  );

  const updated = await client.query<ExpiredReservationHoldRow>(
    `UPDATE reservation
        SET status = 'expired',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = ANY($3::uuid[])
        AND status = 'held'
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at <= statement_timestamp()
      RETURNING id AS reservation_id, version`,
    [input.tenantId, input.branchId, reservationIds],
  );
  return updated.rows;
}

/** Chooses the first locked asset that is still free for the exact authoritative buffered range. */
export async function chooseAvailableLockedAsset(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    variantId: string;
    assetIds: string[];
    blockedStart: string;
    blockedEnd: string;
  },
): Promise<string | null> {
  if (input.assetIds.length === 0) return null;
  const result = await client.query<{ id: string }>(
    `SELECT pa.id
       FROM physical_asset pa
      WHERE pa.tenant_id = $1
        AND pa.branch_id = $2
        AND pa.variant_id = $3
        AND pa.id = ANY($4::uuid[])
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
           WHERE aa.tenant_id = pa.tenant_id
             AND aa.branch_id = pa.branch_id
             AND aa.asset_id = pa.id
             AND aa.is_blocking = true
             AND aa.period && tstzrange($5::timestamptz, $6::timestamptz, '[)')
        )
      ORDER BY pa.id ASC
      LIMIT 1`,
    [
      input.tenantId,
      input.branchId,
      input.variantId,
      input.assetIds,
      input.blockedStart,
      input.blockedEnd,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function readReservationCustomerForCreate(
  client: PoolClient,
  input: { tenantId: string; customerId: string },
): Promise<ReservationCustomerSnapshotRow | null> {
  const result = await client.query<ReservationCustomerSnapshotRow>(
    `SELECT id, full_name, phone, lower(email) AS email,
            nullif(btrim(address), '') AS address
       FROM customer
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND anonymized_at IS NULL
        AND archived_at IS NULL
        AND (phone IS NOT NULL OR email IS NOT NULL)
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.customerId],
  );
  return result.rows[0] ?? null;
}

export async function createReservationCustomer(
  client: PoolClient,
  input: {
    tenantId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    address: string;
    socialMedia: string | null;
    notes: string | null;
  },
): Promise<ReservationCustomerSnapshotRow> {
  const result = await client.query<ReservationCustomerSnapshotRow>(
    `INSERT INTO customer (tenant_id, full_name, phone, email, address, social_media, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, full_name, phone, lower(email) AS email, address`,
    [
      input.tenantId,
      input.fullName,
      input.phone,
      input.email,
      input.address,
      input.socialMedia,
      input.notes,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Reservation customer insert returned no row.');
  return row;
}

export async function fillReservationCustomerAddress(
  client: PoolClient,
  input: { tenantId: string; customerId: string; address: string },
): Promise<string | null> {
  const result = await client.query<{ address: string }>(
    `UPDATE customer
        SET address = $3
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND nullif(btrim(address), '') IS NULL
      RETURNING address`,
    [input.tenantId, input.customerId, input.address],
  );
  return result.rows[0]?.address ?? null;
}

export async function createReservationGraph(
  client: PoolClient,
  input: {
    reservationId: string;
    reservationLineId: string;
    allocationId: string;
    paymentId: string;
    tenantId: string;
    branchId: string;
    customerId: string | null;
    storefrontId: string;
    policySnapshotId: string;
    paymentMethodId: string;
    referenceCode: string;
    eventDate: string | null;
    pickupAt: string;
    dueAt: string;
    timezoneSnapshot: string;
    customerSnapshot: Record<string, unknown> | null;
    deliverySnapshot: Record<string, unknown>;
    priceSnapshot: Record<string, unknown>;
    rentalTotalMinor: number;
    securityRequiredMinor: number;
    dueNowMinor: number;
    variantId: string;
    lineNameSnapshot: string;
    measurementsSnapshot: Record<string, number>;
    pricingSnapshot: Record<string, unknown>;
    assetId: string;
    blockedStart: string;
    blockedEnd: string;
  },
): Promise<CreatedReservationGraphRow> {
  const reservation = await client.query<{
    id: string;
    hold_expires_at: Date;
    version: number;
    created_at: Date;
  }>(
    `INSERT INTO reservation
       (id, tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id,
        payment_method_id, reference_code, status, event_date, pickup_at, due_at,
        timezone_snapshot, customer_snapshot, delivery_snapshot, price_snapshot, currency,
        rental_total_minor, security_required_minor, due_now_minor, hold_acquired_at,
        hold_expires_at, version)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, 'held', $9::date, $10::timestamptz,
        $11::timestamptz, $12, $13::jsonb, $14::jsonb, $15::jsonb, 'PHP',
        $16, $17, $18, statement_timestamp(), statement_timestamp() + interval '15 minutes', 1)
     RETURNING id, hold_expires_at, version, created_at`,
    [
      input.reservationId,
      input.tenantId,
      input.branchId,
      input.customerId,
      input.storefrontId,
      input.policySnapshotId,
      input.paymentMethodId,
      input.referenceCode,
      input.eventDate,
      input.pickupAt,
      input.dueAt,
      input.timezoneSnapshot,
      input.customerSnapshot === null ? null : JSON.stringify(input.customerSnapshot),
      JSON.stringify(input.deliverySnapshot),
      JSON.stringify(input.priceSnapshot),
      input.rentalTotalMinor,
      input.securityRequiredMinor,
      input.dueNowMinor,
    ],
  );

  if (input.dueNowMinor > 0) {
    await client.query(
      `INSERT INTO payment
         (id, tenant_id, reservation_id, payment_method_id, amount_minor, currency,
          status, business_key)
       VALUES ($1, $2, $3, $4, $5, 'PHP', 'pending', $6)`,
      [
        input.paymentId,
        input.tenantId,
        input.reservationId,
        input.paymentMethodId,
        input.dueNowMinor,
        `reservation:${input.reservationId}:initial-payment`,
      ],
    );
  }

  await client.query(
    `INSERT INTO reservation_line
       (id, tenant_id, reservation_id, variant_id, line_number, name_snapshot,
        measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
     VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, $7::jsonb, $8, $9, 'PHP')`,
    [
      input.reservationLineId,
      input.tenantId,
      input.reservationId,
      input.variantId,
      input.lineNameSnapshot,
      JSON.stringify(input.measurementsSnapshot),
      JSON.stringify(input.pricingSnapshot),
      input.rentalTotalMinor,
      input.securityRequiredMinor,
    ],
  );

  await client.query(
    `INSERT INTO asset_allocation
       (id, tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
     VALUES ($1, $2, $3, $4, $5, 'reservation_hold',
             tstzrange($6::timestamptz, $7::timestamptz, '[)'), true)`,
    [
      input.allocationId,
      input.tenantId,
      input.branchId,
      input.assetId,
      input.reservationLineId,
      input.blockedStart,
      input.blockedEnd,
    ],
  );

  const row = reservation.rows[0];
  if (!row) throw new Error('Reservation insert returned no row.');
  return {
    reservation_id: row.id,
    reservation_line_id: input.reservationLineId,
    allocation_id: input.allocationId,
    payment_id: input.dueNowMinor > 0 ? input.paymentId : null,
    hold_expires_at: row.hold_expires_at,
    version: row.version,
    created_at: row.created_at,
  };
}

export async function appendReservationAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKind: 'staff' | 'system';
    actorKey: string;
    action: string;
    entityType: string;
    entityId: string;
    redactedSummary: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::jsonb, $8, statement_timestamp(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKind,
      input.actorKey,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.redactedSummary),
      input.requestId,
    ],
  );
}

export async function appendReservationOutboxEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    dedupeKey: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.tenantId, input.dedupeKey, input.eventType, JSON.stringify(input.payload)],
  );
}
