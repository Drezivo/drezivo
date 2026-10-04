import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import {
  guestFittingRequest,
  guestReceiptSubmitRequest,
  guestReceiptUploadRequest,
  guestReservationRequest,
  reservationId,
  type GuestFittingRequest,
  type GuestReceiptSubmitRequest,
  type GuestReceiptUploadRequest,
  type GuestReservationRequest,
} from '@drezivo/contracts';

import { turnstileVerifier } from '../../integrations/turnstile/turnstile.js';
import { idempotencyKeyOf } from '../../middleware/staff-command.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { guestTokenFor } from '../../shared/guest-token.js';
import type { CommandResult } from '../../shared/idempotent-command.js';
import { sendSuccess } from '../../shared/response.js';
import { readGuestAccessCookie, serializeGuestAccessCookie } from './guest-access-cookie.js';
import { guestBookingService as booking } from './guest-booking.service.js';

export const guestBookingRouter = Router();

const slugParams = z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/) }).strict();
const reservationParams = z.object({ id: reservationId }).strict();

/** Per-address budgets are applied to writes, not normal storefront browsing. */
const perIp = (name: string, max: number, windowMinutes: number): RequestHandler =>
  rateLimit({ windowMs: windowMinutes * 60_000, max, keyOf: (req) => `${name}:${req.ip ?? 'unknown'}` });

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** A reservation capability is accepted only from its host-only, reservation-scoped cookie. */
function capabilityOf(req: Request, reservationId: string): string {
  const capability = readGuestAccessCookie(req.header('Cookie'), reservationId);
  if (!capability) throw new NotFoundError('This booking link is not valid or has expired.');
  return capability;
}

const requireSubmissionTurnstile: RequestHandler = async (req, _res, next) => {
  const token = (req.body as { turnstile_token?: string } | undefined)?.turnstile_token;
  if ((await turnstileVerifier.verify(token, req.ip)) === 'failed') {
    next(new ForbiddenError('Please complete the security check and try again.'));
    return;
  }
  next();
};

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
  '/public/stores/:slug/holds',
  noStore,
  perIp('guest-hold', 20, 15),
  validate({ params: slugParams, body: guestReservationRequest }),
  requireSubmissionTurnstile,
  async (req, res) => {
    const result = await booking.createReservation(slugOf(req), meta(req), req.body as GuestReservationRequest);
    if (result.body.success) {
      const { reservation, access_expires_at: expiresAt } = result.body.data;
      res.append('Set-Cookie', serializeGuestAccessCookie(reservation.id, guestTokenFor(reservation.id), new Date(expiresAt)));
    }
    res.status(result.status).json(result.body);
  },
);

guestBookingRouter.post(
  '/public/stores/:slug/fittings',
  noStore,
  perIp('guest-fitting', 10, 15),
  validate({ params: slugParams, body: guestFittingRequest }),
  requireSubmissionTurnstile,
  sendCommand((req) => booking.requestFitting(slugOf(req), meta(req), req.body as GuestFittingRequest)),
);

guestBookingRouter.get(
  '/guest/reservations/:id',
  noStore,
  perIp('guest-view', 60, 1),
  validate({ params: reservationParams }),
  send((req) => booking.getReservation(idOf(req), capabilityOf(req, idOf(req)))),
);

guestBookingRouter.post(
  '/guest/reservations/:id/uploads',
  noStore,
  perIp('guest-upload', 10, 15),
  validate({ params: reservationParams, body: guestReceiptUploadRequest }),
  send((req) => booking.authorizeReceiptUpload(idOf(req), capabilityOf(req, idOf(req)), req.body as GuestReceiptUploadRequest)),
);

guestBookingRouter.post(
  '/guest/reservations/:id/receipts',
  noStore,
  perIp('guest-receipt', 10, 15),
  validate({ params: reservationParams, body: guestReceiptSubmitRequest }),
  sendCommand((req) => booking.submitReceipt(idOf(req), capabilityOf(req, idOf(req)), meta(req), (req.body as GuestReceiptSubmitRequest).file_id)),
);
