import type { RequestHandler } from 'express';

import {
  reservationId,
  reservationListQuery,
  type ReservationListQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    reservationListQuery?: ReservationListQuery;
    reservationId?: string;
  }
}

export const requireReservationManagePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('This branch does not grant reservation management access.'));
    return;
  }
  next();
};

export const validateReservationListQuery: RequestHandler = (req, _res, next): void => {
  const parsed = reservationListQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Reservation list query is invalid.'));
    return;
  }
  req.reservationListQuery = parsed.data;
  next();
};

export const validateReservationId: RequestHandler = (req, _res, next): void => {
  const parsed = reservationId.safeParse(req.params.reservationId);
  if (!parsed.success) {
    next(new ValidationError('A valid reservation id is required.'));
    return;
  }
  req.reservationId = parsed.data;
  next();
};
