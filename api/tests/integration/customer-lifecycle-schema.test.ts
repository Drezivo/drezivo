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
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('customer lifecycle schema', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createTestTenant } = await import('./helpers/factories.js');

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

  it('adds archive/concurrency columns and the bounded customer read indexes without weakening RLS', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_customer_lifecycle_shape' });

    const shape = await withTenantTransaction(tenant.id, 'user_customer_lifecycle_shape', async (client) => {
      const columns = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'customer'
            AND column_name = ANY($1::text[])
          ORDER BY column_name`,
        [['archived_at', 'anonymized_at', 'updated_at']],
      );
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'customer'
            AND indexname = ANY($1::text[])
          ORDER BY indexname`,
        [[
          'customer_tenant_active_name_sort_idx',
          'customer_tenant_name_sort_idx',
          'customer_tenant_staff_search_trgm_idx',
        ]],
      );
      const rls = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE oid = 'public.customer'::regclass`,
      );

      return {
        columns: columns.rows,
        indexes: indexes.rows.map((row) => row.indexname),
        rls: rls.rows[0],
      };
    });

    expect(shape).toEqual({
      columns: [
        { column_name: 'anonymized_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
        { column_name: 'archived_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
        { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ],
      indexes: [
        'customer_tenant_active_name_sort_idx',
        'customer_tenant_name_sort_idx',
        'customer_tenant_staff_search_trgm_idx',
      ],
      rls: { relrowsecurity: true, relforcerowsecurity: true },
    });
  });

  it('keeps customer archive operationally separate from anonymization', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_customer_lifecycle_archive' });

    const lifecycle = await withTenantTransaction(tenant.id, 'user_customer_lifecycle_archive', async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, phone)
         VALUES ($1, 'Lifecycle Customer', '09170000000')
         RETURNING id`,
        [tenant.id],
      );
      const customerId = inserted.rows[0]?.id;
      if (!customerId) throw new Error('Customer insert returned no row.');

      const archived = await client.query<{
        archived_at: Date | null;
        anonymized_at: Date | null;
      }>(
        `UPDATE customer
            SET archived_at = now(),
                updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
          WHERE tenant_id = $1 AND id = $2
          RETURNING archived_at, anonymized_at`,
        [tenant.id, customerId],
      );

      return archived.rows[0];
    });

    expect({
      archived: lifecycle?.archived_at instanceof Date,
      anonymized: lifecycle?.anonymized_at ?? null,
    }).toEqual({ archived: true, anonymized: null });
  });

  it('advances updated_at by at least one millisecond for expected-timestamp concurrency', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_customer_lifecycle_concurrency' });

    const result = await withTenantTransaction(tenant.id, 'user_customer_lifecycle_concurrency', async (client) => {
      const inserted = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Concurrency Customer', 'customer@example.test')
         RETURNING id, updated_at`,
        [tenant.id],
      );
      const customer = inserted.rows[0];
      if (!customer) throw new Error('Customer insert returned no row.');

      const updated = await client.query<{ updated_at: Date }>(
        `UPDATE customer
            SET full_name = 'Updated Customer',
                updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
          WHERE tenant_id = $1 AND id = $2
          RETURNING updated_at`,
        [tenant.id, customer.id],
      );
      const next = updated.rows[0];
      if (!next) throw new Error('Customer update returned no row.');

      return {
        advanced: next.updated_at.getTime() > customer.updated_at.getTime(),
        staleTokenMatches: next.updated_at.getTime() === new Date(customer.updated_at.toISOString()).getTime(),
      };
    });

    expect(result).toEqual({ advanced: true, staleTokenMatches: false });
  });

  it('retains restrictive customer foreign keys for reservation and fitting history', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_customer_lifecycle_fk' });

    const deleteActions = await withTenantTransaction(tenant.id, 'user_customer_lifecycle_fk', async (client) => {
      const result = await client.query<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype
           FROM pg_constraint
          WHERE conname = ANY($1::text[])
          ORDER BY conname`,
        [[
          'fitting_appointment_customer_same_tenant_fk',
          'reservation_customer_same_tenant_fk',
        ]],
      );
      return result.rows;
    });

    expect(deleteActions).toEqual([
      { conname: 'fitting_appointment_customer_same_tenant_fk', confdeltype: 'r' },
      { conname: 'reservation_customer_same_tenant_fk', confdeltype: 'r' },
    ]);
  });

  it('keeps customer rows tenant-isolated after the lifecycle migration', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_customer_lifecycle_rls_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_customer_lifecycle_rls_b' });

    await withTenantTransaction(tenantA.id, 'user_customer_lifecycle_rls_a', (client) =>
      client.query(
        `INSERT INTO customer (tenant_id, full_name, phone)
         VALUES ($1, 'Tenant A Customer', '09170000001')`,
        [tenantA.id],
      ),
    );
    await withTenantTransaction(tenantB.id, 'user_customer_lifecycle_rls_b', (client) =>
      client.query(
        `INSERT INTO customer (tenant_id, full_name, phone)
         VALUES ($1, 'Tenant B Customer', '09170000002')`,
        [tenantB.id],
      ),
    );

    const names = await withTenantTransaction(tenantA.id, 'user_customer_lifecycle_rls_read', async (client) => {
      const result = await client.query<{ full_name: string }>(
        `SELECT full_name
           FROM customer
          ORDER BY full_name`,
      );
      return result.rows.map((row) => row.full_name);
    });

    expect(names).toEqual(['Tenant A Customer']);
  });
});
