import type { RequestHandler } from 'express';

import {
  idempotencyKey,
  paymentMethodId,
  updatePaymentMethodSettingsRequest,
  type UpdatePaymentMethodSettingsRequest,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    paymentMethodSettingsId?: string;
    paymentMethodSettingsRequest?: UpdatePaymentMethodSettingsRequest;
    paymentMethodSettingsIdempotencyKey?: string;
  }
}

export const requirePaymentManagePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('payments.manage')) {
    next(new ForbiddenError('Payment method settings require payment management access.'));
    return;
  }
  next();
};

export const validatePaymentMethodSettingsId: RequestHandler = (req, _res, next): void => {
  const parsed = paymentMethodId.safeParse(req.params.paymentMethodId);
  if (!parsed.success) {
    next(new ValidationError('A valid payment method id is required.'));
    return;
  }
  req.paymentMethodSettingsId = parsed.data;
  next();
};

export const validateUpdatePaymentMethodSettings: RequestHandler = (req, _res, next): void => {
  const parsed = updatePaymentMethodSettingsRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Payment method settings are invalid.'));
    return;
  }
  req.paymentMethodSettingsRequest = parsed.data;
  next();
};

export const requirePaymentMethodSettingsIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.paymentMethodSettingsIdempotencyKey = parsed.data;
  next();
};
