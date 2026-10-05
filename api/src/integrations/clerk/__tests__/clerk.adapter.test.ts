import { describe, expect, it, vi } from 'vitest';

import {
  DependencyUnavailableError,
  StateConflictError,
  ValidationError,
} from '../../../shared/errors.js';
import type { ClerkProviderClient } from '../clerk.adapter.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY = 'test';
process.env.CLERK_PUBLISHABLE_KEY = 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'test';
process.env.AWS_REGION = 'test';
process.env.S3_BUCKET_PRIVATE = 'private';
process.env.S3_BUCKET_PUBLIC = 'public';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.INVITATION_EMAIL_DIGEST_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const { createClerkServerAdapter } = await import('../clerk.adapter.js');

function createProvider() {
  const organizations = {
    createOrganization: vi.fn(),
    getOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
    getOrganizationMembershipList: vi.fn(),
    createOrganizationMembership: vi.fn(),
    updateOrganizationMembership: vi.fn(),
    deleteOrganizationMembership: vi.fn(),
    createOrganizationInvitation: vi.fn(),
    getOrganizationInvitationList: vi.fn(),
    getOrganizationInvitation: vi.fn(),
    revokeOrganizationInvitation: vi.fn(),
  };
  const users = {
    getUser: vi.fn(),
    getUserList: vi.fn(),
  };
  return {
    provider: { organizations, users } as unknown as ClerkProviderClient,
    organizations,
    users,
  };
}

const organization = {
  id: 'org_123',
  name: 'Drezivo Studio',
  slug: 'drezivo-studio',
  createdBy: 'user_123',
};

const membership = {
  id: 'mem_123',
  role: 'org:member',
  organization: { id: 'org_123' },
  publicUserData: { userId: 'user_456' },
};

const invitation = {
  id: 'inv_123',
  organizationId: 'org_123',
  emailAddress: 'frontdesk@example.com',
  role: 'org:member',
  status: 'pending',
  expiresAt: Date.parse('2026-10-01T00:00:00.000Z'),
};

describe('Clerk server adapter', () => {
  it('returns only primary email verification state', async () => {
    const { provider, users } = createProvider();
    users.getUser.mockResolvedValue({
      primaryEmailAddressId: 'email_primary',
      emailAddresses: [
        { id: 'email_primary', verification: { status: 'verified' } },
        { id: 'email_other', verification: { status: 'unverified' } },
      ],
    });
    const adapter = createClerkServerAdapter(provider);

    await expect(adapter.getUserVerificationState('user_123')).resolves.toEqual({
      primaryEmailVerified: true,
    });
    expect(users.getUser).toHaveBeenCalledWith('user_123');
  });

  it('fails closed when there is no verified primary email', async () => {
    const { provider, users } = createProvider();
    users.getUser.mockResolvedValue({ primaryEmailAddressId: null, emailAddresses: [] });
    const adapter = createClerkServerAdapter(provider);

    await expect(adapter.getUserVerificationState('user_123')).resolves.toEqual({
      primaryEmailVerified: false,
    });
  });

  it('loads a bounded set of owner-visible member profiles in one provider request', async () => {
    const { provider, users } = createProvider();
    users.getUserList.mockResolvedValue({
      data: [
        {
          id: 'user_123',
          firstName: 'Riley',
          lastName: 'Owner',
          primaryEmailAddressId: 'email_primary',
          emailAddresses: [{ id: 'email_primary', emailAddress: 'owner@example.test' }],
        },
      ],
    });
    const adapter = createClerkServerAdapter(provider);

    await expect(adapter.getUserProfiles(['user_123'])).resolves.toEqual([
      { userId: 'user_123', name: 'Riley Owner', email: 'owner@example.test' },
    ]);
    expect(users.getUserList).toHaveBeenCalledWith({ userId: ['user_123'], limit: 1 });
  });

  it('creates an organization through the provider boundary and returns a safe projection', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganization.mockResolvedValue(organization);
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createOrganization({ name: 'Drezivo Studio', createdByUserId: 'user_123' }),
    ).resolves.toEqual({
      id: 'org_123',
      name: 'Drezivo Studio',
      slug: 'drezivo-studio',
      createdByUserId: 'user_123',
    });
    expect(organizations.createOrganization).toHaveBeenCalledWith({
      name: 'Drezivo Studio',
      createdBy: 'user_123',
    });
  });

  it('maps a provider conflict to a safe state conflict', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganization.mockRejectedValue({ status: 409 });
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createOrganization({
        name: 'Drezivo Studio',
        createdByUserId: 'user_123',
      }),
    ).rejects.toBeInstanceOf(StateConflictError);
  });

  it('does not misclassify a disabled provider slug feature as a duplicate slug', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganization.mockRejectedValue({
      status: 403,
      errors: [
        {
          code: 'organization_slugs_disabled',
          message: 'This instance does not have slugs enabled for organizations.',
        },
      ],
    });
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createOrganization({
        name: 'Drezivo Studio',
        createdByUserId: 'user_123',
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('sends the typed private onboarding marker without exposing it as a public field', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganization.mockResolvedValue(organization);
    const adapter = createClerkServerAdapter(provider);

    await adapter.createOrganization({
      name: 'Drezivo Studio',
      createdByUserId: 'user_123',
      onboardingMarker: {
        accountId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(organizations.createOrganization).toHaveBeenCalledWith({
      name: 'Drezivo Studio',
      createdBy: 'user_123',
      privateMetadata: {
        drezivo_onboarding: {
          source: 'owner_onboarding_v1',
          account_id: '11111111-1111-4111-8111-111111111111',
          attempt_id: '22222222-2222-4222-8222-222222222222',
        },
      },
    });
  });

  it('reads organization membership by provider user ID without exposing profile fields', async () => {
    const { provider, organizations } = createProvider();
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [membership] });
    const adapter = createClerkServerAdapter(provider);

    await expect(adapter.getOrganizationMembership('org_123', 'user_456')).resolves.toEqual({
      id: 'mem_123',
      organizationId: 'org_123',
      userId: 'user_456',
      role: 'org:member',
    });
    expect(organizations.getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: 'org_123',
      userId: ['user_456'],
      limit: 1,
    });
  });

  it('returns null when a requested membership is not present', async () => {
    const { provider, organizations } = createProvider();
    organizations.getOrganizationMembershipList.mockResolvedValue({ data: [] });
    const adapter = createClerkServerAdapter(provider);

    await expect(adapter.getOrganizationMembership('org_123', 'user_456')).resolves.toBeNull();
  });

  it('creates and revokes invitations with only the supported provider fields', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganizationInvitation.mockResolvedValue(invitation);
    organizations.revokeOrganizationInvitation.mockResolvedValue({
      ...invitation,
      status: 'revoked',
    });
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createInvitation({
        organizationId: 'org_123',
        emailAddress: 'frontdesk@example.com',
        role: 'org:member',
        expiresInDays: 7,
        inviterUserId: 'user_123',
      }),
    ).resolves.toMatchObject({
      id: 'inv_123',
      organizationId: 'org_123',
      emailAddress: 'frontdesk@example.com',
      status: 'pending',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(organizations.createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: 'org_123',
      emailAddress: 'frontdesk@example.com',
      role: 'org:member',
      expiresInDays: 7,
      inviterUserId: 'user_123',
    });

    await expect(
      adapter.revokeInvitation({ organizationId: 'org_123', invitationId: 'inv_123' }),
    ).resolves.toMatchObject({ id: 'inv_123', status: 'revoked' });
    expect(organizations.revokeOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: 'org_123',
      invitationId: 'inv_123',
    });
  });

  it('writes and recovers an exact private dispatch marker without exposing metadata', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganizationInvitation.mockResolvedValue(invitation);
    organizations.getOrganizationInvitationList.mockResolvedValue({
      data: [
        {
          ...invitation,
          privateMetadata: {
            drezivo_dispatch: {
              source: 'membership_invitation_dispatch_v1',
              invitation_id: '11111111-1111-4111-8111-111111111111',
              dispatch_version: 2,
              operation: 'resend',
            },
          },
        },
      ],
    });
    const adapter = createClerkServerAdapter(provider);
    const marker = {
      source: 'membership_invitation_dispatch_v1' as const,
      invitationId: '11111111-1111-4111-8111-111111111111',
      dispatchVersion: 2,
      operation: 'resend' as const,
    };

    await adapter.createInvitation({
      organizationId: 'org_123',
      emailAddress: 'frontdesk@example.com',
      role: 'org:member',
      dispatchMarker: marker,
    });
    expect(organizations.createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: 'org_123',
      emailAddress: 'frontdesk@example.com',
      role: 'org:member',
      privateMetadata: {
        drezivo_dispatch: {
          source: 'membership_invitation_dispatch_v1',
          invitation_id: marker.invitationId,
          dispatch_version: 2,
          operation: 'resend',
        },
      },
    });

    await expect(adapter.findInvitationByDispatchMarker('org_123', marker)).resolves.toMatchObject({
      id: 'inv_123',
      emailAddress: 'frontdesk@example.com',
    });
    expect(
      await adapter.findInvitationsByInvitationId('org_123', marker.invitationId),
    ).toHaveLength(1);
    expect(
      (await adapter.findInvitationByDispatchMarker('org_123', marker)) as unknown as Record<
        string,
        unknown
      >,
    ).not.toHaveProperty('privateMetadata');
  });

  it('supports membership create, update, and delete through one typed boundary', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganizationMembership.mockResolvedValue(membership);
    organizations.updateOrganizationMembership.mockResolvedValue({
      ...membership,
      role: 'org:admin',
    });
    organizations.deleteOrganizationMembership.mockResolvedValue(membership);
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createMembership({
        organizationId: 'org_123',
        userId: 'user_456',
        role: 'org:member',
      }),
    ).resolves.toMatchObject({ id: 'mem_123', role: 'org:member' });
    await expect(
      adapter.updateMembership({
        organizationId: 'org_123',
        userId: 'user_456',
        role: 'org:admin',
      }),
    ).resolves.toMatchObject({ id: 'mem_123', role: 'org:admin' });
    await expect(
      adapter.deleteMembership({ organizationId: 'org_123', userId: 'user_456' }),
    ).resolves.toMatchObject({ id: 'mem_123', role: 'org:member' });
  });

  it('deletes an organization idempotently when it is already absent in Clerk', async () => {
    const { provider, organizations } = createProvider();
    const adapter = createClerkServerAdapter(provider);

    organizations.deleteOrganization
      .mockResolvedValueOnce(organization)
      .mockRejectedValueOnce({ status: 404 });

    await expect(adapter.deleteOrganizationIfPresent('org_123')).resolves.toBe(true);
    await expect(adapter.deleteOrganizationIfPresent('org_123')).resolves.toBe(false);
  });

  it('rejects invalid input before calling Clerk', async () => {
    const { provider, organizations } = createProvider();
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createInvitation({
        organizationId: 'org_123',
        emailAddress: 'not-an-email',
        role: 'org:member',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(organizations.createOrganizationInvitation).not.toHaveBeenCalled();
  });

  it('maps provider failures to a safe typed dependency error without exposing raw details', async () => {
    const { provider, organizations } = createProvider();
    organizations.getOrganization.mockRejectedValue(
      new Error('secret provider response: sk_test_do_not_expose'),
    );
    const adapter = createClerkServerAdapter(provider);

    await expect(adapter.getOrganization('org_123')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 503,
      message: 'Clerk is temporarily unavailable. Please try again.',
    });
    await expect(adapter.getOrganization('org_123')).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('fails closed when Clerk returns an unsupported role or malformed response', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganizationMembership.mockResolvedValue({
      ...membership,
      role: 'org:unknown',
    });
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createMembership({
        organizationId: 'org_123',
        userId: 'user_456',
        role: 'org:member',
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
