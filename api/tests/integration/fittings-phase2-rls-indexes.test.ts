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

const FITTING_TABLES = [
  'fitting_settings',
  'fitting_appointment',
  'fitting_line',
  'fitting_capacity_slot',
  'fitting_slot_allocation',
  'fitting_hours',
  'fitting_closure',
] as const;

const FITTING_INDEXES = [
  'fitting_appointment_tenant_branch_period_gist_idx',
  'fitting_appointment_tenant_branch_start_id_idx',
  'fitting_appointment_tenant_branch_status_start_id_idx',
  'fitting_appointment_tenant_branch_customer_start_id_idx',
  'fitting_line_tenant_fitting_id_idx',
  'fitting_line_tenant_variant_fitting_idx',
  'fitting_line_tenant_guaranteed_asset_idx',
  'fitting_capacity_slot_active_lookup_idx',
  'fitting_slot_allocation_tenant_fitting_history_idx',
  'fitting_hours_tenant_branch_weekday_start_idx',
  'fitting_closure_tenant_branch_period_gist_idx',
  'fitting_closure_tenant_branch_start_id_idx',
] as const;

type FittingSeed = {
  tenantId: string;
  branchId: string;
  customerId: string;
  variantId: string;
  appointmentId: string;
  lineId: string;
  slotId: string;
};

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

async function seedFittingTenant(client: Client, label: string): Promise<FittingSeed> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const tenantId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO tenant (clerk_org_id, name, slug, currency, timezone)
         VALUES ($1, $2, $3, 'PHP', 'Asia/Manila')
         RETURNING id`,
        [`org_${suffix}`, `RLS ${suffix}`, `fit-rls-${suffix}`],
      )
    ).rows,
    'tenant',
  );

  const branchId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      )
    ).rows,
    'branch',
  );

  const customerId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Fitting Customer', $2)
         RETURNING id`,
        [tenantId, `${suffix}@example.test`],
      )
    ).rows,
    'customer',
  );

  const productId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, 'RLS Fitting Garment', 'active')
         RETURNING id`,
        [tenantId, `FIT-${suffix}`],
      )
    ).rows,
    'product',
  );

  const variantId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         VALUES
           ($1, $2, $3, 'M', 'Gold', '{}'::jsonb, 'cm', 'none', 10000, 0,
            'PHP', 'fixed_duration', 1440, 0, 0, 0, 'active')
         RETURNING id`,
        [tenantId, productId, `SKU-${suffix}`],
      )
    ).rows,
    'variant',
  );

  await client.query(
    `INSERT INTO fitting_settings
       (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
     VALUES ($1, $2, true, 1, 60, 0, 'PHP', 1)`,
    [tenantId, branchId],
  );

  const slotId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         VALUES ($1, $2, 1, true)
         RETURNING id`,
        [tenantId, branchId],
      )
    ).rows,
    'slot',
  );

  await client.query(
    `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
     VALUES ($1, $2, 1, '09:00', '17:00')`,
    [tenantId, branchId],
  );

  await client.query(
    `INSERT INTO fitting_closure (tenant_id, branch_id, period, timezone_snapshot, reason)
     VALUES (
       $1,
       $2,
       tstzrange('2026-12-25T01:00:00Z'::timestamptz, '2026-12-25T09:00:00Z'::timestamptz, '[)'),
       'Asia/Manila',
       'Holiday'
     )`,
    [tenantId, branchId],
  );

  await client.query('BEGIN');
  try {
    const appointmentId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO fitting_appointment
             (tenant_id, branch_id, customer_id, booking_channel, status, period,
              timezone_snapshot, currency, fee_minor, business_key, version)
           VALUES (
             $1, $2, $3, 'staff', 'pending',
             tstzrange('2026-10-05T02:00:00Z'::timestamptz, '2026-10-05T03:00:00Z'::timestamptz, '[)'),
             'Asia/Manila', 'PHP', 0, $4, 1
           )
           RETURNING id`,
          [tenantId, branchId, customerId, `fit:${suffix}:${randomUUID()}`],
        )
      ).rows,
      'appointment',
    );

    const lineId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO fitting_line
             (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
           VALUES ($1, $2, $3, NULL, false)
           RETURNING id`,
          [tenantId, appointmentId, variantId],
        )
      ).rows,
      'line',
    );

    await client.query(
      `INSERT INTO fitting_slot_allocation
         (tenant_id, slot_id, fitting_id, period, is_blocking)
       VALUES (
         $1, $2, $3,
         tstzrange('2026-10-05T02:00:00Z'::timestamptz, '2026-10-05T03:00:00Z'::timestamptz, '[)'),
         true
       )`,
      [tenantId, slotId, appointmentId],
    );

    await client.query('COMMIT');
    return { tenantId, branchId, customerId, variantId, appointmentId, lineId, slotId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function setTenant(client: Client, tenantId: string): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
}

describe('FIT-BE-024/025 fitting RLS, privileges, and indexes', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('forces tenant RLS on every fitting table and fails closed without tenant context', async () => {
    const admin = await openClient();
    const app = await openClient(buildAppRoleDatabaseUrl(adminUrl));
    try {
      const tenantA = await seedFittingTenant(admin, 'tenant-a');
      await seedFittingTenant(admin, 'tenant-b');

      const metadata = await admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = ANY($1::text[])
          ORDER BY relname`,
        [FITTING_TABLES],
      );
      expect(metadata.rows).toHaveLength(FITTING_TABLES.length);
      expect(metadata.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(
        true,
      );

      const policies = await admin.query<{
        tablename: string;
        roles: string[];
        qual: string | null;
      }>(
        `SELECT tablename, roles, qual
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])
            AND policyname = 'tenant_isolation'
          ORDER BY tablename`,
        [FITTING_TABLES],
      );
      expect(policies.rows).toHaveLength(FITTING_TABLES.length);
      expect(
        policies.rows.every(
          (row) => row.roles.includes('drezivo_app') && row.qual?.includes('app.tenant_id'),
        ),
      ).toBe(true);

      for (const table of FITTING_TABLES) {
        const unscoped = await app.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM ${table}`,
        );
        expect(unscoped.rows[0]?.count, table).toBe(0);
      }

      await expect(
        app.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 2, '09:00', '10:00')`,
          [tenantA.tenantId, tenantA.branchId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await Promise.allSettled([app.query('ROLLBACK')]);
      await Promise.all([app.end(), admin.end()]);
    }
  });

  it('shows only the active tenant and rejects cross-tenant writes under the app role', async () => {
    const admin = await openClient();
    const app = await openClient(buildAppRoleDatabaseUrl(adminUrl));
    try {
      const tenantA = await seedFittingTenant(admin, 'scope-a');
      const tenantB = await seedFittingTenant(admin, 'scope-b');

      await setTenant(app, tenantA.tenantId);
      for (const table of FITTING_TABLES) {
        const scoped = await app.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM ${table}`,
        );
        expect(scoped.rows[0]?.count, table).toBe(1);
      }

      const hidden = await app.query<{ id: string }>(
        'SELECT id FROM fitting_appointment WHERE id = $1',
        [tenantB.appointmentId],
      );
      expect(hidden.rows).toEqual([]);

      await expect(
        app.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 2, '10:00', '11:00')`,
          [tenantB.tenantId, tenantB.branchId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await app.query('ROLLBACK');
    } finally {
      await Promise.allSettled([app.query('ROLLBACK')]);
      await Promise.all([app.end(), admin.end()]);
    }
  });

  it('keeps fitting tables inaccessible to the worker/global surface and forbids history deletion', async () => {
    const admin = await openClient();
    const app = await openClient(buildAppRoleDatabaseUrl(adminUrl));
    const worker = await openClient(buildWorkerRoleDatabaseUrl(adminUrl));
    try {
      const seed = await seedFittingTenant(admin, 'privileges');

      const grants = await admin.query<{
        table_name: string;
        app_select: boolean;
        worker_select: boolean;
        app_delete: boolean;
      }>(
        `SELECT
           t.table_name,
           has_table_privilege('drezivo_app', format('public.%I', t.table_name), 'SELECT') AS app_select,
           has_table_privilege('drezivo_worker', format('public.%I', t.table_name), 'SELECT') AS worker_select,
           has_table_privilege('drezivo_app', format('public.%I', t.table_name), 'DELETE') AS app_delete
         FROM unnest($1::text[]) AS t(table_name)
         ORDER BY t.table_name`,
        [FITTING_TABLES],
      );
      expect(grants.rows).toHaveLength(FITTING_TABLES.length);
      expect(grants.rows.every((row) => row.app_select && !row.worker_select)).toBe(true);

      const publicGrants = await admin.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM information_schema.role_table_grants
          WHERE grantee = 'PUBLIC'
            AND table_schema = 'public'
            AND table_name = ANY($1::text[])`,
        [FITTING_TABLES],
      );
      expect(publicGrants.rows[0]?.count).toBe(0);

      const nonDeletable = new Map(
        grants.rows.map((row) => [row.table_name, row.app_delete] as const),
      );
      expect(nonDeletable.get('fitting_settings')).toBe(false);
      expect(nonDeletable.get('fitting_appointment')).toBe(false);
      expect(nonDeletable.get('fitting_slot_allocation')).toBe(false);
      expect(nonDeletable.get('fitting_line')).toBe(true);
      expect(nonDeletable.get('fitting_hours')).toBe(true);
      expect(nonDeletable.get('fitting_closure')).toBe(true);

      await expect(worker.query('SELECT count(*) FROM fitting_settings')).rejects.toMatchObject({
        code: '42501',
      });

      await setTenant(app, seed.tenantId);
      await expect(
        app.query('DELETE FROM fitting_appointment WHERE tenant_id = $1 AND id = $2', [
          seed.tenantId,
          seed.appointmentId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await app.query('ROLLBACK');
    } finally {
      await Promise.allSettled([app.query('ROLLBACK'), worker.query('ROLLBACK')]);
      await Promise.all([worker.end(), app.end(), admin.end()]);
    }
  });

  it('installs the BE-025 operational indexes and uses them for representative access paths', async () => {
    const admin = await openClient();
    try {
      const seed = await seedFittingTenant(admin, 'indexes');

      const indexes = await admin.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = ANY($1::text[])
          ORDER BY indexname`,
        [FITTING_INDEXES],
      );
      expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([...FITTING_INDEXES].sort());

      await admin.query('BEGIN');
      await admin.query('SET LOCAL enable_seqscan = off');
      // This tiny one-row fixture can make PostgreSQL prefer a tenant/branch B-tree and filter
      // the range predicate even though the GiST index is healthy. Disable plain index scans for
      // this one eligibility check so the planner must demonstrate the overlap-capable GiST path;
      // FIT-BE-094 separately verifies the GiST is naturally selected under representative load.
      await admin.query('SET LOCAL enable_indexscan = off');

      const calendarPlan = await admin.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF)
         SELECT id
           FROM fitting_appointment
          WHERE tenant_id = $1
            AND branch_id = $2
            AND period && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
        [seed.tenantId, seed.branchId, '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'],
      );
      expect(calendarPlan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'fitting_appointment_tenant_branch_period_gist_idx',
      );
      await admin.query('SET LOCAL enable_indexscan = on');

      const capacityPlan = await admin.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF)
         SELECT id
           FROM fitting_capacity_slot
          WHERE tenant_id = $1 AND branch_id = $2 AND active
          ORDER BY slot_number, id
          LIMIT 1`,
        [seed.tenantId, seed.branchId],
      );
      expect(capacityPlan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'fitting_capacity_slot_active_lookup_idx',
      );

      const linePlan = await admin.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF)
         SELECT id
           FROM fitting_line
          WHERE tenant_id = $1 AND fitting_id = $2
          ORDER BY id`,
        [seed.tenantId, seed.appointmentId],
      );
      expect(linePlan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'fitting_line_tenant_fitting_id_idx',
      );

      await admin.query('ROLLBACK');
    } finally {
      await Promise.allSettled([admin.query('ROLLBACK')]);
      await admin.end();
    }
  });

  it('records both BE-024 and BE-025 migrations in the rehearsal ledger', async () => {
    const admin = await openClient();
    try {
      const applied = await admin.query<{ filename: string }>(
        `SELECT filename
           FROM schema_migrations
          WHERE filename IN ('0045_fittings_rls_privileges.sql', '0046_fittings_indexes.sql')
          ORDER BY filename`,
      );
      expect(applied.rows.map((row) => row.filename)).toEqual([
        '0045_fittings_rls_privileges.sql',
        '0046_fittings_indexes.sql',
      ]);
    } finally {
      await admin.end();
    }
  });
});
