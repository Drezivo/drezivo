import {
  actorContext,
  type ActorContext,
  type PermissionCode,
} from '@drezivo/contracts';

import {
  withActorTenantResolutionTransaction,
  type ActorTenantResolutionContext,
} from '../../db/client.js';
import {
  createClerkServerAdapter,
  type ClerkOrganizationInvitation,
  type ClerkServerAdapter,
} from '../../integrations/clerk/clerk.adapter.js';
import { assertFrontDeskSeatCapacity } from '../entitlements/entitlements.service.js';
import { reconcileTenantLifecycle } from '../billing/billing.service.js';
import {
  DependencyUnavailableError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { claimTenantIdempotency, finalizeTenantIdempotency } from '../../shared/tenant-idempotency.js';
import {
  acceptClaimInvitation,
  appendClaimAudit,
  findClaimMembership,
  findClaimTenant,
  findDefaultClaimBranch,
  lockClaimInvitation,
  lockClaimTenant,
  insertClaimMembership,
  persistClaimMembershipProviderId,
  persistClaimInvitationProviderId,
  restoreClaimMembership,
  upsertClaimBranchGrant,
  expireClaimInvitation,
  type ClaimInvitationRow,
  type ClaimTenantRow,
} from './membership-invitation-claim.repository.js';
import { resolveActorContextInExistingTransaction } from '../tenancy/tenancy.repository.js';

const CLAIM_OPERATION = 'membership_invitation.claim';
export const FRONTDESK_PERMISSION_CODES: PermissionCode[] = [
  'assets.manage',
  'reservations.manage',
  'reservations.custody',
  'payments.view',
  'evidence.view',
  'documents.receipt.view',
  'exports.request',
];

export interface ClaimInvitationInput {
  invitationId: string;
  clerkUserId: string;
  clerkOrgId: string;
  requestId: string;
  idempotencyKey: string;
  clerk?: ClerkServerAdapter;
}

export interface ClaimInvitationResponse {
  status: number;
  body: Record<string, unknown>;
}

export class InvitationClaimDeferredError extends Error {
  constructor() {
    super('The provider membership is not visible yet.');
    this.name = 'InvitationClaimDeferredError';
  }
}

interface ClaimEffectInput {
  context: ActorTenantResolutionContext;
  tenant: ClaimTenantRow;
  invitationId: string;
  clerkUserId: string;
  clerkOrgId: string;
  requestId: string;
  clerk: ClerkServerAdapter;
  /** Webhook reconciliation records the system actor; HTTP claims use the Clerk user. */
  auditActorKey?: string;
}

/** Authenticated HTTP claim with tenant idempotency and an actor-context response. */
export async function claimMembershipInvitation(
  input: ClaimInvitationInput,
): Promise<ClaimInvitationResponse> {
  const payloadHash = canonicalRequestHash({ invitation_id: input.invitationId });
  const clerk = input.clerk ?? createClerkServerAdapter();

  return withActorTenantResolutionTransaction(input.clerkUserId, async (context) => {
    const tenant = await findClaimTenant(context.client, input.clerkOrgId);
    if (!tenant) throw new NotFoundError('The invitation is not available.');
    await context.setTenantContext(tenant.id);
    try {
      await reconcileTenantLifecycle(context.client, tenant.id, {
        actorKey: input.clerkUserId,
        requestId: input.requestId,
      });
      const lockedTenant = await lockClaimTenant(context.client, tenant.id);
      if (!lockedTenant) throw new StateConflictError('Workspace state is unavailable.');

      const claim = await claimTenantIdempotency(context.client, {
        tenantId: tenant.id,
        principalKey: input.clerkUserId,
        operation: CLAIM_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
      });
      if (claim.kind === 'replayed') {
        return { status: claim.responseCode, body: claim.safeResponse as Record<string, unknown> };
      }
      if (claim.kind === 'key_reused') {
        throw new IdempotencyKeyReusedError(
          'This Idempotency-Key was already used for another request.',
        );
      }
      if (claim.kind === 'in_progress') {
        throw new StateConflictError(
          'An identical request is already being processed. Retry shortly.',
        );
      }

      try {
        const resolved = await claimInvitationEffect({
          context,
          tenant: lockedTenant,
          invitationId: input.invitationId,
          clerkUserId: input.clerkUserId,
          clerkOrgId: input.clerkOrgId,
          requestId: input.requestId,
          clerk,
        });
        const body = successBody(input.requestId, toPublicActorContext(resolved));
        await finalizeTenantIdempotency(context.client, {
          tenantId: tenant.id,
          principalKey: input.clerkUserId,
          operation: CLAIM_OPERATION,
          intentKey: input.idempotencyKey,
          payloadHash,
          status: 'succeeded',
          responseCode: 200,
          safeResponse: body,
        });
        return { status: 200, body };
      } catch (error) {
        // A provider outage must roll back the claim and idempotency row so the caller can retry.
        if (error instanceof DependencyUnavailableError) throw error;
        if (error instanceof InvitationClaimDeferredError) {
          throw new StateConflictError('The invitation is not ready to claim.');
        }
        if (!isAppError(error)) throw error;
        const body = failureBody(input.requestId, error.code, error.message);
        await finalizeTenantIdempotency(context.client, {
          tenantId: tenant.id,
          principalKey: input.clerkUserId,
          operation: CLAIM_OPERATION,
          intentKey: input.idempotencyKey,
          payloadHash,
          status: 'failed',
          responseCode: error.status,
          safeResponse: body,
        });
        return { status: error.status, body };
      }
    } finally {
      await context.clearTenantContext();
    }
  });
}

/**
 * Worker/webhook entry point. It deliberately omits HTTP idempotency: the inbox provider event
 * ID and the local membership/invitation constraints provide the duplicate-safe boundary.
 */
export async function claimMembershipInvitationInTransaction(input: ClaimEffectInput): Promise<ActorContext> {
  const resolved = await claimInvitationEffect(input);
  return toPublicActorContext(resolved);
}

async function claimInvitationEffect(input: ClaimEffectInput): Promise<ResolvedClaimContext> {
  const { client } = input.context;
  if (input.tenant.status !== 'active') {
    throw new StateConflictError('The invitation is not available.');
  }
  const subscription = await client.query<{ status: string }>(
    `SELECT status FROM subscription WHERE tenant_id = $1 LIMIT 1`,
    [input.tenant.id],
  );
  if (!subscription.rows[0] || ['restricted', 'cancelled'].includes(subscription.rows[0].status)) {
    throw new StateConflictError('The invitation is not available.');
  }

  await expireClaimInvitation(client, input.tenant.id, input.invitationId);
  const invitation = await lockClaimInvitation(client, input.tenant.id, input.invitationId);
  if (
    !invitation ||
    (invitation.status !== 'pending' && invitation.status !== 'accepted') ||
    (invitation.status === 'pending' && invitation.expires_at <= new Date())
  ) {
    throw new NotFoundError('The invitation is not available.');
  }

  const providerInvitation = await resolveAcceptedProviderInvitation(
    input.clerk,
    input.clerkOrgId,
    invitation,
  );
  const providerMembership = await input.clerk.getOrganizationMembership(
    input.clerkOrgId,
    input.clerkUserId,
  );
  if (!providerMembership) {
    throw new InvitationClaimDeferredError();
  }
  if (providerMembership.role !== 'org:member') {
    throw new NotFoundError('The invitation is not available.');
  }

  const existing = await findClaimMembership(client, input.tenant.id, input.clerkUserId);
  if (existing?.role === 'owner') {
    throw new StateConflictError('The invitation is not available.');
  }

  if (invitation.status === 'accepted') {
    if (!existing || existing.role !== 'frontdesk' || existing.status !== 'active') {
      throw new NotFoundError('The invitation is not available.');
    }
    const branch = await findDefaultClaimBranch(client, input.tenant.id);
    if (!branch) throw new StateConflictError('Workspace branch state is unavailable.');
    await persistClaimMembershipProviderId(client, {
      tenantId: input.tenant.id,
      membershipId: existing.id,
      clerkMembershipId: providerMembership.id,
    });
    await persistClaimInvitationProviderId(client, {
      tenantId: input.tenant.id,
      invitationId: input.invitationId,
      providerInvitationId: providerInvitation.id,
    });
    await upsertClaimBranchGrant(client, {
      tenantId: input.tenant.id,
      branchId: branch.id,
      membershipId: existing.id,
      permissionCodes: FRONTDESK_PERMISSION_CODES,
    });
    const resolved = await resolveActorContextInExistingTransaction(input.context, {
      principalId: input.clerkUserId,
      clerkOrgId: input.clerkOrgId,
    });
    if (resolved.kind !== 'resolved') throw new StateConflictError('Workspace state is unavailable.');
    return resolved.context;
  }

  const branch = await findDefaultClaimBranch(client, input.tenant.id);
  if (!branch) throw new StateConflictError('Workspace branch state is unavailable.');

  if (existing?.status === 'active') {
    if (!(await acceptClaimInvitation(client, {
      tenantId: input.tenant.id,
      invitationId: input.invitationId,
      providerInvitationId: providerInvitation.id,
    }))) {
      throw new StateConflictError('The invitation is not available.');
    }
    await appendClaimAudit(client, {
      tenantId: input.tenant.id,
      actorKey: input.auditActorKey ?? input.clerkUserId,
      membershipId: existing.id,
      invitationId: input.invitationId,
      requestId: input.requestId,
    });
    await persistClaimMembershipProviderId(client, {
      tenantId: input.tenant.id,
      membershipId: existing.id,
      clerkMembershipId: providerMembership.id,
    });
    await upsertClaimBranchGrant(client, {
      tenantId: input.tenant.id,
      branchId: branch.id,
      membershipId: existing.id,
      permissionCodes: FRONTDESK_PERMISSION_CODES,
    });
  } else {
    await assertFrontDeskSeatCapacity(client, input.tenant.id, 1, {
      excludeInvitationId: input.invitationId,
    });
    if (existing) {
      await restoreClaimMembership(client, {
        tenantId: input.tenant.id,
        membershipId: existing.id,
        clerkMembershipId: providerMembership.id,
      });
    } else {
      await insertClaimMembership(client, {
        tenantId: input.tenant.id,
        clerkUserId: input.clerkUserId,
        clerkMembershipId: providerMembership.id,
      });
    }
    const membership = await findClaimMembership(client, input.tenant.id, input.clerkUserId);
    if (!membership) throw new StateConflictError('Membership state is unavailable.');
    await upsertClaimBranchGrant(client, {
      tenantId: input.tenant.id,
      branchId: branch.id,
      membershipId: membership.id,
      permissionCodes: FRONTDESK_PERMISSION_CODES,
    });
    if (!(await acceptClaimInvitation(client, {
      tenantId: input.tenant.id,
      invitationId: input.invitationId,
      providerInvitationId: providerInvitation.id,
    }))) {
      throw new StateConflictError('The invitation is not available.');
    }
    await appendClaimAudit(client, {
      tenantId: input.tenant.id,
      actorKey: input.auditActorKey ?? input.clerkUserId,
      membershipId: membership.id,
      invitationId: input.invitationId,
      requestId: input.requestId,
    });
  }

  const resolved = await resolveActorContextInExistingTransaction(input.context, {
    principalId: input.clerkUserId,
    clerkOrgId: input.clerkOrgId,
  });
  if (resolved.kind !== 'resolved') throw new StateConflictError('Workspace state is unavailable.');
  return resolved.context;
}

export async function resolveAcceptedProviderInvitation(
  clerk: ClerkServerAdapter,
  clerkOrgId: string,
  invitation: ClaimInvitationRow,
): Promise<ClerkOrganizationInvitation> {
  const markerCandidates = await Promise.all([
    clerk.findInvitationByDispatchMarker(clerkOrgId, {
      source: 'membership_invitation_dispatch_v1',
      invitationId: invitation.id,
      dispatchVersion: invitation.dispatch_version,
      operation: 'create',
    }),
    clerk.findInvitationByDispatchMarker(clerkOrgId, {
      source: 'membership_invitation_dispatch_v1',
      invitationId: invitation.id,
      dispatchVersion: invitation.dispatch_version,
      operation: 'resend',
    }),
  ]);
  const acceptedMarker = markerCandidates.filter(
    (candidate) => candidate?.status === 'accepted',
  );
  if (acceptedMarker.length > 1) throw new NotFoundError('The invitation is not available.');
  const currentMarker = acceptedMarker[0];
  // The dispatch marker is authoritative for the current resend revision. A persisted provider
  // ID alone is not enough because a previous resend may have left that ID on the local row.
  if (!currentMarker) throw new NotFoundError('The invitation is not available.');

  if (invitation.clerk_invitation_id) {
    const provider = await clerk.findInvitation(clerkOrgId, invitation.clerk_invitation_id);
    if (
      !provider ||
      provider.status !== 'accepted' ||
      provider.organizationId !== clerkOrgId ||
      provider.role !== 'org:member'
    ) {
      throw new NotFoundError('The invitation is not available.');
    }
    if (currentMarker.id !== provider.id) {
      throw new NotFoundError('The invitation is not available.');
    }
    return provider;
  }

  const provider = currentMarker;
  if (
    !provider ||
    provider.organizationId !== clerkOrgId ||
    provider.role !== 'org:member'
  ) {
    throw new NotFoundError('The invitation is not available.');
  }
  return provider;
}

type ResolvedClaimContext = NonNullable<Extract<Awaited<ReturnType<typeof resolveActorContextInExistingTransaction>>, { kind: 'resolved' }>['context']>;

function toPublicActorContext(context: ResolvedClaimContext): ActorContext {
  return actorContext.parse({
    tenant: context.tenant,
    membership: context.membership,
    branches: context.branches,
    active_branch_id: context.active_branch_id,
    branch_grants: context.branch_grants,
    subscription: context.subscription,
    entitlements: context.entitlements,
    access: context.access,
    // `satisfies` makes the compiler flag a field added to ActorContext but missed here; parse() alone takes unknown.
  } satisfies ActorContext);
}

function successBody(requestId: string, data: ActorContext): Record<string, unknown> {
  return { success: true, data, request_id: requestId };
}

function failureBody(requestId: string, code: string, message: string): Record<string, unknown> {
  return { success: false, error: { code, message }, request_id: requestId };
}
