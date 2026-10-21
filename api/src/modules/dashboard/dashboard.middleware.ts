import type { RequestHandler } from 'express';

import { dashboardOverviewQuery, type DashboardOverviewQuery } from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    dashboardOverviewQuery?: DashboardOverviewQuery;
  }
}

export const requireDashboardReadPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('Reservation management permission is required.'));
    return;
  }
  next();
};

export const validateDashboardOverviewQuery: RequestHandler = (req, _res, next): void => {
  const parsed = dashboardOverviewQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Dashboard overview query is invalid.'));
    return;
  }
  req.dashboardOverviewQuery = parsed.data;
  next();
};
