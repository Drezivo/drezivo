import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY = 'test';
process.env.CLERK_PUBLISHABLE_KEY = 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'test';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.INVITATION_EMAIL_DIGEST_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
process.env.AWS_REGION = 'test';
process.env.S3_BUCKET_PRIVATE = 'private';
process.env.S3_BUCKET_PUBLIC = 'public';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';

const { createMembershipInvitationDispatchHandler } = await import('../membership-invitations.dispatcher.js');
const { clerkInvitationDispatchSource } = await import('../../../integrations/clerk/clerk.adapter.js');

const invitationId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

function createHarness(options?: { status?: 'pending' | 'revoked'; version?: number }) {
  const query = vi.fn((sql: string) => {
    if (sql.includes('SELECT i.id')) {
      return {
        rows: [
          {
            id: invitationId,
            tenant_id: tenantId,
            recipient_email_digest: 'digest',
            recipient_email_ciphertext: 'ciphertext',
            status: options?.status ?? 'pending',
            expires_at: new Date(),
            clerk_invitation_id: null,
            business_key: 'business-key',
            dispatch_version: options?.version ?? 1,
            created_at: new Date(),
            updated_at: new Date(),
            clerk_org_id: 'org_123',
          },
        ],
      };
    }
    if (sql.includes('UPDATE membership_invitation')) return { rows: [{ id: invitationId }] };
    return { rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  const runTenantTransaction = vi.fn(async (_tenantId: string, _key: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client));
  const clerk = {
    findInvitationByDispatchMarker: vi.fn().mockResolvedValue(null),
    findInvitationsByInvitationId: vi.fn().mockResolvedValue([]),
    createInvitation: vi.fn().mockResolvedValue({
      id: 'provider_inv_1',
      organizationId: 'org_123',
      emailAddress: 'frontdesk@example.com',
      role: 'org:member',
      status: 'pending',
      expiresAt: new Date(),
    }),
    revokeInvitationIfPresent: vi.fn().mockResolvedValue(null),
    findInvitation: vi.fn().mockResolvedValue(null),
  };
  const handler = createMembershipInvitationDispatchHandler({
    clerk: clerk as never,
    decryptEmail: vi.fn().mockReturnValue('frontdesk@example.com'),
    runTenantTransaction: runTenantTransaction as never,
  });
  return { handler, clerk, query };
}

describe('membership invitation dispatch worker', () => {
  it('creates one provider invitation with the exact private marker', async () => {
    const { handler, clerk, query } = createHarness();
    await handler({
      id: 'outbox-1',
      tenant_id: tenantId,
      event_type: 'clerk.invitation.dispatch_requested',
      payload: { invitation_id: invitationId, dispatch_version: 1, operation: 'create' },
      attempts: 0,
      max_attempts: 8,
      _leaseToken: 'lease',
    });
    expect(clerk.createInvitation).toHaveBeenCalledWith({
      organizationId: 'org_123',
      emailAddress: 'frontdesk@example.com',
      role: 'org:member',
      expiresInDays: 7,
      dispatchMarker: {
        source: clerkInvitationDispatchSource,
        invitationId,
        dispatchVersion: 1,
        operation: 'create',
      },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE membership_invitation'),
      expect.arrayContaining([tenantId, invitationId, 1, 'provider_inv_1']),
    );
  });

  it('does not call Clerk for stale or already-cancelled dispatch rows', async () => {
    const stale = createHarness({ version: 2 });
    await stale.handler({
      id: 'outbox-2',
      tenant_id: tenantId,
      event_type: 'clerk.invitation.dispatch_requested',
      payload: { invitation_id: invitationId, dispatch_version: 1, operation: 'resend' },
      attempts: 0,
      max_attempts: 8,
      _leaseToken: 'lease',
    });
    expect(stale.clerk.createInvitation).not.toHaveBeenCalled();

    const cancelled = createHarness({ status: 'revoked' });
    await cancelled.handler({
      id: 'outbox-3',
      tenant_id: tenantId,
      event_type: 'clerk.invitation.dispatch_requested',
      payload: { invitation_id: invitationId, dispatch_version: 1, operation: 'create' },
      attempts: 0,
      max_attempts: 8,
      _leaseToken: 'lease',
    });
    expect(cancelled.clerk.createInvitation).not.toHaveBeenCalled();
  });

  it('revokes the prior provider invitation before creating a resend', async () => {
    const { handler, clerk } = createHarness({ version: 2 });
    clerk.findInvitationsByInvitationId.mockResolvedValue([
      {
        id: 'provider_old',
        organizationId: 'org_123',
        emailAddress: 'frontdesk@example.com',
        role: 'org:member',
        status: 'pending',
        expiresAt: new Date(),
      },
    ]);
    await handler({
      id: 'outbox-4',
      tenant_id: tenantId,
      event_type: 'clerk.invitation.dispatch_requested',
      payload: { invitation_id: invitationId, dispatch_version: 2, operation: 'resend' },
      attempts: 0,
      max_attempts: 8,
      _leaseToken: 'lease',
    });
    expect(clerk.revokeInvitationIfPresent).toHaveBeenCalledWith({
      organizationId: 'org_123',
      invitationId: 'provider_old',
    });
  });
});
