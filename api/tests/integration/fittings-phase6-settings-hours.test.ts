import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

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
  options: { capacity?: number; durationMinutes?: number; feeMinor?: number } = {},
): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, suffix, `fit-settings-${suffix}`],
        )
      ).rows,
      'tenant',
    );
    const branchId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone,operating_hours)
           VALUES (
             $1,'Main','MAIN',true,'Asia/Manila',
             '{"opens_local":"09:00","closes_local":"17:00","closed_weekdays":[]}'::jsonb
           ) RETURNING id`,
          [tenantId],
        )
      ).rows,
      'branch',
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Settings Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Settings Gown','active') RETURNING id`,
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
        options.capacity ?? 2,
        options.durationMinutes ?? 60,
        options.feeMinor ?? 500,
      ],
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
    permissionCodes: ['reservations.manage'] as PermissionCode[],
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
    permissionCodes: ['reservations.manage'] as PermissionCode[],
    effectiveTenantStatus: 'active' as const,
  };
}

function readContext(seed: Seed, allowed = true) {
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId: randomUUID(),
    principalId: `user_${randomUUID()}`,
    permissionCodes: (allowed ? ['reservations.manage'] : []) as PermissionCode[],
    effectiveTenantStatus: 'active' as const,
  };
}

describe('fitting scalar settings configuration', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const { cancelFittingCommand } =
    await import('../../src/modules/fittings/fittings.mutation.service.js');
  const { updateFittingSettingsCommand } =
    await import('../../src/modules/fittings/fittings.settings.command.service.js');
  const { getFittingSettings } = await import('../../src/modules/fittings/fittings.service.js');

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

  async function createPreference(seed: Seed, startsAt: string) {
    const response = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: startsAt,
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    if (!response.body.success) throw new Error('Expected fitting creation success.');
    return response.body.data.fitting;
  }

  it('allows operational reads while keeping fitting configuration mutation owner-only', async () => {
    const seed = await seedTenant('permissions');
    expect((await getFittingSettings(readContext(seed))).branch_id).toBe(seed.branchId);
    await expect(getFittingSettings(readContext(seed, false))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      updateFittingSettingsCommand(frontdeskContext(seed), {
        version: 1,
        enabled: true,
        capacity: 2,
        duration_minutes: 60,
        fee_minor: '500',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updates only fitting-specific enabled, capacity, duration and fee settings', async () => {
    const seed = await seedTenant('scalar');
    const result = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: false,
      capacity: 3,
      duration_minutes: 90,
      fee_minor: '1200',
    });
    expect(result.status).toBe(200);
    expect(result.body.success && result.body.data.settings).toMatchObject({
      enabled: false,
      capacity: 3,
      duration_minutes: 90,
      fee_minor: '1200',
      version: 2,
    });
    expect(JSON.stringify(result.body)).not.toContain('weekly_hours');
    expect(JSON.stringify(result.body)).not.toContain('closure');
  });

  it('disabling fittings blocks new fitting creation', async () => {
    const seed = await seedTenant('disabled');
    const disabled = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: false,
      capacity: 2,
      duration_minutes: 60,
      fee_minor: '500',
    });
    expect(disabled.status).toBe(200);

    const create = await createStaffFittingCommand(ownerContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2026-10-05T02:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    });
    expect(create.status).toBe(409);
    expect(create.body.success ? null : create.body.error.code).toBe('STATE_CONFLICT');
  });

  it('rejects a capacity reduction below accepted simultaneous fitting demand', async () => {
    const seed = await seedTenant('capacity', { capacity: 2 });
    await createPreference(seed, '2099-01-05T02:00:00.000Z');
    await createPreference(seed, '2099-01-05T02:00:00.000Z');

    const result = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 1,
      duration_minutes: 60,
      fee_minor: '500',
    });
    expect(result.status).toBe(409);
    expect(result.body.success ? null : result.body.error.code).toBe('STATE_CONFLICT');
    expect((await getFittingSettings(readContext(seed))).capacity).toBe(2);
    await withAdmin(async (client) => {
      const claims = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM fitting_slot_allocation
          WHERE tenant_id = $1
            AND is_blocking`,
        [seed.tenantId],
      );
      expect(claims.rows[0]?.count).toBe('2');
    });
  });

  it('can reduce capacity after accepted demand is released', async () => {
    const seed = await seedTenant('capacity-release', { capacity: 2 });
    const first = await createPreference(seed, '2099-01-05T02:00:00.000Z');
    await createPreference(seed, '2099-01-05T02:00:00.000Z');
    const cancelled = await cancelFittingCommand(
      { ...ownerContext(seed), fittingId: first.id },
      { version: first.version, reason: 'Customer cancelled.' },
    );
    expect(cancelled.status).toBe(200);

    const result = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 1,
      duration_minutes: 60,
      fee_minor: '500',
    });
    expect(result.status).toBe(200);
    expect(result.body.success && result.body.data.settings.capacity).toBe(1);
  });

  it('rebalances many fittings by first-fit slot order while allowing adjacent periods', async () => {
    const seed = await seedTenant('capacity-rebalance', { capacity: 3 });
    const startsAt = [
      '2099-01-05T01:00:00.000Z',
      '2099-01-05T01:30:00.000Z',
      '2099-01-05T02:00:00.000Z',
      '2099-01-05T02:30:00.000Z',
    ];
    const fittings: Array<{ id: string }> = [];
    for (const start of startsAt) fittings.push(await createPreference(seed, start));

    const result = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 2,
      duration_minutes: 60,
      fee_minor: '500',
    });

    expect(result.status).toBe(200);
    await withAdmin(async (client) => {
      const claims = await client.query<{ fitting_id: string; slot_number: number }>(
        `SELECT fsa.fitting_id,
                fcs.slot_number
           FROM fitting_slot_allocation fsa
           JOIN fitting_capacity_slot fcs
             ON fcs.tenant_id = fsa.tenant_id
            AND fcs.id = fsa.slot_id
          WHERE fsa.tenant_id = $1
            AND fsa.is_blocking
          ORDER BY lower(fsa.period), upper(fsa.period), fsa.fitting_id`,
        [seed.tenantId],
      );
      expect(claims.rows).toEqual(
        fittings.map((fitting, index) => ({
          fitting_id: fitting.id,
          slot_number: index % 2 === 0 ? 1 : 2,
        })),
      );
    });
  });

  it('replays one scalar settings intent without applying the mutation twice', async () => {
    const seed = await seedTenant('idempotent');
    const key = randomUUID();
    const context = ownerContext(seed, key);
    const request = {
      version: 1,
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '700',
    } as const;

    const first = await updateFittingSettingsCommand(context, request);
    const replay = await updateFittingSettingsCommand(
      { ...context, requestId: randomUUID() },
      request,
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await getFittingSettings(readContext(seed))).version).toBe(2);
  });

  it('returns STALE_VERSION without changing fitting settings', async () => {
    const seed = await seedTenant('stale');
    const first = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '700',
    });
    expect(first.status).toBe(200);

    const stale = await updateFittingSettingsCommand(ownerContext(seed), {
      version: 1,
      enabled: false,
      capacity: 1,
      duration_minutes: 90,
      fee_minor: '999',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.success ? null : stale.body.error.code).toBe('STALE_VERSION');

    expect(await getFittingSettings(readContext(seed))).toMatchObject({
      enabled: true,
      capacity: 3,
      duration_minutes: 60,
      fee_minor: '700',
      version: 2,
    });
  });
});
