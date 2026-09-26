import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

type Seed = {
  tenantId: string;
  branchId: string;
  secondBranchId: string;
  customerId: string;
  variantId: string;
  assetAId: string;
  assetBId: string;
  secondBranchAssetId: string;
  slot1Id: string;
  slot2Id: string;
  secondBranchSlotId: string;
  paymentMethodId: string;
};

type FittingIds = {
  fittingId: string;
  lineId: string;
  slotAllocationId: string;
  assetAllocationId: string | null;
};

const PERIOD_A = {
  start: '2026-10-10T02:00:00.000Z',
  end: '2026-10-10T03:00:00.000Z',
};

const PERIOD_OVERLAP = {
  start: '2026-10-10T02:30:00.000Z',
  end: '2026-10-10T03:30:00.000Z',
};

const PERIOD_ADJACENT = {
  start: '2026-10-10T03:00:00.000Z',
  end: '2026-10-10T04:00:00.000Z',
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

async function seedBase(client: Client, label: string): Promise<Seed> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;

  const tenantId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO tenant (clerk_org_id, name, slug, currency, timezone)
         VALUES ($1, $2, $3, 'PHP', 'Asia/Manila')
         RETURNING id`,
        [`org_${suffix}`, `Fitting ${suffix}`, `fit-${suffix}`],
      )
    ).rows,
    'tenant',
  );

  const branchId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      )
    ).rows,
    'branch',
  );

  const secondBranchId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Second', 'SECOND', false, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      )
    ).rows,
    'second branch',
  );

  const customerId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Fitting Customer', $2)
         RETURNING id`,
        [tenantId, `${suffix}@example.test`],
      )
    ).rows,
    'customer',
  );

  const productId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, 'Fitting Gown', 'active')
         RETURNING id`,
        [tenantId, `FIT-${suffix}`],
      )
    ).rows,
    'product',
  );

  const variantId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         VALUES
           ($1, $2, $3, 'M', 'Gold', '{}'::jsonb, 'cm', 'none', 10000, 0,
            'PHP', 'fixed_duration', 1440, 0, 0, 0, 'active')
         RETURNING id`,
        [tenantId, productId, `SKU-${suffix}`],
      )
    ).rows,
    'variant',
  );

  const assetAId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')
         RETURNING id`,
        [tenantId, branchId, variantId, `FIT-A-${suffix}`],
      )
    ).rows,
    'asset A',
  );

  const assetBId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')
         RETURNING id`,
        [tenantId, branchId, variantId, `FIT-B-${suffix}`],
      )
    ).rows,
    'asset B',
  );

  const secondBranchAssetId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')
         RETURNING id`,
        [tenantId, secondBranchId, variantId, `FIT-X-${suffix}`],
      )
    ).rows,
    'second branch asset',
  );

  await client.query(
    `INSERT INTO fitting_settings
       (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
     VALUES ($1, $2, true, 2, 60, 30000, 'PHP', 1),
            ($1, $3, true, 1, 60, 30000, 'PHP', 1)`,
    [tenantId, branchId, secondBranchId],
  );

  const slot1Id = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         VALUES ($1, $2, 1, true)
         RETURNING id`,
        [tenantId, branchId],
      )
    ).rows,
    'slot 1',
  );

  const slot2Id = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         VALUES ($1, $2, 2, true)
         RETURNING id`,
        [tenantId, branchId],
      )
    ).rows,
    'slot 2',
  );

  const secondBranchSlotId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         VALUES ($1, $2, 1, true)
         RETURNING id`,
        [tenantId, secondBranchId],
      )
    ).rows,
    'second branch slot',
  );

  const paymentMethodId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, storefront_enabled, version)
         VALUES ($1, 'Cash', 'cash', '{}'::jsonb, true, false, 1)
         RETURNING id`,
        [tenantId],
      )
    ).rows,
    'payment method',
  );

  return {
    tenantId,
    branchId,
    secondBranchId,
    customerId,
    variantId,
    assetAId,
    assetBId,
    secondBranchAssetId,
    slot1Id,
    slot2Id,
    secondBranchSlotId,
    paymentMethodId,
  };
}

async function insertPendingFitting(
  client: Client,
  seed: Seed,
  input: {
    label: string;
    period?: { start: string; end: string };
    slotId?: string;
    guaranteed?: boolean;
    assetId?: string;
    feeMinor?: bigint;
    branchId?: string;
  },
): Promise<FittingIds> {
  const period = input.period ?? PERIOD_A;
  const branchId = input.branchId ?? seed.branchId;
  const slotId = input.slotId ?? seed.slot1Id;
  const guaranteed = input.guaranteed ?? false;
  const feeMinor = input.feeMinor ?? 30000n;

  const fittingId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_appointment
           (tenant_id, branch_id, customer_id, booking_channel, status, period,
            timezone_snapshot, currency, fee_minor, business_key, version)
         VALUES
           ($1, $2, $3, 'staff', 'pending', tstzrange($4::timestamptz, $5::timestamptz, '[)'),
            'Asia/Manila', 'PHP', $6, $7, 1)
         RETURNING id`,
        [
          seed.tenantId,
          branchId,
          seed.customerId,
          period.start,
          period.end,
          feeMinor.toString(),
          `fit:${input.label}:${randomUUID()}`,
        ],
      )
    ).rows,
    'fitting appointment',
  );

  const lineId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_line
           (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          seed.tenantId,
          fittingId,
          seed.variantId,
          guaranteed ? (input.assetId ?? seed.assetAId) : null,
          guaranteed,
        ],
      )
    ).rows,
    'fitting line',
  );

  const slotAllocationId = requireId(
    (
      await client.query<{ id: string }>(
        `INSERT INTO fitting_slot_allocation
           (tenant_id, slot_id, fitting_id, period, is_blocking)
         VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), true)
         RETURNING id`,
        [seed.tenantId, slotId, fittingId, period.start, period.end],
      )
    ).rows,
    'slot allocation',
  );

  let assetAllocationId: string | null = null;
  if (guaranteed) {
    assetAllocationId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, fitting_line_id, kind, period, is_blocking)
           VALUES
             ($1, $2, $3, $4, 'fitting', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)
           RETURNING id`,
          [
            seed.tenantId,
            branchId,
            input.assetId ?? seed.assetAId,
            lineId,
            period.start,
            period.end,
          ],
        )
      ).rows,
      'asset allocation',
    );
  }

  return { fittingId, lineId, slotAllocationId, assetAllocationId };
}

async function createCommittedFitting(
  client: Client,
  seed: Seed,
  input: Parameters<typeof insertPendingFitting>[2],
): Promise<FittingIds> {
  await client.query('BEGIN');
  try {
    const ids = await insertPendingFitting(client, seed, input);
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
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

describe('FIT-BE-021/022 fitting database integrity and exclusions', () => {
  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  it('rejects cross-tenant appointment/customer and fitting-line asset references', async () => {
    const client = await openAdminClient();
    try {
      const tenantA = await seedBase(client, 'tenant-a');
      const tenantB = await seedBase(client, 'tenant-b');

      const badCustomer = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_appointment
             (tenant_id, branch_id, customer_id, booking_channel, status, period,
              timezone_snapshot, currency, fee_minor, business_key, version)
           VALUES
             ($1, $2, $3, 'staff', 'pending', tstzrange($4::timestamptz, $5::timestamptz, '[)'),
              'Asia/Manila', 'PHP', 0, $6, 1)`,
          [
            tenantA.tenantId,
            tenantA.branchId,
            tenantB.customerId,
            PERIOD_A.start,
            PERIOD_A.end,
            `fit:foreign-customer:${randomUUID()}`,
          ],
        ),
      );

      await client.query('BEGIN');
      const fitting = await insertPendingFitting(client, tenantA, {
        label: 'foreign-asset-parent',
        guaranteed: false,
      });
      await client.query('COMMIT');

      const badAsset = await constraintResult(() =>
        client.query(
          `UPDATE fitting_line
              SET garment_guaranteed = true, asset_id = $1
            WHERE tenant_id = $2 AND id = $3`,
          [tenantB.assetAId, tenantA.tenantId, fitting.lineId],
        ),
      );

      expect(badCustomer.code).toBe('23503');
      expect(badAsset.code).toBe('23503');
    } finally {
      await client.end();
    }
  });

  it('enforces canonical state, range, guarantee, and finance snapshot constraints', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBase(client, 'row-integrity');

      const badInitialState = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_appointment
             (tenant_id, branch_id, customer_id, booking_channel, status, period,
              timezone_snapshot, currency, fee_minor, business_key, version)
           VALUES
             ($1, $2, $3, 'staff', 'confirmed', tstzrange($4::timestamptz, $5::timestamptz, '[)'),
              'Asia/Manila', 'PHP', 0, $6, 1)`,
          [
            seed.tenantId,
            seed.branchId,
            seed.customerId,
            PERIOD_A.start,
            PERIOD_A.end,
            `fit:bad-state:${randomUUID()}`,
          ],
        ),
      );

      const badRange = await constraintResult(() =>
        client.query(
          `INSERT INTO fitting_appointment
             (tenant_id, branch_id, customer_id, booking_channel, status, period,
              timezone_snapshot, currency, fee_minor, business_key, version)
           VALUES
             ($1, $2, $3, 'staff', 'pending', tstzrange($4::timestamptz, $5::timestamptz, '[]'),
              'Asia/Manila', 'PHP', 0, $6, 1)`,
          [
            seed.tenantId,
            seed.branchId,
            seed.customerId,
            PERIOD_A.start,
            PERIOD_A.end,
            `fit:bad-range:${randomUUID()}`,
          ],
        ),
      );

      const fitting = await createCommittedFitting(client, seed, {
        label: 'preference',
        guaranteed: false,
        feeMinor: 30000n,
      });

      const preferenceWithAsset = await constraintResult(() =>
        client.query(
          `UPDATE fitting_line SET asset_id = $1
            WHERE tenant_id = $2 AND id = $3`,
          [seed.assetAId, seed.tenantId, fitting.lineId],
        ),
      );

      const illegalTransition = await constraintResult(() =>
        client.query(
          `UPDATE fitting_appointment
              SET status = 'completed', version = version + 1
            WHERE tenant_id = $1 AND id = $2`,
          [seed.tenantId, fitting.fittingId],
        ),
      );

      const chargeCurrencyMismatch = await constraintResult(async () => {
        await client.query('BEGIN');
        try {
          await client.query(
            `INSERT INTO charge
               (tenant_id, fitting_id, kind, amount_minor, currency, business_key)
             VALUES ($1, $2, 'fitting_fee', 30000, 'USD', $3)`,
            [seed.tenantId, fitting.fittingId, `charge:bad-currency:${randomUUID()}`],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      const chargeAmountMismatch = await constraintResult(async () => {
        await client.query('BEGIN');
        try {
          await client.query(
            `INSERT INTO charge
               (tenant_id, fitting_id, kind, amount_minor, currency, business_key)
             VALUES ($1, $2, 'fitting_fee', 29999, 'PHP', $3)`,
            [seed.tenantId, fitting.fittingId, `charge:bad-amount:${randomUUID()}`],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      const paymentCurrencyMismatch = await constraintResult(async () => {
        await client.query('BEGIN');
        try {
          await client.query(
            `INSERT INTO payment
               (tenant_id, fitting_id, payment_method_id, amount_minor, currency, status, business_key)
             VALUES ($1, $2, $3, 10000, 'USD', 'pending', $4)`,
            [
              seed.tenantId,
              fitting.fittingId,
              seed.paymentMethodId,
              `payment:bad-currency:${randomUUID()}`,
            ],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      expect(badInitialState).toMatchObject({
        code: '23514',
        constraint: 'fitting_appointment_initial_state',
      });
      expect(badRange.code).toBe('23514');
      expect(preferenceWithAsset).toMatchObject({
        code: '23514',
        constraint: 'fitting_line_guarantee_asset_check',
      });
      expect(illegalTransition).toMatchObject({
        code: '23514',
        constraint: 'fitting_appointment_state_transition',
      });
      expect(chargeCurrencyMismatch).toMatchObject({
        code: '23514',
        constraint: 'charge_fitting_currency_match',
      });
      expect(chargeAmountMismatch).toMatchObject({
        code: '23514',
        constraint: 'charge_fitting_fee_snapshot_match',
      });
      expect(paymentCurrencyMismatch).toMatchObject({
        code: '23514',
        constraint: 'payment_fitting_currency_match',
      });
    } finally {
      await client.end();
    }
  });

  it('rejects same-tenant cross-branch capacity and guaranteed-asset relationships', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBase(client, 'branch-integrity');

      const wrongSlot = await constraintResult(async () => {
        await client.query('BEGIN');
        try {
          await insertPendingFitting(client, seed, {
            label: 'wrong-slot',
            slotId: seed.secondBranchSlotId,
            guaranteed: false,
          });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      const wrongAsset = await constraintResult(async () => {
        await client.query('BEGIN');
        try {
          await insertPendingFitting(client, seed, {
            label: 'wrong-asset',
            slotId: seed.slot1Id,
            guaranteed: true,
            assetId: seed.secondBranchAssetId,
          });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      expect(wrongSlot.code).toBe('23514');
      expect([
        'fitting_slot_allocation_branch_match',
        'fitting_capacity_claim_matches_appointment',
      ]).toContain(wrongSlot.constraint);
      expect(wrongAsset.code).toBe('23514');
      expect([
        'fitting_line_asset_branch_match',
        'asset_allocation_fitting_branch_match',
        'fitting_asset_claim_matches_appointment',
      ]).toContain(wrongAsset.constraint);
    } finally {
      await client.end();
    }
  });

  it('prevents concurrent overlap on the same hidden capacity slot', async () => {
    const seedClient = await openAdminClient();
    const first = await openAdminClient();
    const second = await openAdminClient();
    try {
      const seed = await seedBase(seedClient, 'slot-race');

      await first.query('BEGIN');
      await second.query('BEGIN');
      await insertPendingFitting(first, seed, {
        label: 'slot-race-a',
        period: PERIOD_A,
        slotId: seed.slot1Id,
        guaranteed: false,
      });

      const secondHeader = await second.query<{ id: string }>(
        `INSERT INTO fitting_appointment
           (tenant_id, branch_id, customer_id, booking_channel, status, period,
            timezone_snapshot, currency, fee_minor, business_key, version)
         VALUES
           ($1, $2, $3, 'staff', 'pending', tstzrange($4::timestamptz, $5::timestamptz, '[)'),
            'Asia/Manila', 'PHP', 0, $6, 1)
         RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          seed.customerId,
          PERIOD_OVERLAP.start,
          PERIOD_OVERLAP.end,
          `fit:slot-race-b:${randomUUID()}`,
        ],
      );
      const secondFittingId = requireId(secondHeader.rows, 'second fitting');
      await second.query(
        `INSERT INTO fitting_line (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
         VALUES ($1, $2, $3, NULL, false)`,
        [seed.tenantId, secondFittingId, seed.variantId],
      );

      const competingInsert = second
        .query(
          `INSERT INTO fitting_slot_allocation
             (tenant_id, slot_id, fitting_id, period, is_blocking)
           VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), true)`,
          [seed.tenantId, seed.slot1Id, secondFittingId, PERIOD_OVERLAP.start, PERIOD_OVERLAP.end],
        )
        .then(() => ({ code: 'inserted' }))
        .catch((error: { code?: string; constraint?: string }) => ({
          code: error.code,
          constraint: error.constraint,
        }));

      await first.query('COMMIT');
      const result = await competingInsert;
      await second.query('ROLLBACK');

      expect(result).toMatchObject({
        code: '23P01',
        constraint: 'fitting_slot_allocation_no_overlap',
      });
    } finally {
      await Promise.allSettled([first.query('ROLLBACK'), second.query('ROLLBACK')]);
      await Promise.all([seedClient.end(), first.end(), second.end()]);
    }
  });

  it('allows adjacent capacity periods because fitting periods are canonical [)', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBase(client, 'slot-adjacent');
      await createCommittedFitting(client, seed, {
        label: 'adjacent-a',
        period: PERIOD_A,
        slotId: seed.slot1Id,
        guaranteed: false,
      });
      await createCommittedFitting(client, seed, {
        label: 'adjacent-b',
        period: PERIOD_ADJACENT,
        slotId: seed.slot1Id,
        guaranteed: false,
      });

      const blocking = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM fitting_slot_allocation
          WHERE tenant_id = $1 AND slot_id = $2 AND is_blocking`,
        [seed.tenantId, seed.slot1Id],
      );
      expect(blocking.rows[0]?.count).toBe('2');
    } finally {
      await client.end();
    }
  });

  it('prevents concurrent guaranteed fittings from double-allocating one physical asset', async () => {
    const seedClient = await openAdminClient();
    const first = await openAdminClient();
    const second = await openAdminClient();
    try {
      const seed = await seedBase(seedClient, 'asset-race');

      await first.query('BEGIN');
      await second.query('BEGIN');
      await insertPendingFitting(first, seed, {
        label: 'asset-race-a',
        period: PERIOD_A,
        slotId: seed.slot1Id,
        guaranteed: true,
        assetId: seed.assetAId,
      });

      const secondHeader = await second.query<{ id: string }>(
        `INSERT INTO fitting_appointment
           (tenant_id, branch_id, customer_id, booking_channel, status, period,
            timezone_snapshot, currency, fee_minor, business_key, version)
         VALUES
           ($1, $2, $3, 'staff', 'pending', tstzrange($4::timestamptz, $5::timestamptz, '[)'),
            'Asia/Manila', 'PHP', 0, $6, 1)
         RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          seed.customerId,
          PERIOD_OVERLAP.start,
          PERIOD_OVERLAP.end,
          `fit:asset-race-b:${randomUUID()}`,
        ],
      );
      const secondFittingId = requireId(secondHeader.rows, 'second fitting');
      const secondLine = await second.query<{ id: string }>(
        `INSERT INTO fitting_line (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [seed.tenantId, secondFittingId, seed.variantId, seed.assetAId],
      );
      const secondLineId = requireId(secondLine.rows, 'second line');
      await second.query(
        `INSERT INTO fitting_slot_allocation
           (tenant_id, slot_id, fitting_id, period, is_blocking)
         VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), true)`,
        [seed.tenantId, seed.slot2Id, secondFittingId, PERIOD_OVERLAP.start, PERIOD_OVERLAP.end],
      );

      const competingInsert = second
        .query(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, fitting_line_id, kind, period, is_blocking)
           VALUES ($1, $2, $3, $4, 'fitting', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
          [
            seed.tenantId,
            seed.branchId,
            seed.assetAId,
            secondLineId,
            PERIOD_OVERLAP.start,
            PERIOD_OVERLAP.end,
          ],
        )
        .then(() => ({ code: 'inserted' }))
        .catch((error: { code?: string; constraint?: string }) => ({
          code: error.code,
          constraint: error.constraint,
        }));

      await first.query('COMMIT');
      const result = await competingInsert;
      await second.query('ROLLBACK');

      expect(result).toMatchObject({ code: '23P01', constraint: 'asset_allocation_no_overlap' });
    } finally {
      await Promise.allSettled([first.query('ROLLBACK'), second.query('ROLLBACK')]);
      await Promise.all([seedClient.end(), first.end(), second.end()]);
    }
  });

  it('retains released claim history and permits later reuse of the slot and garment', async () => {
    const client = await openAdminClient();
    try {
      const seed = await seedBase(client, 'release-history');
      const first = await createCommittedFitting(client, seed, {
        label: 'release-a',
        period: PERIOD_A,
        slotId: seed.slot1Id,
        guaranteed: true,
        assetId: seed.assetAId,
      });

      await client.query('BEGIN');
      await client.query(
        `UPDATE fitting_slot_allocation
            SET is_blocking = false, released_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, first.slotAllocationId],
      );
      await client.query(
        `UPDATE asset_allocation
            SET is_blocking = false, released_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, first.assetAllocationId],
      );
      await client.query(
        `UPDATE fitting_appointment
            SET status = 'cancelled', terminal_reason = 'Customer cancelled', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, first.fittingId],
      );
      await client.query('COMMIT');

      const second = await createCommittedFitting(client, seed, {
        label: 'release-b',
        period: PERIOD_A,
        slotId: seed.slot1Id,
        guaranteed: true,
        assetId: seed.assetAId,
      });

      const history = await client.query<{
        old_slot_blocking: boolean;
        old_slot_released: boolean;
        old_asset_blocking: boolean;
        old_asset_released: boolean;
        second_slot_blocking: boolean;
        second_asset_blocking: boolean;
      }>(
        `SELECT
           old_slot.is_blocking AS old_slot_blocking,
           old_slot.released_at IS NOT NULL AS old_slot_released,
           old_asset.is_blocking AS old_asset_blocking,
           old_asset.released_at IS NOT NULL AS old_asset_released,
           new_slot.is_blocking AS second_slot_blocking,
           new_asset.is_blocking AS second_asset_blocking
         FROM fitting_slot_allocation old_slot
         JOIN asset_allocation old_asset ON old_asset.id = $2
         JOIN fitting_slot_allocation new_slot ON new_slot.id = $3
         JOIN asset_allocation new_asset ON new_asset.id = $4
        WHERE old_slot.id = $1`,
        [
          first.slotAllocationId,
          first.assetAllocationId,
          second.slotAllocationId,
          second.assetAllocationId,
        ],
      );

      expect(history.rows[0]).toEqual({
        old_slot_blocking: false,
        old_slot_released: true,
        old_asset_blocking: false,
        old_asset_released: true,
        second_slot_blocking: true,
        second_asset_blocking: true,
      });
    } finally {
      await client.end();
    }
  });
});
