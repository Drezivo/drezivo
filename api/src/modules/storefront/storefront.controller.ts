import type { Request, Response } from 'express';

import { sendError } from '../../shared/response.js';
import { getPublicAvailability, getPublicStorefront } from './storefront.service.js';
import type { AvailabilityQuery, StorefrontSlugParams } from './storefront.schemas.js';

const notImplementedMessage = 'Public storefront reads are not available in this scaffold.';

export function getStorefrontController(req: Request, res: Response): void {
  getPublicStorefront(req.params as unknown as StorefrontSlugParams);
  sendError(res, 501, 'NOT_IMPLEMENTED', notImplementedMessage, req.requestId);
}

export function getAvailabilityController(req: Request, res: Response): void {
  getPublicAvailability(
    req.params as unknown as StorefrontSlugParams,
    req.query as unknown as AvailabilityQuery,
  );
  sendError(res, 501, 'NOT_IMPLEMENTED', notImplementedMessage, req.requestId);
}
