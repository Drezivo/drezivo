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
process.env.DATABASE_POOL_MAX = '8';
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
  otherBranchId: string;
  membershipId: string;
  principalId: string;
  customerId: string;
  variantId: string;
}

function idOf(rows: Array<{ id: string }>, label: string): string {
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

async function seed(label: string): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = idOf(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, `Hours ${suffix}`, `hours-${suffix}`],
        )
      ).rows,
      'tenant',
    );
    const branchId = idOf(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone,operating_hours)
           VALUES (
             $1,'Main Branch','MAIN',true,'Asia/Manila',
             '{"opens_local":"09:00","closes_local":"20:00","closed_weekdays":["sunday"]}'::jsonb
           ) RETURNING id`,
          [tenantId],
        )
      ).rows,
      'branch',
    );
    const otherBranchId = idOf(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone)
           VALUES ($1,'Other Branch','OTHER',false,'Asia/Manila') RETURNING id`,
          [tenantId],
        )
      ).rows,
      'other branch',
    );
    const principalId = `user_${suffix}`;
    const membershipId = idOf(
      (
        await client.query<{ id: string }>(
          `INSERT INTO membership (tenant_id,clerk_user_id,role,status)
           VALUES ($1,$2,'owner','active') RETURNING id`,
          [tenantId, principalId],
        )
      ).rows,
      'membership',
    );
    const customerId = idOf(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Hours Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = idOf(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Hours Gown','active') RETURNING id`,
          [tenantId, `P-${suffix}`],
        )
      ).rows,
      'product',
    );
    const variantId = idOf(
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
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,1,60,0,'PHP',1), ($1,$3,true,1,60,0,'PHP',1)`,
      [tenantId, branchId, otherBranchId],
    );
    return { tenantId, branchId, otherBranchId, membershipId, principalId, customerId, variantId };
  });
}

function context(seedValue: Seed, branchId = seedValue.branchId, permissions: PermissionCode[] = ['policies.manage']) {
  return {
    tenantId: seedValue.tenantId,
    branchId,
    membershipId: seedValue.membershipId,
    principalId: seedValue.principalId,
    permissionCodes: permissions,
    effectiveTenantStatus: 'active' as const,
    requestId: randomUUID(),
  };
}

async function seedFutureFitting(seedValue: Seed, startsAt: string): Promise<void> {
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const result = await createStaffFittingCommand(
    {
      tenantId: seedValue.tenantId,
      branchId: seedValue.branchId,
      membershipId: seedValue.membershipId,
      principalId: seedValue.principalId,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    },
    {
      customer: { source: 'existing', customer_id: seedValue.customerId as never },
      starts_at: startsAt,
      garments: [{ variant_id: seedValue.variantId as never, garment_mode: 'preference' }],
    },
  );
  if (!result.body.success) throw new Error(`Expected fitting seed success, got ${result.body.error.code}.`);
}

describe('Settings Business Hours ownership', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { settingsService } = await import('../../src/modules/settings/settings.service.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('reads and version-updates only the active branch and emits a bounded audit', async () => {
    const seeded = await seed('update');
    const initial = await settingsService.getBusinessHours(context(seeded));
    expect(initial).toMatchObject({
      branch_id: seeded.branchId,
      branch_name: 'Main Branch',
      opens_local: '09:00',
      closes_local: '20:00',
      closed_weekdays: ['sunday'],
      version: 1,
    });

    const otherTenant = await seed('update-other-tenant');
    const result = await settingsService.updateBusinessHours(context(seeded), randomUUID(), {
      version: 1,
      opens_local: '10:00',
      closes_local: '19:00',
      closed_weekdays: ['sunday', 'monday'],
    });
    expect(result.status).toBe(200);
    expect(result.body.success && result.body.data).toMatchObject({
      branch_id: seeded.branchId,
      branch_name: 'Main Branch',
      opens_local: '10:00',
      closes_local: '19:00',
      closed_weekdays: ['sunday', 'monday'],
      version: 2,
    });

    await withAdmin(async (client) => {
      const other = await client.query<{ operating_hours: Record<string, unknown> }>(
        `SELECT operating_hours FROM branch WHERE tenant_id=$1 AND id=$2`,
        [seeded.tenantId, seeded.otherBranchId],
      );
      expect(other.rows[0]?.operating_hours).toMatchObject({ opens_local: '08:00', closes_local: '20:00' });
      const foreignTenant = await client.query<{ operating_hours: Record<string, unknown> }>(
        `SELECT operating_hours FROM branch WHERE tenant_id=$1 AND id=$2`,
        [otherTenant.tenantId, otherTenant.branchId],
      );
      expect(foreignTenant.rows[0]?.operating_hours).toMatchObject({ opens_local: '09:00', closes_local: '20:00' });
      const audit = await client.query<{ action: string; redacted_summary: Record<string, unknown> }>(
        `SELECT action,redacted_summary FROM audit_event
          WHERE tenant_id=$1 AND action='settings.business_hours.updated'`,
        [seeded.tenantId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows[0])).not.toContain('Hours Customer');
    });
  });

  it('requires policies.manage and rejects stale Business Hours versions', async () => {
    const seeded = await seed('auth-stale');
    await expect(
      Promise.resolve().then(() =>
        settingsService.updateBusinessHours(context(seeded, seeded.branchId, []), randomUUID(), {
          version: 1,
          opens_local: '10:00',
          closes_local: '19:00',
          closed_weekdays: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const first = await settingsService.updateBusinessHours(context(seeded), randomUUID(), {
      version: 1,
      opens_local: '10:00',
      closes_local: '19:00',
      closed_weekdays: [],
    });
    expect(first.status).toBe(200);
    const stale = await settingsService.updateBusinessHours(context(seeded), randomUUID(), {
      version: 1,
      opens_local: '11:00',
      closes_local: '18:00',
      closed_weekdays: [],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.success ? null : stale.body.error.code).toBe('STALE_VERSION');

    const persisted = await settingsService.getBusinessHours(context(seeded));
    expect(persisted).toMatchObject({
      opens_local: '10:00',
      closes_local: '19:00',
      closed_weekdays: [],
      version: 2,
    });
  });

  it('rejects narrower Business Hours or a recurring closed weekday that would invalidate an accepted future fitting', async () => {
    const seeded = await seed('guard-hours');
    await seedFutureFitting(seeded, '2099-01-05T02:00:00.000Z');

    const narrower = await settingsService.updateBusinessHours(context(seeded), randomUUID(), {
      version: 1,
      opens_local: '11:00',
      closes_local: '20:00',
      closed_weekdays: ['sunday'],
    });
    expect(narrower.status).toBe(409);
    expect(narrower.body.success ? null : narrower.body.error.code).toBe('SCHEDULE_CONFLICT');

    const closedMonday = await settingsService.updateBusinessHours(context(seeded), randomUUID(), {
      version: 1,
      opens_local: '09:00',
      closes_local: '20:00',
      closed_weekdays: ['sunday', 'monday'],
    });
    expect(closedMonday.status).toBe(409);
    expect(closedMonday.body.success ? null : closedMonday.body.error.message).toContain('accepted future fitting');
  });

  it('creates, lists, updates and removes active-branch special closed dates with versioning and audits', async () => {
    const seeded = await seed('closure-crud');
    const created = await settingsService.createBranchClosure(context(seeded), randomUUID(), {
      local_date: '2099-12-25',
      reason: 'Holiday',
    });
    expect(created.status).toBe(201);
    if (!created.body.success) throw new Error('Expected branch closure creation success.');
    const closure = created.body.data.closure;
    expect(closure).toMatchObject({ branch_id: seeded.branchId, local_date: '2099-12-25', version: 1 });

    const listed = await settingsService.listBranchClosures(context(seeded), {
      date_start: '2099-12-01',
      date_end: '2099-12-31',
      limit: 20,
    });
    expect(listed.items).toHaveLength(1);

    const updated = await settingsService.updateBranchClosure(context(seeded), closure.id, randomUUID(), {
      version: 1,
      local_date: '2099-12-26',
      reason: 'Extended holiday',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.success && updated.body.data.closure).toMatchObject({ local_date: '2099-12-26', version: 2 });

    const removed = await settingsService.removeBranchClosure(context(seeded), closure.id, randomUUID(), { version: 2 });
    expect(removed.status).toBe(200);
    expect((await settingsService.listBranchClosures(context(seeded), {
      date_start: '2099-12-01',
      date_end: '2099-12-31',
      limit: 20,
    })).items).toEqual([]);

    await withAdmin(async (client) => {
      const audits = await client.query<{ action: string }>(
        `SELECT action FROM audit_event WHERE tenant_id=$1 AND action LIKE 'settings.business_hours.closure.%' ORDER BY action`,
        [seeded.tenantId],
      );
      expect(audits.rows.map((row) => row.action).sort()).toEqual([
        'settings.business_hours.closure.created',
        'settings.business_hours.closure.removed',
        'settings.business_hours.closure.updated',
      ].sort());
    });
  });

  it('rejects duplicate special closed dates and invalid closure input safely', async () => {
    const seeded = await seed('closure-invalid');
    const created = await settingsService.createBranchClosure(context(seeded), randomUUID(), {
      local_date: '2099-12-25',
      reason: 'Holiday',
    });
    expect(created.status).toBe(201);

    const duplicate = await settingsService.createBranchClosure(context(seeded), randomUUID(), {
      local_date: '2099-12-25',
      reason: 'Duplicate holiday',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.success ? null : duplicate.body.error.code).toBe('STATE_CONFLICT');

    const { branchClosureCreateRequest } = await import('@drezivo/contracts');
    expect(branchClosureCreateRequest.safeParse({ local_date: '2099-02-30', reason: 'Impossible date' }).success).toBe(false);
    expect(branchClosureCreateRequest.safeParse({ local_date: '2099-12-26', reason: '   ' }).success).toBe(false);
  });

  it('rejects a special closed date that overlaps an accepted future fitting', async () => {
    const seeded = await seed('closure-guard');
    await seedFutureFitting(seeded, '2099-01-05T02:00:00.000Z');

    const result = await settingsService.createBranchClosure(context(seeded), randomUUID(), {
      local_date: '2099-01-05',
      reason: 'Private event',
    });
    expect(result.status).toBe(409);
    expect(result.body.success ? null : result.body.error.code).toBe('SCHEDULE_CONFLICT');
  });
});
