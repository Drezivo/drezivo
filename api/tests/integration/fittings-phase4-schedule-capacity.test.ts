import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  claimFittingCapacitySlot,
  createFittingAppointmentBase,
  ensureFittingCapacitySlots,
  validateFittingScheduleForCreate,
} from '../../src/modules/fittings/fittings.command.repository.js';
import {
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

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

  return { tenantId, branchId, customerId, variantId };
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
  beforeAll(async () => migrateTestDatabase(adminUrl));
  afterEach(async () => resetTestDatabase(adminUrl));

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
      expect(valid).toEqual({ is_future: true, within_weekly_hours: true, closure_free: true });

      const outsideHours = await validateFittingScheduleForCreate(client as never, {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        startsAt: '2099-01-09T00:00:00.000Z',
        endsAt: '2099-01-09T01:00:00.000Z',
      });
      expect(outsideHours.within_weekly_hours).toBe(false);

      const closed = await validateFittingScheduleForCreate(client as never, {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        startsAt: '2099-01-10T04:30:00.000Z',
        endsAt: '2099-01-10T05:30:00.000Z',
      });
      expect(closed.closure_free).toBe(false);
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
