import { readFileSync } from 'node:fs';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

/** Migration 0093: Gigi's Rental moves to Growth, then Standard returns to 300 active garments. */
const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('migration 0093 Standard garment limit', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const migration = readFileSync(
    new URL('../../src/db/migrations/0093_standard_garment_limit_300.sql', import.meta.url),
    'utf8',
  );

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  const planOf = async (tenantId: string) =>
    (await admin.query<{ code: string }>(
      'SELECT p.code FROM subscription s JOIN plan p ON p.id = s.plan_id WHERE s.tenant_id = $1',
      [tenantId],
    )).rows[0]?.code;

  it("moves only Gigi's Rental to Growth, once, and leaves Standard at 300", async () => {
    const gigi = await createStorefrontWorkspace('m93-gigi');
    const other = await createStorefrontWorkspace('m93-other');
    await admin.query("UPDATE storefront SET slug = 'gigis-rental' WHERE tenant_id = $1", [gigi.tenantId]);
    const periodBefore = (await admin.query<{ end: Date }>('SELECT current_period_end AS end FROM subscription WHERE tenant_id = $1', [gigi.tenantId])).rows[0]?.end;

    await admin.query(migration);
    await admin.query(migration);

    expect(await planOf(gigi.tenantId)).toBe('growth');
    expect(await planOf(other.tenantId)).toBe('standard');
    const periodAfter = (await admin.query<{ end: Date }>('SELECT current_period_end AS end FROM subscription WHERE tenant_id = $1', [gigi.tenantId])).rows[0]?.end;
    expect(periodAfter).toEqual(periodBefore);
    const events = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM subscription_event WHERE tenant_id = $1 AND business_key = 'migration-0093:standard-to-growth'",
      [gigi.tenantId],
    );
    expect(events.rows[0]?.n).toBe(1);
    const limit = await admin.query<{ limit_value: number }>(
      `SELECT e.limit_value FROM plan_entitlement e JOIN plan p ON p.id = e.plan_id
        WHERE p.code = 'standard' AND p.version = 1 AND e.capability = 'physical_assets.max'`,
    );
    expect(limit.rows[0]?.limit_value).toBe(300);
  });
});
