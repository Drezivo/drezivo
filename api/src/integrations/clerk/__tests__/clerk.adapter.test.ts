import { describe, expect, it, vi } from 'vitest';

import { DependencyUnavailableError, ValidationError } from '../../../shared/errors.js';
import type { ClerkProviderClient } from '../clerk.adapter.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY = 'test';
process.env.CLERK_PUBLISHABLE_KEY = 'test';
process.env.AWS_REGION = 'test';
process.env.S3_BUCKET_PRIVATE = 'private';
process.env.S3_BUCKET_PUBLIC = 'public';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';

const { createClerkServerAdapter } = await import('../clerk.adapter.js');

function createProvider() {
  const organizations = {
    createOrganization: vi.fn(),
    getOrganization: vi.fn(),
    getOrganizationMembershipList: vi.fn(),
    createOrganizationMembership: vi.fn(),
    updateOrganizationMembership: vi.fn(),
    deleteOrganizationMembership: vi.fn(),
    createOrganizationInvitation: vi.fn(),
    getOrganizationInvitation: vi.fn(),
    revokeOrganizationInvitation: vi.fn(),
  };
  return {
    provider: { organizations } as unknown as ClerkProviderClient,
    organizations,
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
    organizations.revokeOrganizationInvitation.mockResolvedValue({ ...invitation, status: 'revoked' });
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

  it('supports membership create, update, and delete through one typed boundary', async () => {
    const { provider, organizations } = createProvider();
    organizations.createOrganizationMembership.mockResolvedValue(membership);
    organizations.updateOrganizationMembership.mockResolvedValue({ ...membership, role: 'org:admin' });
    organizations.deleteOrganizationMembership.mockResolvedValue(membership);
    const adapter = createClerkServerAdapter(provider);

    await expect(
      adapter.createMembership({ organizationId: 'org_123', userId: 'user_456', role: 'org:member' }),
    ).resolves.toMatchObject({ id: 'mem_123', role: 'org:member' });
    await expect(
      adapter.updateMembership({ organizationId: 'org_123', userId: 'user_456', role: 'org:admin' }),
    ).resolves.toMatchObject({ id: 'mem_123', role: 'org:admin' });
    await expect(
      adapter.deleteMembership({ organizationId: 'org_123', userId: 'user_456' }),
    ).resolves.toMatchObject({ id: 'mem_123', role: 'org:member' });
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
      adapter.createMembership({ organizationId: 'org_123', userId: 'user_456', role: 'org:member' }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
