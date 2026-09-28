import {
  customerDetailResponse,
  customerFittingHistoryResponse,
  customerListResponse,
  customerReservationHistoryResponse,
  customerSummaryResponse,
  type CustomerDetailResponse,
  type CustomerFittingHistoryResponse,
  type CustomerHistoryQuery,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerReservationHistoryResponse,
  type CustomerSummaryResponse,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import {
  listCustomerFittingHistory,
  listCustomerReservationHistory,
  listCustomersReadModel,
  readCustomerDetailModel,
  readCustomerSummary,
} from './customers.repository.js';

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

export async function getCustomerDetail(
  context: CustomerReadContext,
  customerId: string,
): Promise<CustomerDetailResponse> {
  assertCustomerReadPermission(context.permissionCodes);
  const row = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
    readCustomerDetailModel(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      customerId,
    }),
  );
  if (!row) throw new NotFoundError('Customer could not be found.');

  return customerDetailResponse.parse({
    id: row.customer_id,
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    social_media: row.social_media,
    notes: row.notes,
    status: row.archived_at === null ? 'active' : 'archived',
    archived_at: row.archived_at?.toISOString() ?? null,
    reservation_count: row.reservation_count,
    fitting_count: row.fitting_count,
    completed_engagement_count: row.completed_engagement_count,
    last_activity:
      row.last_activity_type && row.last_activity_at
        ? { type: row.last_activity_type, at: row.last_activity_at.toISOString() }
        : null,
    next_activity:
      row.next_activity_type && row.next_activity_at
        ? { type: row.next_activity_type, at: row.next_activity_at.toISOString() }
        : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

export async function getCustomerReservationHistory(
  context: CustomerReadContext,
  customerId: string,
  query: CustomerHistoryQuery,
): Promise<CustomerReservationHistoryResponse> {
  assertCustomerReadPermission(context.permissionCodes);
  const page = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
    listCustomerReservationHistory(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      customerId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }),
  );
  if (!page) throw new NotFoundError('Customer could not be found.');

  return customerReservationHistoryResponse.parse({
    items: page.rows.map((row) => ({
      id: row.id,
      reference_code: row.reference_code,
      clothing_name_snapshot: row.clothing_name_snapshot,
      status: row.status,
      pickup_at: row.pickup_at.toISOString(),
      due_at: row.due_at.toISOString(),
      rental_total_minor: row.rental_total_minor,
      currency: row.currency,
    })),
    page_meta: {
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
    },
  });
}

export async function getCustomerFittingHistory(
  context: CustomerReadContext,
  customerId: string,
  query: CustomerHistoryQuery,
): Promise<CustomerFittingHistoryResponse> {
  assertCustomerReadPermission(context.permissionCodes);
  const page = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
    listCustomerFittingHistory(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      customerId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }),
  );
  if (!page) throw new NotFoundError('Customer could not be found.');

  return customerFittingHistoryResponse.parse({
    items: page.rows.map((row) => ({
      id: row.id,
      starts_at: row.starts_at.toISOString(),
      status: row.status,
      garment_summary: row.garment_summary,
      fee: {
        fee_minor: row.fee_minor,
        currency: row.currency,
        payment_status: row.payment_status,
      },
    })),
    page_meta: {
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
    },
  });
}

export function assertCustomerReadPermission(permissionCodes: PermissionCode[]): void {
  if (!permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('Customer directory access requires reservation management permission.');
  }
}
