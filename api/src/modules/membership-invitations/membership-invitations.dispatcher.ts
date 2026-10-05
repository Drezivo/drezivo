import { z } from 'zod';

import {
  clerkInvitationDispatchSource,
  createClerkServerAdapter,
  type ClerkOrganizationInvitation,
  type ClerkServerAdapter,
} from '../../integrations/clerk/clerk.adapter.js';
import { withSystemTenantTransaction } from '../../db/client.js';
import {
  lockInvitationForDispatch,
  updateInvitationProviderCorrelation,
} from './membership-invitations.repository.js';
import { decryptRecipientEmail } from '../../shared/protected-recipient.js';
import { PermanentOutboxError, type EventHandler, type OutboxRow } from '../../worker/runner.js';
import { config } from '../../config/index.js';

const dispatchPayload = z.object({
  invitation_id: z.string().uuid(),
  dispatch_version: z.number().int().positive(),
  operation: z.enum(['create', 'resend']),
});
const revokePayload = z.object({
  invitation_id: z.string().uuid(),
  dispatch_version: z.number().int().positive(),
  operation: z.literal('cancel'),
});

export interface MembershipInvitationDispatchDependencies {
  clerk: ClerkServerAdapter;
  decryptEmail: (ciphertext: string) => string;
  runTenantTransaction: typeof withSystemTenantTransaction;
  staffAppUrl: string;
}

const defaultDependencies: MembershipInvitationDispatchDependencies = {
  clerk: createClerkServerAdapter(),
  decryptEmail: decryptRecipientEmail,
  runTenantTransaction: withSystemTenantTransaction,
  staffAppUrl: config.STAFF_APP_URL,
};

/** Dedicated outbox boundary for local invitation intent. No provider payloads cross this API. */
export function createMembershipInvitationDispatchHandler(
  dependencies: MembershipInvitationDispatchDependencies = defaultDependencies,
): EventHandler {
  return async (row: OutboxRow) => {
    if (row.event_type === 'clerk.invitation.dispatch_requested') {
      const payload = dispatchPayload.safeParse(row.payload);
      if (!payload.success) throw new PermanentOutboxError('Invalid invitation dispatch payload.');
      await dispatchInvitation(row, payload.data, dependencies);
      return;
    }
    if (row.event_type === 'clerk.invitation.revoke_requested') {
      const payload = revokePayload.safeParse(row.payload);
      if (!payload.success) throw new PermanentOutboxError('Invalid invitation revoke payload.');
      await revokeInvitation(row, payload.data, dependencies);
      return;
    }
    throw new PermanentOutboxError('Unsupported invitation outbox event.');
  };
}

export const handleMembershipInvitationDispatch = createMembershipInvitationDispatchHandler();

async function dispatchInvitation(
  row: OutboxRow,
  payload: z.infer<typeof dispatchPayload>,
  dependencies: MembershipInvitationDispatchDependencies,
): Promise<void> {
  await dependencies.runTenantTransaction(
    row.tenant_id,
    'worker:clerk-invitation-dispatch',
    async (client) => {
      const snapshot = await lockInvitationForDispatch(
        client,
        row.tenant_id,
        payload.invitation_id,
      );
      if (!snapshot) throw new PermanentOutboxError('Invitation dispatch target is unavailable.');
      if (
        snapshot.invitation.status !== 'pending' ||
        snapshot.invitation.dispatch_version !== payload.dispatch_version
      ) {
        return;
      }

      const marker = {
        source: clerkInvitationDispatchSource,
        invitationId: payload.invitation_id,
        dispatchVersion: payload.dispatch_version,
        operation: payload.operation,
      } as const;
      const exact = await dependencies.clerk.findInvitationByDispatchMarker(
        snapshot.clerk_org_id,
        marker,
      );
      const prior = await dependencies.clerk.findInvitationsByInvitationId(
        snapshot.clerk_org_id,
        payload.invitation_id,
      );
      for (const invitation of prior) {
        if (invitation.id !== exact?.id && isRevocable(invitation)) {
          await dependencies.clerk.revokeInvitationIfPresent({
            organizationId: snapshot.clerk_org_id,
            invitationId: invitation.id,
          });
        }
      }

      const providerInvitation =
        exact ??
        (await dependencies.clerk.createInvitation({
          organizationId: snapshot.clerk_org_id,
          emailAddress: decryptForProvider(
            dependencies,
            snapshot.invitation.recipient_email_ciphertext,
          ),
          role: 'org:member',
          expiresInDays: 7,
          redirectUrl: invitationRedirectUrl(
            dependencies.staffAppUrl,
            payload.invitation_id,
            snapshot.clerk_org_id,
          ),
          dispatchMarker: marker,
        }));

      const persisted = await updateInvitationProviderCorrelation(client, {
        tenantId: row.tenant_id,
        invitationId: payload.invitation_id,
        dispatchVersion: payload.dispatch_version,
        providerInvitationId: providerInvitation.id,
      });
      if (!persisted) {
        if (isRevocable(providerInvitation)) {
          await dependencies.clerk.revokeInvitationIfPresent({
            organizationId: snapshot.clerk_org_id,
            invitationId: providerInvitation.id,
          });
        }
      }
    },
  );
}

function invitationRedirectUrl(
  staffAppUrl: string,
  invitationId: string,
  clerkOrgId: string,
): string {
  const url = new URL(`/accept-invitation/${encodeURIComponent(invitationId)}`, staffAppUrl);
  url.searchParams.set('organization_id', clerkOrgId);
  return url.toString();
}

async function revokeInvitation(
  row: OutboxRow,
  payload: z.infer<typeof revokePayload>,
  dependencies: MembershipInvitationDispatchDependencies,
): Promise<void> {
  await dependencies.runTenantTransaction(
    row.tenant_id,
    'worker:clerk-invitation-dispatch',
    async (client) => {
      const snapshot = await lockInvitationForDispatch(
        client,
        row.tenant_id,
        payload.invitation_id,
      );
      if (!snapshot) throw new PermanentOutboxError('Invitation revoke target is unavailable.');
      if (snapshot.invitation.dispatch_version !== payload.dispatch_version) return;

      const invitations = await dependencies.clerk.findInvitationsByInvitationId(
        snapshot.clerk_org_id,
        payload.invitation_id,
      );
      if (snapshot.invitation.clerk_invitation_id) {
        const known = await dependencies.clerk.findInvitation(
          snapshot.clerk_org_id,
          snapshot.invitation.clerk_invitation_id,
        );
        if (known && !invitations.some((candidate) => candidate.id === known.id)) {
          invitations.push(known);
        }
      }
      for (const invitation of invitations) {
        if (!isRevocable(invitation)) continue;
        await dependencies.clerk.revokeInvitationIfPresent({
          organizationId: snapshot.clerk_org_id,
          invitationId: invitation.id,
        });
      }
    },
  );
}

function decryptForProvider(
  dependencies: MembershipInvitationDispatchDependencies,
  ciphertext: string,
): string {
  try {
    return dependencies.decryptEmail(ciphertext);
  } catch {
    throw new PermanentOutboxError('Protected invitation recipient cannot be decrypted.');
  }
}

function isRevocable(invitation: ClerkOrganizationInvitation): boolean {
  return invitation.status === null || invitation.status === 'pending';
}
