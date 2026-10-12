import {
  memberRemovalResponse,
  memberRosterResponse,
  type MemberRemovalResponse,
  type MemberRosterResponse,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withTenantTransaction } from '../../db/client.js';
import {
  createClerkServerAdapter,
  type ClerkServerAdapter,
} from '../../integrations/clerk/clerk.adapter.js';
import { assertTenantOwnerMembership } from '../tenancy/tenancy.service.js';
import { getFrontdeskSeatUsage } from '../entitlements/entitlements.service.js';
import {
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
} from '../../shared/tenant-idempotency.js';
import {
  insertMemberRemovalAudit,
  insertMemberRemovalOutbox,
  listActiveTenantMembers,
  lockMembership,
  markFrontdeskMembershipRemoved,
} from './members.repository.js';

const REMOVE_OPERATION = 'membership.remove.v1';

export interface ListTenantMembersInput {
  tenantId: string;
  membershipId: string;
  principalId: string;
}

export async function listTenantMembers(
  input: ListTenantMembersInput,
  clerk: ClerkServerAdapter = createClerkServerAdapter(),
): Promise<MemberRosterResponse> {
  const snapshot = await withTenantTransaction(
    input.tenantId,
    input.principalId,
    async (client) => {
      await assertTenantOwnerMembership(client, input);
      const members = await listActiveTenantMembers(client, input.tenantId);
      const frontdeskSeats = await getFrontdeskSeatUsage(client, input.tenantId);
      return { members, frontdeskSeats };
    },
  );

  const profiles = await clerk.getUserProfiles(
    snapshot.members.map((member) => member.clerk_user_id),
  );
  const profilesByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));

  return memberRosterResponse.parse({
    members: snapshot.members.map((member) => {
      const profile = profilesByUserId.get(member.clerk_user_id);
      return {
        id: member.id,
        name: profile?.name ?? null,
        email: profile?.email ?? null,
        role: member.role,
      };
    }),
    frontdesk_seats: snapshot.frontdeskSeats,
  });
}

export interface RemoveTenantMemberInput extends ListTenantMembersInput {
  requestId: string;
  idempotencyKey: string;
  targetMembershipId: string;
}

export interface RemoveTenantMemberResult {
  status: number;
  body: SuccessEnvelope<MemberRemovalResponse> | FailureEnvelope;
}

/**
 * The Owner removes one Front Desk member. Access ends in this transaction (the tenant resolver
 * only admits active memberships); leaving the Clerk organization is queued for the worker, so a
 * Clerk outage never leaves the member with access. A replay of the same key returns the result.
 */
export async function removeTenantMember(
  input: RemoveTenantMemberInput,
): Promise<RemoveTenantMemberResult> {
  const payloadHash = canonicalRequestHash({ membership_id: input.targetMembershipId });
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await assertTenantOwnerMembership(client, input);
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: REMOVE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') {
      return { status: claim.responseCode, body: claim.safeResponse as RemoveTenantMemberResult['body'] };
    }
    if (claim.kind === 'key_reused') {
      throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
    }
    if (claim.kind === 'in_progress') {
      throw new StateConflictError('This member is already being removed. Refresh in a moment.');
    }

    try {
      await removeFrontdeskMember(client, input);
      const data = memberRemovalResponse.parse({ membership_id: input.targetMembershipId, status: 'removed' });
      return finalizeRemoval(client, input, payloadHash, {
        status: 200,
        body: { success: true, data, request_id: input.requestId },
      });
    } catch (error) {
      if (!isAppError(error)) throw error;
      return finalizeRemoval(client, input, payloadHash, {
        status: error.status,
        body: { success: false, error: { code: error.code, message: error.message }, request_id: input.requestId },
      });
    }
  });
}

async function removeFrontdeskMember(client: PoolClient, input: RemoveTenantMemberInput): Promise<void> {
  const target = await lockMembership(client, input.tenantId, input.targetMembershipId);
  if (!target) throw new NotFoundError('This member could not be found in your workspace.');
  if (target.role === 'owner') throw new StateConflictError('The Owner cannot be removed from the workspace.');
  if (target.status !== 'active') throw new StateConflictError('This member was already removed. Refresh to see your team.');

  const removed = await markFrontdeskMembershipRemoved(client, input.tenantId, target.id);
  if (!removed) throw new StateConflictError('This member changed while being removed. Refresh and try again.');
  await insertMemberRemovalOutbox(client, {
    tenantId: input.tenantId,
    membershipId: target.id,
    authzVersion: removed.authz_version,
  });
  await insertMemberRemovalAudit(client, {
    tenantId: input.tenantId,
    actorKey: input.principalId,
    membershipId: target.id,
    requestId: input.requestId,
  });
}

async function finalizeRemoval(
  client: PoolClient,
  input: RemoveTenantMemberInput,
  payloadHash: string,
  result: RemoveTenantMemberResult,
): Promise<RemoveTenantMemberResult> {
  await finalizeTenantIdempotency(client, {
    tenantId: input.tenantId,
    principalKey: input.membershipId,
    operation: REMOVE_OPERATION,
    intentKey: input.idempotencyKey,
    payloadHash,
    status: result.body.success ? 'succeeded' : 'failed',
    responseCode: result.status,
    safeResponse: result.body,
  });
  return result;
}
