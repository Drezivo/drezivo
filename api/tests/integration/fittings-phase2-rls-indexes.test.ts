import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureAppRoleLogin,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

const TENANT_SCOPED_TABLES = [
  'fitting_settings',
  'fitting_appointment',
  'fitting_line',
  'fitting_capacity_slot',
  'fitting_slot_allocation',
  'branch_closure',
] as const;

const REQUIRED_INDEXES = [
  'fitting_appointment_tenant_branch_period_gist_idx',
  'fitting_appointment_tenant_branch_start_id_idx',
  'fitting_appointment_tenant_branch_status_start_id_idx',
  'fitting_appointment_tenant_branch_customer_start_id_idx',
  'fitting_line_tenant_fitting_id_idx',
  'fitting_line_tenant_variant_fitting_idx',
  'fitting_line_tenant_guaranteed_asset_idx',
  'fitting_capacity_slot_active_lookup_idx',
  'fitting_slot_allocation_tenant_fitting_history_idx',
  'branch_closure_tenant_branch_date_idx',
  'branch_closure_tenant_branch_date_key',
] as const;

function requireId(rows: Array<{ id: string }>, label: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${label} insert returned no row`);
  return row.id;
}

async function openClient(connectionString = adminUrl): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function seedBranch(client: Client, label: string) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const tenantId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO tenant (clerk_org_id, name, slug, currency, timezone)
         VALUES ($1, $2, $3, 'PHP', 'Asia/Manila') RETURNING id`,
        [`org_${suffix}`, `RLS ${suffix}`, `rls-${suffix}`],
      )
    ).rows,
    'tenant',
  );
  const branchId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main', 'MAIN', true, 'Asia/Manila') RETURNING id`,
        [tenantId],
      )
    ).rows,
    'branch',
  );
  await client.query(
    `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
     VALUES ($1, $2, date '2026-12-25', 'Holiday')`,
    [tenantId, branchId],
  );
  return { tenantId, branchId };
}

async function setTenant(client: Client, tenantId: string): Promise<void> {
  await client.query('BEGIN');
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
  await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', 'rls-test-principal']);
}

describe('fitting and Business Hours RLS, privileges, and indexes', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('forces tenant RLS on fitting state and branch closed dates', async () => {
    const admin = await openClient();
    try {
      const metadata = await admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = ANY($1::text[])
          ORDER BY relname`,
        [TENANT_SCOPED_TABLES],
      );
      expect(metadata.rows).toHaveLength(TENANT_SCOPED_TABLES.length);
      expect(metadata.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

      const policies = await admin.query<{ tablename: string; roles: string[]; qual: string | null }>(
        `SELECT tablename, roles, qual
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])
            AND policyname = 'tenant_isolation'
          ORDER BY tablename`,
        [TENANT_SCOPED_TABLES],
      );
      expect(policies.rows).toHaveLength(TENANT_SCOPED_TABLES.length);
      expect(
        policies.rows.every(
          (row) => row.roles.includes('drezivo_app') && row.qual?.includes('app.tenant_id'),
        ),
      ).toBe(true);
    } finally {
      await admin.end();
    }
  });

  it('fails closed without tenant context and isolates branch closed dates by tenant', async () => {
    const admin = await openClient();
    const app = await openClient(buildAppRoleDatabaseUrl(adminUrl));
    try {
      const tenantA = await seedBranch(admin, 'a');
      const tenantB = await seedBranch(admin, 'b');

      const unscoped = await app.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM branch_closure',
      );
      expect(unscoped.rows[0]?.count).toBe(0);

      await setTenant(app, tenantA.tenantId);
      const scoped = await app.query<{ tenant_id: string; branch_id: string }>(
        'SELECT tenant_id, branch_id FROM branch_closure ORDER BY local_date',
      );
      expect(scoped.rows).toEqual([{ tenant_id: tenantA.tenantId, branch_id: tenantA.branchId }]);

      await expect(
        app.query(
          `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
           VALUES ($1, $2, date '2026-12-26', 'Foreign tenant')`,
          [tenantB.tenantId, tenantB.branchId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await app.query('ROLLBACK');
    } finally {
      await Promise.allSettled([app.query('ROLLBACK')]);
      await Promise.all([app.end(), admin.end()]);
    }
  });

  it('grants branch closure CRUD only to the app runtime and preserves fitting history delete restrictions', async () => {
    const admin = await openClient();
    const worker = await openClient(buildWorkerRoleDatabaseUrl(adminUrl));
    try {
      const grants = await admin.query<{
        app_select: boolean;
        app_insert: boolean;
        app_update: boolean;
        app_delete: boolean;
        worker_select: boolean;
      }>(
        `SELECT
           has_table_privilege('drezivo_app', 'public.branch_closure', 'SELECT') AS app_select,
           has_table_privilege('drezivo_app', 'public.branch_closure', 'INSERT') AS app_insert,
           has_table_privilege('drezivo_app', 'public.branch_closure', 'UPDATE') AS app_update,
           has_table_privilege('drezivo_app', 'public.branch_closure', 'DELETE') AS app_delete,
           has_table_privilege('drezivo_worker', 'public.branch_closure', 'SELECT') AS worker_select`,
      );
      expect(grants.rows[0]).toEqual({
        app_select: true,
        app_insert: true,
        app_update: true,
        app_delete: true,
        worker_select: false,
      });

      const publicGrants = await admin.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM information_schema.role_table_grants
          WHERE grantee = 'PUBLIC'
            AND table_schema = 'public'
            AND table_name = 'branch_closure'`,
      );
      expect(publicGrants.rows[0]?.count).toBe(0);

      await expect(worker.query('SELECT count(*) FROM branch_closure')).rejects.toMatchObject({
        code: '42501',
      });

      const history = await admin.query<{ table_name: string; can_delete: boolean }>(
        `SELECT table_name,
                has_table_privilege('drezivo_app', format('public.%I', table_name), 'DELETE') AS can_delete
           FROM unnest(ARRAY['fitting_settings','fitting_appointment','fitting_slot_allocation']) table_name
          ORDER BY table_name`,
      );
      expect(history.rows.every((row) => !row.can_delete)).toBe(true);
    } finally {
      await Promise.all([worker.end(), admin.end()]);
    }
  });

  it('installs the operational fitting and branch-closure indexes while removing obsolete schedule indexes', async () => {
    const admin = await openClient();
    try {
      const indexes = await admin.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = ANY($1::text[])
          ORDER BY indexname`,
        [REQUIRED_INDEXES],
      );
      expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([...REQUIRED_INDEXES].sort());

      const obsolete = await admin.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'fitting_hours_tenant_branch_weekday_start_idx',
              'fitting_closure_tenant_branch_period_gist_idx',
              'fitting_closure_tenant_branch_start_id_idx'
            )`,
      );
      expect(obsolete.rows[0]?.count).toBe(0);
    } finally {
      await admin.end();
    }
  });
});
