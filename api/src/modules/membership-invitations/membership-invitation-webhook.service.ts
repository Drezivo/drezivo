import type { ClerkServerAdapter } from '../../integrations/clerk/clerk.adapter.js';
import { withSystemTenantResolutionTransaction } from '../../db/client.js';
import {
  findClaimTenant,
} from './membership-invitation-claim.repository.js';
import {
  claimMembershipInvitationInTransaction,
  InvitationClaimDeferredError,
} from './membership-invitation-claim.service.js';
import { DependencyUnavailableError, NotFoundError, StateConflictError } from '../../shared/errors.js';

const SYSTEM_PRINCIPAL = 'clerk:invitation-claim';

export type InvitationWebhookReconciliationResult =
  | { kind: 'claimed' }
  | { kind: 'ignored' }
  | { kind: 'deferred' };

/**
 * Reuses the verified claim core for a signed organization_invitation.accepted event. The
 * webhook payload is already normalized/redacted by TBF-022; no provider body crosses this API.
 */
export async function reconcileAcceptedInvitationWebhook(input: {
  organizationId: string;
  invitationId: string;
  userId: string;
  requestId: string;
  clerk: ClerkServerAdapter;
}): Promise<InvitationWebhookReconciliationResult> {
  return withSystemTenantResolutionTransaction(SYSTEM_PRINCIPAL, async (context) => {
    const tenant = await findClaimTenant(context.client, input.organizationId, input.invitationId);
    if (!tenant) return { kind: 'ignored' };
    await context.setTenantContext(tenant.id);
    try {
      await claimMembershipInvitationInTransaction({
        context,
        tenant,
        invitationId: input.invitationId,
        clerkUserId: input.userId,
        clerkOrgId: input.organizationId,
        requestId: input.requestId,
        clerk: input.clerk,
        auditActorKey: SYSTEM_PRINCIPAL,
      });
      return { kind: 'claimed' };
    } catch (error) {
      if (error instanceof InvitationClaimDeferredError) return { kind: 'deferred' };
      // Invalid, foreign, expired, and already-consumed events are safe no-ops. Provider outages
      // remain errors so the inbox row can be retried by the worker.
      if (error instanceof DependencyUnavailableError) throw error;
      if (!(error instanceof NotFoundError) && !(error instanceof StateConflictError)) throw error;
      return { kind: 'ignored' };
    } finally {
      await context.clearTenantContext();
    }
  });
}
