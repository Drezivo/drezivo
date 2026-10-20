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

import { withActorTenantResolutionTransaction, withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import type { FileStreamResponse } from '../files/file-stream.js';
import {
  ForbiddenError,
  NotFoundError,
  PaymentAlreadyPendingError,
  StateConflictError,
  ValidationError,
} from '../../shared/errors.js';
import { runIdempotentCommand, type CommandResult } from '../../shared/idempotent-command.js';
import { resolvePlanEntitlements, resolveTenantEntitlements } from '../entitlements/entitlements.service.js';
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
  return withActorTenantResolutionTransaction(actor.principalId, async (transaction) => {
    const { client } = transaction;
    const eligibility = actor.role === 'owner'
      ? await client.query<{ eligible: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM account a
              WHERE a.clerk_user_id = $1
                AND a.current_owned_tenant_id = $2
                AND a.trial_consumed_at IS NULL
           ) AS eligible`,
          [actor.principalId, actor.tenantId],
        )
      : null;
    await transaction.setTenantContext(actor.tenantId);
    const subscription = await readBillingSubscription(client, actor.tenantId);
    if (!subscription) throw new StateConflictError('Workspace subscription is unavailable.');
    const entitlements = await resolveTenantEntitlements(client, actor.tenantId);
    const methods = await listActivePlatformPaymentMethods(client);
    const payments = await listSubscriptionPayments(client, actor.tenantId, PAYMENT_HISTORY_LIMIT);
    const canStartTrial =
      actor.role === 'owner' &&
      entitlements.planCode === 'free' &&
      !subscription.pending_payment &&
      eligibility?.rows[0]?.eligible === true;

    return billingOverview.parse({
      plan: {
        code: entitlements.planCode,
        name: entitlements.planCode === 'free' ? 'Free' : entitlements.planCode === 'starter' ? 'Starter' : 'Standard',
        monthly_minor: String(subscription.monthly_minor),
        currency: subscription.currency,
        physical_assets_max: entitlements.physicalAssetsMax,
        frontdesk_seats_max: entitlements.frontdeskSeatsMax,
        trial_days: entitlements.planCode === 'free' ? 0 : TRIAL_DURATION_DAYS,
      },
      subscription: {
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at?.toISOString() ?? null,
        read_only_until: subscription.grace_ends_at?.toISOString() ?? null,
        current_period_end: subscription.current_period_end?.toISOString() ?? null,
      },
      access: accessOf(subscription, subscription.now),
      can_pay: actor.role === 'owner',
      can_start_trial: canStartTrial,
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
  return withActorTenantResolutionTransaction(actor.principalId, async (transaction) => {
    const { client } = transaction;
    const accountResult = await client.query<{
      trial_consumed_at: Date | null;
      current_owned_tenant_id: string | null;
    }>(
      `SELECT trial_consumed_at, current_owned_tenant_id
         FROM account
        WHERE clerk_user_id = $1
        FOR UPDATE`,
      [actor.principalId],
    );
    const account = accountResult.rows[0] ?? null;
    await transaction.setTenantContext(actor.tenantId);
    return runIdempotentCommand(
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
        const currentPlan = await resolveTenantEntitlements(client, actor.tenantId);
        const targetPlan = await resolvePlanEntitlements(client, request.plan_code ?? currentPlan.planCode);
        if (targetPlan.planCode === 'free') {
          throw new ValidationError('Choose Starter or Standard to submit an upgrade payment.');
        }
        if (currentPlan.planCode === 'free') {
          if (
            account?.current_owned_tenant_id !== actor.tenantId ||
            !account.trial_consumed_at
          ) {
            throw new StateConflictError('Start your eligible 14-day trial to activate this plan.');
          }
        } else if (targetPlan.planId !== currentPlan.planId) {
          throw new StateConflictError('Paid plan changes are not available.');
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
            targetPlanId: targetPlan.planId,
            amountMinor: targetPlan.monthlyMinor,
            currency: targetPlan.currency,
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
          summary: { payment_method_id: method.id, target_plan_code: targetPlan.planCode, amount_minor: targetPlan.monthlyMinor },
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
    );
  });
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

/** Operator-only: stream an accepted payment proof without exposing its R2 location. */
export async function readPaymentProof(
  tenantId: string,
  paymentId: string,
  operatorSubject: string,
  storage: ObjectStorage = objectStorage,
): Promise<FileStreamResponse | null> {
  const file = await withTenantTransaction(tenantId, `operator:${operatorSubject}`, (client) =>
    readPaymentProofFile(client, tenantId, paymentId),
  );
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mime_type)) return null;
  const read = await storage.readObject({
    storageKey: file.storage_key,
    versionId: file.version_id,
  });
  if (!read || read.contentLength !== file.byte_size) return null;
  return { body: read.body, byteSize: file.byte_size, mimeType: file.mime_type as FileStreamResponse['mimeType'] };
}

function toPaymentView(row: SubscriptionPaymentRow): SubscriptionPaymentView {
  return subscriptionPaymentView.parse({
    id: row.id,
    amount_minor: String(row.amount_minor),
    target_plan_code: row.target_plan_code,
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
