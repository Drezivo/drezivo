import { Router, type Request, type Response } from 'express';
import { sendError } from '../../shared/response.js';

export const storefrontRouter = Router();

storefrontRouter.get('/public/stores/:slug', (req: Request, res: Response) => {
  sendError(res, 501, 'NOT_IMPLEMENTED', 'Public storefront reads are not available in this scaffold.', req.requestId);
});

storefrontRouter.get('/public/stores/:slug/availability', (req: Request, res: Response) => {
  sendError(res, 501, 'NOT_IMPLEMENTED', 'Public availability reads are not available in this scaffold.', req.requestId);
});
