import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { buildAppRoleDatabaseUrl, ensureAppRoleLogin, migrateTestDatabase, requireTestDatabaseUrl, resetTestDatabase } from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
const admin = new Client({ connectionString: adminUrl });
const runtime = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });

describe('operator paid-business aggregate', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await admin.connect();
    await resetTestDatabase(adminUrl);
    await runtime.connect();
    const cases = [
      ['paid', 'active', 'standard', 'active', '-1 day', '1 day'],
      ['locked-paid', 'restricted', 'standard', 'active', '-1 day', '1 day'],
      ['free', 'active', 'free', 'active', '-1 day', null],
      ['trial', 'active', 'standard', 'trialing', '-1 day', '1 day'],
      ['expired', 'active', 'standard', 'active', '-2 days', '-1 day'],
      ['cancelled', 'active', 'standard', 'cancelled', '-1 day', '1 day'],
      ['future', 'active', 'standard', 'active', '1 day', '2 days'],
    ];
    for (const [name, tenantStatus, plan, status, start, end] of cases) {
      const tenant = await admin.query<{ id: string }>(
        'INSERT INTO tenant (clerk_org_id,name,slug,status) VALUES ($1,$1,$1,$2) RETURNING id', [`aggregate-${name}`, tenantStatus],
      );
      const tenantId = tenant.rows[0]?.id;
      if (!tenantId) throw new Error('Test tenant was not created.');
      await admin.query(`INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
        SELECT $1,id,$3,statement_timestamp()+$4::interval,
          CASE WHEN $5::text IS NULL THEN NULL ELSE statement_timestamp()+$5::interval END
        FROM plan WHERE code=$2 AND active=true AND version=1`, [tenantId, plan, status, start, end]);
    }
  }, 180_000);
  afterAll(async () => { await runtime.end(); await admin.end(); });

  it('requires operator context and counts only current paid periods, including locked businesses', async () => {
    await expect(runtime.query('SELECT operator_private.paid_business_count()')).rejects.toMatchObject({ code: '42501' });
    await runtime.query('BEGIN READ ONLY');
    try {
      await runtime.query("SELECT set_config('app.actor_kind','operator',true), set_config('app.principal_id','operator:test',true), set_config('app.tenant_id','',true)");
      const result = await runtime.query<{ count: number }>('SELECT operator_private.paid_business_count() AS count');
      expect(result.rows[0]?.count).toBe(2);
    } finally { await runtime.query('ROLLBACK'); }
  });
});
