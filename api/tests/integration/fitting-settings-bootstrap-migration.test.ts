import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

describe('branch Business Hours bootstrap persistence', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('gives every newly inserted branch the canonical Business Hours default', async () => {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const tenantId = randomUUID();
      await client.query(
        `INSERT INTO tenant (id, clerk_org_id, name, slug, status, currency, timezone)
         VALUES ($1, $2, 'Business Hours Default', $3, 'active', 'PHP', 'Asia/Manila')`,
        [tenantId, `org_business_hours_${tenantId}`, `business-hours-${tenantId}`],
      );
      const branch = await client.query<{
        operating_hours: Record<string, unknown>;
        operating_hours_version: string;
        operating_hours_updated_at: Date;
      }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'main', true, 'Asia/Manila', 'active')
         RETURNING operating_hours, operating_hours_version::text, operating_hours_updated_at`,
        [tenantId],
      );

      expect(branch.rows[0]?.operating_hours).toEqual({
        opens_local: '08:00',
        closes_local: '20:00',
        closed_weekdays: [],
      });
      expect(branch.rows[0]?.operating_hours_version).toBe('1');
      expect(branch.rows[0]?.operating_hours_updated_at).toBeInstanceOf(Date);
    } finally {
      await client.end();
    }
  });

  it('keeps fitting scalar settings while the legacy schedule tables are gone', async () => {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const tables = await client.query<{
        fitting_hours: string | null;
        fitting_closure: string | null;
        branch_closure: string | null;
      }>(
        `SELECT to_regclass('public.fitting_hours')::text AS fitting_hours,
                to_regclass('public.fitting_closure')::text AS fitting_closure,
                to_regclass('public.branch_closure')::text AS branch_closure`,
      );
      expect(tables.rows[0]).toEqual({
        fitting_hours: null,
        fitting_closure: null,
        branch_closure: 'branch_closure',
      });

      const settingsColumns = await client.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'fitting_settings'
          ORDER BY ordinal_position`,
      );
      expect(settingsColumns.rows.map((row) => row.column_name)).toEqual(
        expect.arrayContaining([
          'enabled',
          'capacity',
          'duration_minutes',
          'fee_minor',
          'currency',
          'version',
        ]),
      );
    } finally {
      await client.end();
    }
  });
});
