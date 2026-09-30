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
  variantAId: string;
  variantBId: string;
  assetAIds: string[];
  assetBIds: string[];
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
    feeMinor?: number;
    assetACount?: number;
    assetBCount?: number;
  } = {},
): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, suffix, `fit4-${suffix}`],
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
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Phase 4 Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );

    async function createVariant(code: string, name: string): Promise<string> {
      const productId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO product (tenant_id,code,name,status)
             VALUES ($1,$2,$3,'active') RETURNING id`,
            [tenantId, `${code}-${suffix}`, name],
          )
        ).rows,
        'product',
      );
      return requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO product_variant
               (tenant_id,product_id,sku,size_label,color_label,measurements,measurement_unit,
                measurement_mode,rental_price_minor,security_deposit_minor,currency,pricing_mode,
                included_duration_minutes,extra_day_price_minor,prep_minutes,turnaround_minutes,status)
             VALUES ($1,$2,$3,'M','Ivory','{}','cm','none',1000,0,'PHP','fixed_duration',1440,0,0,0,'active')
             RETURNING id`,
            [tenantId, productId, `SKU-${code}-${suffix}`],
          )
        ).rows,
        'variant',
      );
    }

    const variantAId = await createVariant('A', 'Gown A');
    const variantBId = await createVariant('B', 'Gown B');

    async function createAssets(
      variantId: string,
      prefix: string,
      count: number,
    ): Promise<string[]> {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const result = await client.query<{ id: string }>(
          `INSERT INTO physical_asset (tenant_id,branch_id,variant_id,asset_code)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [tenantId, branchId, variantId, `${prefix}-${index + 1}-${suffix}`],
        );
        ids.push(requireId(result.rows, 'asset'));
      }
      return ids;
    }

    const assetAIds = await createAssets(variantAId, 'A', options.assetACount ?? 2);
    const assetBIds = await createAssets(variantBId, 'B', options.assetBCount ?? 1);

    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,$3,60,$4,'PHP',1)`,
      [tenantId, branchId, options.capacity ?? 2, options.feeMinor ?? 500],
    );
    await client.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"09:00","closes_local":"17:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, branchId],
    );

    return { tenantId, branchId, customerId, variantAId, variantBId, assetAIds, assetBIds };
  });
}

async function addMaintenanceBlock(
  seed: Seed,
  assetId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  await withAdmin(async (client) => {
    const maintenanceId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO maintenance_work_order
             (tenant_id,branch_id,asset_id,kind,status,reason)
           VALUES ($1,$2,$3,'repair','open','Phase 4 test') RETURNING id`,
          [seed.tenantId, seed.branchId, assetId],
        )
      ).rows,
      'maintenance',
    );
    await client.query(
      `INSERT INTO asset_allocation
         (tenant_id,branch_id,asset_id,maintenance_id,kind,period,is_blocking)
       VALUES ($1,$2,$3,$4,'maintenance',tstzrange($5::timestamptz,$6::timestamptz,'[)'),true)`,
      [seed.tenantId, seed.branchId, assetId, maintenanceId, startsAt, endsAt],
    );
  });
}

describe('FIT-BE-043..045 fitting atomic allocation and update semantics', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const { rescheduleFittingCommand, updateFittingGarmentPlanCommand } =
    await import('../../src/modules/fittings/fittings.mutation.service.js');

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

  function createContext(seed: Seed, key = randomUUID()) {
    const membershipId = randomUUID();
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId,
      principalId: `user_${membershipId}`,
      requestId: randomUUID(),
      idempotencyKey: key,
    };
  }

  it('creates a guaranteed line with one exact-period physical allocation and immutable fitting fee charge', async () => {
    const seed = await seedTenant('guaranteed');
    const response = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantAId as never, garment_mode: 'guaranteed' }],
    });
    expect(response.status).toBe(201);
    if (!response.body.success) throw new Error('Expected create success.');
    const garment = response.body.data.fitting.garments[0];
    const fittingId = response.body.data.fitting.id;
    expect(garment?.garment_mode).toBe('guaranteed');
    expect(garment?.assigned_asset).not.toBeNull();

    await withAdmin(async (client) => {
      const result = await client.query<{
        kind: string;
        starts_at: Date;
        ends_at: Date;
        amount_minor: string;
        charge_kind: string;
      }>(
        `SELECT aa.kind,
                lower(aa.period) AS starts_at,
                upper(aa.period) AS ends_at,
                ch.amount_minor::text,
                ch.kind AS charge_kind
           FROM fitting_appointment fa
           JOIN fitting_line fl ON fl.tenant_id=fa.tenant_id AND fl.fitting_id=fa.id AND fl.removed_at IS NULL
           JOIN asset_allocation aa ON aa.tenant_id=fl.tenant_id AND aa.fitting_line_id=fl.id AND aa.is_blocking
           JOIN charge ch ON ch.tenant_id=fa.tenant_id AND ch.fitting_id=fa.id AND ch.kind='fitting_fee'
          WHERE fa.tenant_id=$1 AND fa.id=$2::uuid`,
        [seed.tenantId, fittingId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        kind: 'fitting',
        amount_minor: '500',
        charge_kind: 'fitting_fee',
      });
      expect(result.rows[0]?.starts_at.toISOString()).toBe('2099-01-09T02:00:00.000Z');
      expect(result.rows[0]?.ends_at.toISOString()).toBe('2099-01-09T03:00:00.000Z');
    });
  });

  it('treats an existing maintenance allocation as a hard blocker for a guaranteed fitting claim', async () => {
    const seed = await seedTenant('maintenance-block', { assetACount: 1, feeMinor: 0 });
    await addMaintenanceBlock(
      seed,
      seed.assetAIds[0] as string,
      '2099-01-09T02:00:00.000Z',
      '2099-01-09T03:00:00.000Z',
    );
    const response = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantAId as never, garment_mode: 'guaranteed' }],
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'ASSET_UNAVAILABLE' },
    });
  });

  it('reschedules atomically, keeps the fitting id, preserves released claim history, and replaces a blocked guaranteed asset', async () => {
    const seed = await seedTenant('reschedule', { assetACount: 2 });
    const created = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantAId as never, garment_mode: 'guaranteed' }],
    });
    if (!created.body.success) throw new Error('Expected create success.');
    const fitting = created.body.data.fitting;
    const oldAssetId = fitting.garments[0]?.assigned_asset?.id;
    if (!oldAssetId) throw new Error('Expected guaranteed asset.');
    await addMaintenanceBlock(
      seed,
      oldAssetId,
      '2099-01-09T04:00:00.000Z',
      '2099-01-09T05:00:00.000Z',
    );

    const context = { ...createContext(seed), fittingId: fitting.id };
    const updated = await rescheduleFittingCommand(context, {
      version: fitting.version,
      starts_at: '2099-01-09T04:00:00.000Z',
    });
    expect(updated.status).toBe(200);
    if (!updated.body.success) throw new Error('Expected reschedule success.');
    expect(updated.body.data.fitting.id).toBe(fitting.id);
    expect(updated.body.data.fitting.period.start).toBe('2099-01-09T04:00:00.000Z');
    expect(updated.body.data.fitting.version).toBe(fitting.version + 1);
    expect(updated.body.data.fitting.garments[0]?.assigned_asset?.id).not.toBe(oldAssetId);
    const updatedVersion = updated.body.data.fitting.version;

    await expect(
      rescheduleFittingCommand(
        { ...context, requestId: randomUUID() },
        { version: updatedVersion, starts_at: '2099-01-09T05:00:00.000Z' },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    for (const assetId of seed.assetAIds) {
      await addMaintenanceBlock(
        seed,
        assetId,
        '2099-01-09T06:00:00.000Z',
        '2099-01-09T07:00:00.000Z',
      );
    }
    const failed = await rescheduleFittingCommand(
      { ...createContext(seed), fittingId: fitting.id },
      { version: updatedVersion, starts_at: '2099-01-09T06:00:00.000Z' },
    );
    expect(failed.status).toBe(409);

    await withAdmin(async (client) => {
      const assetHistory = await client.query<{ blocking: string; released: string }>(
        `SELECT count(*) FILTER (WHERE aa.is_blocking)::text AS blocking,
                count(*) FILTER (WHERE NOT aa.is_blocking AND aa.released_at IS NOT NULL)::text AS released
           FROM fitting_line fl
           JOIN asset_allocation aa ON aa.tenant_id=fl.tenant_id AND aa.fitting_line_id=fl.id
          WHERE fl.tenant_id=$1 AND fl.fitting_id=$2::uuid AND fl.removed_at IS NULL`,
        [seed.tenantId, fitting.id],
      );
      expect(assetHistory.rows[0]).toEqual({ blocking: '1', released: '1' });
      const capacityHistory = await client.query<{ blocking: string; released: string }>(
        `SELECT count(*) FILTER (WHERE is_blocking)::text AS blocking,
                count(*) FILTER (WHERE NOT is_blocking AND released_at IS NOT NULL)::text AS released
           FROM fitting_slot_allocation
          WHERE tenant_id=$1 AND fitting_id=$2::uuid`,
        [seed.tenantId, fitting.id],
      );
      expect(capacityHistory.rows[0]).toEqual({ blocking: '1', released: '1' });
      const unchanged = await client.query<{ starts_at: Date; ends_at: Date; version: string }>(
        `SELECT lower(period) AS starts_at, upper(period) AS ends_at, version::text
           FROM fitting_appointment
          WHERE tenant_id=$1 AND id=$2::uuid`,
        [seed.tenantId, fitting.id],
      );
      expect(unchanged.rows[0]?.starts_at.toISOString()).toBe('2099-01-09T04:00:00.000Z');
      expect(unchanged.rows[0]?.ends_at.toISOString()).toBe('2099-01-09T05:00:00.000Z');
      expect(unchanged.rows[0]?.version).toBe(String(updatedVersion));
    });
  });

  it('replaces a future garment plan by securing the new guarantee before retiring the old guaranteed line', async () => {
    const seed = await seedTenant('plan');
    const created = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [
        { variant_id: seed.variantAId as never, garment_mode: 'guaranteed' },
        { variant_id: seed.variantAId as never, garment_mode: 'preference' },
      ],
    });
    if (!created.body.success) throw new Error('Expected create success.');
    const fitting = created.body.data.fitting;

    const updated = await updateFittingGarmentPlanCommand(
      { ...createContext(seed), fittingId: fitting.id },
      {
        version: fitting.version,
        garments: [
          { variant_id: seed.variantBId as never, garment_mode: 'guaranteed' },
          { variant_id: seed.variantAId as never, garment_mode: 'preference' },
        ],
      },
    );
    expect(updated.status).toBe(200);
    if (!updated.body.success) throw new Error('Expected garment update success.');
    expect(updated.body.data.fitting.version).toBe(fitting.version + 1);
    expect(updated.body.data.fitting.garments).toHaveLength(2);
    expect(
      updated.body.data.fitting.garments.some(
        (line) => line.variant.variant_id === seed.variantBId && line.garment_mode === 'guaranteed',
      ),
    ).toBe(true);

    await withAdmin(async (client) => {
      const history = await client.query<{
        active_lines: string;
        retired_lines: string;
        blocking_assets: string;
        released_assets: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE fl.removed_at IS NULL)::text AS active_lines,
           count(*) FILTER (WHERE fl.removed_at IS NOT NULL)::text AS retired_lines,
           count(aa.id) FILTER (WHERE aa.is_blocking)::text AS blocking_assets,
           count(aa.id) FILTER (WHERE NOT aa.is_blocking AND aa.released_at IS NOT NULL)::text AS released_assets
         FROM fitting_line fl
         LEFT JOIN asset_allocation aa ON aa.tenant_id=fl.tenant_id AND aa.fitting_line_id=fl.id
        WHERE fl.tenant_id=$1 AND fl.fitting_id=$2::uuid`,
        [seed.tenantId, fitting.id],
      );
      expect(history.rows[0]).toEqual({
        active_lines: '2',
        retired_lines: '1',
        blocking_assets: '1',
        released_assets: '1',
      });
    });
  });

  it('preserves the original garment plan when a replacement guarantee cannot be acquired', async () => {
    const seed = await seedTenant('plan-fail', { assetBCount: 1 });
    await addMaintenanceBlock(
      seed,
      seed.assetBIds[0] as string,
      '2099-01-09T02:00:00.000Z',
      '2099-01-09T03:00:00.000Z',
    );
    const created = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantAId as never, garment_mode: 'guaranteed' }],
    });
    if (!created.body.success) throw new Error('Expected create success.');
    const fitting = created.body.data.fitting;

    const failed = await updateFittingGarmentPlanCommand(
      { ...createContext(seed), fittingId: fitting.id },
      {
        version: fitting.version,
        garments: [{ variant_id: seed.variantBId as never, garment_mode: 'guaranteed' }],
      },
    );
    expect(failed.status).toBe(409);
    expect(failed.body.success).toBe(false);

    await withAdmin(async (client) => {
      const current = await client.query<{
        variant_id: string;
        version: string;
        active_count: string;
      }>(
        `SELECT fl.variant_id, fa.version::text,
                count(*) OVER ()::text AS active_count
           FROM fitting_appointment fa
           JOIN fitting_line fl ON fl.tenant_id=fa.tenant_id AND fl.fitting_id=fa.id AND fl.removed_at IS NULL
          WHERE fa.tenant_id=$1 AND fa.id=$2::uuid`,
        [seed.tenantId, fitting.id],
      );
      expect(current.rows).toHaveLength(1);
      expect(current.rows[0]).toMatchObject({
        variant_id: seed.variantAId,
        version: String(fitting.version),
        active_count: '1',
      });
    });
  });

  it('replays an identical create once and rejects a changed payload under the same idempotency key', async () => {
    const seed = await seedTenant('idempotent');
    const key = randomUUID();
    const context = createContext(seed, key);
    const request = {
      customer: { source: 'existing' as const, customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantAId as never, garment_mode: 'guaranteed' as const }],
    };
    const first = await createStaffFittingCommand(context, request);
    const replay = await createStaffFittingCommand(
      { ...context, requestId: randomUUID() },
      request,
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    if (!first.body.success || !replay.body.success)
      throw new Error('Expected create replay success.');
    expect(replay.body.data.fitting.id).toBe(first.body.data.fitting.id);

    await expect(
      createStaffFittingCommand(
        { ...context, requestId: randomUUID() },
        { ...request, starts_at: '2099-01-09T03:00:00.000Z' },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    await withAdmin(async (client) => {
      const counts = await client.query<{
        fittings: string;
        slots: string;
        assets: string;
        charges: string;
        audits: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM fitting_appointment WHERE tenant_id=$1) AS fittings,
           (SELECT count(*)::text FROM fitting_slot_allocation WHERE tenant_id=$1 AND is_blocking) AS slots,
           (SELECT count(*)::text FROM asset_allocation WHERE tenant_id=$1 AND fitting_line_id IS NOT NULL AND is_blocking) AS assets,
           (SELECT count(*)::text FROM charge WHERE tenant_id=$1 AND fitting_id IS NOT NULL AND kind='fitting_fee') AS charges,
           (SELECT count(*)::text FROM audit_event WHERE tenant_id=$1 AND action='fitting.created') AS audits`,
        [seed.tenantId],
      );
      expect(counts.rows[0]).toEqual({
        fittings: '1',
        slots: '1',
        assets: '1',
        charges: '1',
        audits: '1',
      });
    });
  });

  it('serializes last-capacity and same-asset contention while allowing adjacent periods', async () => {
    const capacitySeed = await seedTenant('capacity-race', {
      capacity: 1,
      assetACount: 0,
      feeMinor: 0,
    });
    const request = {
      customer: { source: 'existing' as const, customer_id: capacitySeed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [
        { variant_id: capacitySeed.variantAId as never, garment_mode: 'preference' as const },
      ],
    };
    const capacityResults = await Promise.all([
      createStaffFittingCommand(createContext(capacitySeed), request),
      createStaffFittingCommand(createContext(capacitySeed), request),
    ]);
    expect(capacityResults.map((result) => result.status).sort()).toEqual([201, 409]);

    await resetTestDatabase(adminUrl);
    const assetSeed = await seedTenant('asset-race', { capacity: 2, assetACount: 1, feeMinor: 0 });
    const guaranteedRequest = {
      customer: { source: 'existing' as const, customer_id: assetSeed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [
        { variant_id: assetSeed.variantAId as never, garment_mode: 'guaranteed' as const },
      ],
    };
    const assetResults = await Promise.all([
      createStaffFittingCommand(createContext(assetSeed), guaranteedRequest),
      createStaffFittingCommand(createContext(assetSeed), guaranteedRequest),
    ]);
    expect(assetResults.map((result) => result.status).sort()).toEqual([201, 409]);

    await resetTestDatabase(adminUrl);
    const adjacentSeed = await seedTenant('adjacent', { capacity: 1, assetACount: 1, feeMinor: 0 });
    const first = await createStaffFittingCommand(createContext(adjacentSeed), {
      customer: { source: 'existing', customer_id: adjacentSeed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: adjacentSeed.variantAId as never, garment_mode: 'guaranteed' }],
    });
    const second = await createStaffFittingCommand(createContext(adjacentSeed), {
      customer: { source: 'existing', customer_id: adjacentSeed.customerId as never },
      starts_at: '2099-01-09T03:00:00.000Z',
      garments: [{ variant_id: adjacentSeed.variantAId as never, garment_mode: 'guaranteed' }],
    });
    expect([first.status, second.status]).toEqual([201, 201]);
  });

  it('allows a preference-only fitting to coexist with an overlapping physical-asset blocker', async () => {
    const seed = await seedTenant('preference-blocker', {
      capacity: 1,
      assetACount: 1,
      feeMinor: 0,
    });
    await addMaintenanceBlock(
      seed,
      seed.assetAIds[0] as string,
      '2099-01-09T02:00:00.000Z',
      '2099-01-09T03:00:00.000Z',
    );
    const response = await createStaffFittingCommand(createContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantAId as never, garment_mode: 'preference' }],
    });
    expect(response.status).toBe(201);
    if (!response.body.success) throw new Error('Expected preference create success.');
    expect(response.body.data.fitting.garments[0]).toMatchObject({
      garment_mode: 'preference',
      assigned_asset: null,
    });
  });
});
