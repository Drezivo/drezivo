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
