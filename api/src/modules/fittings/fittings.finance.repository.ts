import type { PoolClient } from 'pg';

export interface LockedFittingFinanceRow {
  fitting_id: string;
  status: 'pending' | 'confirmed' | 'completed' | 'rejected' | 'cancelled' | 'no_show';
  fee_minor: number;
  currency: string;
  version: number;
}

export interface FittingFeeChargeRow {
  charge_id: string;
  amount_minor: number;
  currency: string;
}

export interface FittingPaymentMethodRow {
  payment_method_id: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
}

export interface LockedFittingPaymentRow {
  payment_id: string;
  payment_method_id: string;
  rail: FittingPaymentMethodRow['rail'];
  amount_minor: number;
  currency: string;
  status: 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded';
  merchant_reference: string | null;
  verified_at: Date | null;
}

export interface LockedFittingReceiptRow {
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

export interface FittingPaymentVerificationRow {
  verification_id: string;
  decision: 'verified' | 'rejected' | 'ask_info';
  verified_amount_minor: number | null;
  decided_at: Date;
}

export interface FittingAllocationApplyCapacityRow {
  allocation_id: string;
  amount_minor: number;
  reversed_minor: string;
}

export interface FittingRefundAllocationReversalInput {
  allocationId: string;
  amountMinor: number;
  reversesId: string;
  businessKey: string;
}

export interface LockedFittingRefundRow {
  refund_id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  purpose: 'fitting_fee_refund';
  status: 'requested' | 'processing' | 'completed' | 'failed' | 'cancelled';
  merchant_reference: string | null;
  completed_at: Date | null;
}

export async function lockFittingForFinance(
  client: PoolClient,
  input: { tenantId: string; branchId: string; fittingId: string },
): Promise<LockedFittingFinanceRow | null> {
  const result = await client.query<LockedFittingFinanceRow>(
    `SELECT fa.id AS fitting_id, fa.status, fa.fee_minor::integer AS fee_minor, fa.currency, fa.version
       FROM fitting_appointment fa
      WHERE fa.tenant_id = $1
        AND fa.branch_id = $2
        AND fa.id = $3::uuid
      LIMIT 1
      FOR UPDATE OF fa`,
    [input.tenantId, input.branchId, input.fittingId],
  );
  return result.rows[0] ?? null;
}

export async function lockFittingFeeCharge(
  client: PoolClient,
  input: { tenantId: string; fittingId: string },
): Promise<FittingFeeChargeRow | null> {
  const result = await client.query<FittingFeeChargeRow>(
    `SELECT c.id AS charge_id, c.amount_minor, c.currency
       FROM charge c
      WHERE c.tenant_id = $1
        AND c.fitting_id = $2::uuid
        AND c.kind = 'fitting_fee'
        AND c.reverses_id IS NULL
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 1`,
    [input.tenantId, input.fittingId],
  );
  return result.rows[0] ?? null;
}

export async function readActiveFittingPaymentMethod(
  client: PoolClient,
  input: { tenantId: string; paymentMethodId: string },
): Promise<FittingPaymentMethodRow | null> {
  const result = await client.query<FittingPaymentMethodRow>(
    `SELECT pm.id AS payment_method_id, pm.rail
       FROM payment_method pm
      WHERE pm.tenant_id = $1
        AND pm.id = $2::uuid
        AND pm.active = true
      LIMIT 1`,
    [input.tenantId, input.paymentMethodId],
  );
  return result.rows[0] ?? null;
}

export async function lockCanonicalFittingPayment(
  client: PoolClient,
  input: { tenantId: string; fittingId: string },
): Promise<LockedFittingPaymentRow | null> {
  const result = await client.query<LockedFittingPaymentRow>(
    `SELECT p.id AS payment_id, p.payment_method_id, pm.rail,
            p.amount_minor, p.currency, p.status, p.merchant_reference, p.verified_at
       FROM payment p
       JOIN payment_method pm
         ON pm.tenant_id = p.tenant_id AND pm.id = p.payment_method_id
      WHERE p.tenant_id = $1
        AND p.fitting_id = $2::uuid
        AND p.business_key = ('fitting:' || $2::text || ':fee-payment')
      LIMIT 1
      FOR UPDATE OF p`,
    [input.tenantId, input.fittingId],
  );
  return result.rows[0] ?? null;
}

export async function createFittingFeePayment(
  client: PoolClient,
  input: {
    paymentId: string;
    tenantId: string;
    fittingId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO payment
       (id, tenant_id, fitting_id, payment_method_id, amount_minor, currency, status, business_key)
     VALUES ($1,$2,$3::uuid,$4::uuid,$5,$6,'pending',$7)`,
    [
      input.paymentId,
      input.tenantId,
      input.fittingId,
      input.paymentMethodId,
      input.amountMinor,
      input.currency,
      `fitting:${input.fittingId}:fee-payment`,
    ],
  );
}

export async function lockLatestFittingReceipt(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<LockedFittingReceiptRow | null> {
  const result = await client.query<LockedFittingReceiptRow>(
    `SELECT pr.id AS receipt_id, pr.payment_id, pr.evidence_status, pr.submitted_at,
            fo.id AS file_id, fo.purpose AS file_purpose,
            fo.lifecycle_status AS file_lifecycle_status, fo.is_private AS file_is_private,
            fo.frozen_at AS file_frozen_at, fo.version_id AS file_version_id, fo.sha256 AS file_sha256
       FROM payment_receipt pr
       JOIN file_object fo
         ON fo.tenant_id = pr.tenant_id AND fo.id = pr.file_id
      WHERE pr.tenant_id = $1 AND pr.payment_id = $2::uuid
      ORDER BY pr.submitted_at DESC, pr.id DESC
      LIMIT 1
      FOR UPDATE OF pr`,
    [input.tenantId, input.paymentId],
  );
  return result.rows[0] ?? null;
}

export async function attachAcceptedFittingReceipt(
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
      WHERE tenant_id = $1 AND payment_id = $2::uuid AND file_id = $3::uuid
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
        AND evidence_status IN ('uploaded','under_review')`,
    [input.tenantId, input.paymentId],
  );

  const inserted = await client.query<{ receipt_id: string; payment_id: string }>(
    `INSERT INTO payment_receipt (tenant_id, payment_id, file_id, evidence_status, submitted_at)
     VALUES ($1,$2::uuid,$3::uuid,'uploaded',statement_timestamp())
     RETURNING id AS receipt_id, payment_id`,
    [input.tenantId, input.paymentId, input.fileId],
  );
  return inserted.rows[0] ?? null;
}

export async function readLatestFittingPaymentVerification(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<FittingPaymentVerificationRow | null> {
  const result = await client.query<FittingPaymentVerificationRow>(
    `SELECT pv.id AS verification_id, pv.decision, pv.verified_amount_minor, pv.decided_at
       FROM payment_verification pv
      WHERE pv.tenant_id = $1 AND pv.payment_id = $2::uuid
      ORDER BY pv.decided_at DESC, pv.id DESC
      LIMIT 1
      FOR UPDATE OF pv`,
    [input.tenantId, input.paymentId],
  );
  return result.rows[0] ?? null;
}

export async function verifyFittingPaymentCollection(
  client: PoolClient,
  input: { tenantId: string; paymentId: string; merchantReference: string | null },
): Promise<Date | null> {
  const result = await client.query<{ verified_at: Date }>(
    `UPDATE payment
        SET status = 'paid',
            verified_at = statement_timestamp(),
            merchant_reference = COALESCE($3, merchant_reference)
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND status IN ('pending','partially_paid')
        AND verified_at IS NULL
      RETURNING verified_at`,
    [input.tenantId, input.paymentId, input.merchantReference],
  );
  return result.rows[0]?.verified_at ?? null;
}

export async function insertFittingPaymentVerification(
  client: PoolClient,
  input: {
    tenantId: string;
    paymentId: string;
    membershipId: string;
    verifiedAmountMinor: number;
    cashTenderedMinor: number | null;
    changeDueMinor: number | null;
    evidenceNote: string;
  },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO payment_verification
       (tenant_id, payment_id, verifier_membership_id, decision,
        verified_amount_minor, cash_tendered_minor, change_due_minor, evidence_note, business_key)
     VALUES ($1,$2::uuid,$3::uuid,'verified',$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, business_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.paymentId,
      input.membershipId,
      input.verifiedAmountMinor,
      input.cashTenderedMinor,
      input.changeDueMinor,
      input.evidenceNote,
      `fitting-payment-verified:${input.paymentId}`,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function markFittingReceiptVerified(
  client: PoolClient,
  input: { tenantId: string; receiptId: string },
): Promise<void> {
  await client.query(
    `UPDATE payment_receipt
        SET evidence_status = 'verified'
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND evidence_status IN ('uploaded','under_review')`,
    [input.tenantId, input.receiptId],
  );
}

export async function insertFittingFeePaymentAllocation(
  client: PoolClient,
  input: {
    allocationId: string;
    tenantId: string;
    fittingId: string;
    paymentId: string;
    chargeId: string;
    amountMinor: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO payment_allocation
       (id, tenant_id, payment_id, charge_id, amount_minor, direction, business_key)
     VALUES ($1,$2,$3::uuid,$4::uuid,$5,'apply',$6)`,
    [
      input.allocationId,
      input.tenantId,
      input.paymentId,
      input.chargeId,
      input.amountMinor,
      `fitting:${input.fittingId}:fee-allocation`,
    ],
  );
}

export async function readFittingFeePaymentAllocation(
  client: PoolClient,
  input: { tenantId: string; fittingId: string },
): Promise<{ allocation_id: string; amount_minor: number } | null> {
  const result = await client.query<{ allocation_id: string; amount_minor: number }>(
    `SELECT pa.id AS allocation_id, pa.amount_minor
       FROM payment_allocation pa
      WHERE pa.tenant_id = $1
        AND pa.business_key = ('fitting:' || $2::text || ':fee-allocation')
        AND pa.direction = 'apply'
      LIMIT 1`,
    [input.tenantId, input.fittingId],
  );
  return result.rows[0] ?? null;
}

export async function readFittingAllocationApplyCapacity(
  client: PoolClient,
  input: { tenantId: string; paymentId: string; chargeId: string },
): Promise<FittingAllocationApplyCapacityRow[]> {
  const result = await client.query<FittingAllocationApplyCapacityRow>(
    `SELECT apply.id AS allocation_id,
            apply.amount_minor,
            COALESCE(sum(reverse.amount_minor), 0)::text AS reversed_minor
       FROM payment_allocation apply
       LEFT JOIN payment_allocation reverse
         ON reverse.tenant_id = apply.tenant_id
        AND reverse.reverses_id = apply.id
        AND reverse.direction = 'reverse'
      WHERE apply.tenant_id = $1
        AND apply.payment_id = $2::uuid
        AND apply.charge_id = $3::uuid
        AND apply.direction = 'apply'
      GROUP BY apply.id, apply.amount_minor, apply.created_at
      ORDER BY apply.created_at ASC, apply.id ASC`,
    [input.tenantId, input.paymentId, input.chargeId],
  );
  return result.rows;
}

export async function readActiveFittingRefundTotal(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<string> {
  const result = await client.query<{ amount_minor: string }>(
    `SELECT COALESCE(sum(r.amount_minor::bigint), 0)::text AS amount_minor
       FROM refund r
      WHERE r.tenant_id = $1
        AND r.payment_id = $2::uuid
        AND r.status IN ('requested','processing','completed')`,
    [input.tenantId, input.paymentId],
  );
  return result.rows[0]?.amount_minor ?? '0';
}

export async function readCompletedFittingRefundTotal(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<string> {
  const result = await client.query<{ amount_minor: string }>(
    `SELECT COALESCE(sum(r.amount_minor::bigint), 0)::text AS amount_minor
       FROM refund r
      WHERE r.tenant_id = $1
        AND r.payment_id = $2::uuid
        AND r.status = 'completed'`,
    [input.tenantId, input.paymentId],
  );
  return result.rows[0]?.amount_minor ?? '0';
}

export async function createFittingRefundInstruction(
  client: PoolClient,
  input: {
    refundId: string;
    tenantId: string;
    paymentId: string;
    membershipId: string;
    amountMinor: number;
    currency: string;
    businessKey: string;
  },
): Promise<LockedFittingRefundRow> {
  const result = await client.query<LockedFittingRefundRow>(
    `INSERT INTO refund
       (id, tenant_id, payment_id, amount_minor, currency, purpose, status,
        requested_by, business_key)
     VALUES ($1,$2,$3::uuid,$4,$5,'fitting_fee_refund','requested',$6::uuid,$7)
     RETURNING id AS refund_id, payment_id, amount_minor, currency, purpose, status,
               merchant_reference, completed_at`,
    [
      input.refundId,
      input.tenantId,
      input.paymentId,
      input.amountMinor,
      input.currency,
      input.membershipId,
      input.businessKey,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Fitting refund insert returned no row.');
  return row;
}

export async function insertFittingRefundAllocationReversals(
  client: PoolClient,
  input: {
    tenantId: string;
    paymentId: string;
    chargeId: string;
    reversals: FittingRefundAllocationReversalInput[];
  },
): Promise<number> {
  if (input.reversals.length === 0) return 0;

  const result = await client.query(
    `INSERT INTO payment_allocation
       (id, tenant_id, payment_id, charge_id, amount_minor, direction, reverses_id, business_key)
     SELECT reversal.allocation_id, $1, $2::uuid, $3::uuid, reversal.amount_minor,
            'reverse', reversal.reverses_id, reversal.business_key
       FROM unnest($4::uuid[], $5::integer[], $6::uuid[], $7::text[])
         WITH ORDINALITY AS reversal(allocation_id, amount_minor, reverses_id, business_key, ordinal)
      ORDER BY reversal.ordinal`,
    [
      input.tenantId,
      input.paymentId,
      input.chargeId,
      input.reversals.map(({ allocationId }) => allocationId),
      input.reversals.map(({ amountMinor }) => amountMinor),
      input.reversals.map(({ reversesId }) => reversesId),
      input.reversals.map(({ businessKey }) => businessKey),
    ],
  );
  return result.rowCount ?? 0;
}

export async function lockFittingRefund(
  client: PoolClient,
  input: { tenantId: string; paymentId: string; refundId: string },
): Promise<LockedFittingRefundRow | null> {
  const result = await client.query<LockedFittingRefundRow>(
    `SELECT r.id AS refund_id, r.payment_id, r.amount_minor, r.currency, r.purpose,
            r.status, r.merchant_reference, r.completed_at
       FROM refund r
      WHERE r.tenant_id = $1
        AND r.payment_id = $2::uuid
        AND r.id = $3::uuid
        AND r.purpose = 'fitting_fee_refund'
      LIMIT 1
      FOR UPDATE OF r`,
    [input.tenantId, input.paymentId, input.refundId],
  );
  return result.rows[0] ?? null;
}

export async function resolveFittingRefundStatus(
  client: PoolClient,
  input: {
    tenantId: string;
    refundId: string;
    status: 'completed' | 'failed' | 'cancelled';
    merchantReference: string | null;
  },
): Promise<LockedFittingRefundRow | null> {
  const result = await client.query<LockedFittingRefundRow>(
    `UPDATE refund
        SET status = $3,
            merchant_reference = COALESCE($4, merchant_reference),
            completed_at = CASE WHEN $3 = 'completed' THEN statement_timestamp() ELSE NULL END
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND status IN ('requested','processing')
      RETURNING id AS refund_id, payment_id, amount_minor, currency, purpose, status,
                merchant_reference, completed_at`,
    [input.tenantId, input.refundId, input.status, input.merchantReference],
  );
  return result.rows[0] ?? null;
}

export async function insertFittingRefundAllocationRestore(
  client: PoolClient,
  input: {
    allocationId: string;
    tenantId: string;
    paymentId: string;
    chargeId: string;
    amountMinor: number;
    refundId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO payment_allocation
       (id, tenant_id, payment_id, charge_id, amount_minor, direction, business_key)
     VALUES ($1,$2,$3::uuid,$4::uuid,$5,'apply',$6)`,
    [
      input.allocationId,
      input.tenantId,
      input.paymentId,
      input.chargeId,
      input.amountMinor,
      `refund:${input.refundId}:allocation-restore`,
    ],
  );
}

export async function markFittingPaymentRefunded(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<void> {
  await client.query(
    `UPDATE payment
        SET status = 'refunded'
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND status = 'paid'
        AND verified_at IS NOT NULL`,
    [input.tenantId, input.paymentId],
  );
}

export async function appendFittingRefundAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: 'refund.requested' | 'refund.completed' | 'refund.failed' | 'refund.cancelled';
    refundId: string;
    paymentId: string;
    fittingId: string;
    amountMinor: number;
    requestId: string;
    summary?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,$3,'refund',$4::uuid,$5::jsonb,$6,statement_timestamp(),'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.refundId,
      JSON.stringify({
        fitting_id: input.fittingId,
        payment_id: input.paymentId,
        amount_minor: input.amountMinor,
        ...input.summary,
      }),
      input.requestId,
    ],
  );
}

export async function appendFittingFinanceAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: 'fitting.payment_created' | 'payment.receipt_attached' | 'payment.verified';
    entityId: string;
    requestId: string;
    fittingId: string;
    summary: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1,'staff',$2,$3,'payment',$4::uuid,$5::jsonb,$6,statement_timestamp(),'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.entityId,
      JSON.stringify({ fitting_id: input.fittingId, ...input.summary }),
      input.requestId,
    ],
  );
}
