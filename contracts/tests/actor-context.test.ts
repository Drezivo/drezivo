import { describe, expect, it } from 'vitest';

import { actorContext, workspaceList } from '../src/tenancy/actor-context';

const tenant = {
  id: '9fbd891f-cab6-48a9-a965-e84deea05df6',
  name: 'Drezivo Formalwear',
  slug: 'drezivo-formalwear',
  status: 'active' as const,
  currency: 'PHP',
  timezone: 'Asia/Manila',
  created_at: '2026-09-17T00:00:00.000Z',
  updated_at: '2026-09-17T00:00:00.000Z',
};

describe('actor and workspace contracts', () => {
  it('accepts the safe actor context projection', () => {
    expect(
      actorContext.safeParse({
        tenant,
        membership: {
          id: 'bd6e4f50-93ff-4a2f-8d41-9e06f1af9b8e',
          role: 'owner',
          status: 'active',
          updated_at: tenant.updated_at,
        },
        branches: [
          {
            id: '2b8d2ea5-d2ee-4f77-9f4e-7a8a4e3d0f3e',
            name: 'Main Branch',
            code: 'main',
            is_default: true,
            timezone: 'Asia/Manila',
            status: 'active',
          },
        ],
        active_branch_id: '2b8d2ea5-d2ee-4f77-9f4e-7a8a4e3d0f3e',
        branch_grants: [
          { branch_id: '2b8d2ea5-d2ee-4f77-9f4e-7a8a4e3d0f3e', permission_codes: ['assets.manage'] },
        ],
        subscription: {
          id: 'f0dc85c4-4b31-47fd-a24e-6208f44e62ad',
          plan_code: 'starter',
          status: 'trialing',
          trial_ends_at: tenant.updated_at,
          grace_ends_at: null,
        },
        entitlements: { physical_assets_max: 125, frontdesk_seats_max: 0 },
      }).success,
    ).toBe(true);
  });

  it('rejects missing branch and entitlement context', () => {
    expect(actorContext.safeParse({ tenant }).success).toBe(false);
  });

  it('uses one fixed paginated workspace shape', () => {
    expect(
      workspaceList.safeParse({
        items: [
          {
            tenant,
            clerk_org_id: 'org_workspace_123',
            role: 'owner',
            membership_updated_at: tenant.updated_at,
          },
        ],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(true);
    expect(
      workspaceList.safeParse({
        items: [{ tenant, role: 'owner', membership_updated_at: tenant.updated_at }],
        page_meta: { next_cursor: null, has_more: false },
      }).success,
    ).toBe(false);
  });
});
