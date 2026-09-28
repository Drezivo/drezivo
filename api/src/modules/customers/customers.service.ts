import {
  customerListResponse,
  customerSummaryResponse,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerSummaryResponse,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { listCustomersReadModel, readCustomerSummary } from './customers.repository.js';

export interface CustomerReadContext {
  tenantId: string;
  branchId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
}

export async function getCustomerList(
  context: CustomerReadContext,
  query: CustomerListQuery,
): Promise<CustomerListResponse> {
  assertCustomerReadPermission(context.permissionCodes);
  const page = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
    listCustomersReadModel(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      query,
    }),
  );

  return customerListResponse.parse({
    items: page.rows.map((row) => ({
      id: row.customer_id,
      full_name: row.full_name,
      phone: row.phone,
      email: row.email,
      status: row.archived_at === null ? 'active' : 'archived',
      reservation_count: row.reservation_count,
      fitting_count: row.fitting_count,
      last_activity:
        row.last_activity_type && row.last_activity_at
          ? { type: row.last_activity_type, at: row.last_activity_at.toISOString() }
          : null,
      next_activity:
        row.next_activity_type && row.next_activity_at
          ? { type: row.next_activity_type, at: row.next_activity_at.toISOString() }
          : null,
      created_at: row.created_at.toISOString(),
    })),
    page_meta: {
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
    },
  });
}

export async function getCustomerSummary(
  context: CustomerReadContext,
): Promise<CustomerSummaryResponse> {
  assertCustomerReadPermission(context.permissionCodes);
  const summary = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
    readCustomerSummary(client, { tenantId: context.tenantId, branchId: context.branchId }),
  );
  if (!summary) throw new NotFoundError('Active branch could not be found.');
  return customerSummaryResponse.parse(summary);
}

export function assertCustomerReadPermission(permissionCodes: PermissionCode[]): void {
  if (!permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('Customer directory access requires reservation management permission.');
  }
}
