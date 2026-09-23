import type { PoolClient } from 'pg';

export interface LockedReservationReviewRow {
  reservation_id: string;
  status:
    | 'held'
    | 'pending_confirmation'
    | 'confirmed'
    | 'picked_up'
    | 'returned'
    | 'completed'
    | 'cancelled'
    | 'expired'
    | 'rejected';
  version: number;
  customer_snapshot: Record<string, unknown> | null;
  hold_acquired_at: Date;
  hold_expires_at: Date | null;
  pickup_at: Date;
  due_at: Date;
  due_now_minor: number;
  currency: string;
  database_now: Date;
}

export interface LockedReservationPaymentRow {
  payment_id: string;
  payment_method_id: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  amount_minor: number;
  currency: string;
  status: 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded';
  merchant_reference: string | null;
  verified_at: Date | null;
}

export interface LockedReservationReceiptRow {
  receipt_id: string;
  payment_id: string;
  evidence_status: 'uploaded' | 'under_review' | 'verified' | 'rejected' | 'superseded';
  submitted_at: Date;
  file_id: string;
  file_purpose: string;
  file_lifecycle_status: string;
  file_is_private: boolean;
  file_frozen_at: Date | null;
  file_version_id: string | null;
  file_sha256: string | null;
}

export interface ReservationVerificationRow {
  verification_id: string;
  decision: 'verified' | 'rejected' | 'ask_info';
  verified_amount_minor: number | null;
  decided_at: Date;
}

export interface LockedReservationAllocationRow {
  allocation_id: string;
  asset_id: string;
  kind: 'reservation_hold' | 'reservation_confirmed';
  is_blocking: boolean;
  blocked_start: Date;
  blocked_end: Date;
}

export interface ReservationMutationSummaryRow {
  reservation_id: string;
  reference_code: string;
  status: LockedReservationReviewRow['status'];
  branch_id: string;
  storefront_id: string;
  variant_id: string;
  payment_method_id: string;
  fulfillment_method: 'pickup' | 'delivery';
  pickup_at: Date;
  due_at: Date;
  timezone_snapshot: string;
  event_date: string | null;
  rental_total_minor: number;
  security_required_minor: number;
  due_now_minor: number;
  currency: string;
  hold_expires_at: Date | null;
  version: number;
  created_at: Date;
}

/** First lock in the Phase-3 order: reservation header and optimistic version. */
export async function lockReservationForReview(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string },
): Promise<LockedReservationReviewRow | null> {
  const result = await client.query<LockedReservationReviewRow>(
    `SELECT
       r.id AS reservation_id,
       r.status,
       r.version,
       r.customer_snapshot,
       r.hold_acquired_at,
       r.hold_expires_at,
       r.pickup_at,
       r.due_at,
       r.due_now_minor,
       r.currency,
       statement_timestamp() AS database_now
     FROM reservation r
     WHERE r.tenant_id = $1
       AND r.branch_id = $2
       AND r.id = $3::uuid
     LIMIT 1
     FOR UPDATE OF r`,
    [input.tenantId, input.branchId, input.reservationId],
  );
  return result.rows[0] ?? null;
}

/** Second lock: the canonical initial payment intent created atomically with the hold. */
export async function lockReservationPaymentForReview(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<LockedReservationPaymentRow | null> {
  const result = await client.query<LockedReservationPaymentRow>(
    `SELECT
       p.id AS payment_id,
       p.payment_method_id,
       pm.rail,
       p.amount_minor,
       p.currency,
       p.status,
       p.merchant_reference,
       p.verified_at
     FROM payment p
     JOIN payment_method pm
       ON pm.tenant_id = p.tenant_id
      AND pm.id = p.payment_method_id
     WHERE p.tenant_id = $1
       AND p.reservation_id = $2::uuid
       AND p.business_key = ('reservation:' || $2::text || ':initial-payment')
     LIMIT 1
     FOR UPDATE OF p`,
    [input.tenantId, input.reservationId],
  );
  return result.rows[0] ?? null;
}

/** Third lock: latest evidence for the locked payment, with immutable file acceptance facts. */
export async function lockLatestReservationReceipt(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<LockedReservationReceiptRow | null> {
  const result = await client.query<LockedReservationReceiptRow>(
    `SELECT
       pr.id AS receipt_id,
       pr.payment_id,
       pr.evidence_status,
       pr.submitted_at,
       fo.id AS file_id,
       fo.purpose AS file_purpose,
       fo.lifecycle_status AS file_lifecycle_status,
       fo.is_private AS file_is_private,
       fo.frozen_at AS file_frozen_at,
       fo.version_id AS file_version_id,
       fo.sha256 AS file_sha256
     FROM payment_receipt pr
     JOIN file_object fo
       ON fo.tenant_id = pr.tenant_id
      AND fo.id = pr.file_id
     WHERE pr.tenant_id = $1
       AND pr.payment_id = $2::uuid
     ORDER BY pr.submitted_at DESC, pr.id DESC
     LIMIT 1
     FOR UPDATE OF pr`,
    [input.tenantId, input.paymentId],
  );
  return result.rows[0] ?? null;
}

/** Immutable finance authority consumed by RSV-031; payment verification itself remains Finance-owned. */
export async function readLatestReservationVerification(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<ReservationVerificationRow | null> {
  const result = await client.query<ReservationVerificationRow>(
    `SELECT
       pv.id AS verification_id,
       pv.decision,
       pv.verified_amount_minor,
       pv.decided_at
     FROM payment_verification pv
     WHERE pv.tenant_id = $1
       AND pv.payment_id = $2::uuid
     ORDER BY pv.decided_at DESC, pv.id DESC
     LIMIT 1
     FOR UPDATE OF pv`,
    [input.tenantId, input.paymentId],
  );
  return result.rows[0] ?? null;
}

/** Final lock in the documented order: allocation rows and physical assets, sorted by asset UUID. */
export async function lockReservationAllocationsForReview(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string },
): Promise<LockedReservationAllocationRow[]> {
  const result = await client.query<LockedReservationAllocationRow>(
    `SELECT
       aa.id AS allocation_id,
       aa.asset_id,
       aa.kind,
       aa.is_blocking,
       lower(aa.period) AS blocked_start,
       upper(aa.period) AS blocked_end
     FROM reservation_line rl
     JOIN asset_allocation aa
       ON aa.tenant_id = rl.tenant_id
      AND aa.reservation_line_id = rl.id
     JOIN physical_asset pa
       ON pa.tenant_id = aa.tenant_id
      AND pa.id = aa.asset_id
     WHERE rl.tenant_id = $1
       AND rl.reservation_id = $2::uuid
       AND aa.branch_id = $3::uuid
       AND aa.reservation_line_id IS NOT NULL
     ORDER BY pa.id ASC, aa.id ASC
     FOR UPDATE OF pa, aa`,
    [input.tenantId, input.reservationId, input.branchId],
  );
  return result.rows;
}

export async function bindReservationCustomerForSubmit(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    reservationId: string;
    version: number;
    customerId: string;
    customerSnapshot: Record<string, unknown>;
  },
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `UPDATE reservation
        SET customer_id = $5::uuid,
            customer_snapshot = $6::jsonb
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status = 'held'
        AND version = $4
        AND customer_id IS NULL
        AND customer_snapshot IS NULL
      RETURNING id`,
    [
      input.tenantId,
      input.branchId,
      input.reservationId,
      input.version,
      input.customerId,
      JSON.stringify(input.customerSnapshot),
    ],
  );
  return result.rowCount === 1;
}

export async function markReceiptUnderReview(
  client: PoolClient,
  input: { tenantId: string; receiptId: string },
): Promise<void> {
  await client.query(
    `UPDATE payment_receipt
        SET evidence_status = 'under_review'
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND evidence_status = 'uploaded'`,
    [input.tenantId, input.receiptId],
  );
}

export async function submitReservationForReview(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'pending_confirmation',
            terms_accepted_at = statement_timestamp(),
            submitted_at = statement_timestamp(),
            hold_expires_at = LEAST(hold_acquired_at + interval '24 hours', pickup_at),
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status = 'held'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function confirmReservationReview(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'confirmed',
            confirmed_at = statement_timestamp(),
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status = 'pending_confirmation'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

/** Confirmation changes only allocation kind; the original [) period and blocking flag are preserved. */
export async function markReservationAllocationsConfirmed(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE asset_allocation aa
        SET kind = 'reservation_confirmed'
       FROM reservation_line rl
      WHERE aa.tenant_id = $1
        AND rl.tenant_id = aa.tenant_id
        AND rl.reservation_id = $2::uuid
        AND aa.reservation_line_id = rl.id
        AND aa.kind = 'reservation_hold'
        AND aa.is_blocking = true`,
    [input.tenantId, input.reservationId],
  );
  return result.rowCount ?? 0;
}

export async function cancelReservationPreHandover(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'cancelled',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status IN ('held', 'pending_confirmation', 'confirmed')
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function rejectReservationReview(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'rejected',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status = 'pending_confirmation'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function releaseReservationAllocations(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE asset_allocation aa
        SET is_blocking = false,
            released_at = statement_timestamp()
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

/** Request-time expiry makes correctness independent of the periodic cleanup worker. */
export async function expireReservationReview(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'expired',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status IN ('held', 'pending_confirmation')
        AND version = $4
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at <= statement_timestamp()
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function readReservationMutationSummary(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string },
): Promise<ReservationMutationSummaryRow | null> {
  const result = await client.query<ReservationMutationSummaryRow>(
    `SELECT
       r.id AS reservation_id,
       r.reference_code,
       r.status,
       r.branch_id,
       r.storefront_id,
       line.variant_id,
       r.payment_method_id,
       r.delivery_snapshot ->> 'fulfillment_method' AS fulfillment_method,
       r.pickup_at,
       r.due_at,
       r.timezone_snapshot,
       r.event_date::date::text AS event_date,
       r.rental_total_minor,
       r.security_required_minor,
       r.due_now_minor,
       r.currency,
       r.hold_expires_at,
       r.version,
       r.created_at
     FROM reservation r
     JOIN LATERAL (
       SELECT rl.variant_id
       FROM reservation_line rl
       WHERE rl.tenant_id = r.tenant_id
         AND rl.reservation_id = r.id
       ORDER BY rl.line_number ASC, rl.id ASC
       LIMIT 1
     ) line ON true
     WHERE r.tenant_id = $1
       AND r.branch_id = $2
       AND r.id = $3::uuid
     LIMIT 1`,
    [input.tenantId, input.branchId, input.reservationId],
  );
  return result.rows[0] ?? null;
}
