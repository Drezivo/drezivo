import type { Request, Response } from 'express';

import { sendError } from '../../shared/response.js';
import { createPublicHold } from './reservations.service.js';

export function createPublicHoldController(req: Request, res: Response): void {
  createPublicHold();
  sendError(
    res,
    501,
    'NOT_IMPLEMENTED',
    'Reservation holds are not available in this scaffold.',
    req.requestId,
  );
}
