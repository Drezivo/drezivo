import { z } from 'zod';

import { createClerkServerAdapter } from '../../integrations/clerk/clerk.adapter.js';
import { withSystemTenantResolutionTransaction } from '../../db/client.js';
import { DependencyUnavailableError, NotFoundError, StateConflictError } from '../../shared/errors.js';
import { claimReceivedClerkWebhookRows, markClerkWebhookProcessed } from '../../modules/webhooks/webhook-inbox.repository.js';
import { claimMembershipInvitationInTransaction, InvitationClaimDeferredError } from '../../modules/membership-invitations/membership-invitation-claim.service.js';
import { findClaimTenant } from '../../modules/membership-invitations/membership-invitation-claim.repository.js';

const acceptedPayload = z.object({
  organization_id: z.string().trim().min(1),
  invitation_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
});

const SYSTEM_PRINCIPAL = 'clerk:webhook-reconcile';

/** Process one inbox row; a deferred provider membership leaves the row received for retry. */
export async function reconcileNextClerkWebhook(): Promise<boolean> {
  return withSystemTenantResolutionTransaction(SYSTEM_PRINCIPAL, async (context) => {
    const { client } = context;
    const rows = await claimReceivedClerkWebhookRows(client, 1);
    const row = rows[0];
    if (!row) return false;

    if (row.event_type !== 'organization_invitation.accepted') {
      await markClerkWebhookProcessed(client, row.id, 'processed');
      return true;
    }

    const payload = acceptedPayload.safeParse(row.safe_payload);
    if (!payload.success) {
      await markClerkWebhookProcessed(client, row.id, 'rejected');
      return true;
    }

    const tenant = await findClaimTenant(
      client,
      payload.data.organization_id,
      payload.data.invitation_id,
    );
    if (!tenant) {
      await markClerkWebhookProcessed(client, row.id, 'processed');
      return true;
    }

    await context.setTenantContext(tenant.id);
    try {
      await claimMembershipInvitationInTransaction({
        context,
        tenant,
        invitationId: payload.data.invitation_id,
        clerkUserId: payload.data.user_id,
        clerkOrgId: payload.data.organization_id,
        requestId: row.provider_event_id,
        clerk: createClerkServerAdapter(),
        auditActorKey: SYSTEM_PRINCIPAL,
      });
      await markClerkWebhookProcessed(client, row.id, 'processed');
      return true;
    } catch (error) {
      if (error instanceof InvitationClaimDeferredError) throw error;
      if (error instanceof DependencyUnavailableError) throw error;
      if (error instanceof NotFoundError || error instanceof StateConflictError) {
        await markClerkWebhookProcessed(client, row.id, 'processed');
        return true;
      }
      throw error;
    } finally {
      await context.clearTenantContext();
    }
  });
}

export async function reconcileDueClerkWebhooks(limit = 10): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    const processed = await reconcileNextClerkWebhook();
    if (!processed) return;
  }
}
