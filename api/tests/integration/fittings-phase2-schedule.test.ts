import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

type ScheduleSeed = {
  tenantId: string;
  branchId: string;
  secondBranchId: string;
  timezone: string;
};

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

async function seedScheduleBranch(
  client: Client,
  label: string,
  timezone = 'Asia/Manila',
): Promise<ScheduleSeed> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const tenantId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO tenant (clerk_org_id, name, slug, currency, timezone)
         VALUES ($1, $2, $3, 'PHP', $4)
         RETURNING id`,
        [`org_${suffix}`, `Schedule ${suffix}`, `fit-schedule-${suffix}`, timezone],
      )
    ).rows,
    'tenant',
  );

  const branchId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main', 'MAIN', true, $2)
         RETURNING id`,
        [tenantId, timezone],
      )
    ).rows,
    'branch',
  );

  const secondBranchId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Second', 'SECOND', false, $2)
         RETURNING id`,
        [tenantId, timezone],
      )
    ).rows,
    'second branch',
  );

  return { tenantId, branchId, secondBranchId, timezone };
}

async function insertSettings(
  client: Client,
  seed: ScheduleSeed,
  input?: {
    branchId?: string;
    enabled?: boolean;
    capacity?: number;
    durationMinutes?: number;
    feeMinor?: bigint;
    currency?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO fitting_settings
       (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
    [
      seed.tenantId,
      input?.branchId ?? seed.branchId,
      input?.enabled ?? true,
      input?.capacity ?? 2,
      input?.durationMinutes ?? 60,
      (input?.feeMinor ?? 30000n).toString(),
      input?.currency ?? 'PHP',
    ],
  );
}

async function constraintResult(
  operation: () => Promise<unknown>,
): Promise<{ code: string | undefined; constraint: string | undefined }> {
  try {
    await operation();
    return { code: 'inserted', constraint: undefined };
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    return { code: pgError.code, constraint: pgError.constraint };
  }
}

describe('FIT-BE-023 fitting schedule and closure persistence', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('persists branch-scoped enabled/capacity/duration/fee settings and prevents active slots from exceeding capacity', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedScheduleBranch(client, 'settings');
      await insertSettings(client, seed, {
        enabled: false,
        capacity: 2,
        durationMinutes: 90,
        feeMinor: 45000n,
      });

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
        version: string;
      }>(
        `SELECT enabled, capacity, duration_minutes, fee_minor::text, currency, version::text
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
        version: '1',
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

      const reduceBelowActive = await constraintResult(() =>
        client.query(
          `UPDATE fitting_settings
              SET capacity = 1, version = version + 1
            WHERE tenant_id = $1 AND branch_id = $2`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(reduceBelowActive).toMatchObject({
        code: '23514',
        constraint: 'fitting_capacity_slots_within_setting',
      });

      const wrongCurrency = await constraintResult(() =>
        client.query(
          `UPDATE fitting_settings
              SET currency = 'USD', version = version + 1
            WHERE tenant_id = $1 AND branch_id = $2`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(wrongCurrency).toMatchObject({
        code: '23514',
        constraint: 'fitting_settings_currency_match',
      });
    } finally {
      await client.end();
    }
  });

  it('stores ISO weekday local windows for all seven days and supports split windows as recurring-break gaps', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedScheduleBranch(client, 'weekly-hours');
      await insertSettings(client, seed);

      await client.query(
        `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
         VALUES
           ($1, $2, 1, '09:00', '12:00'),
           ($1, $2, 1, '13:00', '17:00'),
           ($1, $2, 2, '09:00', '17:00'),
           ($1, $2, 3, '09:00', '17:00'),
           ($1, $2, 4, '09:00', '17:00'),
           ($1, $2, 5, '09:00', '17:00'),
           ($1, $2, 6, '10:00', '14:00'),
           ($1, $2, 7, '10:00', '12:00')`,
        [seed.tenantId, seed.branchId],
      );

      // Adjacent windows are legal half-open configuration intervals.
      await client.query(
        `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
         VALUES ($1, $2, 7, '12:00', '13:00')`,
        [seed.tenantId, seed.branchId],
      );

      const shape = await client.query<{
        weekdays: number;
        monday_windows: number;
        monday_break_rows: number;
        sunday_windows: number;
      }>(
        `SELECT
           count(DISTINCT weekday)::integer AS weekdays,
           count(*) FILTER (WHERE weekday = 1)::integer AS monday_windows,
           count(*) FILTER (
             WHERE weekday = 1 AND starts_local < time '13:00' AND ends_local > time '12:00'
           )::integer AS monday_break_rows,
           count(*) FILTER (WHERE weekday = 7)::integer AS sunday_windows
         FROM fitting_hours
        WHERE tenant_id = $1 AND branch_id = $2`,
        [seed.tenantId, seed.branchId],
      );

      expect(shape.rows[0]).toEqual({
        weekdays: 7,
        monday_windows: 2,
        monday_break_rows: 0,
        sunday_windows: 2,
      });
    } finally {
      await client.end();
    }
  });

  it('rejects malformed and overlapping weekly windows while keeping adjacent windows valid', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedScheduleBranch(client, 'invalid-hours');
      await insertSettings(client, seed);

      await client.query(
        `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
         VALUES ($1, $2, 1, '09:00', '12:00'), ($1, $2, 1, '13:00', '17:00')`,
        [seed.tenantId, seed.branchId],
      );

      const overlap = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 1, '11:30', '13:30')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(overlap).toMatchObject({ code: '23P01', constraint: 'fitting_hours_no_overlap' });

      const invalidWeekday = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 8, '09:00', '10:00')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(invalidWeekday).toMatchObject({
        code: '23514',
        constraint: 'fitting_hours_weekday_bounds',
      });

      const overnight = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 2, '17:00', '09:00')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(overnight).toMatchObject({
        code: '23514',
        constraint: 'fitting_hours_window_order',
      });

      const seconds = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 3, '09:00:30', '10:00:00')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(seconds).toMatchObject({
        code: '23514',
        constraint: 'fitting_hours_minute_precision',
      });
    } finally {
      await client.end();
    }
  });

  it('enforces the eight-window technical bound per branch weekday', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedScheduleBranch(client, 'window-bound');
      await insertSettings(client, seed);

      for (let index = 0; index < 8; index += 1) {
        const startHour = index * 2;
        const endHour = startHour + 1;
        await client.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 4, make_time($3, 0, 0), make_time($4, 0, 0))`,
          [seed.tenantId, seed.branchId, startHour, endHour],
        );
      }

      const ninth = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
           VALUES ($1, $2, 4, '16:00', '17:00')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(ninth).toMatchObject({
        code: '23514',
        constraint: 'fitting_hours_windows_per_day_max',
      });
    } finally {
      await client.end();
    }
  });

  it('stores date-specific closures as bounded instants with the authoritative branch timezone snapshot', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedScheduleBranch(client, 'closure-timezone', 'America/New_York');
      await insertSettings(client, seed);

      const closure = await client.query<{
        timezone_snapshot: string;
        start_at: Date;
        end_at: Date;
        reason: string;
      }>(
        `INSERT INTO fitting_closure
           (tenant_id, branch_id, period, timezone_snapshot, reason)
         VALUES
           ($1, $2,
            tstzrange('2026-11-01T05:00:00Z'::timestamptz, '2026-11-01T07:00:00Z'::timestamptz, '[)'),
            'America/New_York', 'Private event')
         RETURNING timezone_snapshot, lower(period) AS start_at, upper(period) AS end_at, reason`,
        [seed.tenantId, seed.branchId],
      );

      const storedClosure = closure.rows[0];
      if (!storedClosure) throw new Error('fitting closure insert returned no row');

      expect(storedClosure).toMatchObject({
        timezone_snapshot: 'America/New_York',
        reason: 'Private event',
      });
      expect(storedClosure.end_at.getTime() - storedClosure.start_at.getTime()).toBe(
        2 * 60 * 60 * 1000,
      );

      const wrongTimezone = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_closure
             (tenant_id, branch_id, period, timezone_snapshot, reason)
           VALUES
             ($1, $2,
              tstzrange('2026-12-25T05:00:00Z'::timestamptz, '2026-12-25T10:00:00Z'::timestamptz, '[)'),
              'Asia/Manila', 'Holiday')`,
          [seed.tenantId, seed.branchId],
        ),
      );
      expect(wrongTimezone).toMatchObject({
        code: '23514',
        constraint: 'fitting_closure_timezone_match',
      });
    } finally {
      await client.end();
    }
  });
});
