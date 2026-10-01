import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  claimFittingCapacitySlot,
  createFittingAppointmentBase,
  ensureFittingCapacitySlots,
  validateFittingScheduleForCreate,
} from '../../src/modules/fittings/fittings.command.repository.js';
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

interface Seed {
  tenantId: string;
  branchId: string;
  customerId: string;
  variantId: string;
  membershipId: string;
  principalId: string;
}

function requireId(rows: Array<{ id: string }>, label: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${label} insert returned no row`);
  return row.id;
}

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  return client;
}

async function seedBranch(client: Client, label: string): Promise<Seed> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const tenant = await client.query<{ id: string }>(
    `INSERT INTO tenant (clerk_org_id, name, slug, currency, timezone)
     VALUES ($1, $2, $3, 'PHP', 'Asia/Manila') RETURNING id`,
    [`org_${suffix}`, suffix, `fit4-${suffix}`],
  );
  const tenantId = requireId(tenant.rows, 'tenant');
  const branch = await client.query<{ id: string }>(
    `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
     VALUES ($1, 'Main', 'MAIN', true, 'Asia/Manila') RETURNING id`,
    [tenantId],
  );
  const branchId = requireId(branch.rows, 'branch');
  const principalId = `user_${suffix}`;
  const membership = await client.query<{ id: string }>(
    `INSERT INTO membership (tenant_id, clerk_user_id, role, status)
     VALUES ($1, $2, 'owner', 'active') RETURNING id`,
    [tenantId, principalId],
  );
  const membershipId = requireId(membership.rows, 'membership');
  const customer = await client.query<{ id: string }>(
    `INSERT INTO customer (tenant_id, full_name, email)
     VALUES ($1, 'Schedule Test Customer', $2) RETURNING id`,
    [tenantId, `${suffix}@example.test`],
  );
  const customerId = requireId(customer.rows, 'customer');
  const product = await client.query<{ id: string }>(
    `INSERT INTO product (tenant_id, code, name, status)
     VALUES ($1, $2, 'Schedule Test Gown', 'active') RETURNING id`,
    [tenantId, `P-${suffix}`],
  );
  const variant = await client.query<{ id: string }>(
    `INSERT INTO product_variant
       (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
        measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
        included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
     VALUES ($1, $2, $3, 'M', 'Gold', '{}', 'cm', 'none', 1000, 0, 'PHP',
             'fixed_duration', 1440, 0, 0, 0, 'active')
     RETURNING id`,
    [tenantId, requireId(product.rows, 'product'), `SKU-${suffix}`],
  );
  const variantId = requireId(variant.rows, 'variant');

  await client.query(
    `INSERT INTO fitting_settings
       (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
     VALUES ($1, $2, true, 1, 60, 0, 'PHP', 1)`,
    [tenantId, branchId],
  );
  await client.query(
    `UPDATE branch
        SET operating_hours = '{"opens_local":"09:00","closes_local":"17:00","closed_weekdays":[]}'::jsonb
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, branchId],
  );
  await client.query(
    `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
     VALUES ($1, $2, date '2099-01-10', 'Private event')`,
    [tenantId, branchId],
  );

  return { tenantId, branchId, customerId, variantId, membershipId, principalId };
}

async function createStaffFitting(seed: Seed, startsAt: string) {
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');
  return createStaffFittingCommand(
    {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: seed.membershipId,
      principalId: seed.principalId,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    },
    {
      customer: { source: 'existing', customer_id: seed.customerId as never },
      starts_at: startsAt,
      garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
    },
  );
}

async function insertPreferenceFitting(
  client: Client,
  seed: Seed,
  startsAt: string,
  endsAt: string,
): Promise<string> {
  const fittingId = randomUUID();
  await createFittingAppointmentBase(client as never, {
    fittingId,
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    customerId: seed.customerId,
    startsAt,
    endsAt,
    timezoneSnapshot: 'Asia/Manila',
    currency: 'PHP',
    feeMinor: 0,
    internalNote: null,
    businessKey: `test:${fittingId}`,
    garments: [
      { lineId: randomUUID(), variantId: seed.variantId, guaranteed: false, assetId: null },
    ],
    chargeId: randomUUID(),
  });
  return fittingId;
}

describe('FIT-BE-041 fitting schedule and capacity validation', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => {
    const { closePool } = await import('../../src/db/client.js');
    await closePool();
  });

  it('requires a future period wholly inside Business Hours and outside branch closed dates', async () => {
    const client = await openClient();
    try {
      const seed = await seedBranch(client, 'schedule');
      const valid = await validateFittingScheduleForCreate(client as never, {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        startsAt: '2099-01-09T02:00:00.000Z',
        endsAt: '2099-01-09T03:00:00.000Z',
      });
      expect(valid).toEqual({ is_future: true, within_business_hours: true, closed_date_free: true });

      const outsideHours = await validateFittingScheduleForCreate(client as never, {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        startsAt: '2099-01-09T00:00:00.000Z',
        endsAt: '2099-01-09T01:00:00.000Z',
      });
      expect(outsideHours.within_business_hours).toBe(false);

      const closed = await validateFittingScheduleForCreate(client as never, {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        startsAt: '2099-01-10T04:30:00.000Z',
        endsAt: '2099-01-10T05:30:00.000Z',
      });
      expect(closed.closed_date_free).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('enforces opening, closing, recurring closed weekdays, and special closed dates through the staff fitting command', async () => {
    const client = await openClient();
    try {
      const seed = await seedBranch(client, 'command-schedule');

      const beforeOpening = await createStaffFitting(seed, '2099-01-09T00:30:00.000Z');
      expect(beforeOpening.status).toBe(409);
      expect(beforeOpening.body.success ? null : beforeOpening.body.error.code).toBe('SCHEDULE_CONFLICT');

      const endsAfterClosing = await createStaffFitting(seed, '2099-01-09T08:30:00.000Z');
      expect(endsAfterClosing.status).toBe(409);
      expect(endsAfterClosing.body.success ? null : endsAfterClosing.body.error.code).toBe('SCHEDULE_CONFLICT');

      const insideHours = await createStaffFitting(seed, '2099-01-09T01:00:00.000Z');
      expect(insideHours.status).toBe(201);
      expect(insideHours.body.success).toBe(true);

      await client.query(
        `UPDATE branch
            SET operating_hours = '{"opens_local":"09:00","closes_local":"17:00","closed_weekdays":["sunday"]}'::jsonb
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.branchId],
      );
      const recurringClosed = await createStaffFitting(seed, '2099-01-11T01:00:00.000Z');
      expect(recurringClosed.status).toBe(409);
      expect(recurringClosed.body.success ? null : recurringClosed.body.error.message).toContain('open weekday');

      const specialClosed = await createStaffFitting(seed, '2099-01-10T01:00:00.000Z');
      expect(specialClosed.status).toBe(409);
      expect(specialClosed.body.success ? null : specialClosed.body.error.message).toContain('special closed date');

      await client.query(
        'DELETE FROM branch_closure WHERE tenant_id = $1 AND branch_id = $2 AND local_date = date \'2099-01-10\'',
        [seed.tenantId, seed.branchId],
      );
      const reopened = await createStaffFitting(seed, '2099-01-10T01:00:00.000Z');
      expect(reopened.status).toBe(201);
      expect(reopened.body.success).toBe(true);
    } finally {
      await client.end();
    }
  });

  it('keeps capacity conflicts independent from valid Business Hours', async () => {
    const client = await openClient();
    try {
      const seed = await seedBranch(client, 'command-capacity');
      const first = await createStaffFitting(seed, '2099-01-09T01:00:00.000Z');
      expect(first.status).toBe(201);
      const second = await createStaffFitting(seed, '2099-01-09T01:00:00.000Z');
      expect(second.status).toBe(409);
      expect(second.body.success ? null : second.body.error.code).toBe('CAPACITY_CONFLICT');
    } finally {
      await client.end();
    }
  });

  it('materializes exactly configured hidden capacity and refuses an overlapping second claim', async () => {
    const client = await openClient();
    try {
      const seed = await seedBranch(client, 'capacity');
      await client.query('BEGIN');
      await ensureFittingCapacitySlots(client as never, {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        capacity: 1,
      });
      const firstFitting = await insertPreferenceFitting(
        client,
        seed,
        '2099-01-09T02:00:00.000Z',
        '2099-01-09T03:00:00.000Z',
      );
      const firstSlot = await claimFittingCapacitySlot(client as never, {
        allocationId: randomUUID(),
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        fittingId: firstFitting,
        startsAt: '2099-01-09T02:00:00.000Z',
        endsAt: '2099-01-09T03:00:00.000Z',
      });
      expect(firstSlot).not.toBeNull();
      await client.query('COMMIT');

      await client.query('BEGIN');
      const secondFitting = await insertPreferenceFitting(
        client,
        seed,
        '2099-01-09T02:30:00.000Z',
        '2099-01-09T03:30:00.000Z',
      );
      const secondSlot = await claimFittingCapacitySlot(client as never, {
        allocationId: randomUUID(),
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        fittingId: secondFitting,
        startsAt: '2099-01-09T02:30:00.000Z',
        endsAt: '2099-01-09T03:30:00.000Z',
      });
      expect(secondSlot).toBeNull();
      await client.query('ROLLBACK');

      const counts = await client.query<{ active_slots: string; blocking_claims: string }>(
        `SELECT
           (SELECT count(*) FROM fitting_capacity_slot WHERE tenant_id = $1 AND branch_id = $2 AND active)::text AS active_slots,
           (SELECT count(*) FROM fitting_slot_allocation WHERE tenant_id = $1 AND is_blocking)::text AS blocking_claims`,
        [seed.tenantId, seed.branchId],
      );
      expect(counts.rows[0]).toEqual({ active_slots: '1', blocking_claims: '1' });
    } finally {
      await client.end();
    }
  });
});
