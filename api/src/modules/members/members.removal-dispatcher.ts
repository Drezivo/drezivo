import { z } from 'zod';

import { withSystemTenantTransaction } from '../../db/client.js';
import {
  createClerkServerAdapter,
  type ClerkServerAdapter,
} from '../../integrations/clerk/clerk.adapter.js';
import { PermanentOutboxError, type EventHandler, type OutboxRow } from '../../worker/runner.js';
import { lockMembershipForProviderRemoval } from './members.repository.js';

export const MEMBER_REMOVAL_EVENT_TYPE = 'clerk.membership.remove_requested';

const removalPayload = z.object({
  membership_id: z.string().uuid(),
  authz_version: z.number().int().positive(),
});

export interface MemberRemovalDispatchDependencies {
  clerk: ClerkServerAdapter;
  runTenantTransaction: typeof withSystemTenantTransaction;
}

/**
 * Removes a removed Front Desk member from the tenant's Clerk organization. Drezivo access already
 * ended when the Owner removed them; this only tidies the provider side so the workspace leaves
 * their organization switcher. A failure throws and the outbox retries with backoff.
 */
export function createMemberRemovalDispatchHandler(
  dependencies: MemberRemovalDispatchDependencies = {
    clerk: createClerkServerAdapter(),
    runTenantTransaction: withSystemTenantTransaction,
  },
): EventHandler {
  return async (row: OutboxRow) => {
    const payload = removalPayload.safeParse(row.payload);
    if (!payload.success) throw new PermanentOutboxError('Invalid member removal payload.');

    await dependencies.runTenantTransaction(row.tenant_id, 'worker:clerk-member-removal', async (client) => {
      const member = await lockMembershipForProviderRemoval(client, row.tenant_id, payload.data.membership_id);
      if (!member) throw new PermanentOutboxError('Member removal target is unavailable.');
      // Re-invited and active again (or a newer removal is queued): this request is stale.
      if (member.status !== 'removed' || member.authz_version !== payload.data.authz_version) return;
      if (member.role !== 'frontdesk') throw new PermanentOutboxError('Only Front Desk members are removed from Clerk.');

      const providerMembership = await dependencies.clerk.getOrganizationMembership(member.clerk_org_id, member.clerk_user_id);
      if (!providerMembership) return;
      await dependencies.clerk.deleteMembership({ organizationId: member.clerk_org_id, userId: member.clerk_user_id });
    });
  };
}

export const handleMemberRemovalDispatch = createMemberRemovalDispatchHandler();
