import { memberRosterResponse, type MemberRosterResponse } from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  createClerkServerAdapter,
  type ClerkServerAdapter,
} from '../../integrations/clerk/clerk.adapter.js';
import { assertTenantOwnerMembership } from '../tenancy/tenancy.service.js';
import { getFrontdeskSeatUsage } from '../entitlements/entitlements.service.js';
import { listActiveTenantMembers } from './members.repository.js';

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
