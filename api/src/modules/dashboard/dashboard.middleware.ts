import type { RequestHandler } from 'express';

import { ForbiddenError } from '../../shared/errors.js';

export const requireDashboardReadPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('Reservation management permission is required.'));
    return;
  }
  next();
};
