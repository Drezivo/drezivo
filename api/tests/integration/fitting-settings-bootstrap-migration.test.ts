import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
const fittingSettingsBootstrapMigration = new URL(
  '../../src/db/migrations/0052_fitting_settings_enabled_defaults.sql',
  import.meta.url,
);

describe('FIT-BE-101 fitting settings bootstrap migration', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('backfills only unconfigured branches with enabled Monday-to-Saturday hours', async () => {
    const tenantId = randomUUID();
    const legacyBranchId = randomUUID();
    const configuredBranchId = randomUUID();
    const client = new Client({ connectionString: adminUrl });
    await client.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tenant (id, clerk_org_id, name, slug, status, currency, timezone)
         VALUES ($1, $2, 'Migration Test Tenant', 'migration-test-tenant', 'active', 'PHP', 'Asia/Manila')`,
        [tenantId, `org_migration_${tenantId}`],
      );
      await client.query(
        `INSERT INTO branch (id, tenant_id, name, code, is_default, timezone, status)
         VALUES
           ($1, $3, 'Legacy Branch', 'legacy', true, 'Asia/Manila', 'active'),
           ($2, $3, 'Configured Branch', 'configured', false, 'Asia/Manila', 'active')`,
        [legacyBranchId, configuredBranchId, tenantId],
      );
      await client.query(
        `INSERT INTO fitting_settings
           (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
         VALUES ($1, $2, true, 3, 90, 250, 'PHP')`,
        [tenantId, configuredBranchId],
      );
      await client.query(
        `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
         VALUES ($1, $2, 7, time '10:00', time '11:00')`,
        [tenantId, configuredBranchId],
      );

      await client.query(await readFile(fittingSettingsBootstrapMigration, 'utf8'));
      await client.query('COMMIT');

      const settings = await client.query<{
        branch_id: string;
        enabled: boolean;
        capacity: number;
        duration_minutes: number;
        fee_minor: string;
        currency: string;
        version: number;
      }>(
        `SELECT fs.branch_id, fs.enabled, fs.capacity, fs.duration_minutes, fs.fee_minor::text,
                fs.currency, fs.version::integer AS version
           FROM fitting_settings fs
           JOIN branch b ON b.tenant_id = fs.tenant_id AND b.id = fs.branch_id
          WHERE fs.tenant_id = $1
          ORDER BY b.code ASC`,
        [tenantId],
      );
      const hours = await client.query<{
        branch_id: string;
        weekday: number;
        starts_local: string;
        ends_local: string;
      }>(
        `SELECT fh.branch_id, fh.weekday, to_char(fh.starts_local, 'HH24:MI') AS starts_local,
                to_char(fh.ends_local, 'HH24:MI') AS ends_local
           FROM fitting_hours fh
           JOIN branch b ON b.tenant_id = fh.tenant_id AND b.id = fh.branch_id
          WHERE fh.tenant_id = $1
          ORDER BY b.code ASC, fh.weekday ASC`,
        [tenantId],
      );

      expect(settings.rows).toEqual([
        {
          branch_id: configuredBranchId,
          enabled: true,
          capacity: 3,
          duration_minutes: 90,
          fee_minor: '250',
          currency: 'PHP',
          version: 1,
        },
        {
          branch_id: legacyBranchId,
          enabled: true,
          capacity: 1,
          duration_minutes: 60,
          fee_minor: '0',
          currency: 'PHP',
          version: 1,
        },
      ]);
      expect(hours.rows).toEqual([
        { branch_id: configuredBranchId, weekday: 7, starts_local: '10:00', ends_local: '11:00' },
        { branch_id: legacyBranchId, weekday: 1, starts_local: '08:00', ends_local: '20:00' },
        { branch_id: legacyBranchId, weekday: 2, starts_local: '08:00', ends_local: '20:00' },
        { branch_id: legacyBranchId, weekday: 3, starts_local: '08:00', ends_local: '20:00' },
        { branch_id: legacyBranchId, weekday: 4, starts_local: '08:00', ends_local: '20:00' },
        { branch_id: legacyBranchId, weekday: 5, starts_local: '08:00', ends_local: '20:00' },
        { branch_id: legacyBranchId, weekday: 6, starts_local: '08:00', ends_local: '20:00' },
      ]);
    } finally {
      await client.end();
    }
  });
});
