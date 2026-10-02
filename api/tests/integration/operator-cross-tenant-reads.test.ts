import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('0069 operator cross-tenant reads', async () => {
  const { closePool, withGlobalTransaction, withOperatorGlobalTransaction, withTenantTransaction } =
    await import('../../src/db/client.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('lists every business with member counts in one query, only in operator context', async () => {
    const first = await createTestTenant();
    const second = await createTestTenant();
    await createTestMembership(first.id, 'user_owner_a', 'owner');
    const suspended = await createTestMembership(first.id, 'user_desk_a', 'frontdesk');
    await withTenantTransaction(first.id, 'user_owner_a', (client) =>
      client.query("UPDATE membership SET status = 'suspended' WHERE id = $1", [suspended]),
    );
    await createTestMembership(second.id, 'user_owner_b', 'owner');

    const rows = await withOperatorGlobalTransaction('operator_test', async (client) =>
      (await client.query<{ tenant_id: string; members_active: number; members_suspended: number; pending_payment: boolean }>(
        'SELECT tenant_id, members_active, members_suspended, pending_payment FROM operator_tenant_summaries(50)',
      )).rows,
    );
    const byId = new Map(rows.map((row) => [row.tenant_id, row]));
    expect(byId.get(first.id)).toMatchObject({ members_active: 1, members_suspended: 1, pending_payment: false });
    expect(byId.get(second.id)).toMatchObject({ members_active: 1, members_suspended: 0 });

    const people = await withOperatorGlobalTransaction('operator_test', async (client) =>
      (await client.query<{ clerk_user_id: string }>('SELECT clerk_user_id FROM operator_people(50)')).rows,
    );
    expect(people.map((row) => row.clerk_user_id).sort()).toEqual(['user_desk_a', 'user_owner_a', 'user_owner_b']);
  });

  it('returns nothing to an account or tenant transaction', async () => {
    const tenant = await createTestTenant();
    await createTestMembership(tenant.id, 'user_owner_c', 'owner');

    const asAccount = await withGlobalTransaction('user_owner_c', async (client) => ({
      tenants: (await client.query('SELECT * FROM operator_tenant_summaries(50)')).rowCount,
      people: (await client.query('SELECT * FROM operator_people(50)')).rowCount,
      payments: (await client.query("SELECT * FROM operator_subscription_payment_queue('recent', 50)")).rowCount,
    }));
    expect(asAccount).toEqual({ tenants: 0, people: 0, payments: 0 });

    const insideTenant = await withTenantTransaction(tenant.id, 'user_owner_c', async (client) => {
      await client.query("SELECT set_config('app.actor_kind', 'operator', true)");
      return (await client.query('SELECT * FROM operator_tenant_summaries(50)')).rowCount;
    });
    expect(insideTenant).toBe(0);
  });

  it('rejects an unknown payment queue instead of defaulting', async () => {
    await expect(
      withOperatorGlobalTransaction('operator_test', (client) =>
        client.query("SELECT * FROM operator_subscription_payment_queue('everything', 50)"),
      ),
    ).rejects.toThrow(/unknown payment queue/);
  });
});
