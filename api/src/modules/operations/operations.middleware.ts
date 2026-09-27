import type { RequestHandler } from 'express';

import {
  clothingAvailabilityTimelineQuery,
  operationalCalendarQuery,
  type ClothingAvailabilityTimelineQuery,
  type OperationalCalendarQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    operationalCalendarQuery?: OperationalCalendarQuery;
    clothingAvailabilityTimelineQuery?: ClothingAvailabilityTimelineQuery;
  }
}

export const requireOperationsReadPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('This branch does not grant operational schedule access.'));
    return;
  }
  next();
};

export const validateOperationalCalendarQuery: RequestHandler = (req, _res, next): void => {
  const parsed = operationalCalendarQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Calendar query is invalid.'));
    return;
  }
  req.operationalCalendarQuery = parsed.data;
  next();
};

export const validateClothingAvailabilityTimelineQuery: RequestHandler = (req, _res, next): void => {
  const parsed = clothingAvailabilityTimelineQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Clothing availability query is invalid.'));
    return;
  }
  req.clothingAvailabilityTimelineQuery = parsed.data;
  next();
};
