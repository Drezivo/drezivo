import {
  dashboardFittingSummaryResponse,
  operationalCalendarQuery,
  operationalCalendarResponse,
  type DashboardFittingSummaryResponse,
  type OperationalCalendarQuery,
  type OperationalCalendarResponse,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  readDashboardFittingSummary,
  readOperationalCalendarEvents,
} from './operations.repository.js';

export interface OperationsReadContext {
  tenantId: string;
  branchId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
}

export async function getOperationalCalendar(
  context: OperationsReadContext,
  queryInput: OperationalCalendarQuery,
): Promise<OperationalCalendarResponse> {
  const parsed = operationalCalendarQuery.safeParse(queryInput);
  if (!parsed.success) throw new ValidationError('Calendar query is invalid.');
  assertOperationsReadPermission(context);
  const query = parsed.data;

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const rows = await readOperationalCalendarEvents(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      start: query.start,
      end: query.end,
    });
    return operationalCalendarResponse.parse({
      window: { start: query.start, end: query.end },
      events: rows.map((row) => ({
        id: row.id,
        source: row.source,
        source_id: row.source_id,
        event_type: row.event_type,
        branch_id: row.branch_id,
        period: { start: row.starts_at.toISOString(), end: row.ends_at.toISOString() },
        customer_name: row.customer_name,
        item_names: row.item_names,
        status: row.status,
      })),
    });
  });
}

export async function getDashboardFittingSummary(
  context: OperationsReadContext,
): Promise<DashboardFittingSummaryResponse> {
  assertOperationsReadPermission(context);
  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const row = await readDashboardFittingSummary(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
    });
    if (!row) throw new NotFoundError('Active branch could not be found.');
    return dashboardFittingSummaryResponse.parse({
      window: {
        today_start: row.today_start.toISOString(),
        today_end: row.today_end.toISOString(),
        upcoming_end: row.upcoming_end.toISOString(),
      },
      fittings_today: row.fittings_today,
      fittings_upcoming: row.fittings_upcoming,
      fittings_pending_review: row.fittings_pending_review,
    });
  });
}

function assertOperationsReadPermission(context: OperationsReadContext): void {
  if (!context.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant operational schedule access.');
  }
}
