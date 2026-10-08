import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  billingOverview,
  submitSubscriptionPaymentResponse,
  subscriptionPaymentView,
  type BillingOverview,
  type SubmitSubscriptionPaymentRequest,
  type SubmitSubscriptionPaymentResponse,
  type SubscriptionAccess,
  type SubscriptionPaymentView,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import {
  ForbiddenError,
  NotFoundError,
  PaymentAlreadyPendingError,
  StateConflictError,
  ValidationError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import { resolveTenantEntitlements } from '../entitlements/entitlements.service.js';
import { accessOf } from './access.js';
import { TRIAL_DURATION_DAYS } from './billing.constants.js';
import {
  appendBillingAuditEvent,
  insertPendingSubscriptionPayment,
  isAcceptedPaymentProof,
  listActivePlatformPaymentMethods,
  listSubscriptionPayments,
  readAccessRow,
  readActivePlatformPaymentMethod,
  readActivePlatformQr,
  readBillingSubscription,
  readPaymentProofFile,
  readSubscriptionPayment,
  type SubscriptionPaymentRow,
} from './billing-payments.repository.js';

const SUBMIT_OPERATION = 'subscription.payment.submit';
const PAYMENT_HISTORY_LIMIT = 24;
const PENDING_UNIQUE_INDEX = 'subscription_payment_one_pending_per_tenant';
/** Operator proof links are short-lived: long enough to open, too short to be worth sharing. */
export const PROOF_URL_TTL_SECONDS = 5 * 60;

export interface BillingActor {
  tenantId: string;
  membershipId: string;
  principalId: string;
  role: 'owner' | 'frontdesk';
  requestId: string;
}

/** Access for a tenant on the caller's tenant-scoped transaction; null when it has no subscription. */
export async function readTenantAccess(
  client: PoolClient,
  tenantId: string,
): Promise<SubscriptionAccess | null> {
  const row = await readAccessRow(client, tenantId);
  return row ? accessOf(row, row.now) : null;
}

/** GET /billing. Owner and front desk may read it; only the owner may pay. */
export function getBillingOverview(actor: BillingActor): Promise<BillingOverview> {
  return withTenantTransaction(actor.tenantId, actor.principalId, async (client) => {
    const subscription = await readBillingSubscription(client, actor.tenantId);
    if (!subscription) throw new StateConflictError('Workspace subscription is unavailable.');
    const entitlements = await resolveTenantEntitlements(client, actor.tenantId);
    const methods = await listActivePlatformPaymentMethods(client);
    const payments = await listSubscriptionPayments(client, actor.tenantId, PAYMENT_HISTORY_LIMIT);

    return billingOverview.parse({
      plan: {
        code: entitlements.planCode,
        name: entitlements.planCode === 'starter' ? 'Starter' : 'Standard',
        monthly_minor: String(subscription.monthly_minor),
        currency: subscription.currency,
        physical_assets_max: entitlements.physicalAssetsMax,
        frontdesk_seats_max: entitlements.frontdeskSeatsMax,
        trial_days: TRIAL_DURATION_DAYS,
      },
      subscription: {
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at?.toISOString() ?? null,
        read_only_until: subscription.grace_ends_at?.toISOString() ?? null,
        current_period_end: subscription.current_period_end.toISOString(),
      },
      access: accessOf(subscription, subscription.now),
      can_pay: actor.role === 'owner',
      payment_methods: methods.map((method) => ({
        id: method.id,
        label: method.label,
        account_name: method.account_name,
        account_number: method.account_number,
        instructions: method.instructions,
        has_qr: method.has_qr,
      })),
      payments: payments.map(toPaymentView),
    });
  });
}

/**
 * POST /billing/payments. Owner only, Idempotency-Key required. The amount is the plan price
 * recomputed here, never read from the request. One payment can wait for review at a time: the
 * subscription row lock serializes submissions and the partial unique index is the backstop.
 */
export function submitSubscriptionPayment(
  actor: BillingActor,
  idempotencyKey: string,
  request: SubmitSubscriptionPaymentRequest,
): Promise<CommandResult<SubmitSubscriptionPaymentResponse>> {
  if (actor.role !== 'owner')
    throw new ForbiddenError('Only the workspace owner can pay for the subscription.');
  return withTenantTransaction(actor.tenantId, actor.principalId, (client) =>
    runIdempotentCommand(
      client,
      {
        tenantId: actor.tenantId,
        principalKey: actor.membershipId,
        operation: SUBMIT_OPERATION,
        intentKey: idempotencyKey,
        requestId: actor.requestId,
      },
      request,
      async () => {
        const subscription = await readBillingSubscription(client, actor.tenantId, true);
        if (!subscription) throw new StateConflictError('Workspace subscription is unavailable.');
        if (subscription.status === 'cancelled')
          throw new StateConflictError('This subscription is closed.');
        if (subscription.pending_payment) {
          throw new PaymentAlreadyPendingError('A payment is already waiting for review.');
        }
        const method = await readActivePlatformPaymentMethod(client, request.payment_method_id);
        if (!method) throw new ValidationError('Choose one of the listed payment methods.');
        if (!(await isAcceptedPaymentProof(client, actor.tenantId, request.proof_file_id))) {
          throw new ValidationError('Upload the proof of payment again before submitting.');
        }

        const paymentId = randomUUID();
        try {
          await insertPendingSubscriptionPayment(client, {
            id: paymentId,
            tenantId: actor.tenantId,
            subscriptionId: subscription.subscription_id,
            amountMinor: subscription.monthly_minor,
            currency: subscription.currency,
            paymentMethodId: method.id,
            reference: request.reference,
            proofFileId: request.proof_file_id,
            membershipId: actor.membershipId,
          });
        } catch (error) {
          if (isPendingUniqueViolation(error)) {
            throw new PaymentAlreadyPendingError('A payment is already waiting for review.');
          }
          throw error;
        }
        await appendBillingAuditEvent(client, {
          tenantId: actor.tenantId,
          actorKey: actor.principalId,
          action: 'subscription.payment.submitted',
          entityId: paymentId,
          summary: { payment_method_id: method.id, amount_minor: subscription.monthly_minor },
          requestId: actor.requestId,
        });

        const payment = await readSubscriptionPayment(client, actor.tenantId, paymentId);
        if (!payment) throw new StateConflictError('The submitted payment could not be read.');
        return submitSubscriptionPaymentResponse.parse({
          payment: toPaymentView(payment),
          access: accessOf({ ...subscription, pending_payment: true }, subscription.now),
        });
      },
      201,
    ),
  );
}

/** QR image of one of Drezivo's active payment methods, with its type re-checked before serving. */
export async function readPlatformQr(
  actor: BillingActor,
  methodId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const qr = await withTenantTransaction(actor.tenantId, actor.principalId, (client) =>
    readActivePlatformQr(client, methodId),
  );
  if (!qr || !matchesImageSignature(qr.qr_image, qr.qr_mime))
    throw new NotFoundError('This QR code is not available.');
  return { bytes: qr.qr_image, contentType: qr.qr_mime };
}

/** Operator-only: a 5-minute signed URL for a payment's proof, within the operator's tenant scope. */
export async function signPaymentProofUrl(
  tenantId: string,
  paymentId: string,
  operatorSubject: string,
  storage: ObjectStorage = objectStorage,
): Promise<{ url: string; expires_at: string; content_type: string } | null> {
  const file = await withTenantTransaction(tenantId, `operator:${operatorSubject}`, (client) =>
    readPaymentProofFile(client, tenantId, paymentId),
  );
  if (!file) return null;
  const read = await storage.authorizeRead({
    storageKey: file.storage_key,
    versionId: file.version_id,
    expiresInSeconds: PROOF_URL_TTL_SECONDS,
  });
  return {
    url: read.readUrl,
    expires_at: read.expiresAt.toISOString(),
    content_type: file.mime_type,
  };
}

function toPaymentView(row: SubscriptionPaymentRow): SubscriptionPaymentView {
  return subscriptionPaymentView.parse({
    id: row.id,
    amount_minor: String(row.amount_minor),
    currency: row.currency,
    status: row.status,
    reference: row.reference ?? 'Not provided',
    payment_method_label: row.payment_method_label ?? 'Payment',
    submitted_at: row.created_at.toISOString(),
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
    review_note: row.status === 'failed' ? row.review_note : null,
  });
}

function isPendingUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505' &&
    (error as { constraint?: unknown }).constraint === PENDING_UNIQUE_INDEX
  );
}

function matchesImageSignature(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png')
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp')
    return (
      bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
      bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    );
  return false;
}
