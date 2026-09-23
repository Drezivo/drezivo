import type { RequestHandler } from 'express';

import {
  idempotencyKey,
  reservationCancelRequest,
  reservationConfirmRequest,
  reservationId,
  reservationListQuery,
  reservationPickupRequest,
  reservationRejectRequest,
  reservationReturnRequest,
  reservationSubmitRequest,
  staffReservationCompleteRequest,
  staffReservationCreateRequest,
  type ReservationCancelRequest,
  type ReservationConfirmRequest,
  type ReservationListQuery,
  type ReservationPickupRequest,
  type ReservationRejectRequest,
  type ReservationReturnRequest,
  type ReservationSubmitRequest,
  type StaffReservationCompleteRequest,
  type StaffReservationCreateRequest,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    reservationListQuery?: ReservationListQuery;
    reservationId?: string;
    reservationCreateRequest?: StaffReservationCreateRequest;
    reservationCompleteRequest?: StaffReservationCompleteRequest;
    reservationCancelRequest?: ReservationCancelRequest;
    reservationPickupRequest?: ReservationPickupRequest;
    reservationReturnRequest?: ReservationReturnRequest;
    reservationSubmitRequest?: ReservationSubmitRequest;
    reservationConfirmRequest?: ReservationConfirmRequest;
    reservationRejectRequest?: ReservationRejectRequest;
    reservationIdempotencyKey?: string;
  }
}

export const requireReservationManagePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('This branch does not grant reservation management access.'));
    return;
  }
  next();
};

export const requireReservationCustodyPermission: RequestHandler = (req, _res, next): void => {
  const permissions = req.tenantContext?.permissionCodes ?? [];
  if (!permissions.includes('reservations.manage') || !permissions.includes('reservations.custody')) {
    next(new ForbiddenError('Reservation custody permission is required.'));
    return;
  }
  next();
};

export const requireMerchantReservationReviewPermission: RequestHandler = (req, _res, next): void => {
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

export const validateStaffReservationCreate: RequestHandler = (req, _res, next): void => {
  const parsed = staffReservationCreateRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Staff reservation request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationCreateRequest = parsed.data;
  next();
};

export const validateStaffReservationComplete: RequestHandler = (req, _res, next): void => {
  const parsed = staffReservationCompleteRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Staff reservation completion request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationCompleteRequest = parsed.data;
  next();
};

export const validateReservationCancel: RequestHandler = (req, _res, next): void => {
  const parsed = reservationCancelRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Reservation cancellation request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationCancelRequest = parsed.data;
  next();
};

export const validateReservationPickup: RequestHandler = (req, _res, next): void => {
  const parsed = reservationPickupRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Reservation pickup request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationPickupRequest = parsed.data;
  next();
};

export const validateReservationReturn: RequestHandler = (req, _res, next): void => {
  const parsed = reservationReturnRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Reservation return request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationReturnRequest = parsed.data;
  next();
};

export const validateReservationSubmit: RequestHandler = (req, _res, next): void => {
  const parsed = reservationSubmitRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Reservation submission request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationSubmitRequest = parsed.data;
  next();
};

export const validateReservationConfirm: RequestHandler = (req, _res, next): void => {
  const parsed = reservationConfirmRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Reservation confirmation request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationConfirmRequest = parsed.data;
  next();
};

export const validateReservationReject: RequestHandler = (req, _res, next): void => {
  const parsed = reservationRejectRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Reservation rejection request is invalid.'));
    return;
  }
  req.body = parsed.data;
  req.reservationRejectRequest = parsed.data;
  next();
};

export const requireReservationIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.reservationIdempotencyKey = parsed.data;
  next();
};
