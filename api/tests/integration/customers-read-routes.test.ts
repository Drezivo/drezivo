import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { customerListResponse, successEnvelope } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('Customers read routes', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('requires authenticated staff access for the customer directory', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const response = await request(createApp()).get('/api/v1/customers');
    expect(response.status).toBe(401);
  });

  it('requires reservations.manage on the active branch', async () => {
    const seed = await seedWorkspace('org_customers_permission', 'user_customers_permission', []);
    useClerk(seed);
    const response = await request(createApp()).get('/api/v1/customers');
    expect(response.status).toBe(403);
  });

  it('paginates active customers deterministically and excludes other tenants', async () => {
    const seed = await seedWorkspace('org_customers_list', 'user_customers_list', ['reservations.manage']);
    const foreign = await seedWorkspace('org_customers_foreign', 'user_customers_foreign', ['reservations.manage']);
    useClerk(seed);

    await seedCustomer(seed, 'Carla Cruz', '09170000003', null);
    const annaId = await seedCustomer(seed, 'Anna Reyes', '09170000001', null);
    const beaId = await seedCustomer(seed, 'Bea Santos', null, 'bea@example.test');
    await seedCustomer(seed, 'Archived Person', '09170000004', null, { archived: true });
    await seedCustomer(foreign, 'Foreign Person', '09170000005', null);

    const first = await request(createApp()).get('/api/v1/customers?limit=2');
    expect(first.status).toBe(200);
    const firstBody = successEnvelope(customerListResponse).parse(first.body);
    expect(firstBody.data.items.map((item) => item.id)).toEqual([annaId, beaId]);
    expect(firstBody.data.page_meta.has_more).toBe(true);

    const nextCursor = firstBody.data.page_meta.next_cursor;
    if (!nextCursor) throw new Error('expected next customer cursor');
    const second = await request(createApp()).get(
      `/api/v1/customers?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(second.status).toBe(200);
    const secondBody = successEnvelope(customerListResponse).parse(second.body);
    expect(secondBody.data.items).toHaveLength(1);
    expect(secondBody.data.items[0]?.full_name).toBe('Carla Cruz');
  });

  it('searches only name phone and email and supports archived/all status filters', async () => {
    const seed = await seedWorkspace('org_customers_filters', 'user_customers_filters', ['reservations.manage']);
    useClerk(seed);
    await seedCustomer(seed, 'Maria Santos', '09175550101', 'maria@example.test');
    await seedCustomer(seed, 'Archived Maria', '09990000000', 'old@example.test', { archived: true });
    await seedCustomer(seed, 'Notes Match', '08880000000', 'notes@example.test', { notes: 'secretneedle' });

    const active = await request(createApp()).get('/api/v1/customers?search=maria');
    const activeBody = successEnvelope(customerListResponse).parse(active.body);
    expect(activeBody.data.items.map((item) => item.full_name)).toEqual(['Maria Santos']);

    const archived = await request(createApp()).get('/api/v1/customers?search=maria&status=archived');
    const archivedBody = successEnvelope(customerListResponse).parse(archived.body);
    expect(archivedBody.data.items.map((item) => item.full_name)).toEqual(['Archived Maria']);

    const privateSearch = await request(createApp()).get('/api/v1/customers?search=secretneedle&status=all');
    const privateSearchBody = successEnvelope(customerListResponse).parse(privateSearch.body);
    expect(privateSearchBody.data.items).toEqual([]);
  });

  async function seedWorkspace(clerkOrgId: string, principalId: string, permissions: string[]) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const branchId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      const id = branch.rows[0]?.id;
      if (!id) throw new Error('branch insert returned no row');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, id, membershipId, JSON.stringify(permissions)],
      );
      const plan = await client.query<{ id: string }>(`SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active LIMIT 1`);
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('starter plan missing');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );
      return id;
    });
    return { tenantId: tenant.id, clerkOrgId: tenant.clerkOrgId, principalId, branchId };
  }

  async function seedCustomer(
    seed: { tenantId: string; principalId: string },
    fullName: string,
    phone: string | null,
    email: string | null,
    options: { archived?: boolean; notes?: string } = {},
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, phone, email, notes, archived_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() ELSE NULL END)
         RETURNING id`,
        [seed.tenantId, fullName, phone, email, options.notes ?? null, options.archived ?? false],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('customer insert returned no row');
      return id;
    });
  }

  function useClerk(seed: { principalId: string; clerkOrgId: string }): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }
});
