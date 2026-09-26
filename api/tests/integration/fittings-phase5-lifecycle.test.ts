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

async function seedTenant(label: string, feeMinor = 500): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, suffix, `fit5-${suffix}`],
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
           VALUES ($1,'Phase 5 Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Lifecycle Gown','active') RETURNING id`,
          [tenantId, `LIFE-${suffix}`],
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
      `INSERT INTO physical_asset (tenant_id,branch_id,variant_id,asset_code)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, branchId, variantId, `ASSET-${suffix}`],
    );
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,1,60,$3,'PHP',1)`,
      [tenantId, branchId, feeMinor],
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

async function shiftFittingPeriod(
  seed: Seed,
  fittingId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  await withAdmin(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE fitting_slot_allocation
            SET period = tstzrange($3::timestamptz,$4::timestamptz,'[)')
          WHERE tenant_id=$1 AND fitting_id=$2::uuid AND is_blocking`,
        [seed.tenantId, fittingId, startsAt, endsAt],
      );
      await client.query(
        `UPDATE asset_allocation aa
            SET period = tstzrange($3::timestamptz,$4::timestamptz,'[)')
           FROM fitting_line fl
          WHERE fl.tenant_id=$1 AND fl.fitting_id=$2::uuid
            AND aa.tenant_id=fl.tenant_id AND aa.fitting_line_id=fl.id AND aa.is_blocking`,
        [seed.tenantId, fittingId, startsAt, endsAt],
      );
      await client.query(
        `UPDATE fitting_appointment
            SET period = tstzrange($3::timestamptz,$4::timestamptz,'[)')
          WHERE tenant_id=$1 AND id=$2::uuid`,
        [seed.tenantId, fittingId, startsAt, endsAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function readClaimState(
  seed: Seed,
  fittingId: string,
): Promise<{
  blockingSlots: number;
  releasedSlots: number;
  blockingAssets: number;
  releasedAssets: number;
}> {
  return withAdmin(async (client) => {
    const result = await client.query<{
      blocking_slots: string;
      released_slots: string;
      blocking_assets: string;
      released_assets: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM fitting_slot_allocation
           WHERE tenant_id=$1 AND fitting_id=$2::uuid AND is_blocking) AS blocking_slots,
         (SELECT count(*)::text FROM fitting_slot_allocation
           WHERE tenant_id=$1 AND fitting_id=$2::uuid AND NOT is_blocking AND released_at IS NOT NULL) AS released_slots,
         (SELECT count(*)::text
            FROM fitting_line fl
            JOIN asset_allocation aa ON aa.tenant_id=fl.tenant_id AND aa.fitting_line_id=fl.id
           WHERE fl.tenant_id=$1 AND fl.fitting_id=$2::uuid AND aa.is_blocking) AS blocking_assets,
         (SELECT count(*)::text
            FROM fitting_line fl
            JOIN asset_allocation aa ON aa.tenant_id=fl.tenant_id AND aa.fitting_line_id=fl.id
           WHERE fl.tenant_id=$1 AND fl.fitting_id=$2::uuid
             AND NOT aa.is_blocking AND aa.released_at IS NOT NULL) AS released_assets`,
      [seed.tenantId, fittingId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Claim state query returned no row.');
    return {
      blockingSlots: Number(row.blocking_slots),
      releasedSlots: Number(row.released_slots),
      blockingAssets: Number(row.blocking_assets),
      releasedAssets: Number(row.released_assets),
    };
  });
}

describe('FIT-BE-050..054 fitting lifecycle commands', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const {
    cancelFittingCommand,
    completeFittingCommand,
    confirmFittingCommand,
    markFittingNoShowCommand,
    rejectFittingCommand,
  } = await import('../../src/modules/fittings/fittings.mutation.service.js');

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

  function baseContext(seed: Seed, key = randomUUID()) {
    const membershipId = randomUUID();
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId,
      principalId: `user_${membershipId}`,
      requestId: randomUUID(),
      idempotencyKey: key,
      permissionCodes: ['reservations.manage' as const],
    };
  }

  it('requires the shared operational fitting permission without granting finance authority', async () => {
    const seed = await seedTenant('permission');
    const fitting = await createGuaranteed(seed);
    await expect(
      confirmFittingCommand(
        {
          ...baseContext(seed),
          permissionCodes: [],
          fittingId: fitting.id,
        },
        { version: fitting.version },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  async function createGuaranteed(seed: Seed) {
    const created = await createStaffFittingCommand(baseContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-09T02:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'guaranteed' }],
    });
    if (!created.body.success) throw new Error('Expected fitting creation success.');
    return created.body.data.fitting;
  }

  it('confirms a pending fitting without payment, retains its claims, and coalesces concurrent retries', async () => {
    const seed = await seedTenant('confirm');
    const fitting = await createGuaranteed(seed);
    const key = randomUUID();
    const context = { ...baseContext(seed, key), fittingId: fitting.id };

    const [first, concurrentRetry] = await Promise.all([
      confirmFittingCommand(context, { version: fitting.version }),
      confirmFittingCommand({ ...context, requestId: randomUUID() }, { version: fitting.version }),
    ]);
    expect([first.status, concurrentRetry.status]).toEqual([200, 200]);
    if (!first.body.success || !concurrentRetry.body.success)
      throw new Error('Expected confirmation success.');
    expect(first.body.data.fitting).toMatchObject({
      id: fitting.id,
      status: 'confirmed',
      version: fitting.version + 1,
    });
    expect(concurrentRetry.body.data.fitting.version).toBe(fitting.version + 1);
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 1,
      releasedSlots: 0,
      blockingAssets: 1,
      releasedAssets: 0,
    });

    await withAdmin(async (client) => {
      const counts = await client.query<{
        charges: string;
        payments: string;
        audits: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM charge WHERE tenant_id=$1 AND fitting_id=$2::uuid AND kind='fitting_fee') AS charges,
           (SELECT count(*)::text FROM payment WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS payments,
           (SELECT count(*)::text FROM audit_event WHERE tenant_id=$1 AND entity_id=$2::uuid AND action='fitting.confirmed') AS audits`,
        [seed.tenantId, fitting.id],
      );
      expect(counts.rows[0]).toEqual({ charges: '1', payments: '0', audits: '1' });
    });
  });

  it('rejects a future pending fitting with a reason, releases claims once, and never fabricates finance state', async () => {
    const seed = await seedTenant('reject');
    const fitting = await createGuaranteed(seed);
    const key = randomUUID();
    const context = { ...baseContext(seed, key), fittingId: fitting.id };
    const rejected = await rejectFittingCommand(context, {
      version: fitting.version,
      reason: 'Customer changed plans',
    });
    expect(rejected.status).toBe(200);
    if (!rejected.body.success) throw new Error('Expected rejection success.');
    expect(rejected.body.data.fitting).toMatchObject({
      status: 'rejected',
      terminal_reason: 'Customer changed plans',
      version: fitting.version + 1,
    });
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 0,
      releasedSlots: 1,
      blockingAssets: 0,
      releasedAssets: 1,
    });

    const replay = await rejectFittingCommand(
      { ...context, requestId: randomUUID() },
      { version: fitting.version, reason: 'Customer changed plans' },
    );
    expect(replay.status).toBe(200);
    const repeatedWithNewIntent = await rejectFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version + 1, reason: 'Try again' },
    );
    expect(repeatedWithNewIntent.status).toBe(409);

    await withAdmin(async (client) => {
      const finance = await client.query<{ charges: string; payments: string }>(
        `SELECT
           (SELECT count(*)::text FROM charge WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS charges,
           (SELECT count(*)::text FROM payment WHERE tenant_id=$1 AND fitting_id=$2::uuid) AS payments`,
        [seed.tenantId, fitting.id],
      );
      expect(finance.rows[0]).toEqual({ charges: '1', payments: '0' });
    });
  });

  it('returns conflict for stale versions and commands that are invalid from the current status', async () => {
    const seed = await seedTenant('stale-status');
    const fitting = await createGuaranteed(seed);
    const confirmed = await confirmFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version },
    );
    if (!confirmed.body.success) throw new Error('Expected confirmation success.');

    const staleCancel = await cancelFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version, reason: 'Stale command' },
    );
    const invalidReject = await rejectFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: confirmed.body.data.fitting.version, reason: 'Wrong state' },
    );
    expect([staleCancel.status, invalidReject.status]).toEqual([409, 409]);
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 1,
      releasedSlots: 0,
      blockingAssets: 1,
      releasedAssets: 0,
    });
  });

  it('allows cancellation from confirmed only before start and preserves released allocation history', async () => {
    const seed = await seedTenant('cancel');
    const fitting = await createGuaranteed(seed);
    const confirmed = await confirmFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version },
    );
    if (!confirmed.body.success) throw new Error('Expected confirmation success.');

    const cancelled = await cancelFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: confirmed.body.data.fitting.version, reason: 'Shop closure' },
    );
    expect(cancelled.status).toBe(200);
    if (!cancelled.body.success) throw new Error('Expected cancellation success.');
    expect(cancelled.body.data.fitting).toMatchObject({
      status: 'cancelled',
      terminal_reason: 'Shop closure',
    });
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 0,
      releasedSlots: 1,
      blockingAssets: 0,
      releasedAssets: 1,
    });
  });

  it('freezes reject/cancel at start, still permits explicit pending confirmation, then allows no-show', async () => {
    const seed = await seedTenant('started');
    const fitting = await createGuaranteed(seed);
    const now = Date.now();
    await shiftFittingPeriod(
      seed,
      fitting.id,
      new Date(now - 30 * 60_000).toISOString(),
      new Date(now + 30 * 60_000).toISOString(),
    );

    const rejected = await rejectFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version, reason: 'Too late' },
    );
    const cancelled = await cancelFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version, reason: 'Too late' },
    );
    expect([rejected.status, cancelled.status]).toEqual([409, 409]);

    const confirmed = await confirmFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version },
    );
    expect(confirmed.status).toBe(200);
    if (!confirmed.body.success) throw new Error('Expected late explicit confirmation success.');
    expect(confirmed.body.data.fitting.allowed_actions).toContain('mark_no_show');

    const noShow = await markFittingNoShowCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: confirmed.body.data.fitting.version },
    );
    expect(noShow.status).toBe(200);
    if (!noShow.body.success) throw new Error('Expected no-show success.');
    expect(noShow.body.data.fitting.status).toBe('no_show');
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 0,
      releasedSlots: 1,
      blockingAssets: 0,
      releasedAssets: 1,
    });
  });

  it('rejects no-show before start and completion before end without releasing claims', async () => {
    const seed = await seedTenant('too-early');
    const fitting = await createGuaranteed(seed);
    const confirmed = await confirmFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version },
    );
    if (!confirmed.body.success) throw new Error('Expected confirmation success.');
    const version = confirmed.body.data.fitting.version;

    const noShow = await markFittingNoShowCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version },
    );
    const complete = await completeFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version },
    );
    expect([noShow.status, complete.status]).toEqual([409, 409]);
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 1,
      releasedSlots: 0,
      blockingAssets: 1,
      releasedAssets: 0,
    });
  });

  it('completes a confirmed fitting only after end and does not create rental history', async () => {
    const seed = await seedTenant('complete');
    const fitting = await createGuaranteed(seed);
    const confirmed = await confirmFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version },
    );
    if (!confirmed.body.success) throw new Error('Expected confirmation success.');
    await shiftFittingPeriod(
      seed,
      fitting.id,
      '2000-01-01T00:00:00.000Z',
      '2000-01-01T01:00:00.000Z',
    );

    const completed = await completeFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: confirmed.body.data.fitting.version },
    );
    expect(completed.status).toBe(200);
    if (!completed.body.success) throw new Error('Expected completion success.');
    expect(completed.body.data.fitting.status).toBe('completed');
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 0,
      releasedSlots: 1,
      blockingAssets: 0,
      releasedAssets: 1,
    });

    await withAdmin(async (client) => {
      const custody = await client.query<{ count: string }>(
        `SELECT count(*)::text FROM custody_event WHERE tenant_id=$1`,
        [seed.tenantId],
      );
      expect(custody.rows[0]?.count).toBe('0');
    });
  });

  it('serializes confirm-versus-reject with one winning version and consistent claims', async () => {
    const seed = await seedTenant('confirm-reject-race');
    const fitting = await createGuaranteed(seed);

    const race = await Promise.all([
      confirmFittingCommand(
        { ...baseContext(seed), fittingId: fitting.id },
        { version: fitting.version },
      ),
      rejectFittingCommand(
        { ...baseContext(seed), fittingId: fitting.id },
        { version: fitting.version, reason: 'Race rejection' },
      ),
    ]);
    expect(race.map((result) => result.status).sort()).toEqual([200, 409]);

    const winner = race.find((result) => result.status === 200);
    if (!winner?.body.success) throw new Error('Expected one lifecycle race winner.');
    if (winner.body.data.fitting.status === 'confirmed') {
      expect(await readClaimState(seed, fitting.id)).toEqual({
        blockingSlots: 1,
        releasedSlots: 0,
        blockingAssets: 1,
        releasedAssets: 0,
      });
    } else {
      expect(winner.body.data.fitting.status).toBe('rejected');
      expect(await readClaimState(seed, fitting.id)).toEqual({
        blockingSlots: 0,
        releasedSlots: 1,
        blockingAssets: 0,
        releasedAssets: 1,
      });
    }

    await withAdmin(async (client) => {
      const result = await client.query<{ lifecycle_audits: string; version: string }>(
        `SELECT
           (SELECT count(*)::text FROM audit_event
             WHERE tenant_id=$1 AND entity_id=$2::uuid
               AND action IN ('fitting.confirmed','fitting.rejected')) AS lifecycle_audits,
           (SELECT version::text FROM fitting_appointment WHERE tenant_id=$1 AND id=$2::uuid) AS version`,
        [seed.tenantId, fitting.id],
      );
      expect(result.rows[0]).toEqual({
        lifecycle_audits: '1',
        version: String(fitting.version + 1),
      });
    });
  });

  it('serializes complete-versus-no-show with one terminal winner and one allocation release', async () => {
    const seed = await seedTenant('terminal-race');
    const fitting = await createGuaranteed(seed);
    const confirmed = await confirmFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version },
    );
    if (!confirmed.body.success) throw new Error('Expected confirmation success.');
    await shiftFittingPeriod(
      seed,
      fitting.id,
      '2000-01-01T00:00:00.000Z',
      '2000-01-01T01:00:00.000Z',
    );
    const currentVersion = confirmed.body.data.fitting.version;

    const race = await Promise.all([
      completeFittingCommand(
        { ...baseContext(seed), fittingId: fitting.id },
        { version: currentVersion },
      ),
      markFittingNoShowCommand(
        { ...baseContext(seed), fittingId: fitting.id },
        { version: currentVersion },
      ),
    ]);
    expect(race.map((result) => result.status).sort()).toEqual([200, 409]);

    const winner = race.find((result) => result.status === 200);
    if (!winner?.body.success) throw new Error('Expected one terminal race winner.');
    expect(['completed', 'no_show']).toContain(winner.body.data.fitting.status);
    expect(await readClaimState(seed, fitting.id)).toEqual({
      blockingSlots: 0,
      releasedSlots: 1,
      blockingAssets: 0,
      releasedAssets: 1,
    });

    await withAdmin(async (client) => {
      const result = await client.query<{ lifecycle_audits: string; version: string }>(
        `SELECT
           (SELECT count(*)::text FROM audit_event
             WHERE tenant_id=$1 AND entity_id=$2::uuid
               AND action IN ('fitting.completed','fitting.marked_no_show')) AS lifecycle_audits,
           (SELECT version::text FROM fitting_appointment WHERE tenant_id=$1 AND id=$2::uuid) AS version`,
        [seed.tenantId, fitting.id],
      );
      expect(result.rows[0]).toEqual({
        lifecycle_audits: '1',
        version: String(currentVersion + 1),
      });
    });
  });
});
