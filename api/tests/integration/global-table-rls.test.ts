import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureAppRoleLogin,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
const GLOBAL_TABLES = [
  'plan',
  'plan_entitlement',
  'schema_migrations',
  'tenant',
  'webhook_inbox',
  'platform_payment_method',
  'platform_payment_method_change',
] as const;

async function openClient(connectionString = adminUrl): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

describe('global-table RLS and runtime privileges', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });

  it('forces RLS and defines explicit policies on global tables', async () => {
    const admin = await openClient();
    try {
      const tables = await admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relnamespace = 'public'::regnamespace
            AND relname = ANY($1::text[])
          ORDER BY relname`,
        [GLOBAL_TABLES],
      );
      expect(tables.rows).toHaveLength(GLOBAL_TABLES.length);
      expect(tables.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(
        true,
      );

      const policies = await admin.query<{ tablename: string; policyname: string }>(
        `SELECT tablename, policyname
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])
          ORDER BY tablename, policyname`,
        [GLOBAL_TABLES],
      );
      const policiesByTable = new Map<string, string[]>();
      for (const policy of policies.rows) {
        policiesByTable.set(policy.tablename, [
          ...(policiesByTable.get(policy.tablename) ?? []),
          policy.policyname,
        ]);
      }
      expect(policiesByTable.get('plan')).toContain('plan_runtime_read');
      expect(policiesByTable.get('plan_entitlement')).toContain('plan_entitlement_runtime_read');
      expect(policiesByTable.get('schema_migrations')).toContain('schema_migrations_runtime_deny');
      expect(policiesByTable.get('tenant')).toContain('tenant_app_scoped_read');
      expect(policiesByTable.get('webhook_inbox')).toContain('webhook_inbox_worker_read');
      expect(policiesByTable.get('platform_payment_method')).toContain(
        'platform_payment_method_read',
      );
      expect(policiesByTable.get('platform_payment_method_change')).toContain(
        'platform_payment_method_change_operator_read',
      );
    } finally {
      await admin.end();
    }
  });

  it('limits global-table grants to the operations used by the API and worker', async () => {
    const admin = await openClient();
    try {
      const grants = await admin.query<{
        app_plan_read: boolean;
        app_plan_write: boolean;
        worker_plan_read: boolean;
        app_ledger_read: boolean;
        worker_ledger_read: boolean;
        app_webhook_read: boolean;
        worker_webhook_read: boolean;
      }>(`SELECT
        has_table_privilege('drezivo_app', 'public.plan', 'SELECT') AS app_plan_read,
        has_table_privilege('drezivo_app', 'public.plan', 'INSERT') AS app_plan_write,
        has_table_privilege('drezivo_worker', 'public.plan', 'SELECT') AS worker_plan_read,
        has_table_privilege('drezivo_app', 'public.schema_migrations', 'SELECT') AS app_ledger_read,
        has_table_privilege('drezivo_worker', 'public.schema_migrations', 'SELECT') AS worker_ledger_read,
        has_table_privilege('drezivo_app', 'public.webhook_inbox', 'SELECT') AS app_webhook_read,
        has_table_privilege('drezivo_worker', 'public.webhook_inbox', 'SELECT') AS worker_webhook_read`);
      expect(grants.rows[0]).toEqual({
        app_plan_read: true,
        app_plan_write: false,
        worker_plan_read: true,
        app_ledger_read: false,
        worker_ledger_read: false,
        app_webhook_read: false,
        worker_webhook_read: true,
      });

      const app = await openClient(buildAppRoleDatabaseUrl(adminUrl));
      const worker = await openClient(buildWorkerRoleDatabaseUrl(adminUrl));
      try {
        await expect(app.query('SELECT filename FROM schema_migrations')).rejects.toMatchObject({
          code: '42501',
        });
        await expect(worker.query('SELECT filename FROM schema_migrations')).rejects.toMatchObject({
          code: '42501',
        });
        await expect(
          app.query('SELECT provider_event_id FROM webhook_inbox'),
        ).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await Promise.all([app.end(), worker.end()]);
      }
    } finally {
      await admin.end();
    }
  });

  it('does not expose the automatic-RLS event helper to runtime database roles', async () => {
    const admin = await openClient();
    try {
      const result = await admin.query<{
        function_exists: boolean;
        app_can_execute: boolean;
        worker_can_execute: boolean;
      }>(`SELECT
        helper.oid IS NOT NULL AS function_exists,
        CASE WHEN helper.oid IS NULL THEN false
             ELSE has_function_privilege('drezivo_app', helper.oid, 'EXECUTE') END AS app_can_execute,
        CASE WHEN helper.oid IS NULL THEN false
             ELSE has_function_privilege('drezivo_worker', helper.oid, 'EXECUTE') END AS worker_can_execute
       FROM (SELECT to_regprocedure('public.rls_auto_enable()') AS oid) AS helper`);

      const helper = result.rows[0];
      expect(helper).toBeDefined();
      if (helper?.function_exists) {
        expect(helper.app_can_execute).toBe(false);
        expect(helper.worker_can_execute).toBe(false);
      }
    } finally {
      await admin.end();
    }
  });
});
