import {
  membershipInvitation,
  membershipInvitationId,
  ownerMembershipInvitation,
  type CreateMembershipInvitationRequest,
  type MembershipInvitation,
  type OwnerMembershipInvitation,
  type PaginationRequest,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withTenantTransaction } from '../../db/client.js';
import { assertFrontDeskSeatCapacity } from '../entitlements/entitlements.service.js';
import { assertTenantOwnerMembership } from '../tenancy/tenancy.service.js';
import {
  DependencyUnavailableError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import {
  decryptRecipientEmail,
  digestRecipientEmail,
  encryptRecipientEmail,
} from '../../shared/protected-recipient.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
} from '../../shared/tenant-idempotency.js';
import {
  assertTenantInvitationWritesAllowed,
  expirePendingInvitations,
  findInvitationByDigest,
  insertInvitation,
  insertInvitationOutbox,
  insertInvitationRevokeOutbox,
  listOwnerInvitations,
  lockInvitation,
  lockInvitationTenant,
  revokeInvitation,
  toSafeInvitation,
  updateInvitationForResend,
  type OwnerInvitationRow,
  type SafeInvitationRow,
} from './membership-invitations.repository.js';

const CREATE_OPERATION = 'membership_invitation.create';
const RESEND_OPERATION = 'membership_invitation.resend';
const CANCEL_OPERATION = 'membership_invitation.cancel';

export interface InvitationCommandInput {
  tenantId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface CreateInvitationInput extends InvitationCommandInput {
  request: CreateMembershipInvitationRequest;
}

export interface InvitationTargetInput extends InvitationCommandInput {
  invitationId: string;
}

export interface InvitationCommandResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function createMembershipInvitation(
  input: CreateInvitationInput,
): Promise<InvitationCommandResponse> {
  return runCommand(input, CREATE_OPERATION, input.request, async (client) => {
    const digest = digestRecipientEmail(input.request.email);
    await expirePendingInvitations(client, input.tenantId);
    const existing = await findInvitationByDigest(client, input.tenantId, digest);
    if (existing?.status === 'pending') return toSafeInvitation(existing);
    if (existing?.status === 'accepted') {
      throw new StateConflictError('This invitation has already been accepted.');
    }

    await assertFrontDeskSeatCapacity(client, input.tenantId, 1);
    if (existing) {
      const reopened = await updateInvitationForResend(client, input.tenantId, existing.id);
      if (!reopened) throw new StateConflictError('Invitation cannot be resent.');
      await insertInvitationOutbox(client, {
        tenantId: input.tenantId,
        invitationId: reopened.id,
        dispatchVersion: reopened.dispatch_version,
        operation: 'resend',
      });
      return toSafeInvitation(reopened);
    }

    const created = await insertInvitation(client, {
      tenantId: input.tenantId,
      digest,
      ciphertext: encryptRecipientEmail(input.request.email),
      businessKey: `membership-invitation:${input.tenantId}:${digest}`,
    });
    await insertInvitationOutbox(client, {
      tenantId: input.tenantId,
      invitationId: created.id,
      dispatchVersion: created.dispatch_version,
      operation: 'create',
    });
    return toSafeInvitation(created);
  });
}

export async function resendMembershipInvitation(
  input: InvitationTargetInput,
): Promise<InvitationCommandResponse> {
  return runCommand(input, RESEND_OPERATION, {}, async (client) => {
    await expirePendingInvitations(client, input.tenantId);
    const current = await lockInvitation(client, input.tenantId, input.invitationId);
    if (!current) throw new NotFoundError('Invitation not found.');
    if (current.status === 'accepted') throw new StateConflictError('Invitation cannot be resent.');
    if (current.status !== 'pending') await assertFrontDeskSeatCapacity(client, input.tenantId, 1);
    const updated = await updateInvitationForResend(client, input.tenantId, input.invitationId);
    if (!updated) throw new StateConflictError('Invitation cannot be resent.');
    await insertInvitationOutbox(client, {
      tenantId: input.tenantId,
      invitationId: updated.id,
      dispatchVersion: updated.dispatch_version,
      operation: 'resend',
    });
    return toSafeInvitation(updated);
  });
}

export async function cancelMembershipInvitation(
  input: InvitationTargetInput,
): Promise<InvitationCommandResponse> {
  return runCommand(input, CANCEL_OPERATION, {}, async (client) => {
    await expirePendingInvitations(client, input.tenantId);
    const current = await lockInvitation(client, input.tenantId, input.invitationId);
    if (!current) throw new NotFoundError('Invitation not found.');
    if (current.status === 'accepted')
      throw new StateConflictError('Invitation cannot be cancelled.');
    const updated = await revokeInvitation(client, input.tenantId, input.invitationId);
    if (!updated) throw new StateConflictError('Invitation cannot be cancelled.');
    if (current.status === 'pending') {
      await insertInvitationRevokeOutbox(client, {
        tenantId: input.tenantId,
        invitationId: updated.id,
        dispatchVersion: updated.dispatch_version,
      });
    }
    return toSafeInvitation(updated);
  });
}

export async function listMembershipInvitations(
  input: { tenantId: string; membershipId: string; principalId: string } & PaginationRequest,
): Promise<{
  items: OwnerMembershipInvitation[];
  page_meta: { next_cursor: string | null; has_more: boolean };
}> {
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await assertTenantOwnerMembership(client, input);
    await expirePendingInvitations(client, input.tenantId);
    const cursor = decodeCursor(input.cursor);
    const rows = await listOwnerInvitations(client, {
      tenantId: input.tenantId,
      ...(cursor ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } : {}),
      limit: input.limit,
    });
    const hasMore = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toOwnerContractInvitation),
      page_meta: {
        has_more: hasMore,
        next_cursor: hasMore && last ? encodeCursor(last) : null,
      },
    };
  });
}

async function runCommand(
  input: InvitationCommandInput,
  operation: string,
  request: unknown,
  effect: (client: PoolClient) => Promise<SafeInvitationRow>,
): Promise<InvitationCommandResponse> {
  const payloadHash = canonicalRequestHash(request);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await assertTenantOwnerMembership(client, input);
    if (!(await assertTenantInvitationWritesAllowed(client, input.tenantId))) {
      throw new StateConflictError('Workspace invitation state is unavailable.');
    }
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed')
      return { status: claim.responseCode, body: claim.safeResponse as Record<string, unknown> };
    if (claim.kind === 'key_reused')
      throw new IdempotencyKeyReusedError(
        'This Idempotency-Key was already used for another request.',
      );
    if (claim.kind === 'in_progress')
      throw new StateConflictError(
        'An identical request is already being processed. Retry shortly.',
      );

    try {
      if (!(await lockInvitationTenant(client, input.tenantId))) {
        throw new StateConflictError('Workspace invitation state is unavailable.');
      }
      const safe = await effect(client);
      const body = successBody(input.requestId, toContractInvitation(safe));
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation,
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
        operation,
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

function toContractInvitation(row: SafeInvitationRow): MembershipInvitation {
  return membershipInvitation.parse({
    id: row.id,
    status: row.status,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
  });
}

function toOwnerContractInvitation(row: OwnerInvitationRow): OwnerMembershipInvitation {
  let email: string;
  try {
    email = decryptRecipientEmail(row.recipient_email_ciphertext);
  } catch {
    throw new DependencyUnavailableError('Stored invitation details are temporarily unavailable.');
  }
  return ownerMembershipInvitation.parse({
    id: row.id,
    email,
    status: row.status,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
  });
}

function successBody(requestId: string, data: MembershipInvitation): Record<string, unknown> {
  return { success: true, data, request_id: requestId };
}

function failureBody(requestId: string, code: string, message: string): Record<string, unknown> {
  return { success: false, error: { code, message }, request_id: requestId };
}

function encodeCursor(row: SafeInvitationRow): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string')
      throw new Error('cursor');
    if (!membershipInvitationId.safeParse(parsed.id).success) throw new Error('cursor');
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error('cursor');
    return { createdAt, id: parsed.id };
  } catch {
    throw new ValidationError('Invitation cursor is invalid.');
  }
}
