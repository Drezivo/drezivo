import {
  customerArchiveRequest,
  customerArchiveResponse,
  customerDetailResponse,
  customerEditRequest,
  customerEditResponse,
  customerFittingHistoryResponse,
  customerListResponse,
  customerReservationHistoryResponse,
  customerSummaryResponse,
  type CustomerDetailResponse,
  type CustomerArchiveRequest,
  type CustomerArchiveResponse,
  type CustomerEditRequest,
  type CustomerEditResponse,
  type CustomerFittingHistoryResponse,
  type CustomerHistoryQuery,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerReservationHistoryResponse,
  type CustomerSummaryResponse,
  type PermissionCode,
  type ErrorCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StaleVersionError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { finalizeTenantIdempotency, claimTenantIdempotency } from '../../shared/tenant-idempotency.js';
import {
  appendCustomerAuditEvent,
  archiveCustomerProfile,
  listCustomerFittingHistory,
  listCustomerReservationHistory,
  listCustomersReadModel,
  readCustomerForMutation,
  readCustomerDetailModel,
  readCustomerSummary,
  updateCustomerProfile,
  type CustomerDetailReadRow,
} from './customers.repository.js';

export interface CustomerReadContext {
  tenantId: string;
  branchId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
}

export interface CustomerMutationContext extends CustomerReadContext {
  membershipId: string;
  effectiveTenantStatus: 'active' | 'past_due' | 'restricted' | 'cancelled';
  requestId: string;
  idempotencyKey: string;
}

export type CustomerMutationBody<T> =
  | { success: true; data: T; request_id: string }
  | { success: false; error: { code: ErrorCode; message: string }; request_id: string };

export interface CustomerMutationResponse<T> {
  status: number;
  body: CustomerMutationBody<T>;
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

export async function updateCustomer(
  context: CustomerMutationContext,
  customerId: string,
  input: CustomerEditRequest,
): Promise<CustomerMutationResponse<CustomerEditResponse>> {
  assertCustomerMutationContext(context);
  const parsed = customerEditRequest.safeParse(input);
  if (!parsed.success) throw new ValidationError('Customer edit request is invalid.');
  const request = normalizeCustomerEditRequest(parsed.data);
  const payloadHash = canonicalRequestHash({ customer_id: customerId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: 'customer.update',
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayCustomerMutation<CustomerEditResponse>(claim);
    if (replay) return replay;

    try {
      const current = await readCustomerForMutation(client, { tenantId: context.tenantId, customerId });
      if (!current) throw new NotFoundError('Customer could not be found.');
      assertFreshCustomerTimestamp(current.updated_at, request.expected_updated_at);

      await updateCustomerProfile(client, {
        tenantId: context.tenantId,
        customerId,
        fullName: request.full_name,
        phone: request.phone,
        email: request.email,
        address: request.address,
        socialMedia: request.social_media,
        notes: request.notes,
      });
      const detail = await readCustomerDetailModel(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        customerId,
      });
      if (!detail) throw new StateConflictError('The customer profile could not be reloaded after update.');
      const data = customerEditResponse.parse({ customer: toCustomerDetail(detail) });
      const body = successBody(context.requestId, data);
      const changedFields = (['full_name', 'phone', 'email', 'address', 'social_media', 'notes'] as const)
        .filter((field) => {
          const currentField = field === 'social_media' ? current.social_media : current[field];
          return currentField !== request[field];
        });

      await appendCustomerAuditEvent(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'customer.profile_updated',
        customerId,
        redactedSummary: { changed_fields: changedFields },
        requestId: context.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: context.tenantId,
        principalKey: context.membershipId,
        operation: 'customer.update',
        intentKey: context.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeCustomerFailure(client, context, 'customer.update', payloadHash, error);
    }
  });
}

export async function archiveCustomer(
  context: CustomerMutationContext,
  customerId: string,
  input: CustomerArchiveRequest,
): Promise<CustomerMutationResponse<CustomerArchiveResponse>> {
  assertCustomerMutationContext(context);
  const parsed = customerArchiveRequest.safeParse(input);
  if (!parsed.success) throw new ValidationError('Customer archive request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ customer_id: customerId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: 'customer.archive',
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayCustomerMutation<CustomerArchiveResponse>(claim);
    if (replay) return replay;

    try {
      const current = await readCustomerForMutation(client, { tenantId: context.tenantId, customerId });
      if (!current) throw new NotFoundError('Customer could not be found.');
      assertFreshCustomerTimestamp(current.updated_at, request.expected_updated_at);

      const archived = current.archived_at
        ? current
        : await archiveCustomerProfile(client, { tenantId: context.tenantId, customerId });
      const data = customerArchiveResponse.parse({
        id: archived.customer_id,
        status: 'archived',
        archived_at: archived.archived_at?.toISOString(),
        updated_at: archived.updated_at.toISOString(),
      });
      const body = successBody(context.requestId, data);

      if (!current.archived_at) {
        await appendCustomerAuditEvent(client, {
          tenantId: context.tenantId,
          actorKey: context.principalId,
          action: 'customer.archived',
          customerId,
          redactedSummary: { status: 'archived' },
          requestId: context.requestId,
        });
      }
      await finalizeTenantIdempotency(client, {
        tenantId: context.tenantId,
        principalKey: context.membershipId,
        operation: 'customer.archive',
        intentKey: context.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeCustomerFailure(client, context, 'customer.archive', payloadHash, error);
    }
  });
}

export function assertCustomerReadPermission(permissionCodes: PermissionCode[]): void {
  if (!permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('Customer directory access requires reservation management permission.');
  }
}

function assertCustomerMutationContext(context: CustomerMutationContext): void {
  assertCustomerReadPermission(context.permissionCodes);
  if (context.effectiveTenantStatus === 'restricted') {
    throw new TenantRestrictedError('This workspace is temporarily restricted.');
  }
  if (context.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
}

function normalizeCustomerEditRequest(request: CustomerEditRequest): CustomerEditRequest {
  return {
    ...request,
    full_name: request.full_name.trim(),
    phone: request.phone?.trim() ?? null,
    email: request.email?.trim().toLowerCase() ?? null,
    address: request.address?.trim() ?? null,
    social_media: request.social_media?.trim() ?? null,
    notes: request.notes?.trim() ?? null,
  };
}

function assertFreshCustomerTimestamp(actual: Date, expected: string): void {
  if (actual.getTime() !== new Date(expected).getTime()) {
    throw new StaleVersionError('This customer profile changed before it could be updated. Refresh and try again.');
  }
}

function toCustomerDetail(row: CustomerDetailReadRow): CustomerDetailResponse {
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

function successBody<T>(requestId: string, data: T): CustomerMutationBody<T> {
  return { success: true, data, request_id: requestId };
}

function replayCustomerMutation<T>(claim: Awaited<ReturnType<typeof claimTenantIdempotency>>): CustomerMutationResponse<T> | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse as CustomerMutationBody<T> };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical request is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeCustomerFailure<T>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: CustomerMutationContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<CustomerMutationResponse<T>> {
  if (!isAppError(error)) throw error;
  const body: CustomerMutationBody<T> = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
