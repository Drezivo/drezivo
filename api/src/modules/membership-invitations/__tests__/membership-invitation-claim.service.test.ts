import { describe, expect, it, vi } from 'vitest';

import type { ClerkServerAdapter } from '../../../integrations/clerk/clerk.adapter.js';
import { NotFoundError } from '../../../shared/errors.js';
import {
  FRONTDESK_PERMISSION_CODES,
  resolveAcceptedProviderInvitation,
} from '../membership-invitation-claim.service.js';

function provider(overrides: Partial<ClerkServerAdapter> = {}): ClerkServerAdapter {
  return {
    getUserVerificationState: vi.fn(),
    createOrganization: vi.fn(),
    getOrganization: vi.fn(),
    getOrganizationMembership: vi.fn(),
    createInvitation: vi.fn(),
    findInvitation: vi.fn(),
    findInvitationByDispatchMarker: vi.fn(),
    findInvitationsByInvitationId: vi.fn(),
    getInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    revokeInvitationIfPresent: vi.fn(),
    createMembership: vi.fn(),
    updateMembership: vi.fn(),
    deleteMembership: vi.fn(),
    ...overrides,
  };
}

const invitation = {
  id: '2c0e6d4d-cf09-4e6d-8e38-1c5a93cf2ce1',
  tenant_id: '0cda4bf4-ea3d-43b5-a9f3-ec39b9f7b6b9',
  status: 'pending' as const,
  expires_at: new Date(Date.now() + 60_000),
  clerk_invitation_id: null,
  dispatch_version: 2,
};

describe('verified invitation claim provider correlation', () => {
  it('accepts exactly one current dispatch marker with an accepted member invitation', async () => {
    const accepted = {
      id: 'orginv_accepted',
      organizationId: 'org_claim',
      emailAddress: 'redacted@example.test',
      role: 'org:member' as const,
      status: 'accepted' as const,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const clerk = provider({
      findInvitationByDispatchMarker: vi
        .fn()
        .mockResolvedValueOnce(accepted)
        .mockResolvedValueOnce(null),
    });

    await expect(resolveAcceptedProviderInvitation(clerk, 'org_claim', invitation)).resolves.toEqual(
      accepted,
    );
  });

  it('rejects a provider invitation without the exact current marker', async () => {
    const clerk = provider({
      findInvitationByDispatchMarker: vi.fn().mockResolvedValue(null),
    });

    await expect(resolveAcceptedProviderInvitation(clerk, 'org_claim', invitation)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('does not trust a persisted provider ID when the current resend marker is missing', async () => {
    const clerk = provider({
      findInvitationByDispatchMarker: vi.fn().mockResolvedValue(null),
      findInvitation: vi.fn().mockResolvedValue({
        id: 'orginv_previous_revision',
        organizationId: 'org_claim',
        emailAddress: 'redacted@example.test',
        role: 'org:member' as const,
        status: 'accepted' as const,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    await expect(
      resolveAcceptedProviderInvitation(clerk, 'org_claim', {
        ...invitation,
        clerk_invitation_id: 'orginv_previous_revision',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps the default Front Desk grant closed and operational-only', () => {
    expect(FRONTDESK_PERMISSION_CODES).toEqual([
      'assets.manage',
      'reservations.manage',
      'reservations.custody',
      'payments.view',
      'evidence.view',
      'documents.receipt.view',
      'exports.request',
    ]);
  });
});
