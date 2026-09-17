import { Router } from 'express';

import {
  getAvailabilityController,
  getStorefrontController,
} from './storefront.controller.js';

export const storefrontRouter = Router();

storefrontRouter.get('/public/stores/:slug', getStorefrontController);
storefrontRouter.get('/public/stores/:slug/availability', getAvailabilityController);
