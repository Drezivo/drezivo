import { Router } from 'express';

import { createPublicHoldController } from './reservations.controller.js';

export const reservationsRouter = Router();

reservationsRouter.post('/public/stores/:slug/holds', createPublicHoldController);
