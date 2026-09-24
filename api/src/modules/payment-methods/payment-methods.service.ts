import {
  paymentMethodSettingsItem,
  paymentMethodSettingsList,
  updatePaymentMethodSettingsRequest,
  type PaymentMethodSettingsItem,
  type PaymentMethodSettingsList,
  type PermissionCode,
  type TenantStatus,
  type UpdatePaymentMethodSettingsRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
} from '../../shared/tenant-idempotency.js';
import {
  appendPaymentMethodAuditEvent,
  isAcceptedStorefrontAsset,
  listPaymentMethodSettings,
  readPaymentMethodSettings,
  updatePaymentMethodSettingsRow,
  type PaymentMethodSettingsRow,
} from './payment-methods.repository.js';

const UPDATE_OPERATION = 'payment_method.settings.update';

export interface PaymentMethodContext {
  tenantId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
}

export interface PaymentMethodCommandContext extends PaymentMethodContext {
  requestId: string;
  idempotencyKey: string;
}

export interface PaymentMethodCommandResponse {
  status: number;
  body: SuccessEnvelope<PaymentMethodSettingsItem> | FailureEnvelope;
}

export async function getPaymentMethodSettings(
  input: PaymentMethodContext,
): Promise<PaymentMethodSettingsList> {
  assertCanManagePayments(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const rows = await listPaymentMethodSettings(client, input.tenantId);
    return paymentMethodSettingsList.parse({ items: rows.map(toSettingsItem) });
  });
}

export async function updatePaymentMethodSettings(
  input: PaymentMethodCommandContext & {
    paymentMethodId: string;
    request: UpdatePaymentMethodSettingsRequest;
  },
): Promise<PaymentMethodCommandResponse> {
  assertCanManagePayments(input);
  assertWorkspaceWritable(input.effectiveTenantStatus);

  const parsed = updatePaymentMethodSettingsRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Payment method settings are invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ payment_method_id: input.paymentMethodId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: UPDATE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') {
      return {
        status: claim.responseCode,
        body: claim.safeResponse as SuccessEnvelope<PaymentMethodSettingsItem> | FailureEnvelope,
      };
    }
    if (claim.kind === 'key_reused') {
      throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
    }
    if (claim.kind === 'in_progress') {
      throw new StateConflictError('An identical payment method update is already being processed.');
    }

    try {
      const current = await readPaymentMethodSettings(client, input.tenantId, input.paymentMethodId);
      if (!current) throw new NotFoundError('The payment method could not be found.');

      if (current.rail === 'cash' && request.storefront_enabled) {
        throw new ValidationError('Cash is available for staff bookings only and cannot be enabled on the storefront.');
      }
      const isGcash = current.name.trim().toLowerCase() === 'gcash';
      const accountNumber = request.destination.account_number?.trim() ?? '';
      if (isGcash && accountNumber.length > 0 && !/^\d{11}$/.test(accountNumber)) {
        throw new ValidationError('GCash number must be exactly 11 digits.');
      }
      if (current.rail !== 'manual_qr' && request.qr_file_id !== null) {
        throw new ValidationError('A QR image can only be attached to a QR payment method.');
      }
      if (
        request.qr_file_id !== null &&
        !(await isAcceptedStorefrontAsset(client, input.tenantId, request.qr_file_id))
      ) {
        throw new ValidationError('The QR image must be an accepted storefront image from this workspace.');
      }

      const updated = await updatePaymentMethodSettingsRow(client, {
        tenantId: input.tenantId,
        paymentMethodId: input.paymentMethodId,
        expectedVersion: request.version,
        active: request.active,
        storefrontEnabled: current.rail === 'cash' ? false : request.storefront_enabled,
        destinationSnapshot: current.rail === 'cash' ? {} : compactDestination(request.destination),
        qrFileId: current.rail === 'manual_qr' ? request.qr_file_id : null,
      });
      if (!updated) {
        throw new StateConflictError('This payment method changed while you were editing it. Refresh and try again.');
      }

      const row = await readPaymentMethodSettings(client, input.tenantId, input.paymentMethodId);
      if (!row) throw new StateConflictError('The updated payment method could not be read.');
      const data = toSettingsItem(row);
      const body: SuccessEnvelope<PaymentMethodSettingsItem> = {
        success: true,
        data,
        request_id: input.requestId,
      };

      await appendPaymentMethodAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        paymentMethodId: input.paymentMethodId,
        active: data.active,
        storefrontEnabled: data.storefront_enabled,
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      if (!isAppError(error)) throw error;
      const body: FailureEnvelope = {
        success: false,
        error: { code: error.code, message: error.message },
        request_id: input.requestId,
      };
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'failed',
        responseCode: error.status,
        safeResponse: body,
      });
      return { status: error.status, body };
    }
  });
}

function assertCanManagePayments(input: PaymentMethodContext): void {
  if (!input.permissionCodes.includes('payments.manage')) {
    throw new ForbiddenError('Payment method settings require payment management access.');
  }
}

function assertWorkspaceWritable(status: TenantStatus): void {
  if (status === 'restricted') throw new TenantRestrictedError('This workspace is temporarily restricted.');
  if (status === 'cancelled') throw new TenantCancelledError('This workspace is closed.');
}

function compactDestination(destination: UpdatePaymentMethodSettingsRequest['destination']): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (destination.account_name) result['account_name'] = destination.account_name;
  if (destination.account_number) result['account_number'] = destination.account_number;
  if (destination.instructions) result['instructions'] = destination.instructions;
  return result;
}

function safeDestinationValue(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toSettingsItem(row: PaymentMethodSettingsRow): PaymentMethodSettingsItem {
  return paymentMethodSettingsItem.parse({
    id: row.id,
    name: row.name,
    rail: row.rail,
    active: row.active,
    storefront_enabled: row.storefront_enabled,
    storefront_ready: row.storefront_ready,
    version: row.version,
    destination: {
      account_name: safeDestinationValue(row.destination_snapshot, 'account_name'),
      account_number: safeDestinationValue(row.destination_snapshot, 'account_number'),
      instructions: safeDestinationValue(row.destination_snapshot, 'instructions'),
    },
    qr_file_id: row.qr_file_id,
  });
}
