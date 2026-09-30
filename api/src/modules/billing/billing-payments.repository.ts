import type { PoolClient } from 'pg';

import type { SubscriptionPaymentStatus, SubscriptionStatus } from '@drezivo/contracts';

/**
 * Pilot billing reads and the one business-side write (submitting a payment proof).
 *
 * `platform_payment_method` is a GLOBAL table that operators manage; the business API only reads
 * it (see migration 0062 for why the role can technically write). QR bytes are selected only by
 * the dedicated QR read, never in list queries.
 */

export interface AccessRow {
  status: SubscriptionStatus;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
  current_period_end: Date;
  pending_payment: boolean;
  /** Database clock, so every access decision uses one time source. */
  now: Date;
}

export async function readAccessRow(client: PoolClient, tenantId: string): Promise<AccessRow | null> {
  const result = await client.query<AccessRow>(
    `SELECT s.status, s.trial_ends_at, s.grace_ends_at, s.current_period_end,
            EXISTS (
              SELECT 1 FROM subscription_payment sp
               WHERE sp.tenant_id = s.tenant_id AND sp.status = 'pending'
            ) AS pending_payment,
            statement_timestamp() AS now
       FROM subscription s
      WHERE s.tenant_id = $1
      LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export interface BillingSubscriptionRow extends AccessRow {
  subscription_id: string;
  plan_id: string;
  monthly_minor: number;
  currency: string;
}

/** The tenant's subscription with its plan price. `lock` serializes payment submissions per tenant. */
export async function readBillingSubscription(
  client: PoolClient,
  tenantId: string,
  lock = false,
): Promise<BillingSubscriptionRow | null> {
  if (lock) {
    // Lock first, then read in a NEW statement: a statement that waited for the lock would still
    // see its pre-wait snapshot and miss a payment the previous holder just inserted.
    await client.query('SELECT id FROM subscription WHERE tenant_id = $1 FOR UPDATE', [tenantId]);
  }
  const result = await client.query<BillingSubscriptionRow>(
    `SELECT s.id AS subscription_id, s.plan_id, p.monthly_minor, p.currency,
            s.status, s.trial_ends_at, s.grace_ends_at, s.current_period_end,
            EXISTS (
              SELECT 1 FROM subscription_payment sp
               WHERE sp.tenant_id = s.tenant_id AND sp.status = 'pending'
            ) AS pending_payment,
            statement_timestamp() AS now
       FROM subscription s
       JOIN plan p ON p.id = s.plan_id
      WHERE s.tenant_id = $1
      LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export interface PlatformPaymentMethodRow {
  id: string;
  label: string;
  account_name: string | null;
  account_number: string | null;
  instructions: string | null;
  has_qr: boolean;
}

export async function listActivePlatformPaymentMethods(client: PoolClient): Promise<PlatformPaymentMethodRow[]> {
  const result = await client.query<PlatformPaymentMethodRow>(
    `SELECT id, label, account_name, account_number, instructions, qr_image IS NOT NULL AS has_qr
       FROM platform_payment_method
      WHERE active
      ORDER BY sort_order, id
      LIMIT 10`,
  );
  return result.rows;
}

export async function readActivePlatformPaymentMethod(
  client: PoolClient,
  id: string,
): Promise<{ id: string; label: string } | null> {
  const result = await client.query<{ id: string; label: string }>(
    'SELECT id, label FROM platform_payment_method WHERE id = $1 AND active LIMIT 1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function readActivePlatformQr(
  client: PoolClient,
  id: string,
): Promise<{ qr_image: Buffer; qr_mime: string } | null> {
  const result = await client.query<{ qr_image: Buffer; qr_mime: string }>(
    `SELECT qr_image, qr_mime
       FROM platform_payment_method
      WHERE id = $1 AND active AND qr_image IS NOT NULL AND qr_mime IS NOT NULL
      LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export interface SubscriptionPaymentRow {
  id: string;
  amount_minor: number;
  currency: string;
  status: SubscriptionPaymentStatus;
  reference: string | null;
  payment_method_label: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  review_note: string | null;
}

const paymentProjection = `
  SELECT sp.id, sp.amount_minor, sp.currency, sp.status, sp.reference,
         ppm.label AS payment_method_label, sp.created_at, sp.reviewed_at, sp.review_note
    FROM subscription_payment sp
    LEFT JOIN platform_payment_method ppm ON ppm.id = sp.payment_method_id
`;

export async function listSubscriptionPayments(
  client: PoolClient,
  tenantId: string,
  limit: number,
): Promise<SubscriptionPaymentRow[]> {
  const result = await client.query<SubscriptionPaymentRow>(
    `${paymentProjection}
      WHERE sp.tenant_id = $1
      ORDER BY sp.created_at DESC, sp.id DESC
      LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows;
}

export async function readSubscriptionPayment(
  client: PoolClient,
  tenantId: string,
  paymentId: string,
): Promise<SubscriptionPaymentRow | null> {
  const result = await client.query<SubscriptionPaymentRow>(
    `${paymentProjection} WHERE sp.tenant_id = $1 AND sp.id = $2`,
    [tenantId, paymentId],
  );
  return result.rows[0] ?? null;
}

/** An accepted proof upload owned by this tenant, and only of the proof purpose. */
export async function isAcceptedPaymentProof(client: PoolClient, tenantId: string, fileId: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM file_object
        WHERE tenant_id = $1 AND id = $2
          AND purpose = 'subscription_payment_proof' AND lifecycle_status = 'accepted'
     ) AS ok`,
    [tenantId, fileId],
  );
  return result.rows[0]?.ok === true;
}

export async function insertPendingSubscriptionPayment(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    subscriptionId: string;
    amountMinor: number;
    currency: string;
    paymentMethodId: string;
    reference: string;
    proofFileId: string;
    membershipId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO subscription_payment
       (id, tenant_id, subscription_id, amount_minor, currency, status, collection_method,
        business_key, payment_method_id, reference, proof_file_id, submitted_by_membership_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', 'manual_proof', $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.tenantId,
      input.subscriptionId,
      input.amountMinor,
      input.currency,
      `manual-proof:${input.id}`,
      input.paymentMethodId,
      input.reference,
      input.proofFileId,
      input.membershipId,
    ],
  );
}

export async function appendBillingAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: string;
    entityId: string;
    summary: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'subscription_payment', $4, $5::jsonb, $6, now(), 'succeeded')`,
    [input.tenantId, input.actorKey, input.action, input.entityId, JSON.stringify(input.summary), input.requestId],
  );
}

/** Operator read: the proof file of one payment in the operator's tenant scope. */
export async function readPaymentProofFile(
  client: PoolClient,
  tenantId: string,
  paymentId: string,
): Promise<{ storage_key: string; version_id: string | null; mime_type: string } | null> {
  const result = await client.query<{ storage_key: string; version_id: string | null; mime_type: string }>(
    `SELECT f.storage_key, f.version_id, f.mime_type
       FROM subscription_payment sp
       JOIN file_object f ON f.tenant_id = sp.tenant_id AND f.id = sp.proof_file_id
      WHERE sp.tenant_id = $1 AND sp.id = $2
        AND f.purpose = 'subscription_payment_proof' AND f.lifecycle_status = 'accepted'`,
    [tenantId, paymentId],
  );
  return result.rows[0] ?? null;
}
