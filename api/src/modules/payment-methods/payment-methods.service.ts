import type { PoolClient } from 'pg';

import {
  MAX_ONLINE_PAYMENT_METHODS,
  archivePaymentMethodRequest,
  createPaymentMethodRequest,
  paymentMethodSettingsItem,
  paymentMethodSettingsList,
  updatePaymentMethodSettingsRequest,
  type ArchivePaymentMethodRequest,
  type CreatePaymentMethodRequest,
  type PaymentMethodSettingsItem,
  type PaymentMethodSettingsList,
  type PermissionCode,
  type TenantStatus,
  type UpdatePaymentMethodSettingsRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  DependencyUnavailableError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  PaymentMethodLimitError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import { claimTenantIdempotency, finalizeTenantIdempotency } from '../../shared/tenant-idempotency.js';
import { isPaymentMaterialContentType } from './payment-method-readiness.js';
import {
  assertFileObjectCleanupProducerEnabled,
  enqueueReplacedFileObjectCleanup,
} from '../files/file-object-cleanup.repository.js';
import {
  appendPaymentMethodAuditEvent,
  countActiveOnlineMethods,
  insertPaymentMethod,
  isAcceptedStorefrontAsset,
  listPaymentMethodSettings,
  lockOnlineMethodLimit,
  readAcceptedPaymentMaterial,
  readPaymentMethodSettings,
  updatePaymentMethodSettingsRow,
  type PaymentMethodSettingsRow,
} from './payment-methods.repository.js';

const UPDATE_OPERATION = 'payment_method.settings.update';
const CREATE_OPERATION = 'payment_method.create';
const ARCHIVE_OPERATION = 'payment_method.archive';

/** E-wallets whose account number is an 11-digit Philippine mobile number. */
const MOBILE_WALLETS = new Set(['gcash', 'maya']);

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

export async function getPaymentMethodSettings(input: PaymentMethodContext): Promise<PaymentMethodSettingsList> {
  assertCanManagePayments(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const rows = await listPaymentMethodSettings(client, input.tenantId);
    return paymentMethodSettingsList.parse({ items: rows.map(toSettingsItem) });
  });
}

export async function updatePaymentMethodSettings(
  input: PaymentMethodCommandContext & { paymentMethodId: string; request: UpdatePaymentMethodSettingsRequest },
): Promise<PaymentMethodCommandResponse> {
  const parsed = updatePaymentMethodSettingsRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Payment method settings are invalid.');
  const request = parsed.data;

  return runCommand(input, UPDATE_OPERATION, { payment_method_id: input.paymentMethodId, ...request }, 200, async (client) => {
    const current = await readPaymentMethodSettings(client, input.tenantId, input.paymentMethodId, true);
    if (!current) throw new NotFoundError('The payment method could not be found.');
    const cash = current.rail === 'cash';
    if (cash && request.storefront_enabled) {
      throw new ValidationError('Cash is available for staff bookings only and cannot be enabled on the storefront.');
    }
    if (!cash && request.active && !current.active) await assertBelowLimit(client, input.tenantId);
    const presentation = request.presentation ?? current.presentation;
    const files = await checkedFiles(client, input.tenantId, current.name, current.rail, {
      ...request,
      presentation,
      material_file_id: request.material_file_id === undefined ? current.material_file_id : request.material_file_id,
    });

    const currentFileIds = new Set([files.qrFileId, files.materialFileId].filter((fileId): fileId is string => fileId !== null));
    const cleanupCandidates = [
      current.qr_file_id && files.qrFileId && !currentFileIds.has(current.qr_file_id)
        ? current.qr_file_id
        : null,
      current.material_file_id &&
      files.materialFileId &&
      !currentFileIds.has(current.material_file_id)
        ? current.material_file_id
        : null,
    ].filter((fileId): fileId is string => fileId !== null);
    assertFileObjectCleanupProducerEnabled(cleanupCandidates);

    const updated = await updatePaymentMethodSettingsRow(client, {
      tenantId: input.tenantId,
      paymentMethodId: input.paymentMethodId,
      expectedVersion: request.version,
      active: request.active,
      storefrontEnabled: cash ? false : request.storefront_enabled,
      destinationSnapshot: cash ? {} : compactDestination(request.destination),
      qrFileId: files.qrFileId,
      presentation: cash ? 'details' : presentation,
      materialFileId: files.materialFileId,
    });
    if (!updated) throw new StateConflictError('This payment method changed while you were editing it. Refresh and try again.');
    if (current.qr_file_id && !currentFileIds.has(current.qr_file_id)) {
      await enqueueReplacedFileObjectCleanup(client, input.tenantId, current.qr_file_id, files.qrFileId);
    }
    if (current.material_file_id && !currentFileIds.has(current.material_file_id)) {
      await enqueueReplacedFileObjectCleanup(client, input.tenantId, current.material_file_id, files.materialFileId);
    }
    return { paymentMethodId: input.paymentMethodId, action: 'payment_method.settings.updated' as const };
  });
}

/** POST /payment-methods — a new online method; at most MAX_ONLINE_PAYMENT_METHODS active at once. */
export async function createPaymentMethod(
  input: PaymentMethodCommandContext & { request: CreatePaymentMethodRequest },
): Promise<PaymentMethodCommandResponse> {
  const parsed = createPaymentMethodRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('The new payment method is invalid.');
  const request = parsed.data;

  return runCommand(input, CREATE_OPERATION, request, 201, async (client) => {
    await assertBelowLimit(client, input.tenantId);
    const files = await checkedFiles(client, input.tenantId, request.name, request.rail, request);
    const paymentMethodId = await insertPaymentMethod(client, {
      tenantId: input.tenantId,
      name: request.name.trim(),
      rail: request.rail,
      storefrontEnabled: request.storefront_enabled,
      destinationSnapshot: compactDestination(request.destination),
      qrFileId: files.qrFileId,
      presentation: request.presentation,
      materialFileId: files.materialFileId,
    });
    return { paymentMethodId, action: 'payment_method.created' as const };
  });
}

/** POST /payment-methods/:id/archive — "Remove": off for staff and the storefront; history keeps it. */
export async function archivePaymentMethod(
  input: PaymentMethodCommandContext & { paymentMethodId: string; request: ArchivePaymentMethodRequest },
): Promise<PaymentMethodCommandResponse> {
  const parsed = archivePaymentMethodRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('The remove request is invalid.');
  const request = parsed.data;

  return runCommand(input, ARCHIVE_OPERATION, { payment_method_id: input.paymentMethodId, ...request }, 200, async (client) => {
    const current = await readPaymentMethodSettings(client, input.tenantId, input.paymentMethodId);
    if (!current) throw new NotFoundError('The payment method could not be found.');
    if (current.rail === 'cash') throw new ValidationError('Cash cannot be removed. Turn off "Accepted by staff" instead.');
    const updated = await updatePaymentMethodSettingsRow(client, {
      tenantId: input.tenantId,
      paymentMethodId: input.paymentMethodId,
      expectedVersion: request.version,
      active: false,
      storefrontEnabled: false,
      destinationSnapshot: current.destination_snapshot,
      qrFileId: current.qr_file_id,
      presentation: current.presentation,
      materialFileId: current.material_file_id,
    });
    if (!updated) throw new StateConflictError('This payment method changed while you were editing it. Refresh and try again.');
    return { paymentMethodId: input.paymentMethodId, action: 'payment_method.archived' as const };
  });
}

/**
 * One idempotent staff command: the same Idempotency-Key replays the stored response, a different
 * body with the same key is rejected, and business failures are stored so a retry sees them too.
 */
async function runCommand(
  input: PaymentMethodCommandContext,
  operation: string,
  payload: Record<string, unknown>,
  successStatus: number,
  apply: (client: PoolClient) => Promise<{ paymentMethodId: string; action: 'payment_method.settings.updated' | 'payment_method.created' | 'payment_method.archived' }>,
): Promise<PaymentMethodCommandResponse> {
  assertCanManagePayments(input);
  assertWorkspaceWritable(input.effectiveTenantStatus);
  const payloadHash = canonicalRequestHash(payload);
  const key = { tenantId: input.tenantId, principalKey: input.membershipId, operation, intentKey: input.idempotencyKey, payloadHash };

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, key);
    if (claim.kind === 'replayed') {
      return { status: claim.responseCode, body: claim.safeResponse as SuccessEnvelope<PaymentMethodSettingsItem> | FailureEnvelope };
    }
    if (claim.kind === 'key_reused') throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
    if (claim.kind === 'in_progress') throw new StateConflictError('An identical payment method change is already being processed.');

    try {
      const { paymentMethodId, action } = await apply(client);
      const row = await readPaymentMethodSettings(client, input.tenantId, paymentMethodId);
      if (!row) throw new StateConflictError('The payment method could not be read after the change.');
      const data = toSettingsItem(row);
      const body: SuccessEnvelope<PaymentMethodSettingsItem> = { success: true, data, request_id: input.requestId };
      await appendPaymentMethodAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        paymentMethodId,
        active: data.active,
        storefrontEnabled: data.storefront_enabled,
        requestId: input.requestId,
        action,
      });
      await finalizeTenantIdempotency(client, { ...key, status: 'succeeded', responseCode: successStatus, safeResponse: body });
      return { status: successStatus, body };
    } catch (error) {
      if (!isAppError(error) || error instanceof DependencyUnavailableError) throw error;
      const body: FailureEnvelope = { success: false, error: { code: error.code, message: error.message }, request_id: input.requestId };
      await finalizeTenantIdempotency(client, { ...key, status: 'failed', responseCode: error.status, safeResponse: body });
      return { status: error.status, body };
    }
  });
}

async function assertBelowLimit(client: PoolClient, tenantId: string): Promise<void> {
  await lockOnlineMethodLimit(client, tenantId);
  if ((await countActiveOnlineMethods(client, tenantId)) >= MAX_ONLINE_PAYMENT_METHODS) {
    throw new PaymentMethodLimitError(`You can use up to ${MAX_ONLINE_PAYMENT_METHODS} online payment methods. Remove one first.`);
  }
}

/** Validates the account number, QR image, and instructions file a method refers to. */
async function checkedFiles(
  client: PoolClient,
  tenantId: string,
  name: string,
  rail: 'cash' | 'manual_qr' | 'manual_transfer',
  // Plain ids: on update the material id may come from the stored row rather than the request.
  request: Pick<CreatePaymentMethodRequest, 'destination' | 'presentation'> & { qr_file_id: string | null; material_file_id: string | null },
): Promise<{ qrFileId: string | null; materialFileId: string | null }> {
  if (rail === 'cash') return { qrFileId: null, materialFileId: null };
  const accountNumber = request.destination.account_number?.trim() ?? '';
  if (MOBILE_WALLETS.has(name.trim().toLowerCase()) && accountNumber.length > 0 && !/^09\d{9}$/.test(accountNumber)) {
    throw new ValidationError(`${name.trim()} numbers are 11 digits and start with 09.`);
  }
  if (rail !== 'manual_qr' && request.qr_file_id !== null) {
    throw new ValidationError('A QR image can only be attached to a QR payment method.');
  }
  if (request.qr_file_id !== null && !(await isAcceptedStorefrontAsset(client, tenantId, request.qr_file_id))) {
    throw new ValidationError('The QR image must be an accepted image from this workspace.');
  }
  if (request.presentation === 'material') {
    if (!request.material_file_id) throw new ValidationError('Upload your payment instructions file to use it.');
    const mime = await readAcceptedPaymentMaterial(client, tenantId, request.material_file_id);
    if (!mime || !isPaymentMaterialContentType(mime)) {
      throw new ValidationError('The instructions file must be an accepted PDF or image from this workspace.');
    }
  }
  return {
    qrFileId: rail === 'manual_qr' ? request.qr_file_id : null,
    // A details-mode method keeps no material reference; switching back to material means uploading again.
    materialFileId: request.presentation === 'material' ? request.material_file_id : null,
  };
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
  const materialType = row.material_mime && isPaymentMaterialContentType(row.material_mime) ? row.material_mime : null;
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
    presentation: row.presentation,
    material: row.material_file_id && materialType ? { file_id: row.material_file_id, content_type: materialType } : null,
  });
}
