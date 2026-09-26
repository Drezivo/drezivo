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
process.env.DATABASE_POOL_MAX = '16';
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

type CreateFittingCommand =
  typeof import('../../src/modules/fittings/fittings.command.service.js').createStaffFittingCommand;

interface Seed {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  customerId: string;
  variantId: string;
  assetIds: string[];
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

async function seedTenant(label: string, capacity: number, assetCount = 0): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, suffix, `fit9-race-${suffix}`],
        )
      ).rows,
      'tenant',
    );
    const branchId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone)
           VALUES ($1,'Main','MAIN',true,'Asia/Manila') RETURNING id`,
          [tenantId],
        )
      ).rows,
      'branch',
    );
    const principalId = `user_${suffix}`;
    const membershipId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO membership (tenant_id,clerk_user_id,role,status)
           VALUES ($1,$2,'owner','active') RETURNING id`,
          [tenantId, principalId],
        )
      ).rows,
      'membership',
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Race Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Race Gown','active') RETURNING id`,
          [tenantId, `P-${suffix}`],
        )
      ).rows,
      'product',
    );
    const variantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product_variant
             (tenant_id,product_id,sku,size_label,measurements,measurement_unit,measurement_mode,
              rental_price_minor,security_deposit_minor,currency,pricing_mode,included_duration_minutes,
              extra_day_price_minor,prep_minutes,turnaround_minutes,status)
           VALUES ($1,$2,$3,'M','{}','cm','none',1000,0,'PHP','fixed_duration',1440,0,0,0,'active')
           RETURNING id`,
          [tenantId, productId, `SKU-${suffix}`],
        )
      ).rows,
      'variant',
    );
    const assetIds: string[] = [];
    for (let index = 0; index < assetCount; index += 1) {
      assetIds.push(
        requireId(
          (
            await client.query<{ id: string }>(
              `INSERT INTO physical_asset (tenant_id,branch_id,variant_id,asset_code)
               VALUES ($1,$2,$3,$4) RETURNING id`,
              [tenantId, branchId, variantId, `RACE-${index + 1}-${suffix}`],
            )
          ).rows,
          'asset',
        ),
      );
    }
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,$3,60,0,'PHP',1)`,
      [tenantId, branchId, capacity],
    );
    await client.query(
      `INSERT INTO fitting_hours (tenant_id,branch_id,weekday,starts_local,ends_local)
       SELECT $1,$2,weekday,'09:00'::time,'17:00'::time FROM generate_series(1,7) weekday`,
      [tenantId, branchId],
    );
    return { tenantId, branchId, membershipId, principalId, customerId, variantId, assetIds };
  });
}

function createContext(seed: Seed, idempotencyKey = randomUUID()) {
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId: seed.membershipId,
    principalId: seed.principalId,
    requestId: randomUUID(),
    idempotencyKey,
  };
}

function configContext(seed: Seed, idempotencyKey = randomUUID()) {
  return {
    ...createContext(seed, idempotencyKey),
    role: 'owner' as const,
    effectiveTenantStatus: 'active' as const,
  };
}

function requestFor(seed: Seed, startsAt: string, guaranteed = false) {
  return {
    customer: { source: 'existing' as const, customer_id: seed.customerId as never },
    starts_at: startsAt,
    garments: [
      {
        variant_id: seed.variantId as never,
        garment_mode: guaranteed ? ('guaranteed' as const) : ('preference' as const),
      },
    ],
  };
}

async function createOne(
  createStaffFittingCommand: CreateFittingCommand,
  seed: Seed,
  startsAt: string,
  guaranteed = false,
) {
  return createStaffFittingCommand(createContext(seed), requestFor(seed, startsAt, guaranteed));
}

describe('FIT-BE-092 fitting concurrency falsification', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const { rescheduleFittingCommand } =
    await import('../../src/modules/fittings/fittings.mutation.service.js');
  const {
    createFittingClosureCommand,
    updateFittingSettingsCommand,
    updateFittingWeeklyHoursCommand,
  } = await import('../../src/modules/fittings/fittings.schedule.command.service.js');
  const { getFittingDetail } = await import('../../src/modules/fittings/fittings.service.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('permits at most N winners from N+1 truly overlapping creates', async () => {
    const seed = await seedTenant('capacity', 2);
    const results = await Promise.all([
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z'),
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z'),
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z'),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(2);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
    await withAdmin(async (client) => {
      const count = await client.query<{ fittings: string; claims: string }>(
        `SELECT
           (SELECT count(*)::text FROM fitting_appointment WHERE tenant_id=$1 AND status='pending') AS fittings,
           (SELECT count(*)::text FROM fitting_slot_allocation WHERE tenant_id=$1 AND is_blocking) AS claims`,
        [seed.tenantId],
      );
      expect(count.rows[0]).toEqual({ fittings: '2', claims: '2' });
    });
  });

  it('allows one winner when two guaranteed fittings contend for the same physical garment', async () => {
    const seed = await seedTenant('garment', 2, 1);
    const results = await Promise.all([
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z', true),
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z', true),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    const loser = results.find((result) => result.status === 409);
    expect(loser?.body).toMatchObject({ success: false, error: { code: 'ASSET_UNAVAILABLE' } });
  });

  it('serializes capacity reduction against an overlapping booking so both cannot win', async () => {
    const seed = await seedTenant('capacity-config', 2);
    const first = await createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z');
    expect(first.status).toBe(201);

    const [booking, setting] = await Promise.all([
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z'),
      updateFittingSettingsCommand(configContext(seed), {
        version: 1,
        enabled: true,
        capacity: 1,
        duration_minutes: 60,
        fee_minor: '0',
      }),
    ]);
    expect([booking.status, setting.status].filter((status) => status < 300)).toHaveLength(1);
  });

  it('serializes weekly-hours replacement against create so an invalid booking cannot commit', async () => {
    const seed = await seedTenant('hours-config', 1);
    const closedMorning = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ].map((weekday) => ({ weekday, windows: [{ starts_local: '12:00', ends_local: '17:00' }] }));

    const [booking, hours] = await Promise.all([
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z'),
      updateFittingWeeklyHoursCommand(configContext(seed), {
        version: 1,
        weekly_hours: closedMorning as never,
      }),
    ]);
    expect([booking.status, hours.status].filter((status) => status < 300)).toHaveLength(1);
  });

  it('serializes a closure against create so an overlapping fitting cannot survive the winning closure', async () => {
    const seed = await seedTenant('closure-config', 1);
    const [booking, closure] = await Promise.all([
      createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z'),
      createFittingClosureCommand(configContext(seed), {
        settings_version: 1,
        period: { start: '2099-01-05T02:00:00.000Z', end: '2099-01-05T03:00:00.000Z' },
        reason: 'Private event',
      }),
    ]);
    expect([booking.status, closure.status].filter((status) => status < 300)).toHaveLength(1);
  });

  it('accepts adjacent intervals, rejects true overlap, and preserves the old state on failed reschedule', async () => {
    const seed = await seedTenant('adjacent', 1);
    const first = await createOne(createStaffFittingCommand, seed, '2099-01-05T02:00:00.000Z');
    const second = await createOne(createStaffFittingCommand, seed, '2099-01-05T03:00:00.000Z');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const overlap = await createOne(createStaffFittingCommand, seed, '2099-01-05T02:30:00.000Z');
    expect(overlap.status).toBe(409);
    expect(overlap.body).toMatchObject({ success: false, error: { code: 'CAPACITY_CONFLICT' } });

    if (!first.body.success) throw new Error('Expected first fitting create success.');
    const fitting = first.body.data.fitting;
    const failedMove = await rescheduleFittingCommand(
      { ...createContext(seed), fittingId: fitting.id },
      { version: fitting.version, starts_at: '2099-01-05T03:00:00.000Z' },
    );
    expect(failedMove.status).toBe(409);

    const readback = await getFittingDetail(
      {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        membershipId: seed.membershipId,
        principalId: seed.principalId,
        permissionCodes: ['reservations.manage'],
        effectiveTenantStatus: 'active',
      },
      fitting.id,
    );
    expect(readback.period.start).toBe('2099-01-05T02:00:00.000Z');
    expect(readback.version).toBe(fitting.version);
  });

  it('coalesces concurrent identical idempotent create retries into one business effect', async () => {
    const seed = await seedTenant('idem', 1);
    const key = randomUUID();
    const context = createContext(seed, key);
    const request = requestFor(seed, '2099-01-05T02:00:00.000Z');
    const results = await Promise.all([
      createStaffFittingCommand(context, request),
      createStaffFittingCommand({ ...context, requestId: randomUUID() }, request),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);

    await withAdmin(async (client) => {
      const state = await client.query<{ fittings: string; audits: string }>(
        `SELECT
           (SELECT count(*)::text FROM fitting_appointment WHERE tenant_id=$1) AS fittings,
           (SELECT count(*)::text FROM audit_event WHERE tenant_id=$1 AND action='fitting.created') AS audits`,
        [seed.tenantId],
      );
      expect(state.rows[0]).toEqual({ fittings: '1', audits: '1' });
    });
  });
});
