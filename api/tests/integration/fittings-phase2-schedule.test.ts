import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

function requireId(rows: Array<{ id: string }>, label: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${label} insert returned no row`);
  return row.id;
}

async function openAdminClient(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl });
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
        [`org_${suffix}`, `Business Hours ${suffix}`, `business-hours-${suffix}`],
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
  return { tenantId, branchId };
}

async function constraintResult(operation: () => Promise<unknown>) {
  try {
    await operation();
    return { code: 'inserted', constraint: undefined };
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    return { code: pgError.code, constraint: pgError.constraint };
  }
}

describe('branch Business Hours and fitting scalar persistence', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('preserves fitting scalar settings and hidden-capacity guards independently of Business Hours', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBranch(client, 'settings');
      await client.query(
        `INSERT INTO fitting_settings
           (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
         VALUES ($1, $2, false, 2, 90, 45000, 'PHP', 1)`,
        [seed.tenantId, seed.branchId],
      );
      await client.query(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         VALUES ($1, $2, 1, true), ($1, $2, 2, true)`,
        [seed.tenantId, seed.branchId],
      );

      const stored = await client.query<{
        enabled: boolean;
        capacity: number;
        duration_minutes: number;
        fee_minor: string;
        currency: string;
      }>(
        `SELECT enabled, capacity, duration_minutes, fee_minor::text, currency
           FROM fitting_settings
          WHERE tenant_id = $1 AND branch_id = $2`,
        [seed.tenantId, seed.branchId],
      );
      expect(stored.rows[0]).toEqual({
        enabled: false,
        capacity: 2,
        duration_minutes: 90,
        fee_minor: '45000',
        currency: 'PHP',
      });

      const thirdSlot = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
           VALUES ($1, $2, 3, true)`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(thirdSlot).toMatchObject({
        code: '23514',
        constraint: 'fitting_capacity_slots_within_setting',
      });
    } finally {
      await client.end();
    }
  });

  it('stores one canonical branch Business Hours window and recurring closed weekdays', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBranch(client, 'hours');
      const initial = await client.query<{
        operating_hours: Record<string, unknown>;
        operating_hours_version: string;
      }>(
        `SELECT operating_hours, operating_hours_version::text
           FROM branch
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.branchId],
      );
      expect(initial.rows[0]).toEqual({
        operating_hours: {
          opens_local: '08:00',
          closes_local: '20:00',
          closed_weekdays: ['sunday'],
        },
        operating_hours_version: '1',
      });

      await client.query(
        `UPDATE branch
            SET operating_hours = '{"opens_local":"09:00","closes_local":"20:00","closed_weekdays":["sunday","monday"]}'::jsonb,
                operating_hours_version = operating_hours_version + 1,
                operating_hours_updated_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.branchId],
      );
      const changed = await client.query<{
        operating_hours: Record<string, unknown>;
        operating_hours_version: string;
      }>(
        `SELECT operating_hours, operating_hours_version::text
           FROM branch
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.branchId],
      );
      expect(changed.rows[0]).toEqual({
        operating_hours: {
          opens_local: '09:00',
          closes_local: '20:00',
          closed_weekdays: ['sunday', 'monday'],
        },
        operating_hours_version: '2',
      });

      const invalid = await constraintResult(() =>
        client.query(
          `UPDATE branch
              SET operating_hours = '{"opens_local":"20:00","closes_local":"09:00","closed_weekdays":[]}'::jsonb
            WHERE tenant_id = $1 AND id = $2`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(invalid).toMatchObject({ code: '23514', constraint: 'branch_operating_hours_shape' });
    } finally {
      await client.end();
    }
  });

  it('stores whole-day branch closures with tenant-safe uniqueness and bounded reasons', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBranch(client, 'closures');
      await client.query(
        `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
         VALUES ($1, $2, date '2026-12-25', 'Christmas Day')`,
        [seed.tenantId, seed.branchId],
      );
      const row = await client.query<{
        local_date: string;
        reason: string;
        version: string;
      }>(
        `SELECT local_date::text, reason, version::text
           FROM branch_closure
          WHERE tenant_id = $1 AND branch_id = $2`,
        [seed.tenantId, seed.branchId],
      );
      expect(row.rows[0]).toEqual({
        local_date: '2026-12-25',
        reason: 'Christmas Day',
        version: '1',
      });

      const duplicate = await constraintResult(() =>
        client.query(
          `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
           VALUES ($1, $2, date '2026-12-25', 'Duplicate')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(duplicate).toMatchObject({
        code: '23505',
        constraint: 'branch_closure_tenant_branch_date_key',
      });

      const blankReason = await constraintResult(() =>
        client.query(
          `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
           VALUES ($1, $2, date '2026-12-26', '')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(blankReason).toMatchObject({
        code: '23514',
        constraint: 'branch_closure_reason_bounded',
      });
    } finally {
      await client.end();
    }
  });

  it('removes the obsolete fitting-owned schedule tables', async () => {
    const client = await openAdminClient();
    try {
      const result = await client.query<{
        fitting_hours: string | null;
        fitting_closure: string | null;
      }>(
        `SELECT to_regclass('public.fitting_hours')::text AS fitting_hours,
                to_regclass('public.fitting_closure')::text AS fitting_closure`,
      );
      expect(result.rows[0]).toEqual({ fitting_hours: null, fitting_closure: null });
    } finally {
      await client.end();
    }
  });
});
