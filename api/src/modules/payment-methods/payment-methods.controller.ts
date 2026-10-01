import type { Request, Response } from 'express';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import type { ArchivePaymentMethodRequest, CreatePaymentMethodRequest } from '@drezivo/contracts';

import { idempotencyKeyOf } from '../../middleware/staff-command.js';
import {
  archivePaymentMethod,
  createPaymentMethod,
  getPaymentMethodSettings,
  updatePaymentMethodSettings,
  type PaymentMethodContext,
} from './payment-methods.service.js';

export async function listPaymentMethodSettingsController(req: Request, res: Response): Promise<void> {
  sendSuccess(req, res, await getPaymentMethodSettings(requireContext(req)));
}

export async function updatePaymentMethodSettingsController(req: Request, res: Response): Promise<void> {
  const paymentMethodId = req.paymentMethodSettingsId;
  const request = req.paymentMethodSettingsRequest;
  const idempotencyKey = req.paymentMethodSettingsIdempotencyKey;
  if (!paymentMethodId) throw new ValidationError('A valid payment method id is required.');
  if (!request) throw new ValidationError('Payment method settings are invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await updatePaymentMethodSettings({
    ...requireContext(req),
    paymentMethodId,
    request,
    idempotencyKey,
    requestId: req.requestId,
  });
  res.status(result.status).json(result.body);
}

export async function createPaymentMethodController(req: Request, res: Response): Promise<void> {
  const result = await createPaymentMethod({
    ...requireContext(req),
    request: req.body as CreatePaymentMethodRequest,
    idempotencyKey: idempotencyKeyOf(req),
    requestId: req.requestId,
  });
  res.status(result.status).json(result.body);
}

export async function archivePaymentMethodController(req: Request, res: Response): Promise<void> {
  const paymentMethodId = req.paymentMethodSettingsId;
  if (!paymentMethodId) throw new ValidationError('A valid payment method id is required.');
  const result = await archivePaymentMethod({
    ...requireContext(req),
    paymentMethodId,
    request: req.body as ArchivePaymentMethodRequest,
    idempotencyKey: idempotencyKeyOf(req),
    requestId: req.requestId,
  });
  res.status(result.status).json(result.body);
}

function requireContext(req: Request): PaymentMethodContext {
  const principalId = req.clerkPrincipal?.clerkUserId;
  const context = req.tenantContext;
  if (!principalId || !context) throw new ValidationError('Workspace context is required.');

  return {
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    principalId,
    permissionCodes: context.permissionCodes,
    effectiveTenantStatus: context.effectiveTenantStatus,
  };
}
