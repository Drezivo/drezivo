import type { RequestHandler } from 'express';

import {
  fittingCancelRequest,
  fittingClosureCreateRequest,
  fittingClosureListQuery,
  fittingClosureParams,
  fittingClosureRemoveRequest,
  fittingClosureUpdateRequest,
  fittingCompleteRequest,
  fittingConfirmRequest,
  fittingCreateRequest,
  fittingGarmentPlanUpdateRequest,
  fittingIntakeQuery,
  fittingListQuery,
  fittingNoShowRequest,
  fittingNoteUpdateRequest,
  fittingParams,
  fittingPaymentIntentCreateRequest,
  fittingPaymentReceiptAttachRequest,
  fittingPaymentVerifyRequest,
  fittingRejectRequest,
  fittingRescheduleRequest,
  fittingSettingsUpdateRequest,
  fittingWeeklyHoursUpdateRequest,
  idempotencyKey,
  type FittingCancelRequest,
  type FittingClosureCreateRequest,
  type FittingClosureListQuery,
  type FittingClosureRemoveRequest,
  type FittingClosureUpdateRequest,
  type FittingCompleteRequest,
  type FittingConfirmRequest,
  type FittingCreateRequest,
  type FittingGarmentPlanUpdateRequest,
  type FittingIntakeQuery,
  type FittingListQuery,
  type FittingNoShowRequest,
  type FittingNoteUpdateRequest,
  type FittingPaymentIntentCreateRequest,
  type FittingPaymentReceiptAttachRequest,
  type FittingPaymentVerifyRequest,
  type FittingRejectRequest,
  type FittingRescheduleRequest,
  type FittingSettingsUpdateRequest,
  type FittingWeeklyHoursUpdateRequest,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    fittingId?: string;
    fittingClosureId?: string;
    fittingIdempotencyKey?: string;
    fittingListQuery?: FittingListQuery;
    fittingIntakeQuery?: FittingIntakeQuery;
    fittingClosureListQuery?: FittingClosureListQuery;
    fittingCreateRequest?: FittingCreateRequest;
    fittingNoteUpdateRequest?: FittingNoteUpdateRequest;
    fittingGarmentPlanUpdateRequest?: FittingGarmentPlanUpdateRequest;
    fittingRescheduleRequest?: FittingRescheduleRequest;
    fittingConfirmRequest?: FittingConfirmRequest;
    fittingRejectRequest?: FittingRejectRequest;
    fittingCancelRequest?: FittingCancelRequest;
    fittingCompleteRequest?: FittingCompleteRequest;
    fittingNoShowRequest?: FittingNoShowRequest;
    fittingPaymentIntentCreateRequest?: FittingPaymentIntentCreateRequest;
    fittingPaymentReceiptAttachRequest?: FittingPaymentReceiptAttachRequest;
    fittingPaymentVerifyRequest?: FittingPaymentVerifyRequest;
    fittingSettingsUpdateRequest?: FittingSettingsUpdateRequest;
    fittingWeeklyHoursUpdateRequest?: FittingWeeklyHoursUpdateRequest;
    fittingClosureCreateRequest?: FittingClosureCreateRequest;
    fittingClosureUpdateRequest?: FittingClosureUpdateRequest;
    fittingClosureRemoveRequest?: FittingClosureRemoveRequest;
  }
}

export const requireFittingOperationalPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('This branch does not grant fitting operation access.'));
    return;
  }
  next();
};

export const requireFittingConfigurationOwner: RequestHandler = (req, _res, next): void => {
  if (
    req.tenantContext?.role !== 'owner' ||
    !req.tenantContext.permissionCodes.includes('reservations.manage')
  ) {
    next(new ForbiddenError('Only Owner may mutate fitting configuration.'));
    return;
  }
  next();
};

export const requireFittingPaymentVerificationPermission: RequestHandler = (
  req,
  _res,
  next,
): void => {
  const permissions = req.tenantContext?.permissionCodes ?? [];
  if (
    !permissions.includes('reservations.manage') ||
    !permissions.includes('payments.manage') ||
    !permissions.includes('evidence.verify')
  ) {
    next(new ForbiddenError('Merchant payment verification permission is required.'));
    return;
  }
  next();
};

export const requireFittingIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key'));
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.fittingIdempotencyKey = parsed.data;
  next();
};

export const validateFittingId: RequestHandler = (req, _res, next): void => {
  const parsed = fittingParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    next(new ValidationError('A valid fitting id is required.'));
    return;
  }
  req.fittingId = parsed.data.id;
  next();
};

export const validateFittingClosureId: RequestHandler = (req, _res, next): void => {
  const parsed = fittingClosureParams.safeParse({ closureId: req.params.closureId });
  if (!parsed.success) {
    next(new ValidationError('A valid fitting closure id is required.'));
    return;
  }
  req.fittingClosureId = parsed.data.closureId;
  next();
};

function bodyValidator<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  assign: (req: Parameters<RequestHandler>[0], data: T) => void,
  message: string,
): RequestHandler {
  return (req, _res, next): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(message));
      return;
    }
    assign(req, parsed.data);
    next();
  };
}

function queryValidator<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  assign: (req: Parameters<RequestHandler>[0], data: T) => void,
  message: string,
): RequestHandler {
  return (req, _res, next): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError(message));
      return;
    }
    assign(req, parsed.data);
    next();
  };
}

export const validateFittingListQuery = queryValidator(
  fittingListQuery,
  (req, data) => {
    req.fittingListQuery = data;
  },
  'Fitting list query is invalid.',
);
export const validateFittingIntakeQuery = queryValidator(
  fittingIntakeQuery,
  (req, data) => {
    req.fittingIntakeQuery = data;
  },
  'Fitting intake query is invalid.',
);
export const validateFittingClosureListQuery = queryValidator(
  fittingClosureListQuery,
  (req, data) => {
    req.fittingClosureListQuery = data;
  },
  'Fitting closure query is invalid.',
);

export const validateFittingCreate = bodyValidator(
  fittingCreateRequest,
  (req, data) => {
    req.fittingCreateRequest = data;
  },
  'Staff fitting request is invalid.',
);
export const validateFittingNoteUpdate = bodyValidator(
  fittingNoteUpdateRequest,
  (req, data) => {
    req.fittingNoteUpdateRequest = data;
  },
  'Fitting note request is invalid.',
);
export const validateFittingGarmentPlanUpdate = bodyValidator(
  fittingGarmentPlanUpdateRequest,
  (req, data) => {
    req.fittingGarmentPlanUpdateRequest = data;
  },
  'Fitting garment plan request is invalid.',
);
export const validateFittingReschedule = bodyValidator(
  fittingRescheduleRequest,
  (req, data) => {
    req.fittingRescheduleRequest = data;
  },
  'Fitting reschedule request is invalid.',
);
export const validateFittingConfirm = bodyValidator(
  fittingConfirmRequest,
  (req, data) => {
    req.fittingConfirmRequest = data;
  },
  'Fitting confirmation request is invalid.',
);
export const validateFittingReject = bodyValidator(
  fittingRejectRequest,
  (req, data) => {
    req.fittingRejectRequest = data;
  },
  'Fitting rejection request is invalid.',
);
export const validateFittingCancel = bodyValidator(
  fittingCancelRequest,
  (req, data) => {
    req.fittingCancelRequest = data;
  },
  'Fitting cancellation request is invalid.',
);
export const validateFittingComplete = bodyValidator(
  fittingCompleteRequest,
  (req, data) => {
    req.fittingCompleteRequest = data;
  },
  'Fitting completion request is invalid.',
);
export const validateFittingNoShow = bodyValidator(
  fittingNoShowRequest,
  (req, data) => {
    req.fittingNoShowRequest = data;
  },
  'Fitting no-show request is invalid.',
);
export const validateFittingPaymentIntentCreate = bodyValidator(
  fittingPaymentIntentCreateRequest,
  (req, data) => {
    req.fittingPaymentIntentCreateRequest = data;
  },
  'Fitting payment request is invalid.',
);
export const validateFittingPaymentReceiptAttach = bodyValidator(
  fittingPaymentReceiptAttachRequest,
  (req, data) => {
    req.fittingPaymentReceiptAttachRequest = data;
  },
  'Fitting payment receipt request is invalid.',
);
export const validateFittingPaymentVerify = bodyValidator(
  fittingPaymentVerifyRequest,
  (req, data) => {
    req.fittingPaymentVerifyRequest = data;
  },
  'Fitting payment verification request is invalid.',
);
export const validateFittingSettingsUpdate = bodyValidator(
  fittingSettingsUpdateRequest,
  (req, data) => {
    req.fittingSettingsUpdateRequest = data;
  },
  'Fitting settings request is invalid.',
);
export const validateFittingWeeklyHoursUpdate = bodyValidator(
  fittingWeeklyHoursUpdateRequest,
  (req, data) => {
    req.fittingWeeklyHoursUpdateRequest = data;
  },
  'Weekly fitting-hours request is invalid.',
);
export const validateFittingClosureCreate = bodyValidator(
  fittingClosureCreateRequest,
  (req, data) => {
    req.fittingClosureCreateRequest = data;
  },
  'Fitting closure request is invalid.',
);
export const validateFittingClosureUpdate = bodyValidator(
  fittingClosureUpdateRequest,
  (req, data) => {
    req.fittingClosureUpdateRequest = data;
  },
  'Fitting closure request is invalid.',
);
export const validateFittingClosureRemove = bodyValidator(
  fittingClosureRemoveRequest,
  (req, data) => {
    req.fittingClosureRemoveRequest = data;
  },
  'Fitting closure removal request is invalid.',
);
