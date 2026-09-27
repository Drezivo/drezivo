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
  terms_accepted_at: Date | null;
  confirmed_at: Date | null;
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
  reservation_line_id: string;
  asset_id: string;
  asset_branch_id: string;
  asset_lifecycle_status: 'active' | 'retired' | 'lost';
  asset_readiness: 'ready' | 'needs_cleaning' | 'needs_repair' | 'unready';
  asset_recovery_managed_readiness: boolean;
  asset_custody_kind: 'at_branch' | 'with_customer' | 'in_transit';
  asset_version: number;
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
       r.terms_accepted_at,
       r.confirmed_at,
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
       aa.reservation_line_id,
       aa.asset_id,
       pa.branch_id AS asset_branch_id,
       pa.lifecycle_status AS asset_lifecycle_status,
       pa.readiness AS asset_readiness,
       pa.recovery_managed_readiness AS asset_recovery_managed_readiness,
       pa.custody_kind AS asset_custody_kind,
       pa.version AS asset_version,
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

export async function attachAcceptedReservationReceipt(
  client: PoolClient,
  input: { tenantId: string; paymentId: string; fileId: string },
): Promise<{ receipt_id: string; payment_id: string } | null> {
  const file = await client.query<{ id: string }>(
    `SELECT id
       FROM file_object
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND purpose = 'payment_receipt'
        AND lifecycle_status = 'accepted'
        AND is_private = true
        AND frozen_at IS NOT NULL
        AND (version_id IS NOT NULL OR sha256 IS NOT NULL)
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.fileId],
  );
  if (!file.rows[0]) return null;

  const existing = await client.query<{ receipt_id: string; payment_id: string }>(
    `SELECT id AS receipt_id, payment_id
       FROM payment_receipt
      WHERE tenant_id = $1
        AND payment_id = $2::uuid
        AND file_id = $3::uuid
      ORDER BY submitted_at DESC, id DESC
      LIMIT 1`,
    [input.tenantId, input.paymentId, input.fileId],
  );
  if (existing.rows[0]) return existing.rows[0];

  await client.query(
    `UPDATE payment_receipt
        SET evidence_status = 'superseded'
      WHERE tenant_id = $1
        AND payment_id = $2::uuid
        AND evidence_status IN ('uploaded', 'under_review')`,
    [input.tenantId, input.paymentId],
  );

  const inserted = await client.query<{ receipt_id: string; payment_id: string }>(
    `INSERT INTO payment_receipt (tenant_id, payment_id, file_id, evidence_status, submitted_at)
     VALUES ($1, $2::uuid, $3::uuid, 'uploaded', statement_timestamp())
     RETURNING id AS receipt_id, payment_id`,
    [input.tenantId, input.paymentId, input.fileId],
  );
  return inserted.rows[0] ?? null;
}

export async function verifyReservationPaymentCollection(
  client: PoolClient,
  input: {
    tenantId: string;
    paymentId: string;
    merchantReference: string | null;
  },
): Promise<Date | null> {
  const result = await client.query<{ verified_at: Date }>(
    `UPDATE payment
        SET status = 'paid',
            verified_at = statement_timestamp(),
            merchant_reference = COALESCE($3, merchant_reference)
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND status IN ('pending', 'partially_paid')
        AND verified_at IS NULL
      RETURNING verified_at`,
    [input.tenantId, input.paymentId, input.merchantReference],
  );
  return result.rows[0]?.verified_at ?? null;
}

export async function insertReservationPaymentVerification(
  client: PoolClient,
  input: {
    tenantId: string;
    paymentId: string;
    membershipId: string;
    verifiedAmountMinor: number;
    cashTenderedMinor?: number | null;
    changeDueMinor?: number | null;
    evidenceNote: string;
  },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO payment_verification
       (tenant_id, payment_id, verifier_membership_id, decision,
        verified_amount_minor, cash_tendered_minor, change_due_minor, evidence_note, business_key)
     VALUES ($1, $2::uuid, $3::uuid, 'verified', $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, business_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.paymentId,
      input.membershipId,
      input.verifiedAmountMinor,
      input.cashTenderedMinor ?? null,
      input.changeDueMinor ?? null,
      input.evidenceNote,
      `reservation-payment-verified:${input.paymentId}`,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function markReservationReceiptVerified(
  client: PoolClient,
  input: { tenantId: string; receiptId: string },
): Promise<void> {
  await client.query(
    `UPDATE payment_receipt
        SET evidence_status = 'verified'
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND evidence_status IN ('uploaded', 'under_review')`,
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
            hold_expires_at = GREATEST(
              hold_expires_at,
              LEAST(hold_acquired_at + interval '24 hours', pickup_at)
            ),
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

export async function pickupReservationHandover(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'picked_up',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status = 'confirmed'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function markPhysicalAssetPickedUp(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    assetVersion: number;
  },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE physical_asset
        SET custody_kind = 'with_customer',
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1
        AND branch_id = $2::uuid
        AND id = $3::uuid
        AND lifecycle_status = 'active'
        AND readiness = 'ready'
        AND custody_kind = 'at_branch'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.assetId, input.assetVersion],
  );
  return result.rows[0]?.version ?? null;
}

export async function returnReservationCustody(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'returned',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2
        AND id = $3::uuid
        AND status = 'picked_up'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function markPhysicalAssetReturned(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    assetVersion: number;
    recoveryManagedReadiness: boolean;
    conditionNote?: string;
  },
): Promise<{ version: number; readiness: LockedReservationAllocationRow['asset_readiness'] } | null> {
  const result = await client.query<{
    version: number;
    readiness: LockedReservationAllocationRow['asset_readiness'];
  }>(
    `UPDATE physical_asset
        SET custody_kind = 'at_branch',
            readiness = CASE
              WHEN readiness IN ('needs_repair', 'unready') THEN readiness
              ELSE 'needs_cleaning'
            END,
            recovery_managed_readiness = CASE
              WHEN readiness IN ('needs_repair', 'unready') THEN false
              ELSE $5
            END,
            condition_note = COALESCE($6, condition_note),
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1
        AND branch_id = $2::uuid
        AND id = $3::uuid
        AND custody_kind = 'with_customer'
        AND version = $4
      RETURNING version, readiness`,
    [
      input.tenantId,
      input.branchId,
      input.assetId,
      input.assetVersion,
      input.recoveryManagedReadiness,
      input.conditionNote ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export interface ReservationSettlementState {
  pending_refund_count: number;
  outstanding_charge_minor: number;
  deposit_holding_minor: number;
}

export async function inspectReturnedPhysicalAsset(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    assetVersion: number;
    readiness: LockedReservationAllocationRow['asset_readiness'];
    recoveryManagedReadiness: boolean;
    conditionNote?: string;
  },
): Promise<{ version: number; readiness: LockedReservationAllocationRow['asset_readiness'] } | null> {
  const result = await client.query<{
    version: number;
    readiness: LockedReservationAllocationRow['asset_readiness'];
  }>(
    `UPDATE physical_asset
        SET readiness = $5,
            recovery_managed_readiness = $6,
            condition_note = COALESCE($7, condition_note),
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE tenant_id = $1
        AND branch_id = $2::uuid
        AND id = $3::uuid
        AND lifecycle_status = 'active'
        AND custody_kind = 'at_branch'
        AND version = $4
      RETURNING version, readiness`,
    [
      input.tenantId,
      input.branchId,
      input.assetId,
      input.assetVersion,
      input.readiness,
      input.recoveryManagedReadiness,
      input.conditionNote ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function truncateReturnedReservationRecovery(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; assetId: string },
): Promise<Date | null> {
  const result = await client.query<{ blocked_end: Date }>(
    `UPDATE asset_allocation aa
        SET period = tstzrange(
          lower(aa.period),
          LEAST(upper(aa.period), GREATEST(r.due_at, statement_timestamp())),
          '[)'
        )
       FROM reservation_line rl
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
      WHERE aa.tenant_id = $1
        AND aa.branch_id = $2::uuid
        AND aa.asset_id = $3::uuid
        AND aa.reservation_line_id = rl.id
        AND r.id = $4::uuid
        AND r.status = 'returned'
        AND aa.kind = 'reservation_confirmed'
        AND aa.is_blocking = true
      RETURNING upper(aa.period) AS blocked_end`,
    [input.tenantId, input.branchId, input.assetId, input.reservationId],
  );
  return result.rows[0]?.blocked_end ?? null;
}

export async function promoteRecoveryManagedReadinessIfDue(
  client: PoolClient,
  input: { tenantId: string; branchId: string; assetId: string; assetVersion: number },
): Promise<{ version: number; readiness: LockedReservationAllocationRow['asset_readiness'] } | null> {
  const result = await client.query<{
    version: number;
    readiness: LockedReservationAllocationRow['asset_readiness'];
  }>(
    `UPDATE physical_asset pa
        SET readiness = 'ready',
            recovery_managed_readiness = false,
            version = version + 1,
            updated_at = statement_timestamp()
      WHERE pa.tenant_id = $1
        AND pa.branch_id = $2::uuid
        AND pa.id = $3::uuid
        AND pa.version = $4
        AND pa.lifecycle_status = 'active'
        AND pa.custody_kind = 'at_branch'
        AND pa.readiness = 'needs_cleaning'
        AND pa.recovery_managed_readiness = true
        AND NOT EXISTS (
          SELECT 1
            FROM maintenance_work_order mwo
           WHERE mwo.tenant_id = pa.tenant_id
             AND mwo.branch_id = pa.branch_id
             AND mwo.asset_id = pa.id
             AND mwo.status = 'open'
        )
        AND EXISTS (
          SELECT 1
            FROM asset_allocation aa
            JOIN reservation_line rl
              ON rl.tenant_id = aa.tenant_id
             AND rl.id = aa.reservation_line_id
            JOIN reservation r
              ON r.tenant_id = rl.tenant_id
             AND r.id = rl.reservation_id
           WHERE aa.tenant_id = pa.tenant_id
             AND aa.branch_id = pa.branch_id
             AND aa.asset_id = pa.id
             AND aa.kind = 'reservation_confirmed'
             AND aa.is_blocking = true
             AND r.status = 'returned'
             AND upper(aa.period) <= statement_timestamp()
        )
        AND NOT EXISTS (
          SELECT 1
            FROM asset_allocation aa
            JOIN reservation_line rl
              ON rl.tenant_id = aa.tenant_id
             AND rl.id = aa.reservation_line_id
            JOIN reservation r
              ON r.tenant_id = rl.tenant_id
             AND r.id = rl.reservation_id
           WHERE aa.tenant_id = pa.tenant_id
             AND aa.branch_id = pa.branch_id
             AND aa.asset_id = pa.id
             AND aa.kind = 'reservation_confirmed'
             AND aa.is_blocking = true
             AND r.status = 'returned'
             AND r.due_at < upper(aa.period)
             AND upper(aa.period) > statement_timestamp()
        )
      RETURNING pa.version, pa.readiness`,
    [input.tenantId, input.branchId, input.assetId, input.assetVersion],
  );
  return result.rows[0] ?? null;
}

export async function lockOpenAssetMaintenance(
  client: PoolClient,
  input: { tenantId: string; branchId: string; assetId: string },
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM maintenance_work_order
      WHERE tenant_id = $1
        AND branch_id = $2::uuid
        AND asset_id = $3::uuid
        AND status = 'open'
      ORDER BY id
      FOR UPDATE`,
    [input.tenantId, input.branchId, input.assetId],
  );
  return result.rows.map((row) => row.id);
}

export async function readReservationSettlementState(
  client: PoolClient,
  input: { tenantId: string; reservationId: string; paymentId: string | null },
): Promise<ReservationSettlementState> {
  const refundResult = input.paymentId
    ? await client.query<{ status: string }>(
        `SELECT status
           FROM refund
          WHERE tenant_id = $1 AND payment_id = $2::uuid
          ORDER BY id
          FOR UPDATE`,
        [input.tenantId, input.paymentId],
      )
    : { rows: [] as Array<{ status: string }> };

  const charges = await client.query<{ id: string; kind: string; amount_minor: number; reverses_id: string | null }>(
    `SELECT id, kind, amount_minor, reverses_id
       FROM charge
      WHERE tenant_id = $1 AND reservation_id = $2::uuid
      ORDER BY id`,
    [input.tenantId, input.reservationId],
  );
  const allocations = input.paymentId
    ? await client.query<{ direction: string; amount_minor: number }>(
        `SELECT pa.direction, pa.amount_minor
           FROM payment_allocation pa
           JOIN charge c ON c.tenant_id = pa.tenant_id AND c.id = pa.charge_id
          WHERE pa.tenant_id = $1
            AND pa.payment_id = $2::uuid
            AND c.reservation_id = $3::uuid
          ORDER BY pa.id`,
        [input.tenantId, input.paymentId, input.reservationId],
      )
    : { rows: [] as Array<{ direction: string; amount_minor: number }> };
  const deposits = await client.query<{
    id: string;
    kind: string;
    amount_minor: number;
    reverses_id: string | null;
  }>(
    `SELECT id, kind, amount_minor, reverses_id
       FROM deposit_entry
      WHERE tenant_id = $1 AND reservation_id = $2::uuid
      ORDER BY id`,
    [input.tenantId, input.reservationId],
  );

  const chargeById = new Map(charges.rows.map((row) => [row.id, row]));
  const netCharges = charges.rows.reduce((total, row) => {
    if (row.reverses_id) {
      const target = chargeById.get(row.reverses_id);
      const targetSign = target?.kind === 'credit' ? -1 : 1;
      return total - targetSign * row.amount_minor;
    }
    return total + (row.kind === 'credit' ? -row.amount_minor : row.amount_minor);
  }, 0);
  const netAllocations = allocations.rows.reduce(
    (total, row) => total + (row.direction === 'apply' ? row.amount_minor : -row.amount_minor),
    0,
  );

  const depositById = new Map(deposits.rows.map((row) => [row.id, row]));
  const depositEffect = (kind: string, amount: number): number =>
    kind === 'receive' ? amount : kind === 'apply' || kind === 'release' ? -amount : 0;
  const depositHolding = deposits.rows.reduce((total, row) => {
    if (row.kind === 'reverse' && row.reverses_id) {
      const target = depositById.get(row.reverses_id);
      return total - (target ? depositEffect(target.kind, row.amount_minor) : 0);
    }
    return total + depositEffect(row.kind, row.amount_minor);
  }, 0);

  return {
    pending_refund_count: refundResult.rows.filter(
      (row) => row.status === 'requested' || row.status === 'processing',
    ).length,
    outstanding_charge_minor: Math.max(0, netCharges - netAllocations),
    deposit_holding_minor: Math.max(0, depositHolding),
  };
}

export async function completeReturnedReservation(
  client: PoolClient,
  input: { tenantId: string; branchId: string; reservationId: string; version: number },
): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    `UPDATE reservation
        SET status = 'completed',
            version = version + 1
      WHERE tenant_id = $1
        AND branch_id = $2::uuid
        AND id = $3::uuid
        AND status = 'returned'
        AND version = $4
      RETURNING version`,
    [input.tenantId, input.branchId, input.reservationId, input.version],
  );
  return result.rows[0]?.version ?? null;
}

export async function appendReturnCustodyEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    reservationLineId: string;
    actorMembershipId: string;
    businessKey: string;
    conditionSnapshot: Record<string, unknown>;
  },
): Promise<{ id: string; occurred_at: Date } | null> {
  const result = await client.query<{ id: string; occurred_at: Date }>(
    `INSERT INTO custody_event
       (tenant_id, branch_id, asset_id, reservation_line_id, actor_membership_id,
        event_kind, occurred_at, condition_snapshot, business_key)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             'return', statement_timestamp(), $6::jsonb, $7)
     ON CONFLICT (tenant_id, business_key) DO NOTHING
     RETURNING id, occurred_at`,
    [
      input.tenantId,
      input.branchId,
      input.assetId,
      input.reservationLineId,
      input.actorMembershipId,
      JSON.stringify(input.conditionSnapshot),
      input.businessKey,
    ],
  );
  return result.rows[0] ?? null;
}

export async function createOrUpdateReturnDisruptions(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    currentReservationLineId: string;
    custodyEventId: string;
    occurredAt: Date;
  },
): Promise<number> {
  const reason = 'Returned garment remained unavailable after the next reservation allocation window had started.';
  const updated = await client.query<{ id: string }>(
    `UPDATE disruption d
        SET cause_custody_event_id = COALESCE(d.cause_custody_event_id, $5::uuid),
            reason = $6
       FROM asset_allocation aa
       JOIN reservation_line rl
         ON rl.tenant_id = aa.tenant_id
        AND rl.id = aa.reservation_line_id
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
      WHERE d.tenant_id = $1
        AND d.asset_id = $3::uuid
        AND d.status = 'open'
        AND d.reservation_line_id = aa.reservation_line_id
        AND aa.tenant_id = $1
        AND aa.branch_id = $2::uuid
        AND aa.asset_id = $3::uuid
        AND aa.reservation_line_id IS NOT NULL
        AND aa.reservation_line_id <> $4::uuid
        AND aa.is_blocking = true
        AND aa.kind IN ('reservation_hold', 'reservation_confirmed')
        AND r.status IN ('held', 'pending_confirmation', 'confirmed')
        AND lower(aa.period) <= $7::timestamptz
      RETURNING d.id`,
    [
      input.tenantId,
      input.branchId,
      input.assetId,
      input.currentReservationLineId,
      input.custodyEventId,
      reason,
      input.occurredAt,
    ],
  );

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO disruption
       (tenant_id, asset_id, reservation_line_id, cause_custody_event_id,
        reason, status, resolved_at, created_at)
     SELECT
       aa.tenant_id,
       aa.asset_id,
       aa.reservation_line_id,
       $5::uuid,
       $6,
       'open',
       NULL,
       statement_timestamp()
       FROM asset_allocation aa
       JOIN reservation_line rl
         ON rl.tenant_id = aa.tenant_id
        AND rl.id = aa.reservation_line_id
       JOIN reservation r
         ON r.tenant_id = rl.tenant_id
        AND r.id = rl.reservation_id
      WHERE aa.tenant_id = $1
        AND aa.branch_id = $2::uuid
        AND aa.asset_id = $3::uuid
        AND aa.reservation_line_id IS NOT NULL
        AND aa.reservation_line_id <> $4::uuid
        AND aa.is_blocking = true
        AND aa.kind IN ('reservation_hold', 'reservation_confirmed')
        AND r.status IN ('held', 'pending_confirmation', 'confirmed')
        AND lower(aa.period) <= $7::timestamptz
        AND NOT EXISTS (
          SELECT 1
            FROM disruption d
           WHERE d.tenant_id = aa.tenant_id
             AND d.asset_id = aa.asset_id
             AND d.reservation_line_id = aa.reservation_line_id
             AND d.status = 'open'
        )
     RETURNING id`,
    [
      input.tenantId,
      input.branchId,
      input.assetId,
      input.currentReservationLineId,
      input.custodyEventId,
      reason,
      input.occurredAt,
    ],
  );
  return (updated.rowCount ?? 0) + (inserted.rowCount ?? 0);
}

export async function appendPickupCustodyEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    assetId: string;
    reservationLineId: string;
    actorMembershipId: string;
    businessKey: string;
    conditionSnapshot: Record<string, unknown>;
  },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO custody_event
       (tenant_id, branch_id, asset_id, reservation_line_id, actor_membership_id,
        event_kind, occurred_at, condition_snapshot, business_key)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             'pickup', statement_timestamp(), $6::jsonb, $7)
     ON CONFLICT (tenant_id, business_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.branchId,
      input.assetId,
      input.reservationLineId,
      input.actorMembershipId,
      JSON.stringify(input.conditionSnapshot),
      input.businessKey,
    ],
  );
  return result.rows[0]?.id ?? null;
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
