import { randomUUID } from 'node:crypto';

import {
  fittingDetail,
  fittingPaymentIntentCreateRequest,
  fittingPaymentIntentCreateResponse,
  fittingPaymentReceiptAttachRequest,
  fittingPaymentReceiptAttachResponse,
  fittingPaymentVerifyRequest,
  fittingPaymentVerifyResponse,
  refundCreateRequest,
  refundCreateResponse,
  refundResolveRequest,
  refundResolveResponse,
  type FittingDetail,
  type FittingPaymentIntentCreateRequest,
  type FittingPaymentIntentCreateResponse,
  type FittingPaymentReceiptAttachRequest,
  type FittingPaymentReceiptAttachResponse,
  type FittingPaymentVerifyRequest,
  type FittingPaymentVerifyResponse,
  type RefundCreateRequest,
  type RefundCreateResponse,
  type RefundResolveRequest,
  type RefundResolveResponse,
  type RefundSummary,
  type PermissionCode,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  CapacityConflictError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  PaymentPrerequisiteFailedError,
  StateConflictError,
  TenantCancelledError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
  type TenantIdempotencyClaim,
} from '../../shared/tenant-idempotency.js';
import {
  appendFittingFinanceAudit,
  appendFittingRefundAudit,
  attachAcceptedFittingReceipt,
  createFittingFeePayment,
  createFittingRefundInstruction,
  insertFittingFeePaymentAllocation,
  insertFittingPaymentVerification,
  insertFittingRefundAllocationRestore,
  insertFittingRefundAllocationReversal,
  lockCanonicalFittingPayment,
  lockFittingFeeCharge,
  lockFittingForFinance,
  lockFittingRefund,
  lockLatestFittingReceipt,
  markFittingReceiptVerified,
  readActiveFittingPaymentMethod,
  readActiveFittingRefundTotal,
  readCompletedFittingRefundTotal,
  readFittingAllocationApplyCapacity,
  readFittingFeePaymentAllocation,
  readLatestFittingPaymentVerification,
  resolveFittingRefundStatus,
  markFittingPaymentRefunded,
  verifyFittingPaymentCollection,
  type LockedFittingReceiptRow,
} from './fittings.finance.repository.js';
import { readFittingDetailModel } from './fittings.repository.js';

const CREATE_PAYMENT_OPERATION = 'fitting.payment.create';
const ATTACH_RECEIPT_OPERATION = 'fitting.payment_receipt.attach';
const VERIFY_PAYMENT_OPERATION = 'fitting.payment.verify';
const REQUEST_REFUND_OPERATION = 'fitting.refund.request';
const RESOLVE_REFUND_OPERATION = 'fitting.refund.resolve';
const FINANCE_EFFECTS_SAVEPOINT = 'fitting_finance_effects';
const POSTGRES_INTEGER_MAX = 2_147_483_647n;

export interface FittingFinanceContext {
  tenantId: string;
  branchId: string;
  fittingId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  permissionCodes: PermissionCode[];
  role: 'owner' | 'frontdesk';
  effectiveTenantStatus: TenantStatus;
}

export interface FittingPaymentIntentCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingPaymentIntentCreateResponse> | FailureEnvelope;
}

export interface FittingPaymentReceiptCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingPaymentReceiptAttachResponse> | FailureEnvelope;
}

export interface FittingPaymentVerifyCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingPaymentVerifyResponse> | FailureEnvelope;
}

export interface FittingRefundCreateCommandResponse {
  status: number;
  body: SuccessEnvelope<RefundCreateResponse> | FailureEnvelope;
}

export interface FittingRefundResolveCommandResponse {
  status: number;
  body: SuccessEnvelope<RefundResolveResponse> | FailureEnvelope;
}

export interface FittingRefundResolveContext extends FittingFinanceContext {
  refundId: string;
}

export async function createFittingPaymentIntentCommand(
  context: FittingFinanceContext,
  requestInput: FittingPaymentIntentCreateRequest,
): Promise<FittingPaymentIntentCommandResponse> {
  const parsed = fittingPaymentIntentCreateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting payment request is invalid.');
  assertFittingFinanceOperationalPermission(context);
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ fitting_id: context.fittingId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimFinanceIdempotency(
      client,
      context,
      CREATE_PAYMENT_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingPaymentIntentCommandResponse>(claim);
    if (replay) return replay;

    try {
      const fitting = await requireLockedFitting(client, context);
      if (fitting.fee_minor <= 0) {
        throw new StateConflictError('This fitting has no payment obligation.');
      }
      const charge = await lockFittingFeeCharge(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      assertCanonicalFeeCharge(fitting, charge);

      const method = await readActiveFittingPaymentMethod(client, {
        tenantId: context.tenantId,
        paymentMethodId: request.payment_method_id,
      });
      if (!method) throw new NotFoundError('Payment method could not be found.');

      const existing = await lockCanonicalFittingPayment(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      if (existing) {
        throw new StateConflictError('This fitting already has a payment intent.');
      }

      const paymentId = randomUUID();
      await createFittingFeePayment(client, {
        paymentId,
        tenantId: context.tenantId,
        fittingId: context.fittingId,
        paymentMethodId: method.payment_method_id,
        amountMinor: fitting.fee_minor,
        currency: fitting.currency,
      });
      await appendFittingFinanceAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.payment_created',
        entityId: paymentId,
        requestId: context.requestId,
        fittingId: context.fittingId,
        summary: { payment_rail: method.rail, amount_minor: fitting.fee_minor },
      });

      const body: SuccessEnvelope<FittingPaymentIntentCreateResponse> = {
        success: true,
        data: fittingPaymentIntentCreateResponse.parse({
          fitting: await requireFittingDetail(client, context),
        }),
        request_id: context.requestId,
      };
      await finalizeFinanceSuccess(
        client,
        context,
        CREATE_PAYMENT_OPERATION,
        payloadHash,
        body,
        201,
      );
      return { status: 201, body };
    } catch (error) {
      return finalizeFinanceFailure(client, context, CREATE_PAYMENT_OPERATION, payloadHash, error);
    }
  });
}

export async function attachFittingPaymentReceiptCommand(
  context: FittingFinanceContext,
  requestInput: FittingPaymentReceiptAttachRequest,
): Promise<FittingPaymentReceiptCommandResponse> {
  const parsed = fittingPaymentReceiptAttachRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting payment receipt request is invalid.');
  assertFittingFinanceOperationalPermission(context);
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ fitting_id: context.fittingId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimFinanceIdempotency(
      client,
      context,
      ATTACH_RECEIPT_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingPaymentReceiptCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      await requireLockedFitting(client, context);
      const payment = await lockCanonicalFittingPayment(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      if (!payment) throw new PaymentPrerequisiteFailedError('Fitting payment intent is missing.');
      if (payment.rail === 'cash') {
        throw new StateConflictError('Cash payments do not require uploaded payment evidence.');
      }
      if (payment.status === 'paid' || payment.verified_at !== null) {
        throw new StateConflictError('This fitting payment is already verified.');
      }

      await client.query(`SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const receipt = await attachAcceptedFittingReceipt(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        fileId: request.file_id,
      });
      if (!receipt) {
        throw new StateConflictError(
          'Payment receipt must be an accepted immutable payment-receipt file.',
        );
      }
      await appendFittingFinanceAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'payment.receipt_attached',
        entityId: payment.payment_id,
        requestId: context.requestId,
        fittingId: context.fittingId,
        summary: { receipt_id: receipt.receipt_id },
      });

      const body: SuccessEnvelope<FittingPaymentReceiptAttachResponse> = {
        success: true,
        data: fittingPaymentReceiptAttachResponse.parse({
          fitting: await requireFittingDetail(client, context),
          receipt_id: receipt.receipt_id,
          payment_id: receipt.payment_id,
          evidence_status: 'uploaded',
        }),
        request_id: context.requestId,
      };
      await finalizeFinanceSuccess(client, context, ATTACH_RECEIPT_OPERATION, payloadHash, body);
      await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      }
      return finalizeFinanceFailure(client, context, ATTACH_RECEIPT_OPERATION, payloadHash, error);
    }
  });
}

export async function verifyFittingPaymentCommand(
  context: FittingFinanceContext,
  requestInput: FittingPaymentVerifyRequest,
): Promise<FittingPaymentVerifyCommandResponse> {
  const parsed = fittingPaymentVerifyRequest.safeParse(requestInput);
  if (!parsed.success)
    throw new ValidationError('Fitting payment verification request is invalid.');
  assertFittingFinanceVerificationPermission(context);
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ fitting_id: context.fittingId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimFinanceIdempotency(
      client,
      context,
      VERIFY_PAYMENT_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingPaymentVerifyCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const fitting = await requireLockedFitting(client, context);
      const payment = await lockCanonicalFittingPayment(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      if (!payment) throw new PaymentPrerequisiteFailedError('Fitting payment intent is missing.');
      if (payment.status === 'failed' || payment.status === 'refunded') {
        throw new PaymentPrerequisiteFailedError(
          'Fitting payment is not eligible for verification.',
        );
      }
      if (
        request.verified_amount_minor !== String(payment.amount_minor) ||
        payment.amount_minor !== fitting.fee_minor ||
        payment.currency !== fitting.currency
      ) {
        throw new PaymentPrerequisiteFailedError(
          'Verified amount must exactly match the snapshotted fitting fee.',
        );
      }

      const charge = await lockFittingFeeCharge(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      assertCanonicalFeeCharge(fitting, charge);
      if (!charge) throw new Error('Canonical fitting fee charge is missing.');

      const receipt = await lockLatestFittingReceipt(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
      });
      if (payment.rail === 'cash') {
        if (receipt)
          throw new StateConflictError('Cash payment cannot use uploaded receipt evidence.');
      } else if (receipt && !isImmutableAcceptedReceipt(receipt)) {
        throw new PaymentPrerequisiteFailedError(
          'Uploaded payment evidence is not an accepted immutable receipt.',
        );
      } else if (
        receipt &&
        receipt.evidence_status !== 'uploaded' &&
        receipt.evidence_status !== 'under_review'
      ) {
        throw new PaymentPrerequisiteFailedError(
          'Payment evidence is not eligible for verification.',
        );
      }

      const cashTenderedMinor = parseCashTendered(request.cash_tendered_minor, payment.rail);
      if (cashTenderedMinor !== null && cashTenderedMinor < payment.amount_minor) {
        throw new PaymentPrerequisiteFailedError(
          'Cash tendered cannot be less than the fitting fee due.',
        );
      }
      const changeDueMinor =
        cashTenderedMinor === null ? null : cashTenderedMinor - payment.amount_minor;

      const existingVerification = await readLatestFittingPaymentVerification(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
      });
      if (
        payment.status === 'paid' &&
        payment.verified_at &&
        existingVerification?.decision === 'verified' &&
        existingVerification.verified_amount_minor === payment.amount_minor
      ) {
        const allocation = await readFittingFeePaymentAllocation(client, {
          tenantId: context.tenantId,
          fittingId: context.fittingId,
        });
        if (!allocation || allocation.amount_minor !== payment.amount_minor) {
          throw new StateConflictError('Verified fitting payment allocation is incomplete.');
        }
        return finalizeVerifiedSuccess(
          client,
          context,
          payloadHash,
          payment.payment_id,
          payment.amount_minor,
          payment.verified_at,
        );
      }
      if (payment.status === 'paid' || payment.verified_at !== null || existingVerification) {
        throw new StateConflictError(
          'Payment verification state changed. Refresh before retrying.',
        );
      }

      await client.query(`SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const verifiedAt = await verifyFittingPaymentCollection(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        merchantReference: request.merchant_reference ?? null,
      });
      if (!verifiedAt) {
        throw new StateConflictError('Payment verification lost a concurrent state change.');
      }
      const verificationId = await insertFittingPaymentVerification(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        membershipId: context.membershipId,
        verifiedAmountMinor: payment.amount_minor,
        cashTenderedMinor,
        changeDueMinor,
        evidenceNote:
          payment.rail === 'cash'
            ? 'Cash fitting-fee collection recorded by authorized staff.'
            : receipt
              ? 'Fitting payment evidence verified against merchant collection.'
              : 'Fitting merchant collection manually verified by authorized staff without uploaded receipt evidence.',
      });
      if (!verificationId) {
        throw new StateConflictError('Payment was already verified by another action.');
      }
      if (receipt) {
        await markFittingReceiptVerified(client, {
          tenantId: context.tenantId,
          receiptId: receipt.receipt_id,
        });
      }
      await insertFittingFeePaymentAllocation(client, {
        allocationId: randomUUID(),
        tenantId: context.tenantId,
        fittingId: context.fittingId,
        paymentId: payment.payment_id,
        chargeId: charge.charge_id,
        amountMinor: payment.amount_minor,
      });
      await appendFittingFinanceAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'payment.verified',
        entityId: payment.payment_id,
        requestId: context.requestId,
        fittingId: context.fittingId,
        summary: {
          payment_rail: payment.rail,
          verified_amount_minor: payment.amount_minor,
          verification_id: verificationId,
          verification_basis:
            payment.rail === 'cash'
              ? 'cash_collection'
              : receipt
                ? 'uploaded_receipt'
                : 'staff_manual_verification',
        },
      });

      const result = await finalizeVerifiedSuccess(
        client,
        context,
        payloadHash,
        payment.payment_id,
        payment.amount_minor,
        verifiedAt,
      );
      await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return result;
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      }
      return finalizeFinanceFailure(client, context, VERIFY_PAYMENT_OPERATION, payloadHash, error);
    }
  });
}

export async function requestFittingFeeRefundCommand(
  context: FittingFinanceContext,
  requestInput: RefundCreateRequest,
): Promise<FittingRefundCreateCommandResponse> {
  const parsed = refundCreateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting refund request is invalid.');
  assertFittingRefundPermission(context);
  const request = parsed.data;
  if (request.purpose !== 'fitting_fee_refund') {
    throw new ValidationError('Fitting refunds must use the fitting_fee_refund purpose.');
  }
  const amount = BigInt(request.amount_minor);
  if (amount > POSTGRES_INTEGER_MAX) {
    throw new ValidationError('Refund amount exceeds the supported money range.');
  }
  const payloadHash = canonicalRequestHash({ fitting_id: context.fittingId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimFinanceIdempotency(
      client,
      context,
      REQUEST_REFUND_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingRefundCreateCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const fitting = await requireLockedFitting(client, context);
      const payment = await lockCanonicalFittingPayment(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      if (!payment || payment.payment_id !== request.payment_id) {
        throw new NotFoundError('Payment could not be found for this fitting.');
      }
      if (payment.status !== 'paid' || payment.verified_at === null) {
        throw new PaymentPrerequisiteFailedError(
          'Only verified fitting-fee payments can be refunded.',
        );
      }
      if (request.currency !== payment.currency || request.currency !== fitting.currency) {
        throw new PaymentPrerequisiteFailedError(
          'Refund currency must match the verified fitting payment.',
        );
      }
      const verification = await readLatestFittingPaymentVerification(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
      });
      if (
        verification?.decision !== 'verified' ||
        verification.verified_amount_minor !== payment.amount_minor
      ) {
        throw new PaymentPrerequisiteFailedError(
          'Verified fitting payment authority is incomplete.',
        );
      }

      const charge = await lockFittingFeeCharge(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      assertCanonicalFeeCharge(fitting, charge);
      if (!charge) throw new Error('Canonical fitting fee charge is missing.');

      const activeRefunds = BigInt(
        await readActiveFittingRefundTotal(client, {
          tenantId: context.tenantId,
          paymentId: payment.payment_id,
        }),
      );
      const refundableByPayment = BigInt(payment.amount_minor) - activeRefunds;
      if (amount > refundableByPayment) {
        throw new CapacityConflictError('Refund amount exceeds the remaining refundable balance.');
      }

      const applyCapacity = await readFittingAllocationApplyCapacity(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        chargeId: charge.charge_id,
      });
      const availableAllocation = applyCapacity.reduce(
        (sum, row) => sum + BigInt(row.amount_minor) - BigInt(row.reversed_minor),
        0n,
      );
      if (amount > availableAllocation) {
        throw new CapacityConflictError(
          'Refund amount exceeds the remaining allocated fitting fee.',
        );
      }

      await client.query(`SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const refundId = randomUUID();
      const refund = await createFittingRefundInstruction(client, {
        refundId,
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        membershipId: context.membershipId,
        amountMinor: Number(amount),
        currency: request.currency,
        businessKey: `fitting:${context.fittingId}:fee-refund:${context.idempotencyKey}`,
      });

      let remaining = amount;
      let sequence = 0;
      for (const apply of applyCapacity) {
        if (remaining === 0n) break;
        const available = BigInt(apply.amount_minor) - BigInt(apply.reversed_minor);
        if (available <= 0n) continue;
        const reversalAmount = available < remaining ? available : remaining;
        sequence += 1;
        await insertFittingRefundAllocationReversal(client, {
          allocationId: randomUUID(),
          tenantId: context.tenantId,
          paymentId: payment.payment_id,
          chargeId: charge.charge_id,
          amountMinor: Number(reversalAmount),
          reversesId: apply.allocation_id,
          businessKey: `refund:${refundId}:allocation-reverse:${sequence}`,
        });
        remaining -= reversalAmount;
      }
      if (remaining !== 0n) {
        throw new StateConflictError('Fitting payment allocation changed during refund creation.');
      }

      await appendFittingRefundAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'refund.requested',
        refundId,
        paymentId: payment.payment_id,
        fittingId: context.fittingId,
        amountMinor: Number(amount),
        requestId: context.requestId,
        summary: { reason: request.reason },
      });

      const body: SuccessEnvelope<RefundCreateResponse> = {
        success: true,
        data: refundCreateResponse.parse({ refund: toRefundSummaryInput(refund) }),
        request_id: context.requestId,
      };
      await finalizeFinanceSuccess(
        client,
        context,
        REQUEST_REFUND_OPERATION,
        payloadHash,
        body,
        201,
      );
      await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 201, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      }
      if (isRefundBalanceConstraint(error)) {
        return finalizeFinanceFailure(
          client,
          context,
          REQUEST_REFUND_OPERATION,
          payloadHash,
          new CapacityConflictError('Refund amount exceeds the remaining refundable balance.'),
        );
      }
      return finalizeFinanceFailure(client, context, REQUEST_REFUND_OPERATION, payloadHash, error);
    }
  });
}

export async function resolveFittingFeeRefundCommand(
  context: FittingRefundResolveContext,
  requestInput: RefundResolveRequest,
): Promise<FittingRefundResolveCommandResponse> {
  const parsed = refundResolveRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting refund resolution request is invalid.');
  assertFittingRefundPermission(context);
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({
    fitting_id: context.fittingId,
    refund_id: context.refundId,
    ...request,
  });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimFinanceIdempotency(
      client,
      context,
      RESOLVE_REFUND_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingRefundResolveCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const fitting = await requireLockedFitting(client, context);
      const payment = await lockCanonicalFittingPayment(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      if (!payment) throw new NotFoundError('Payment could not be found for this fitting.');
      const refund = await lockFittingRefund(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        refundId: context.refundId,
      });
      if (!refund) throw new NotFoundError('Refund could not be found for this fitting payment.');
      if (refund.status !== 'requested' && refund.status !== 'processing') {
        throw new StateConflictError('This refund instruction has already been resolved.');
      }
      const charge = await lockFittingFeeCharge(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      assertCanonicalFeeCharge(fitting, charge);
      if (!charge) throw new Error('Canonical fitting fee charge is missing.');

      await client.query(`SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const resolved = await resolveFittingRefundStatus(client, {
        tenantId: context.tenantId,
        refundId: context.refundId,
        status: request.status,
        merchantReference: request.merchant_reference ?? null,
      });
      if (!resolved)
        throw new StateConflictError('Refund resolution lost a concurrent state change.');

      if (request.status === 'failed' || request.status === 'cancelled') {
        await insertFittingRefundAllocationRestore(client, {
          allocationId: randomUUID(),
          tenantId: context.tenantId,
          paymentId: payment.payment_id,
          chargeId: charge.charge_id,
          amountMinor: refund.amount_minor,
          refundId: refund.refund_id,
        });
      } else {
        const completed = BigInt(
          await readCompletedFittingRefundTotal(client, {
            tenantId: context.tenantId,
            paymentId: payment.payment_id,
          }),
        );
        if (completed === BigInt(payment.amount_minor)) {
          await markFittingPaymentRefunded(client, {
            tenantId: context.tenantId,
            paymentId: payment.payment_id,
          });
        }
      }

      await appendFittingRefundAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: `refund.${request.status}`,
        refundId: refund.refund_id,
        paymentId: payment.payment_id,
        fittingId: context.fittingId,
        amountMinor: refund.amount_minor,
        requestId: context.requestId,
        summary: {
          resolution_note: request.resolution_note,
          has_merchant_reference: request.merchant_reference !== undefined,
        },
      });

      const body: SuccessEnvelope<RefundResolveResponse> = {
        success: true,
        data: refundResolveResponse.parse({ refund: toRefundSummaryInput(resolved) }),
        request_id: context.requestId,
      };
      await finalizeFinanceSuccess(client, context, RESOLVE_REFUND_OPERATION, payloadHash, body);
      await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${FINANCE_EFFECTS_SAVEPOINT}`);
      }
      return finalizeFinanceFailure(client, context, RESOLVE_REFUND_OPERATION, payloadHash, error);
    }
  });
}

function assertFittingRefundPermission(context: FittingFinanceContext): void {
  if (context.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (context.role !== 'owner' || !context.permissionCodes.includes('payments.manage')) {
    throw new ForbiddenError('Owner payment authority is required for refunds.');
  }
}

function toRefundSummaryInput(refund: {
  refund_id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  purpose: 'fitting_fee_refund';
  status: 'requested' | 'processing' | 'completed' | 'failed' | 'cancelled';
  merchant_reference: string | null;
  completed_at: Date | null;
}): RefundSummary {
  return {
    id: refund.refund_id as RefundSummary['id'],
    payment_id: refund.payment_id as RefundSummary['payment_id'],
    amount_minor: String(refund.amount_minor),
    currency: refund.currency,
    purpose: refund.purpose,
    status: refund.status,
    merchant_reference: refund.merchant_reference,
    completed_at: refund.completed_at?.toISOString() ?? null,
  };
}

function isRefundBalanceConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return false;
  const constraint = (error as { constraint?: unknown }).constraint;
  return (
    constraint === 'refund_active_balance_cap' ||
    constraint === 'payment_allocation_reverse_amount_cap'
  );
}

function assertFittingFinanceOperationalPermission(context: FittingFinanceContext): void {
  if (context.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!context.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant fitting operation access.');
  }
}

function assertFittingFinanceVerificationPermission(context: FittingFinanceContext): void {
  assertFittingFinanceOperationalPermission(context);
  if (
    !context.permissionCodes.includes('payments.manage') ||
    !context.permissionCodes.includes('evidence.verify')
  ) {
    throw new ForbiddenError('Merchant payment verification permission is required.');
  }
}

async function requireLockedFitting(
  client: Parameters<typeof lockFittingForFinance>[0],
  context: FittingFinanceContext,
): Promise<NonNullable<Awaited<ReturnType<typeof lockFittingForFinance>>>> {
  const fitting = await lockFittingForFinance(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    fittingId: context.fittingId,
  });
  if (!fitting) throw new NotFoundError('Fitting could not be found.');
  return fitting;
}

function assertCanonicalFeeCharge(
  fitting: { fee_minor: number; currency: string },
  charge: { amount_minor: number; currency: string } | null,
): void {
  if (
    !charge ||
    charge.amount_minor !== fitting.fee_minor ||
    charge.currency !== fitting.currency
  ) {
    throw new StateConflictError('Canonical fitting fee charge is missing or inconsistent.');
  }
}

function parseCashTendered(
  value: string | undefined,
  rail: 'cash' | 'manual_qr' | 'manual_transfer',
): number | null {
  if (rail !== 'cash') {
    if (value !== undefined) {
      throw new ValidationError('Cash tendered is only valid for a cash payment method.');
    }
    return null;
  }
  if (value === undefined) return null;
  const amount = BigInt(value);
  if (amount > POSTGRES_INTEGER_MAX) {
    throw new ValidationError('Cash tendered exceeds the supported money range.');
  }
  return Number(amount);
}

function isImmutableAcceptedReceipt(receipt: LockedFittingReceiptRow): boolean {
  return (
    receipt.file_purpose === 'payment_receipt' &&
    receipt.file_lifecycle_status === 'accepted' &&
    receipt.file_is_private &&
    receipt.file_frozen_at !== null &&
    (receipt.file_version_id !== null || receipt.file_sha256 !== null)
  );
}

async function requireFittingDetail(
  client: Parameters<typeof readFittingDetailModel>[0],
  context: FittingFinanceContext,
): Promise<FittingDetail> {
  const row = await readFittingDetailModel(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    fittingId: context.fittingId,
  });
  if (!row) throw new Error('Fitting finance mutation could not be read back.');
  const now = Date.now();
  const allowedActions: FittingDetail['allowed_actions'] = [];
  if (row.status === 'pending') {
    allowedActions.push('update_note', 'confirm');
    if (now < row.starts_at.getTime()) {
      allowedActions.push('reject', 'cancel', 'reschedule', 'update_garments');
    }
  } else if (row.status === 'confirmed') {
    allowedActions.push('update_note');
    if (now < row.starts_at.getTime()) {
      allowedActions.push('cancel', 'reschedule', 'update_garments');
    }
    if (now >= row.starts_at.getTime()) allowedActions.push('mark_no_show');
    if (now >= row.ends_at.getTime()) allowedActions.push('complete');
  }
  const garments = Array.isArray(row.garments) ? row.garments : [];
  return fittingDetail.parse({
    id: row.fitting_id,
    branch_id: row.branch_id,
    booking_channel: row.booking_channel,
    status: row.status,
    period: { start: row.starts_at.toISOString(), end: row.ends_at.toISOString() },
    timezone_snapshot: row.timezone_snapshot,
    customer: {
      id: row.customer_id,
      full_name: row.customer_full_name,
      phone: row.customer_phone,
      email: row.customer_email,
    },
    garments: garments.map((raw) => {
      const line = raw as Record<string, unknown>;
      const guaranteed = line.garment_guaranteed === true;
      return {
        id: line.id,
        variant: {
          variant_id: line.variant_id,
          product_name: line.product_name,
          sku: line.sku,
          size_label: line.size_label,
          color_label: line.color_label,
        },
        garment_mode: guaranteed ? 'guaranteed' : 'preference',
        assigned_asset: guaranteed ? { id: line.asset_id, asset_code: line.asset_code } : null,
      };
    }),
    fee: {
      fee_minor: String(row.fee_minor),
      currency: row.currency,
      payment: normalizeFittingPayment(row.payment),
    },
    internal_note: row.internal_note,
    terminal_reason: row.terminal_reason,
    attention:
      (row.status === 'pending' || row.status === 'confirmed') && now >= row.ends_at.getTime()
        ? 'outcome_required'
        : 'none',
    allowed_actions: allowedActions,
    version: Number(row.version),
    created_at: row.created_at.toISOString(),
  });
}

function normalizeFittingPayment(value: unknown): FittingDetail['fee']['payment'] {
  if (!value || typeof value !== 'object') return null;
  const payment = value as Record<string, unknown>;
  return {
    id: String(payment.id) as NonNullable<FittingDetail['fee']['payment']>['id'],
    status: payment.status as NonNullable<FittingDetail['fee']['payment']>['status'],
    evidence_status: payment.evidence_status as NonNullable<
      FittingDetail['fee']['payment']
    >['evidence_status'],
    amount_minor: String(payment.amount_minor),
    currency: String(payment.currency),
    verified_at:
      payment.verified_at instanceof Date
        ? payment.verified_at.toISOString()
        : typeof payment.verified_at === 'string'
          ? payment.verified_at
          : null,
  };
}

async function finalizeVerifiedSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingFinanceContext,
  payloadHash: string,
  paymentId: string,
  amountMinor: number,
  verifiedAt: Date,
): Promise<FittingPaymentVerifyCommandResponse> {
  const body: SuccessEnvelope<FittingPaymentVerifyResponse> = {
    success: true,
    data: fittingPaymentVerifyResponse.parse({
      fitting: await requireFittingDetail(client, context),
      payment_id: paymentId,
      payment_status: 'paid',
      verified_amount_minor: String(amountMinor),
      verified_at: verifiedAt.toISOString(),
    }),
    request_id: context.requestId,
  };
  await finalizeFinanceSuccess(client, context, VERIFY_PAYMENT_OPERATION, payloadHash, body);
  return { status: 200, body };
}

async function claimFinanceIdempotency(
  client: Parameters<typeof claimTenantIdempotency>[0],
  context: FittingFinanceContext,
  operation: string,
  payloadHash: string,
): Promise<TenantIdempotencyClaim> {
  return claimTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
  });
}

function replayOrThrow<T extends { status: number; body: unknown }>(
  claim: TenantIdempotencyClaim,
): T | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse } as T;
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError(
      'An identical fitting finance request is already being processed. Retry shortly.',
    );
  }
  return null;
}

async function finalizeFinanceSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingFinanceContext,
  operation: string,
  payloadHash: string,
  body: unknown,
  responseCode = 200,
): Promise<void> {
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode,
    safeResponse: body,
  });
}

async function finalizeFinanceFailure<T extends { status: number; body: unknown }>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingFinanceContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<T> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body } as T;
}
