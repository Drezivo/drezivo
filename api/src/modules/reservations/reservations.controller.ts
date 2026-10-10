import type { Request, Response } from 'express';

import type { PermissionCode, TenantStatus } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  attachReservationReceipt,
  cancelReservation,
  collectReservationBalance,
  editReservation,
  completeStaffReservation,
  confirmReservation,
  createStaffReservation,
  getReservationDetail,
  getReservationPaymentReceipts,
  getReservationList,
  getStaffReservationAvailabilityCalendar,
  getStaffReservationAvailabilityCheck,
  getStaffReservationIntakeOptions,
  pickupReservation,
  rejectReservation,
  verifyReservationPayment,
  returnReservation,
  inspectReturnedReservation,
  completeRentalReservation,
  submitReservation,
} from './reservations.service.js';

export async function listReservationsController(req: Request, res: Response): Promise<void> {
  const query = req.reservationListQuery;
  if (!query) throw new ValidationError('A valid reservation list query is required.');
  sendSuccess(req, res, await getReservationList(requireContext(req), query));
}

export async function getReservationDetailController(req: Request, res: Response): Promise<void> {
  if (!req.reservationId) throw new ValidationError('A valid reservation id is required.');
  sendSuccess(req, res, await getReservationDetail(requireContext(req), req.reservationId));
}

export async function getReservationPaymentReceiptsController(req: Request, res: Response): Promise<void> {
  if (!req.reservationId) throw new ValidationError('A valid reservation id is required.');
  sendSuccess(req, res, await getReservationPaymentReceipts(requireContext(req), req.reservationId));
}

export async function getStaffReservationIntakeOptionsController(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.reservationIntakeQuery;
  if (!query) throw new ValidationError('A valid reservation intake query is required.');
  sendSuccess(req, res, await getStaffReservationIntakeOptions(requireContext(req), query));
}

export async function getStaffReservationAvailabilityCalendarController(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.reservationAvailabilityCalendarQuery;
  if (!query) throw new ValidationError('A valid reservation availability calendar query is required.');
  sendSuccess(req, res, await getStaffReservationAvailabilityCalendar(requireContext(req), query));
}

export async function getStaffReservationAvailabilityCheckController(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.reservationAvailabilityCheckQuery;
  if (!query) throw new ValidationError('A valid reservation availability check query is required.');
  sendSuccess(req, res, await getStaffReservationAvailabilityCheck(requireContext(req), query));
}

export async function createStaffReservationController(req: Request, res: Response): Promise<void> {
  const request = req.reservationCreateRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!request) throw new ValidationError('Staff reservation request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await createStaffReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    request,
  );
  res.status(result.status).json(result.body);
}

export async function completeStaffReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationCompleteRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Staff reservation completion request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await completeStaffReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function cancelReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationCancelRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation cancellation request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await cancelReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function collectReservationBalanceController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const paymentId = req.reservationPaymentId;
  const request = req.reservationBalanceCollectRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId || !paymentId) throw new ValidationError('A valid reservation and payment id are required.');
  if (!request) throw new ValidationError('Balance collection request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await collectReservationBalance(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    paymentId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function editReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationEditRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation edit request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await editReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function pickupReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationPickupRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation pickup request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await pickupReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function returnReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationReturnRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation return request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await returnReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function inspectReturnedReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationInspectionRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation inspection request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await inspectReturnedReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function completeRentalReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationRentalCompleteRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation completion request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await completeRentalReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function submitReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationSubmitRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation submission request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await submitReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function attachReservationPaymentReceiptController(
  req: Request,
  res: Response,
): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationPaymentReceiptAttachRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation payment receipt request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await attachReservationReceipt(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function verifyReservationPaymentController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationPaymentVerifyRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation payment verification request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await verifyReservationPayment(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function confirmReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationConfirmRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation confirmation request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await confirmReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function rejectReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationRejectRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation rejection request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await rejectReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

function requireContext(req: Request): {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
} {
  const principalId = req.clerkPrincipal?.clerkUserId;
  const context = req.tenantContext;
  if (!principalId || !context) throw new ValidationError('Workspace context is required.');

  return {
    tenantId: context.tenantId,
    branchId: context.activeBranchId,
    membershipId: context.membershipId,
    principalId,
    permissionCodes: context.permissionCodes,
    effectiveTenantStatus: context.effectiveTenantStatus,
  };
}
