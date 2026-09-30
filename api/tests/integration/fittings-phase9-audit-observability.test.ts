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

const PII_NAME = 'PII_SENTINEL_FITTING_CUSTOMER';
const PII_EMAIL = 'pii-sentinel-fitting@example.test';
const PRIVATE_NOTE = 'PRIVATE_NOTE_SENTINEL_NEVER_AUDIT_THIS';

interface Seed {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  customerId: string;
  variantId: string;
  cashMethodId: string;
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

async function seedTenant(): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = randomUUID().slice(0, 8);
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_audit_${suffix}`, `Audit ${suffix}`, `fit9-audit-${suffix}`],
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
    const principalId = `user_audit_${suffix}`;
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
           VALUES ($1,$2,$3) RETURNING id`,
          [tenantId, PII_NAME, PII_EMAIL],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Audit Gown','active') RETURNING id`,
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
    const cashMethodId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO payment_method
             (tenant_id,name,rail,destination_snapshot,active,storefront_enabled,version)
           VALUES ($1,'Cash','cash','{}'::jsonb,true,false,1) RETURNING id`,
          [tenantId],
        )
      ).rows,
      'cash payment method',
    );
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,2,60,500,'PHP',1)`,
      [tenantId, branchId],
    );
    await client.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"09:00","closes_local":"17:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, branchId],
    );
    return { tenantId, branchId, membershipId, principalId, customerId, variantId, cashMethodId };
  });
}

function baseContext(seed: Seed, idempotencyKey = randomUUID()) {
  return {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    membershipId: seed.membershipId,
    principalId: seed.principalId,
    requestId: randomUUID(),
    idempotencyKey,
  };
}

describe('FIT-BE-093 fitting audit and safe observability', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  const { confirmFittingCommand, rescheduleFittingCommand, updateFittingNoteCommand } =
    await import('../../src/modules/fittings/fittings.mutation.service.js');
  const { updateFittingSettingsCommand, updateFittingWeeklyHoursCommand } =
    await import('../../src/modules/fittings/fittings.schedule.command.service.js');
  const { createFittingPaymentIntentCommand, verifyFittingPaymentCommand } =
    await import('../../src/modules/fittings/fittings.finance.service.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('emits bounded redacted audit metadata for create, note, reschedule, status, schedule, and finance actions', async () => {
    const seed = await seedTenant();
    const created = await createStaffFittingCommand(baseContext(seed), {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: '2099-01-05T02:00:00.000Z',
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
      internal_note: PRIVATE_NOTE,
    });
    expect(created.status).toBe(201);
    if (!created.body.success) throw new Error('Expected create success.');
    const fitting = created.body.data.fitting;

    const rescheduled = await rescheduleFittingCommand(
      { ...baseContext(seed), fittingId: fitting.id },
      { version: fitting.version, starts_at: '2099-01-05T03:00:00.000Z' },
    );
    expect(rescheduled.status).toBe(200);
    if (!rescheduled.body.success) throw new Error('Expected reschedule success.');

    const noted = await updateFittingNoteCommand(
      {
        ...baseContext(seed),
        fittingId: fitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: rescheduled.body.data.fitting.version, internal_note: PRIVATE_NOTE },
    );
    expect(noted.status).toBe(200);
    if (!noted.body.success) throw new Error('Expected note update success.');

    const confirmed = await confirmFittingCommand(
      {
        ...baseContext(seed),
        fittingId: fitting.id,
        permissionCodes: ['reservations.manage'],
      },
      { version: noted.body.data.fitting.version },
    );
    expect(confirmed.status).toBe(200);

    const settings = await updateFittingSettingsCommand(
      {
        ...baseContext(seed),
        role: 'owner',
        effectiveTenantStatus: 'active',
      },
      { version: 1, enabled: true, capacity: 2, duration_minutes: 60, fee_minor: '700' },
    );
    expect(settings.status).toBe(200);
    if (!settings.body.success) throw new Error('Expected settings update success.');

    const weeklyHours = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ].map((weekday) => ({ weekday, windows: [{ starts_local: '09:00', ends_local: '17:00' }] }));
    const hours = await updateFittingWeeklyHoursCommand(
      {
        ...baseContext(seed),
        role: 'owner',
        effectiveTenantStatus: 'active',
      },
      { version: settings.body.data.settings.version, weekly_hours: weeklyHours as never },
    );
    expect(hours.status).toBe(200);

    const payment = await createFittingPaymentIntentCommand(
      {
        ...baseContext(seed),
        fittingId: fitting.id,
        permissionCodes: ['reservations.manage'],
        role: 'owner',
        effectiveTenantStatus: 'active',
      },
      { payment_method_id: seed.cashMethodId as never },
    );
    expect(payment.status).toBe(201);

    const verified = await verifyFittingPaymentCommand(
      {
        ...baseContext(seed),
        fittingId: fitting.id,
        permissionCodes: ['reservations.manage', 'payments.manage', 'evidence.verify'],
        role: 'owner',
        effectiveTenantStatus: 'active',
      },
      { verified_amount_minor: '500', cash_tendered_minor: '500' },
    );
    expect(verified.status).toBe(200);

    await withAdmin(async (client) => {
      const audits = await client.query<{
        action: string;
        actor_kind: string;
        actor_key: string;
        request_id: string;
        redacted_summary: Record<string, unknown>;
      }>(
        `SELECT action,actor_kind,actor_key,request_id,redacted_summary
           FROM audit_event
          WHERE tenant_id=$1
            AND action = ANY($2::text[])
          ORDER BY occurred_at, id`,
        [
          seed.tenantId,
          [
            'fitting.created',
            'fitting.rescheduled',
            'fitting.note_updated',
            'fitting.confirmed',
            'fitting.settings_updated',
            'fitting.hours_updated',
            'fitting.payment_created',
            'payment.verified',
          ],
        ],
      );
      expect(audits.rows.map((row) => row.action).sort()).toEqual(
        [
          'fitting.created',
          'fitting.rescheduled',
          'fitting.note_updated',
          'fitting.confirmed',
          'fitting.settings_updated',
          'fitting.hours_updated',
          'fitting.payment_created',
          'payment.verified',
        ].sort(),
      );
      expect(audits.rows.every((row) => row.actor_kind === 'staff')).toBe(true);
      expect(audits.rows.every((row) => row.actor_key === seed.principalId)).toBe(true);
      expect(audits.rows.every((row) => row.request_id.length > 0)).toBe(true);

      const serialized = JSON.stringify(audits.rows);
      for (const forbidden of [
        PII_NAME,
        PII_EMAIL,
        PRIVATE_NOTE,
        'authorization',
        'storage_key',
        'receipt_url',
        'private_url',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).toContain(seed.branchId);
    });
  });
});
