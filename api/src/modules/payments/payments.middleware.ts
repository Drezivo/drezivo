import type { RequestHandler } from 'express';

import { centralPaymentsQuery, type CentralPaymentsQuery } from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    centralPaymentsQuery?: CentralPaymentsQuery;
  }
}

export const requirePaymentsViewPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('payments.view')) {
    next(new ForbiddenError('This branch does not grant payment visibility.'));
    return;
  }
  next();
};

export const validateCentralPaymentsQuery: RequestHandler = (req, _res, next): void => {
  const parsed = centralPaymentsQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Payments query is invalid.'));
    return;
  }
  req.centralPaymentsQuery = parsed.data;
  next();
};
