import {
  dashboardOverviewResponse,
  type DashboardOverviewQuery,
  type DashboardOverviewResponse,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { readDashboardOverview } from './dashboard.repository.js';

export interface DashboardReadContext {
  tenantId: string;
  branchId: string;
  principalId: string;
  permissionCodes: string[];
}

export async function getDashboardOverview(
  context: DashboardReadContext,
  query: DashboardOverviewQuery,
): Promise<DashboardOverviewResponse> {
  if (!context.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('Reservation management permission is required.');
  }

  const projection = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
    readDashboardOverview(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      query,
    }),
  );
  if (!projection) throw new NotFoundError('The active branch could not be found.');

  const parsed = dashboardOverviewResponse.safeParse(projection);
  if (!parsed.success) throw new ValidationError('Dashboard projection is invalid.');
  return parsed.data;
}
