import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  poolConnect: vi.fn(),
  poolQuery: vi.fn(),
  release: vi.fn(),
  deleteOrganizationIfPresent: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  pool: {
    connect: mocks.poolConnect,
    query: mocks.poolQuery,
  },
}));

vi.mock('../../../integrations/clerk/clerk.adapter.js', () => ({
  createClerkServerAdapter: () => ({
    deleteOrganizationIfPresent: mocks.deleteOrganizationIfPresent,
  }),
}));

const { cleanupAbandonedClerkOrganizations } = await import('../clerk-organization-cleanup.js');

const claimedJob = {
  id: '11111111-1111-4111-8111-111111111111',
  onboarding_id: '22222222-2222-4222-8222-222222222222',
  account_id: '33333333-3333-4333-8333-333333333333',
  clerk_org_id: 'org_cleanup',
  attempts: 0,
  max_attempts: 8,
};

function arrangeClaim() {
  mocks.poolConnect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
  mocks.clientQuery.mockImplementation((sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('UPDATE clerk_organization_cleanup_job j')) return { rows: [claimedJob] };
    throw new Error(`unexpected client query: ${sql}`);
  });
}

describe('Clerk organization cleanup worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeClaim();
    mocks.deleteOrganizationIfPresent.mockResolvedValue(true);
  });

  it('deletes only an abandoned, unprovisioned organization created by onboarding', async () => {
    mocks.poolQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT o.status AS onboarding_status')) {
        return {
          rows: [
            {
              onboarding_status: 'abandoned',
              provisioned_tenant_id: null,
              onboarding_clerk_org_id: 'org_cleanup',
              tenant_exists: false,
              provider_created_by_onboarding: true,
            },
          ],
        };
      }
      if (sql.includes("SET status = 'succeeded'")) return { rows: [] };
      throw new Error(`unexpected pool query: ${sql}`);
    });

    await cleanupAbandonedClerkOrganizations(1);

    expect(mocks.deleteOrganizationIfPresent).toHaveBeenCalledWith('org_cleanup');
    expect(
      mocks.poolQuery.mock.calls.some(([sql]) => String(sql).includes("SET status = 'succeeded'")),
    ).toBe(true);
  });

  it('refuses to delete an organization that has been provisioned into a tenant', async () => {
    mocks.poolQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT o.status AS onboarding_status')) {
        return {
          rows: [
            {
              onboarding_status: 'abandoned',
              provisioned_tenant_id: '44444444-4444-4444-8444-444444444444',
              onboarding_clerk_org_id: 'org_cleanup',
              tenant_exists: true,
              provider_created_by_onboarding: true,
            },
          ],
        };
      }
      if (sql.includes("SET status = 'dead'")) return { rows: [] };
      throw new Error(`unexpected pool query: ${sql}`);
    });

    await cleanupAbandonedClerkOrganizations(1);

    expect(mocks.deleteOrganizationIfPresent).not.toHaveBeenCalled();
    expect(
      mocks.poolQuery.mock.calls.some(([sql]) => String(sql).includes("SET status = 'dead'")),
    ).toBe(true);
  });
});
