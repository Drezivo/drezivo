import type { PoolClient } from 'pg';

/** Booking facts an edit recomputes from, read after the reservation row is locked. */
export interface ReservationEditFactsRow {
  policy_snapshot_id: string;
  payment_method_id: string;
  timezone_snapshot: string;
  event_date: string | null;
  customer_snapshot: Record<string, unknown> | null;
  delivery_snapshot: Record<string, unknown>;
  price_snapshot: Record<string, unknown>;
  rental_total_minor: number;
  security_required_minor: number;
  due_now_minor: number;
  delivery_rules: Record<string, unknown>;
}

export async function readReservationEditFacts(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<ReservationEditFactsRow | null> {
  const result = await client.query<ReservationEditFactsRow>(
    `SELECT r.policy_snapshot_id, r.payment_method_id, r.timezone_snapshot, r.event_date::text AS event_date,
            r.customer_snapshot, r.delivery_snapshot, r.price_snapshot,
            r.rental_total_minor, r.security_required_minor, r.due_now_minor,
            ps.delivery_rules
       FROM reservation r
       JOIN policy_snapshot ps ON ps.tenant_id = r.tenant_id AND ps.id = r.policy_snapshot_id
      WHERE r.tenant_id = $1 AND r.id = $2::uuid`,
    [input.tenantId, input.reservationId],
  );
  return result.rows[0] ?? null;
}

export interface ReservationEditLineRow {
  id: string;
  variant_id: string;
  line_number: number;
  pricing_snapshot: Record<string, unknown>;
  rental_minor: number;
  deposit_minor: number;
}

export async function readReservationLinesForEdit(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<ReservationEditLineRow[]> {
  const result = await client.query<ReservationEditLineRow>(
    `SELECT id, variant_id, line_number, pricing_snapshot, rental_minor, deposit_minor
       FROM reservation_line
      WHERE tenant_id = $1 AND reservation_id = $2::uuid
      ORDER BY line_number ASC`,
    [input.tenantId, input.reservationId],
  );
  return result.rows;
}

/**
 * Stops this reservation's allocations from blocking, so its own garments count as free while new
 * dates are matched. Rows stay in place and are re-blocked by `rebookReservationLineAllocation`
 * in the same transaction, so each line keeps exactly one allocation row.
 */
export async function unblockReservationAllocationsForEdit(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE asset_allocation aa
        SET is_blocking = false
       FROM reservation_line rl
      WHERE aa.tenant_id = $1
        AND rl.tenant_id = aa.tenant_id
        AND rl.reservation_id = $2::uuid
        AND aa.reservation_line_id = rl.id
        AND aa.is_blocking = true`,
    [input.tenantId, input.reservationId],
  );
  return result.rowCount ?? 0;
}

/** Points a line's allocation at the chosen garment and period and makes it blocking again. */
export async function rebookReservationLineAllocation(
  client: PoolClient,
  input: { tenantId: string; reservationLineId: string; assetId: string; blockedStart: string; blockedEnd: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE asset_allocation
        SET asset_id = $3::uuid,
            period = tstzrange($4::timestamptz, $5::timestamptz, '[)'),
            is_blocking = true
      WHERE tenant_id = $1
        AND reservation_line_id = $2::uuid
        AND is_blocking = false
        AND released_at IS NULL`,
    [input.tenantId, input.reservationLineId, input.assetId, input.blockedStart, input.blockedEnd],
  );
  return result.rowCount === 1;
}

export async function updateReservationLinePricing(
  client: PoolClient,
  input: { tenantId: string; reservationLineId: string; rentalMinor: number; pricingSnapshot: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `UPDATE reservation_line
        SET rental_minor = $3, pricing_snapshot = $4::jsonb
      WHERE tenant_id = $1 AND id = $2::uuid`,
    [input.tenantId, input.reservationLineId, input.rentalMinor, JSON.stringify(input.pricingSnapshot)],
  );
}

/**
 * Writes the edited booking facts with the optimistic version guard. Returns the new version, or
 * null when another change won the race.
 */
export async function applyReservationEdit(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    reservationId: string;
    version: number;
    pickupAt: string;
    dueAt: string;
    eventDate: string | null;
    customerSnapshot: Record<string, unknown> | null;
    deliverySnapshot: Record<string, unknown>;
    priceSnapshot: Record<string, unknown>;
    rentalTotalMinor: number;
    securityRequiredMinor: number;
    dueNowMinor: number;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET pickup_at = $5::timestamptz,
            due_at = $6::timestamptz,
            event_date = $7::date,
            customer_snapshot = $8::jsonb,
            delivery_snapshot = $9::jsonb,
            price_snapshot = $10::jsonb,
            rental_total_minor = $11,
            due_now_minor = $12,
            security_required_minor = $13,
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND version = $4
        AND status IN ('held', 'pending_confirmation', 'confirmed')
      RETURNING version`,
    [
      input.tenantId,
      input.branchId,
      input.reservationId,
      input.version,
      input.pickupAt,
      input.dueAt,
      input.eventDate,
      input.customerSnapshot === null ? null : JSON.stringify(input.customerSnapshot),
      JSON.stringify(input.deliverySnapshot),
      JSON.stringify(input.priceSnapshot),
      input.rentalTotalMinor,
      input.dueNowMinor,
      input.securityRequiredMinor,
    ],
  );
  return result.rows[0]?.version ?? null;
}

/** Moves an unpaid payment intent to the new total; verified money is never rewritten. */
export async function updatePendingReservationPaymentAmount(
  client: PoolClient,
  input: { tenantId: string; paymentId: string; amountMinor: number },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE payment
        SET amount_minor = $3
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND status = 'pending'
        AND verified_at IS NULL`,
    [input.tenantId, input.paymentId, input.amountMinor],
  );
  return result.rowCount === 1;
}

/** Lines a late-return alert refers to; removing them would erase that record. */
export async function readLinesWithDisruptions(
  client: PoolClient,
  input: { tenantId: string; lineIds: string[] },
): Promise<string[]> {
  if (input.lineIds.length === 0) return [];
  const result = await client.query<{ reservation_line_id: string }>(
    `SELECT DISTINCT reservation_line_id FROM disruption
      WHERE tenant_id = $1 AND reservation_line_id = ANY($2::uuid[])`,
    [input.tenantId, input.lineIds],
  );
  return result.rows.map((row) => row.reservation_line_id);
}

/**
 * Removes garments before handover: their allocations and lines. Only called for reservations that
 * were never picked up and for lines no disruption refers to, so nothing else points at them.
 */
export async function deleteReservationLinesForEdit(
  client: PoolClient,
  input: { tenantId: string; reservationId: string; lineIds: string[] },
): Promise<number> {
  if (input.lineIds.length === 0) return 0;
  await client.query(`DELETE FROM asset_allocation WHERE tenant_id = $1 AND reservation_line_id = ANY($2::uuid[])`, [
    input.tenantId,
    input.lineIds,
  ]);
  const removed = await client.query(
    `DELETE FROM reservation_line WHERE tenant_id = $1 AND reservation_id = $2::uuid AND id = ANY($3::uuid[])`,
    [input.tenantId, input.reservationId, input.lineIds],
  );
  return removed.rowCount ?? 0;
}

/**
 * Numbers the lines 1..n in the given order. Lines first move to a negative range so the unique
 * (reservation, line number) key never sees two lines with the same number mid-update.
 */
export async function renumberReservationLines(
  client: PoolClient,
  input: { tenantId: string; reservationId: string; orderedLineIds: string[] },
): Promise<void> {
  await client.query(
    `UPDATE reservation_line SET line_number = -line_number WHERE tenant_id = $1 AND reservation_id = $2::uuid`,
    [input.tenantId, input.reservationId],
  );
  await client.query(
    `UPDATE reservation_line rl
        SET line_number = ordered.position
       FROM unnest($3::uuid[]) WITH ORDINALITY AS ordered(id, position)
      WHERE rl.tenant_id = $1 AND rl.reservation_id = $2::uuid AND rl.id = ordered.id`,
    [input.tenantId, input.reservationId, input.orderedLineIds],
  );
}
