import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import {
  confirmGuestVerificationRequest,
  guestFittingRequest,
  guestReceiptSubmitRequest,
  guestReceiptUploadRequest,
  guestReservationRequest,
  reservationId,
  startGuestVerificationRequest,
  type ConfirmGuestVerificationRequest,
  type GuestFittingRequest,
  type GuestReceiptSubmitRequest,
  type GuestReceiptUploadRequest,
  type GuestReservationRequest,
  type StartGuestVerificationRequest,
} from '@drezivo/contracts';

import { idempotencyKeyOf } from '../../middleware/staff-command.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { NotFoundError } from '../../shared/errors.js';
import type { CommandResult } from '../../shared/idempotent-command.js';
import { sendSuccess } from '../../shared/response.js';
import { guestBookingService as booking } from './guest-booking.service.js';
import { guestVerificationService as verification } from './guest-verification.service.js';

export const guestBookingRouter = Router();

const slugParams = z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/) }).strict();
const reservationParams = z.object({ id: reservationId }).strict();

/** Per-address budgets. Tight for anything that sends email or writes; normal browsing never hits them. */
const perIp = (name: string, max: number, windowMinutes: number): RequestHandler =>
  rateLimit({ windowMs: windowMinutes * 60_000, max, keyOf: (req) => `${name}:${req.ip ?? 'unknown'}` });

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** The guest token travels only in the Authorization header, never in a URL. Missing or malformed is a concealed 404. */
function bearerOf(req: Request): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.header('Authorization') ?? '');
  if (!match?.[1]) throw new NotFoundError('This booking link is not valid or has expired.');
  return match[1];
}

const slugOf = (req: Request): string => (req.params as { slug: string }).slug;
const idOf = (req: Request): string => (req.params as { id: string }).id;
const meta = (req: Request): { requestId: string; idempotencyKey: string } => ({ requestId: req.requestId, idempotencyKey: idempotencyKeyOf(req) });

function send<T>(run: (req: Request) => Promise<T>): RequestHandler {
  return async (req: Request, res: Response) => sendSuccess(req, res, await run(req));
}
function sendCommand<T>(run: (req: Request) => Promise<CommandResult<T>>): RequestHandler {
  return async (req: Request, res: Response) => {
    const result = await run(req);
    res.status(result.status).json(result.body);
  };
}

guestBookingRouter.post(
  '/public/stores/:slug/verifications',
  noStore,
  perIp('guest-verify-start', 10, 15),
  validate({ params: slugParams, body: startGuestVerificationRequest }),
  send((req) => verification.start(slugOf(req), (req.body as StartGuestVerificationRequest).email)),
);

guestBookingRouter.post(
  '/public/stores/:slug/verifications/confirm',
  noStore,
  perIp('guest-verify-confirm', 20, 15),
  validate({ params: slugParams, body: confirmGuestVerificationRequest }),
  send((req) => {
    const body = req.body as ConfirmGuestVerificationRequest;
    return verification.confirm(slugOf(req), body.email, body.code);
  }),
);

guestBookingRouter.post(
  '/public/stores/:slug/holds',
  noStore,
  perIp('guest-hold', 20, 15),
  validate({ params: slugParams, body: guestReservationRequest }),
  sendCommand((req) => booking.createReservation(slugOf(req), meta(req), req.body as GuestReservationRequest)),
);

guestBookingRouter.post(
  '/public/stores/:slug/fittings',
  noStore,
  perIp('guest-fitting', 10, 15),
  validate({ params: slugParams, body: guestFittingRequest }),
  sendCommand((req) => booking.requestFitting(slugOf(req), meta(req), req.body as GuestFittingRequest)),
);

guestBookingRouter.get(
  '/guest/reservations/:id',
  noStore,
  perIp('guest-view', 60, 1),
  validate({ params: reservationParams }),
  send((req) => booking.getReservation(idOf(req), bearerOf(req))),
);

guestBookingRouter.post(
  '/guest/reservations/:id/uploads',
  noStore,
  perIp('guest-upload', 10, 15),
  validate({ params: reservationParams, body: guestReceiptUploadRequest }),
  send((req) => booking.authorizeReceiptUpload(idOf(req), bearerOf(req), req.body as GuestReceiptUploadRequest)),
);

guestBookingRouter.post(
  '/guest/reservations/:id/receipts',
  noStore,
  perIp('guest-receipt', 10, 15),
  validate({ params: reservationParams, body: guestReceiptSubmitRequest }),
  sendCommand((req) => booking.submitReceipt(idOf(req), bearerOf(req), meta(req), (req.body as GuestReceiptSubmitRequest).file_id)),
);
