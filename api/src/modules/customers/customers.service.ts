import {
  customerArchiveRequest,
  customerArchiveResponse,
  customerDetailResponse,
  customerFittingHistoryResponse,
  customerListResponse,
  customerReservationHistoryResponse,
  customerSummaryResponse,
  type CustomerDetailResponse,
  type CustomerArchiveRequest,
  type CustomerArchiveResponse,
  type CustomerFittingHistoryResponse,
  type CustomerHistoryQuery,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerReservationHistoryResponse,
  type CustomerSummaryResponse,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StaleVersionError,
  StateConflictError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
} from '../../shared/tenant-idempotency.js';
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

export interface CustomerCommandContext extends CustomerReadContext {
  membershipId: string;
  requestId: string;
}

type CustomerCommandResponse<T> = {
  status: number;
  body: SuccessEnvelope<T> | FailureEnvelope;
};

const CUSTOMER_ARCHIVE_OPERATION = 'customer.archive';

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

export async function archiveCustomer(
  input: CustomerCommandContext & {
    customerId: string;
    idempotencyKey: string;
    request: CustomerArchiveRequest;
  },
): Promise<CustomerCommandResponse<CustomerArchiveResponse>> {
  assertCustomerReadPermission(input.permissionCodes);
  const parsedRequest = customerArchiveRequest.safeParse(input.request);
  if (!parsedRequest.success) throw new ValidationError('Customer archive request is invalid.');
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ customer_id: input.customerId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: CUSTOMER_ARCHIVE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') {
      return { status: claim.responseCode, body: claim.safeResponse as CustomerCommandResponse<CustomerArchiveResponse>['body'] };
    }
    if (claim.kind === 'key_reused') {
      throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
    }
    if (claim.kind === 'in_progress') {
      throw new StateConflictError('An identical request is already being processed. Retry shortly.');
    }

    try {
      const current = await client.query<{ archived_at: Date | null; updated_at: Date }>(
        `SELECT archived_at, updated_at
           FROM customer
          WHERE tenant_id = $1 AND id = $2::uuid AND anonymized_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.customerId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('Customer could not be found.');
      if (row.updated_at.getTime() !== new Date(request.expected_updated_at).getTime()) {
        throw new StaleVersionError('This customer changed before it could be archived. Refresh and try again.');
      }
      if (row.archived_at !== null) throw new StateConflictError('This customer is already archived.');

      const updated = await client.query<{ id: string; archived_at: Date; updated_at: Date }>(
        `UPDATE customer
            SET archived_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2::uuid AND anonymized_at IS NULL
          RETURNING id, archived_at, updated_at`,
        [input.tenantId, input.customerId],
      );
      const archived = updated.rows[0];
      if (!archived) throw new NotFoundError('Customer could not be found.');

      const data = customerArchiveResponse.parse({
        id: archived.id,
        status: 'archived',
        archived_at: archived.archived_at.toISOString(),
        updated_at: archived.updated_at.toISOString(),
      });
      const body = successBody(input.requestId, data);
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: CUSTOMER_ARCHIVE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      if (!isAppError(error)) throw error;
      const body = failureBody(input.requestId, error.code, error.message);
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: CUSTOMER_ARCHIVE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'failed',
        responseCode: error.status,
        safeResponse: body,
      });
      return { status: error.status, body };
    }
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

function successBody<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { success: true, data, request_id: requestId };
}

function failureBody(
  requestId: string,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: requestId };
}
