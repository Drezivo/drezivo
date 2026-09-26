import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
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
process.env.DATABASE_POOL_MAX ??= '12';
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

interface Seed {
  tenantId: string;
  branchId: string;
  customerId: string;
  variantId: string;
}

function requireId(rows: Array<{ id: string }>, label: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${label} insert returned no row`);
  return row.id;
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedTenant(
  label: string,
  options: {
    capacity?: number;
    durationMinutes?: number;
    feeMinor?: number;
    timezone?: string;
  } = {},
): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP',$4) RETURNING id`,
          [`org_${suffix}`, suffix, `fit6-${suffix}`, options.timezone ?? 'Asia/Manila'],
        )
      ).rows,
      'tenant',
    );
    const branchId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone)
           VALUES ($1,'Main','MAIN',true,$2) RETURNING id`,
          [tenantId, options.timezone ?? 'Asia/Manila'],
        )
      ).rows,
      'branch',
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Phase 6 Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Phase 6 Gown','active') RETURNING id`,
          [tenantId, `P-${suffix}`],
        )
      ).rows,
      'product',
    );
    const variantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product_variant
             (tenant_id,product_id,sku,size_label,color_label,measurements,measurement_unit,
              measurement_mode,rental_price_minor,security_deposit_minor,currency,pricing_mode,
              included_duration_minutes,extra_day_price_minor,prep_minutes,turnaround_minutes,status)
           VALUES ($1,$2,$3,'M','Ivory','{}','cm','none',1000,0,'PHP','fixed_duration',1440,0,0,0,'active')
           RETURNING id`,
          [tenantId, productId, `SKU-${suffix}`],
        )
      ).rows,
      'variant',
    );

    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,$3,$4,$5,'PHP',1)`,
      [
        tenantId,
        branchId,
        options.capacity ?? 3,
        options.durationMinutes ?? 60,
        options.feeMinor ?? 500,
      ],
    );
    await client.query(
      `INSERT INTO fitting_hours (tenant_id,branch_id,weekday,starts_local,ends_local)
       SELECT $1,$2,weekday,'09:00'::time,'17:00'::time
         FROM generate_series(1,7) AS weekday`,
      [tenantId, branchId],
    );

    return { tenantId, branchId, customerId, variantId };
  });
}

function ownerContext(seed: Seed, idempotencyKey = randomUUID()) {
  const membershipId = randomUUID();
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId,
    principalId: `user_${membershipId}`,
    requestId: randomUUID(),
    idempotencyKey,
    role: 'owner' as const,
    effectiveTenantStatus: 'active' as const,
  };
}

function frontdeskContext(seed: Seed) {
  const membershipId = randomUUID();
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId,
    principalId: `user_${membershipId}`,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    role: 'frontdesk' as const,
    effectiveTenantStatus: 'active' as const,
  };
}

function readContext(
  seed: Seed,
  permissionCodes: Array<'reservations.manage'> = ['reservations.manage'],
) {
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId: randomUUID(),
    principalId: `user_${randomUUID()}`,
    permissionCodes,
    effectiveTenantStatus: 'active' as const,
  };
}

function weeklyHours(
  defaultWindows: Array<{ starts_local: string; ends_local: string }> = [
    { starts_local: '09:00', ends_local: '17:00' },
  ],
) {
  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
    (weekday) => ({ weekday, windows: defaultWindows.map((window) => ({ ...window })) }),
  );
}

describe('FIT-BE-060..061 fitting weekly-hours and branch settings commands', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const { cancelFittingCommand, confirmFittingCommand, rescheduleFittingCommand } =
    await import('../../src/modules/fittings/fittings.mutation.service.js');
  const {
    createFittingClosureCommand,
    removeFittingClosureCommand,
    updateFittingClosureCommand,
    updateFittingSettingsCommand,
    updateFittingWeeklyHoursCommand,
  } = await import('../../src/modules/fittings/fittings.schedule.command.service.js');
  const { getFittingClosures, getFittingDetail, getFittingSettings } =
    await import('../../src/modules/fittings/fittings.service.js');

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

  async function createPreference(
    seed: Seed,
    startsAt: string,
  ): Promise<{
    id: string;
    version: number;
    period: { start: string; end: string };
    fee: { fee_minor: string };
  }> {
    const context = ownerContext(seed);
    const response = await createStaffFittingCommand(context, {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: startsAt,
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    if (!response.body.success) throw new Error('Expected fitting creation success.');
    return response.body.data.fitting;
  }

  it('allows Owner and Front Desk operational reads while keeping configuration mutation owner-only', async () => {
    const seed = await seedTenant('permissions');

    const ownerRead = await getFittingSettings(readContext(seed));
    const frontdeskRead = await getFittingSettings(readContext(seed));
    expect(ownerRead.branch_id).toBe(seed.branchId);
    expect(frontdeskRead.branch_id).toBe(seed.branchId);

    await expect(getFittingSettings(readContext(seed, []))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      updateFittingSettingsCommand(frontdeskContext(seed), {
        version: 1,
        enabled: true,
        capacity: 3,
        duration_minutes: 60,
        fee_minor: '500',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('replaces all seven weekdays, normalizes split windows, and represents a disabled day with zero rows', async () => {
    const seed = await seedTenant('hours-normalize');
    const key = randomUUID();
    const context = ownerContext(seed, key);
    const hours = weeklyHours();
    hours.reverse();
    const monday = hours.find((day) => day.weekday === 'monday');
    if (!monday) throw new Error('Monday missing.');
    monday.windows = [
      { starts_local: '13:00', ends_local: '17:00' },
      { starts_local: '09:00', ends_local: '12:00' },
    ];
    const tuesday = hours.find((day) => day.weekday === 'tuesday');
    if (!tuesday) throw new Error('Tuesday missing.');
    tuesday.windows = [];

    const first = await updateFittingWeeklyHoursCommand(context, {
      version: 1,
      weekly_hours: hours as never,
    });
    expect(first.status).toBe(200);
    if (!first.body.success) throw new Error('Expected weekly-hours success.');
    expect(first.body.data.settings.version).toBe(2);
    expect(first.body.data.settings.weekly_hours[0]).toEqual({
      weekday: 'monday',
      windows: [
        { starts_local: '09:00', ends_local: '12:00' },
        { starts_local: '13:00', ends_local: '17:00' },
      ],
    });
    expect(first.body.data.settings.weekly_hours[1]).toEqual({
      weekday: 'tuesday',
      windows: [],
    });

    const replay = await updateFittingWeeklyHoursCommand(
      { ...context, requestId: randomUUID() },
      { version: 1, weekly_hours: hours as never },
    );
    expect(replay.status).toBe(200);
    if (!replay.body.success) throw new Error('Expected weekly-hours replay success.');
    expect(replay.body.data.settings.version).toBe(2);

    await expect(
      updateFittingWeeklyHoursCommand(
        { ...context, requestId: randomUUID() },
        { version: 1, weekly_hours: weeklyHours() as never },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const nextHours = weeklyHours([{ starts_local: '10:00', ends_local: '16:00' }]);
    const concurrentContext = ownerContext(seed, randomUUID());
    const concurrent = await Promise.all([
      updateFittingWeeklyHoursCommand(concurrentContext, {
        version: 2,
        weekly_hours: nextHours as never,
      }),
      updateFittingWeeklyHoursCommand(
        { ...concurrentContext, requestId: randomUUID() },
        { version: 2, weekly_hours: nextHours as never },
      ),
    ]);
    expect(concurrent.map((result) => result.status)).toEqual([200, 200]);
    for (const result of concurrent) {
      if (!result.body.success) throw new Error('Expected concurrent weekly-hours replay success.');
      expect(result.body.data.settings.version).toBe(3);
    }

    await withAdmin(async (client) => {
      const audit = await client.query<{ count: string }>(
        `SELECT count(*)::text
           FROM audit_event
          WHERE tenant_id=$1 AND action='fitting.hours_updated'`,
        [seed.tenantId],
      );
      expect(audit.rows[0]?.count).toBe('2');
    });
  });

  it('rejects overlapping weekly windows at the contract boundary', async () => {
    const seed = await seedTenant('hours-overlap');
    const hours = weeklyHours();
    hours[0] = {
      weekday: 'monday',
      windows: [
        { starts_local: '09:00', ends_local: '12:00' },
        { starts_local: '11:30', ends_local: '13:00' },
      ],
    };

    await expect(
      updateFittingWeeklyHoursCommand(ownerContext(seed), {
        version: 1,
        weekly_hours: hours as never,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a weekly-hours replacement that would invalidate an accepted future fitting', async () => {
    const seed = await seedTenant('hours-existing');
    const fitting = await createPreference(seed, '2099-01-09T02:00:00.000Z');

    const narrowed = weeklyHours([{ starts_local: '13:00', ends_local: '17:00' }]);
    const result = await updateFittingWeeklyHoursCommand(ownerContext(seed), {
      version: 1,
      weekly_hours: narrowed as never,
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const settings = await getFittingSettings(readContext(seed));
    expect(settings.version).toBe(1);
    expect(settings.weekly_hours[0]?.windows).toEqual([
      { starts_local: '09:00', ends_local: '17:00' },
    ]);
    expect((await getFittingDetail(readContext(seed), fitting.id)).status).toBe('pending');
  });

  it('updates enabled/capacity/duration/fee/version while preserving existing appointment snapshots for later duration and fee changes', async () => {
    const seed = await seedTenant('settings-snapshot');
    const existing = await createPreference(seed, '2099-01-09T02:00:00.000Z');

    const updated = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 4,
      duration_minutes: 90,
      fee_minor: '900',
    });
    expect(updated.status).toBe(200);
    if (!updated.body.success) throw new Error('Expected settings update success.');
    expect(updated.body.data.settings).toMatchObject({
      enabled: true,
      capacity: 4,
      duration_minutes: 90,
      fee_minor: '900',
      currency: 'PHP',
      version: 2,
    });

    const oldDetail = await getFittingDetail(readContext(seed), existing.id);
    expect(oldDetail.period).toEqual(existing.period);
    expect(oldDetail.fee.fee_minor).toBe('500');

    const next = await createPreference(seed, '2099-01-09T04:00:00.000Z');
    expect(new Date(next.period.end).getTime() - new Date(next.period.start).getTime()).toBe(
      90 * 60_000,
    );
    expect(next.fee.fee_minor).toBe('900');
  });

  it('disabling fittings blocks create and reschedule without blocking lifecycle actions on an existing fitting', async () => {
    const seed = await seedTenant('disabled');
    const existing = await createPreference(seed, '2099-01-09T02:00:00.000Z');

    const disabled = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: false,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '500',
    });
    expect(disabled.status).toBe(200);

    const createAttempt = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T04:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(createAttempt.status).toBe(409);
    expect(createAttempt.body).toMatchObject({ success: false, error: { code: 'STATE_CONFLICT' } });

    const reschedule = await rescheduleFittingCommand(
      { ...ownerContext(seed), fittingId: existing.id },
      { version: existing.version, starts_at: '2099-01-09T05:00:00.000Z' },
    );
    expect(reschedule.status).toBe(409);
    expect(reschedule.body).toMatchObject({ success: false, error: { code: 'STATE_CONFLICT' } });

    const confirmed = await confirmFittingCommand(
      {
        ...ownerContext(seed),
        fittingId: existing.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: existing.version },
    );
    expect(confirmed.status).toBe(200);
    if (!confirmed.body.success) throw new Error('Expected lifecycle action to remain available.');
    expect(confirmed.body.data.fitting.status).toBe('confirmed');
  });

  it('rejects a capacity reduction below accepted simultaneous demand and preserves the old setting and claims', async () => {
    const seed = await seedTenant('capacity-reject', { capacity: 3, feeMinor: 0 });
    const appointments = await Promise.all([
      createPreference(seed, '2099-01-09T02:00:00.000Z'),
      createPreference(seed, '2099-01-09T02:00:00.000Z'),
      createPreference(seed, '2099-01-09T02:00:00.000Z'),
    ]);

    const reduced = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 2,
      duration_minutes: 60,
      fee_minor: '0',
    });
    expect(reduced.status).toBe(409);
    expect(reduced.body).toMatchObject({ success: false, error: { code: 'STATE_CONFLICT' } });

    await withAdmin(async (client) => {
      const state = await client.query<{
        capacity: number;
        version: string;
        blocking: string;
      }>(
        `SELECT fs.capacity, fs.version::text,
                (SELECT count(*)::text
                   FROM fitting_slot_allocation fsa
                  WHERE fsa.tenant_id=fs.tenant_id AND fsa.is_blocking) AS blocking
           FROM fitting_settings fs
          WHERE fs.tenant_id=$1 AND fs.branch_id=$2`,
        [seed.tenantId, seed.branchId],
      );
      expect(state.rows[0]).toEqual({ capacity: 3, version: '1', blocking: '3' });
    });
    expect(appointments).toHaveLength(3);
  });

  it('rebalances hidden capacity claims when a lower capacity is still sufficient after a cancellation', async () => {
    const seed = await seedTenant('capacity-repack', { capacity: 3, feeMinor: 0 });
    const first = await createPreference(seed, '2099-01-09T02:00:00.000Z');
    const second = await createPreference(seed, '2099-01-09T02:00:00.000Z');
    const third = await createPreference(seed, '2099-01-09T02:00:00.000Z');

    const cancelled = await cancelFittingCommand(
      {
        ...ownerContext(seed),
        fittingId: first.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: first.version, reason: 'Reduce simultaneous demand' },
    );
    expect(cancelled.status).toBe(200);

    const reduced = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 2,
      duration_minutes: 60,
      fee_minor: '0',
    });
    expect(reduced.status).toBe(200);
    if (!reduced.body.success) throw new Error('Expected safe capacity reduction.');
    expect(reduced.body.data.settings.capacity).toBe(2);
    expect(reduced.body.data.settings.version).toBe(2);

    await withAdmin(async (client) => {
      const slots = await client.query<{
        slot_number: number;
        active: boolean;
        fitting_id: string | null;
      }>(
        `SELECT fcs.slot_number, fcs.active, current_claim.fitting_id
           FROM fitting_capacity_slot fcs
           LEFT JOIN LATERAL (
             SELECT fsa.fitting_id
               FROM fitting_slot_allocation fsa
              WHERE fsa.tenant_id=fcs.tenant_id
                AND fsa.slot_id=fcs.id
                AND fsa.is_blocking
              LIMIT 1
           ) current_claim ON true
          WHERE fcs.tenant_id=$1 AND fcs.branch_id=$2
          ORDER BY fcs.slot_number`,
        [seed.tenantId, seed.branchId],
      );
      expect(
        slots.rows.map((row) => ({ slot_number: row.slot_number, active: row.active })),
      ).toEqual([
        { slot_number: 1, active: true },
        { slot_number: 2, active: true },
        { slot_number: 3, active: false },
      ]);
      expect(
        slots.rows
          .filter((row) => row.active)
          .map((row) => row.fitting_id)
          .sort(),
      ).toEqual([second.id, third.id].sort());
      expect(slots.rows[2]?.fitting_id).toBeNull();

      const history = await client.query<{ blocking: string; released: string }>(
        `SELECT count(*) FILTER (WHERE is_blocking)::text AS blocking,
                count(*) FILTER (WHERE NOT is_blocking AND released_at IS NOT NULL)::text AS released
           FROM fitting_slot_allocation
          WHERE tenant_id=$1`,
        [seed.tenantId],
      );
      expect(history.rows[0]).toEqual({ blocking: '2', released: '3' });
    });
  });

  it('replays scalar settings sequentially and concurrently with one effect per idempotency intent', async () => {
    const seed = await seedTenant('settings-idempotency');
    const firstKey = randomUUID();
    const firstContext = ownerContext(seed, firstKey);
    const firstRequest = {
      version: 1,
      enabled: true,
      capacity: 4,
      duration_minutes: 60,
      fee_minor: '500',
    } as const;

    const first = await updateFittingSettingsCommand(firstContext, firstRequest);
    const replay = await updateFittingSettingsCommand(
      { ...firstContext, requestId: randomUUID() },
      firstRequest,
    );
    expect([first.status, replay.status]).toEqual([200, 200]);
    if (!first.body.success || !replay.body.success)
      throw new Error('Expected settings replay success.');
    expect(first.body.data.settings.version).toBe(2);
    expect(replay.body.data.settings.version).toBe(2);

    const secondContext = ownerContext(seed, randomUUID());
    const secondRequest = {
      version: 2,
      enabled: true,
      capacity: 5,
      duration_minutes: 90,
      fee_minor: '800',
    } as const;
    const concurrent = await Promise.all([
      updateFittingSettingsCommand(secondContext, secondRequest),
      updateFittingSettingsCommand({ ...secondContext, requestId: randomUUID() }, secondRequest),
    ]);
    expect(concurrent.map((result) => result.status)).toEqual([200, 200]);
    for (const result of concurrent) {
      if (!result.body.success) throw new Error('Expected concurrent settings replay success.');
      expect(result.body.data.settings.version).toBe(3);
    }

    await withAdmin(async (client) => {
      const state = await client.query<{ version: string; capacity: number; audits: string }>(
        `SELECT fs.version::text, fs.capacity,
                (SELECT count(*)::text
                   FROM audit_event ae
                  WHERE ae.tenant_id=fs.tenant_id AND ae.action='fitting.settings_updated') AS audits
           FROM fitting_settings fs
          WHERE fs.tenant_id=$1 AND fs.branch_id=$2`,
        [seed.tenantId, seed.branchId],
      );
      expect(state.rows[0]).toEqual({ version: '3', capacity: 5, audits: '2' });
    });
  });

  it('returns STALE_VERSION without changing branch fitting settings', async () => {
    const seed = await seedTenant('stale');
    const result = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 9,
      enabled: false,
      capacity: 1,
      duration_minutes: 120,
      fee_minor: '0',
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false, error: { code: 'STALE_VERSION' } });

    const settings = await getFittingSettings(readContext(seed));
    expect(settings).toMatchObject({
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '500',
      version: 1,
    });
  });

  it('uses split-window gaps and disabled weekdays as real scheduling constraints', async () => {
    const seed = await seedTenant('weekly-schedule-validation');
    const hours = weeklyHours();
    hours[0] = {
      weekday: 'monday',
      windows: [
        { starts_local: '09:00', ends_local: '12:00' },
        { starts_local: '13:00', ends_local: '17:00' },
      ],
    };
    hours[1] = { weekday: 'tuesday', windows: [] };

    const updated = await updateFittingWeeklyHoursCommand(ownerContext(seed), {
      version: 1,
      weekly_hours: hours as never,
    });
    expect(updated.status).toBe(200);

    const gapAttempt = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-12T04:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(gapAttempt.status).toBe(409);
    expect(gapAttempt.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const disabledDayAttempt = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-13T02:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(disabledDayAttempt.status).toBe(409);
    expect(disabledDayAttempt.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const afternoon = await createPreference(seed, '2099-01-12T05:00:00.000Z');
    expect(afternoon.period).toEqual({
      start: '2099-01-12T05:00:00.000Z',
      end: '2099-01-12T06:00:00.000Z',
    });
  });

  it('creates, reads, updates, and removes tenant/branch-scoped closures idempotently with canonical period shape', async () => {
    const seed = await seedTenant('closure-crud');
    const otherSeed = await seedTenant('closure-other-tenant');
    const createContext = ownerContext(seed, randomUUID());
    const createRequest = {
      settings_version: 1,
      period: { start: '2099-01-15T01:00:00.000Z', end: '2099-01-15T03:00:00.000Z' },
      reason: '  Private event  ',
    } as const;

    await expect(
      createFittingClosureCommand(frontdeskContext(seed), createRequest),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      createFittingClosureCommand(ownerContext(seed), {
        ...createRequest,
        reason: '   ',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const created = await createFittingClosureCommand(createContext, createRequest);
    const createReplay = await createFittingClosureCommand(
      { ...createContext, requestId: randomUUID() },
      createRequest,
    );
    expect([created.status, createReplay.status]).toEqual([201, 201]);
    if (!created.body.success || !createReplay.body.success)
      throw new Error('Expected closure creation and replay success.');
    const closureId = created.body.data.closure.id;
    expect(createReplay.body.data.closure.id).toBe(closureId);
    expect(created.body.data).toMatchObject({
      settings_version: 2,
      closure: {
        period: { start: createRequest.period.start, end: createRequest.period.end },
        timezone_snapshot: 'Asia/Manila',
        reason: 'Private event',
      },
    });

    const listed = await getFittingClosures(readContext(seed), {
      period_start: '2099-01-15T00:00:00.000Z',
      period_end: '2099-01-16T00:00:00.000Z',
      limit: 20,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      id: closureId,
      period: createRequest.period,
      timezone_snapshot: 'Asia/Manila',
      reason: 'Private event',
    });

    const crossTenantUpdate = await updateFittingClosureCommand(
      { ...ownerContext(otherSeed), closureId },
      {
        settings_version: 1,
        period: { start: '2099-01-15T04:00:00.000Z', end: '2099-01-15T05:00:00.000Z' },
        reason: 'Wrong tenant',
      },
    );
    expect(crossTenantUpdate.status).toBe(404);

    const updateContext = { ...ownerContext(seed, randomUUID()), closureId };
    const updateRequest = {
      settings_version: 2,
      period: { start: '2099-01-15T04:00:00.000Z', end: '2099-01-15T05:00:00.000Z' },
      reason: 'Maintenance block',
    } as const;
    const concurrentUpdates = await Promise.all([
      updateFittingClosureCommand(updateContext, updateRequest),
      updateFittingClosureCommand({ ...updateContext, requestId: randomUUID() }, updateRequest),
    ]);
    expect(concurrentUpdates.map((result) => result.status)).toEqual([200, 200]);
    for (const result of concurrentUpdates) {
      if (!result.body.success) throw new Error('Expected closure update replay success.');
      expect(result.body.data.settings_version).toBe(3);
      expect(result.body.data.closure).toMatchObject({
        id: closureId,
        period: updateRequest.period,
        reason: updateRequest.reason,
      });
    }

    const removeContext = { ...ownerContext(seed, randomUUID()), closureId };
    const removeRequest = { settings_version: 3 } as const;
    const removed = await removeFittingClosureCommand(removeContext, removeRequest);
    const removeReplay = await removeFittingClosureCommand(
      { ...removeContext, requestId: randomUUID() },
      removeRequest,
    );
    expect([removed.status, removeReplay.status]).toEqual([200, 200]);
    if (!removed.body.success || !removeReplay.body.success)
      throw new Error('Expected closure remove replay success.');
    expect(removed.body.data).toEqual({ closure_id: closureId, settings_version: 4 });
    expect(removeReplay.body.data).toEqual(removed.body.data);

    const afterRemove = await getFittingClosures(readContext(seed), {
      period_start: '2099-01-15T00:00:00.000Z',
      period_end: '2099-01-16T00:00:00.000Z',
      limit: 20,
    });
    expect(afterRemove.items).toEqual([]);

    await withAdmin(async (client) => {
      const audits = await client.query<{ action: string }>(
        `SELECT action
           FROM audit_event
          WHERE tenant_id=$1 AND entity_id=$2
          ORDER BY occurred_at, id`,
        [seed.tenantId, closureId],
      );
      expect(audits.rows.map((row) => row.action)).toEqual([
        'fitting.closure_created',
        'fitting.closure_updated',
        'fitting.closure_removed',
      ]);
    });
  });

  it('rejects new or edited closures that would invalidate accepted future fittings', async () => {
    const seed = await seedTenant('closure-future-conflict');
    const fitting = await createPreference(seed, '2099-01-09T02:00:00.000Z');

    const conflictingCreate = await createFittingClosureCommand(ownerContext(seed), {
      settings_version: 1,
      period: { start: '2099-01-09T01:30:00.000Z', end: '2099-01-09T03:30:00.000Z' },
      reason: 'Would cover accepted fitting',
    });
    expect(conflictingCreate.status).toBe(409);
    expect(conflictingCreate.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const safeCreate = await createFittingClosureCommand(ownerContext(seed), {
      settings_version: 1,
      period: { start: '2099-01-09T04:00:00.000Z', end: '2099-01-09T05:00:00.000Z' },
      reason: 'Safe block',
    });
    expect(safeCreate.status).toBe(201);
    if (!safeCreate.body.success) throw new Error('Expected safe closure creation.');

    const conflictingUpdate = await updateFittingClosureCommand(
      { ...ownerContext(seed), closureId: safeCreate.body.data.closure.id },
      {
        settings_version: 2,
        period: { start: '2099-01-09T01:30:00.000Z', end: '2099-01-09T03:30:00.000Z' },
        reason: 'Unsafe edit',
      },
    );
    expect(conflictingUpdate.status).toBe(409);
    expect(conflictingUpdate.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const settings = await getFittingSettings(readContext(seed));
    expect(settings.version).toBe(2);
    expect((await getFittingDetail(readContext(seed), fitting.id)).status).toBe('pending');
    const closures = await getFittingClosures(readContext(seed), {
      period_start: '2099-01-09T00:00:00.000Z',
      period_end: '2099-01-10T00:00:00.000Z',
      limit: 20,
    });
    expect(closures.items[0]?.period).toEqual({
      start: '2099-01-09T04:00:00.000Z',
      end: '2099-01-09T05:00:00.000Z',
    });
  });

  it('uses date-specific closures in create and reschedule validation and stops blocking after removal', async () => {
    const seed = await seedTenant('closure-schedule-validation');
    const createdClosure = await createFittingClosureCommand(ownerContext(seed), {
      settings_version: 1,
      period: { start: '2099-01-09T01:00:00.000Z', end: '2099-01-09T03:00:00.000Z' },
      reason: 'Private event',
    });
    if (!createdClosure.body.success) throw new Error('Expected closure creation.');

    const blockedCreate = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(blockedCreate.status).toBe(409);
    expect(blockedCreate.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const existing = await createPreference(seed, '2099-01-09T04:00:00.000Z');
    const blockedReschedule = await rescheduleFittingCommand(
      { ...ownerContext(seed), fittingId: existing.id },
      { version: existing.version, starts_at: '2099-01-09T02:00:00.000Z' },
    );
    expect(blockedReschedule.status).toBe(409);
    expect(blockedReschedule.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const removed = await removeFittingClosureCommand(
      { ...ownerContext(seed), closureId: createdClosure.body.data.closure.id },
      { settings_version: 2 },
    );
    expect(removed.status).toBe(200);

    const rescheduled = await rescheduleFittingCommand(
      { ...ownerContext(seed), fittingId: existing.id },
      { version: existing.version, starts_at: '2099-01-09T02:00:00.000Z' },
    );
    expect(rescheduled.status).toBe(200);
    if (!rescheduled.body.success) throw new Error('Expected reschedule after closure removal.');
    expect(rescheduled.body.data.fitting.period.start).toBe('2099-01-09T02:00:00.000Z');
  });

  it('preserves authoritative branch timezone across a DST boundary and uses half-open closure overlap', async () => {
    const seed = await seedTenant('closure-dst', { timezone: 'America/New_York' });
    const hours = weeklyHours([{ starts_local: '00:00', ends_local: '04:00' }]);
    const hoursUpdated = await updateFittingWeeklyHoursCommand(ownerContext(seed), {
      version: 1,
      weekly_hours: hours as never,
    });
    expect(hoursUpdated.status).toBe(200);

    const closure = await createFittingClosureCommand(ownerContext(seed), {
      settings_version: 2,
      period: { start: '2099-11-01T05:00:00.000Z', end: '2099-11-01T07:00:00.000Z' },
      reason: 'DST fallback maintenance',
    });
    expect(closure.status).toBe(201);
    if (!closure.body.success) throw new Error('Expected DST closure creation.');
    expect(closure.body.data.closure).toMatchObject({
      timezone_snapshot: 'America/New_York',
      period: { start: '2099-11-01T05:00:00.000Z', end: '2099-11-01T07:00:00.000Z' },
    });

    const repeatedHourAttempt = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-11-01T05:30:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(repeatedHourAttempt.status).toBe(409);
    expect(repeatedHourAttempt.body).toMatchObject({
      success: false,
      error: { code: 'SCHEDULE_CONFLICT' },
    });

    const boundaryStart = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-11-01T07:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(boundaryStart.status).toBe(201);
    if (!boundaryStart.body.success) throw new Error('Expected half-open boundary creation.');
    expect(boundaryStart.body.data.fitting.period.start).toBe('2099-11-01T07:00:00.000Z');
  });
});
