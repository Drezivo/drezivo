import { Router, type Request, type Response } from 'express';
import { sendError } from '../../shared/response.js';

export const reservationsRouter = Router();

// Booking mutations are deliberately unavailable until the transactional service is wired.
// Returning 501 prevents callers from mistaking a scaffold response for a successful booking.
reservationsRouter.post('/public/stores/:slug/holds', (_req: Request, res: Response) => {
  sendError(res, 501, 'NOT_IMPLEMENTED', 'Reservation holds are not available in this scaffold.', res.req.requestId);
});
