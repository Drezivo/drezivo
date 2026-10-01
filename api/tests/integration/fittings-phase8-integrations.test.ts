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
  assetId: string;
  slotId: string;
  storefrontId: string;
  storefrontSlug: string;
  policySnapshotId: string;
  paymentMethodId: string;
  principalId: string;
  membershipId: string;
  todayStart: Date;
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

async function seedWorkspace(label: string): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const today = await client.query<{ today_start: Date }>(
      `SELECT date_trunc('day', statement_timestamp()) AS today_start`,
    );
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','UTC') RETURNING id`,
          [`org_${suffix}`, suffix, `be8-${suffix}`],
        )
      ).rows,
      'tenant',
    );
    const branchId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone,status)
           VALUES ($1,'Main','MAIN',true,'UTC','active') RETURNING id`,
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
    await client.query(
      `INSERT INTO branch_membership (tenant_id,branch_id,membership_id,permission_codes)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [
        tenantId,
        branchId,
        membershipId,
        JSON.stringify(['reservations.manage', 'payments.view', 'payments.manage']),
      ],
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'BE8 Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'BE8 Gown','active') RETURNING id`,
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
    const assetId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO physical_asset (tenant_id,branch_id,variant_id,asset_code)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [tenantId, branchId, variantId, `ASSET-${suffix}`],
        )
      ).rows,
      'asset',
    );
    // A published storefront is online only while its subscription grants access (billing/access.ts).
    await client.query(
      `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         SELECT $1, id, 'active', now(), now() + interval '30 days'
           FROM plan WHERE code = 'starter' AND version = 1 AND active = true`,
      [tenantId],
    );
    const storefrontSlug = `be8-store-${suffix}`;
    const storefrontId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO storefront (tenant_id,branch_id,slug,status,branding,contact,published_at)
           VALUES ($1,$2,$3,'published','{}'::jsonb,'{}'::jsonb,statement_timestamp()) RETURNING id`,
          [tenantId, branchId, storefrontSlug],
        )
      ).rows,
      'storefront',
    );
    const policySnapshotId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO policy_snapshot
             (tenant_id,storefront_id,version,rental_rules,deposit_rules,cancellation_rules,
              delivery_rules,privacy_notice,effective_at)
           VALUES ($1,$2,1,'{}','{}','{}','{}','BE8 policy',statement_timestamp()) RETURNING id`,
          [tenantId, storefrontId],
        )
      ).rows,
      'policy',
    );
    const paymentMethodId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO payment_method
             (tenant_id,name,rail,destination_snapshot,active,storefront_enabled,version)
           VALUES ($1,'Cash','cash','{}'::jsonb,true,false,1) RETURNING id`,
          [tenantId],
        )
      ).rows,
      'payment method',
    );
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,2,60,0,'PHP',1)`,
      [tenantId, branchId],
    );
    await client.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"00:00","closes_local":"23:59","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, branchId],
    );
    const slotId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO fitting_capacity_slot (tenant_id,branch_id,slot_number,active)
           VALUES ($1,$2,1,true) RETURNING id`,
          [tenantId, branchId],
        )
      ).rows,
      'capacity slot',
    );

    return {
      tenantId,
      branchId,
      customerId,
      variantId,
      assetId,
      slotId,
      storefrontId,
      storefrontSlug,
      policySnapshotId,
      paymentMethodId,
      principalId,
      membershipId,
      todayStart: today.rows[0]?.today_start ?? new Date(),
    };
  });
}

function plus(base: Date, hours: number): string {
  return new Date(base.getTime() + hours * 60 * 60 * 1_000).toISOString();
}

async function insertFitting(
  seed: Seed,
  input: { startsAt: string; endsAt: string; guaranteed?: boolean; feeMinor?: number },
): Promise<string> {
  return withAdmin(async (client) => {
    await client.query('BEGIN');
    try {
      const fittingId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO fitting_appointment
               (tenant_id,branch_id,customer_id,booking_channel,status,period,timezone_snapshot,
                currency,fee_minor,business_key,version)
             VALUES ($1,$2,$3,'staff','pending',tstzrange($4::timestamptz,$5::timestamptz,'[)'),
                     'UTC','PHP',$6,$7,1) RETURNING id`,
            [
              seed.tenantId,
              seed.branchId,
              seed.customerId,
              input.startsAt,
              input.endsAt,
              input.feeMinor ?? 0,
              `be8-fitting:${randomUUID()}`,
            ],
          )
        ).rows,
        'fitting',
      );
      const lineId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO fitting_line
               (tenant_id,fitting_id,variant_id,asset_id,garment_guaranteed)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [
              seed.tenantId,
              fittingId,
              seed.variantId,
              input.guaranteed ? seed.assetId : null,
              input.guaranteed ?? false,
            ],
          )
        ).rows,
        'fitting line',
      );
      await client.query(
        `INSERT INTO fitting_slot_allocation
           (tenant_id,slot_id,fitting_id,period,is_blocking)
         VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'),true)`,
        [seed.tenantId, seed.slotId, fittingId, input.startsAt, input.endsAt],
      );
      if (input.guaranteed) {
        await client.query(
          `INSERT INTO asset_allocation
             (tenant_id,branch_id,asset_id,fitting_line_id,kind,period,is_blocking)
           VALUES ($1,$2,$3,$4,'fitting',tstzrange($5::timestamptz,$6::timestamptz,'[)'),true)`,
          [seed.tenantId, seed.branchId, seed.assetId, lineId, input.startsAt, input.endsAt],
        );
      }
      if ((input.feeMinor ?? 0) > 0) {
        await client.query(
          `INSERT INTO charge (tenant_id,fitting_id,kind,amount_minor,currency,business_key)
           VALUES ($1,$2,'fitting_fee',$3,'PHP',$4)`,
          [seed.tenantId, fittingId, input.feeMinor, `be8-charge:${fittingId}`],
        );
      }
      await client.query('COMMIT');
      return fittingId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function insertReservation(
  seed: Seed,
  input: { pickupAt: string; dueAt: string; withPayment?: boolean },
): Promise<{ reservationId: string; paymentId: string | null }> {
  return withAdmin(async (client) => {
    const reservationId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO reservation
             (tenant_id,branch_id,customer_id,storefront_id,policy_snapshot_id,payment_method_id,
              reference_code,status,pickup_at,due_at,timezone_snapshot,customer_snapshot,
              delivery_snapshot,price_snapshot,currency,rental_total_minor,security_required_minor,due_now_minor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8::timestamptz,$9::timestamptz,'UTC',
                   $10::jsonb,'{"fulfillment_method":"pickup"}'::jsonb,
                   '{"rental_total_minor":"1000","security_required_minor":"0","due_now_minor":"1000","currency":"PHP"}'::jsonb,
                   'PHP',1000,0,1000) RETURNING id`,
          [
            seed.tenantId,
            seed.branchId,
            seed.customerId,
            seed.storefrontId,
            seed.policySnapshotId,
            seed.paymentMethodId,
            `BE8-${randomUUID().slice(0, 8)}`,
            input.pickupAt,
            input.dueAt,
            JSON.stringify({ full_name: 'BE8 Customer', email: 'be8@example.test', phone: null }),
          ],
        )
      ).rows,
      'reservation',
    );
    await client.query(
      `INSERT INTO reservation_line
         (tenant_id,reservation_id,variant_id,line_number,name_snapshot,measurements_snapshot,
          pricing_snapshot,rental_minor,deposit_minor,currency)
       VALUES ($1,$2,$3,1,'BE8 Gown','{}','{"rental_minor":"1000","deposit_minor":"0","currency":"PHP"}',1000,0,'PHP')`,
      [seed.tenantId, reservationId, seed.variantId],
    );
    let paymentId: string | null = null;
    if (input.withPayment) {
      paymentId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO payment
               (tenant_id,reservation_id,payment_method_id,amount_minor,currency,status,business_key)
             VALUES ($1,$2,$3,1000,'PHP','pending',$4) RETURNING id`,
            [
              seed.tenantId,
              reservationId,
              seed.paymentMethodId,
              `be8-rsv-payment:${reservationId}`,
            ],
          )
        ).rows,
        'reservation payment',
      );
    }
    return { reservationId, paymentId };
  });
}

describe('FIT-BE-080..083 cross-product integration', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { getOperationalCalendar, getDashboardFittingSummary } =
    await import('../../src/modules/operations/operations.service.js');
  const { getFittingDetail } = await import('../../src/modules/fittings/fittings.service.js');
  const { getCentralPayments } = await import('../../src/modules/payments/payments.service.js');
  const { computeAvailability } =
    await import('../../src/modules/storefront/storefront.repository.js');

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

  function operationsContext(seed: Seed) {
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      principalId: seed.principalId,
      permissionCodes: ['reservations.manage'] as PermissionCode[],
    };
  }

  it('returns reservation pickup/return and persisted fitting events from one bounded Calendar projection', async () => {
    const seed = await seedWorkspace('calendar');
    const fittingId = await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 10),
      endsAt: plus(seed.todayStart, 11),
    });
    const reservation = await insertReservation(seed, {
      pickupAt: plus(seed.todayStart, 12),
      dueAt: plus(seed.todayStart, 36),
    });
    await withAdmin(async (client) => {
      await client.query(`UPDATE customer SET full_name = 'Live Customer Changed' WHERE id = $1`, [
        seed.customerId,
      ]);
    });

    const calendar = await getOperationalCalendar(operationsContext(seed), {
      start: seed.todayStart.toISOString(),
      end: plus(seed.todayStart, 48),
    });
    expect(calendar.truncated).toBe(false);
    expect(calendar.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'fitting',
          source_id: fittingId,
          event_type: 'fitting',
          status: 'pending',
          period: {
            start: plus(seed.todayStart, 10),
            end: plus(seed.todayStart, 11),
          },
        }),
        expect.objectContaining({
          source: 'reservation',
          source_id: reservation.reservationId,
          event_type: 'pickup',
          status: 'confirmed',
          period: {
            start: plus(seed.todayStart, 12),
            end: plus(seed.todayStart, 12.5),
          },
        }),
        expect.objectContaining({
          source: 'reservation',
          source_id: reservation.reservationId,
          event_type: 'return',
          status: 'confirmed',
          period: {
            start: plus(seed.todayStart, 36),
            end: plus(seed.todayStart, 36.5),
          },
        }),
      ]),
    );
    expect(
      calendar.events
        .filter((event) => event.source === 'reservation')
        .every((event) => event.customer_name === 'BE8 Customer'),
    ).toBe(true);
    expect(
      calendar.events
        .filter((event) => event.source === 'fitting')
        .every((event) => event.customer_name === 'Live Customer Changed'),
    ).toBe(true);

    await expect(
      getOperationalCalendar(operationsContext(seed), {
        start: seed.todayStart.toISOString(),
        end: plus(seed.todayStart, 63 * 24),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('returns tenant-scoped category facets and category IDs for calendar event items', async () => {
    const seed = await seedWorkspace('calendar-category-filter');
    const foreignSeed = await seedWorkspace('calendar-category-foreign');
    const category = await withAdmin(async (client) => {
      const id = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO category (tenant_id,name,status,display_order)
             VALUES ($1,'Evening Wear','active',0) RETURNING id`,
            [seed.tenantId],
          )
        ).rows,
        'calendar category',
      );
      await client.query(
        `UPDATE product p
            SET category_id = $2
           FROM product_variant pv
          WHERE p.tenant_id = $1
            AND p.id = pv.product_id
            AND pv.tenant_id = p.tenant_id
            AND pv.id = $3`,
        [seed.tenantId, id, seed.variantId],
      );
      await client.query(
        `INSERT INTO category (tenant_id,name,status,display_order)
         VALUES ($1,'Foreign Category','active',0)`,
        [foreignSeed.tenantId],
      );
      return id;
    });
    const fittingId = await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 10),
      endsAt: plus(seed.todayStart, 11),
    });
    const reservation = await insertReservation(seed, {
      pickupAt: plus(seed.todayStart, 12),
      dueAt: plus(seed.todayStart, 36),
    });

    const calendar = await getOperationalCalendar(operationsContext(seed), {
      start: seed.todayStart.toISOString(),
      end: plus(seed.todayStart, 48),
    });

    expect(calendar.categories).toContainEqual({
      id: category,
      name: 'Evening Wear',
      status: 'active',
    });
    expect(calendar.categories.some((item) => item.name === 'Foreign Category')).toBe(false);
    expect(
      calendar.events.find((event) => event.source === 'fitting' && event.source_id === fittingId)
        ?.category_ids,
    ).toContain(category);
    expect(
      calendar.events.find(
        (event) => event.source === 'reservation' && event.source_id === reservation.reservationId,
      )?.category_ids,
    ).toContain(category);
  });

  it('projects every eligible reservation state once and conceals excluded states', async () => {
    const seed = await seedWorkspace('calendar-reservation-states');
    const eligibleStatuses = [
      'pending_confirmation',
      'confirmed',
      'picked_up',
      'returned',
      'completed',
    ] as const;
    const excludedStatuses = ['held', 'cancelled', 'expired', 'rejected'] as const;
    const eligibleIds: string[] = [];
    const excludedIds: string[] = [];

    for (const status of eligibleStatuses) {
      const reservation = await insertReservation(seed, {
        pickupAt: plus(seed.todayStart, 12),
        dueAt: plus(seed.todayStart, 36),
      });
      eligibleIds.push(reservation.reservationId);
      await withAdmin(async (client) => {
        await client.query('UPDATE reservation SET status = $1 WHERE id = $2', [
          status,
          reservation.reservationId,
        ]);
      });
    }
    for (const status of excludedStatuses) {
      const reservation = await insertReservation(seed, {
        pickupAt: plus(seed.todayStart, 12),
        dueAt: plus(seed.todayStart, 36),
      });
      excludedIds.push(reservation.reservationId);
      await withAdmin(async (client) => {
        await client.query('UPDATE reservation SET status = $1 WHERE id = $2', [
          status,
          reservation.reservationId,
        ]);
      });
    }

    const calendar = await getOperationalCalendar(operationsContext(seed), {
      start: seed.todayStart.toISOString(),
      end: plus(seed.todayStart, 48),
    });
    const reservationEvents = calendar.events.filter((event) => event.source === 'reservation');

    expect(reservationEvents).toHaveLength(eligibleIds.length * 2);
    for (const reservationId of eligibleIds) {
      expect(reservationEvents.filter((event) => event.source_id === reservationId)).toHaveLength(2);
    }
    for (const reservationId of excludedIds) {
      expect(reservationEvents.some((event) => event.source_id === reservationId)).toBe(false);
    }
  });

  it('preserves event identity across a branch-local midnight boundary', async () => {
    const seed = await seedWorkspace('calendar-midnight');
    await withAdmin(async (client) => {
      await client.query(`UPDATE branch SET timezone = 'Asia/Manila' WHERE id = $1`, [seed.branchId]);
    });
    const reservation = await insertReservation(seed, {
      pickupAt: '2026-09-27T00:15:00+08:00',
      dueAt: '2026-09-27T23:45:00+08:00',
    });

    const calendar = await getOperationalCalendar(operationsContext(seed), {
      start: '2026-09-26T16:00:00.000Z',
      end: '2026-09-27T16:00:00.000Z',
    });
    const events = calendar.events.filter((event) => event.source_id === reservation.reservationId);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.event_type)).toEqual(['pickup', 'return']);
    expect(events[0]?.period.start).toBe('2026-09-26T16:15:00.000Z');
    expect(events[1]?.period.start).toBe('2026-09-27T15:45:00.000Z');
  });

  it('projects every eligible fitting state once and excludes terminal appointments', async () => {
    const seed = await seedWorkspace('calendar-fitting-states');
    const eligibleStatuses = ['pending', 'confirmed', 'completed', 'no_show'] as const;
    const excludedStatuses = ['cancelled', 'rejected'] as const;
    const eligibleIds: string[] = [];
    const excludedIds: string[] = [];

    for (const [index, status] of eligibleStatuses.entries()) {
      const fittingId = await insertFitting(seed, {
        startsAt: plus(seed.todayStart, 12 + index * 2),
        endsAt: plus(seed.todayStart, 13 + index * 2),
      });
      eligibleIds.push(fittingId);
      await withAdmin(async (client) => {
        await client.query('BEGIN');
        try {
          if (status === 'completed' || status === 'no_show') {
            await client.query('UPDATE fitting_appointment SET status = $1 WHERE id = $2', [
              'confirmed',
              fittingId,
            ]);
            await client.query(
              `DELETE FROM asset_allocation
                WHERE fitting_line_id IN (SELECT id FROM fitting_line WHERE fitting_id = $1)`,
              [fittingId],
            );
            await client.query('DELETE FROM fitting_slot_allocation WHERE fitting_id = $1', [fittingId]);
          }
          await client.query('UPDATE fitting_appointment SET status = $1 WHERE id = $2', [
            status,
            fittingId,
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    }
    for (const [index, status] of excludedStatuses.entries()) {
      const fittingId = await insertFitting(seed, {
        startsAt: plus(seed.todayStart, 30 + index * 2),
        endsAt: plus(seed.todayStart, 31 + index * 2),
      });
      excludedIds.push(fittingId);
      await withAdmin(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `DELETE FROM asset_allocation
              WHERE fitting_line_id IN (SELECT id FROM fitting_line WHERE fitting_id = $1)`,
            [fittingId],
          );
          await client.query('DELETE FROM fitting_slot_allocation WHERE fitting_id = $1', [fittingId]);
          await client.query(
            `UPDATE fitting_appointment
                SET status = $1, terminal_reason = 'calendar integration test'
              WHERE id = $2`,
            [status, fittingId],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    }

    const calendar = await getOperationalCalendar(operationsContext(seed), {
      start: seed.todayStart.toISOString(),
      end: plus(seed.todayStart, 48),
    });
    const fittingEvents = calendar.events.filter((event) => event.source === 'fitting');

    expect(fittingEvents).toHaveLength(eligibleIds.length);
    for (const fittingId of eligibleIds) {
      expect(fittingEvents.filter((event) => event.source_id === fittingId)).toHaveLength(1);
    }
    for (const fittingId of excludedIds) {
      expect(fittingEvents.some((event) => event.source_id === fittingId)).toBe(false);
    }
  });

  it('keeps Calendar fitting identity aligned with the production fitting detail', async () => {
    const seed = await seedWorkspace('calendar-fitting-detail');
    const fittingId = await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 10),
      endsAt: plus(seed.todayStart, 12),
      guaranteed: false,
    });
    await withAdmin(async (client) => {
      await client.query(`UPDATE fitting_appointment SET timezone_snapshot = 'Asia/Manila' WHERE id = $1`, [
        fittingId,
      ]);
    });
    const calendar = await getOperationalCalendar(operationsContext(seed), {
      start: seed.todayStart.toISOString(),
      end: plus(seed.todayStart, 24),
    });
    const event = calendar.events.find((candidate) => candidate.source_id === fittingId);
    expect(event).toBeDefined();

    const detail = await getFittingDetail({
      ...operationsContext(seed),
      membershipId: seed.membershipId,
      effectiveTenantStatus: 'active',
    }, fittingId);
    expect(event).toMatchObject({
      source: 'fitting',
      source_id: detail.id,
      status: detail.status,
      period: detail.period,
      customer_name: detail.customer.full_name,
      item_names: [detail.garments[0]?.variant.product_name],
    });
    expect(detail.garments[0]?.garment_mode).toBe('preference');
    expect(detail.garments[0]?.assigned_asset).toBeNull();
  });

  it('keeps Calendar ordering stable and isolates tenants and active branches', async () => {
    const seed = await seedWorkspace('calendar-ordering');
    const foreignTenant = await seedWorkspace('calendar-foreign-tenant');
    const reservation = await insertReservation(seed, {
      pickupAt: plus(seed.todayStart, 12),
      dueAt: plus(seed.todayStart, 36),
    });
    const fitting = await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 12),
      endsAt: plus(seed.todayStart, 13),
      guaranteed: false,
    });
    const foreignFitting = await insertFitting(foreignTenant, {
      startsAt: plus(foreignTenant.todayStart, 12),
      endsAt: plus(foreignTenant.todayStart, 13),
      guaranteed: false,
    });

    const secondaryBranch = await withAdmin(async (client) => {
      const branchId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO branch (tenant_id,name,code,is_default,timezone,status)
             VALUES ($1,'Secondary','SECONDARY',false,'UTC','active') RETURNING id`,
            [seed.tenantId],
          )
        ).rows,
        'secondary branch',
      );
      await client.query(
        `INSERT INTO fitting_settings
           (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
         VALUES ($1,$2,true,1,60,0,'PHP',1)`,
        [seed.tenantId, branchId],
      );
      const slotId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO fitting_capacity_slot (tenant_id,branch_id,slot_number,active)
             VALUES ($1,$2,1,true) RETURNING id`,
            [seed.tenantId, branchId],
          )
        ).rows,
        'secondary slot',
      );
      return { branchId, slotId };
    });
    const secondaryBranchFitting = await insertFitting(
      { ...seed, branchId: secondaryBranch.branchId, slotId: secondaryBranch.slotId },
      { startsAt: plus(seed.todayStart, 12), endsAt: plus(seed.todayStart, 13), guaranteed: false },
    );

    const query = { start: seed.todayStart.toISOString(), end: plus(seed.todayStart, 48) };
    const first = await getOperationalCalendar(operationsContext(seed), query);
    const second = await getOperationalCalendar(operationsContext(seed), query);

    expect(first.events.map((event) => event.id)).toEqual(second.events.map((event) => event.id));
    expect(first.events.filter((event) => event.source_id === reservation.reservationId)).toHaveLength(2);
    expect(first.events.filter((event) => event.source_id === fitting)).toHaveLength(1);
    expect(first.events.some((event) => event.source_id === foreignFitting)).toBe(false);
    expect(first.events.some((event) => event.source_id === secondaryBranchFitting)).toBe(false);
  });

  it('fails closed when the operational reservation-read permission is absent', async () => {
    const seed = await seedWorkspace('calendar-permission');
    await expect(
      getOperationalCalendar(
        { ...operationsContext(seed), permissionCodes: [] },
        { start: seed.todayStart.toISOString(), end: plus(seed.todayStart, 24) },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('derives bounded Dashboard fitting today/upcoming/pending-review counts from authoritative appointments', async () => {
    const seed = await seedWorkspace('dashboard');
    await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 10),
      endsAt: plus(seed.todayStart, 11),
    });
    await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 34),
      endsAt: plus(seed.todayStart, 35),
    });

    const summary = await getDashboardFittingSummary(operationsContext(seed));
    expect(summary.fittings_today).toBe(1);
    expect(summary.fittings_upcoming).toBe(1);
    expect(summary.fittings_pending_review).toBeGreaterThanOrEqual(1);
    expect(Date.parse(summary.window.upcoming_end) - Date.parse(summary.window.today_start)).toBe(
      8 * 24 * 60 * 60 * 1_000,
    );
  });

  it('keeps preference-only fittings out of garment availability while guaranteed allocations block with a public-safe fitting reason', async () => {
    const seed = await seedWorkspace('availability');
    await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 10),
      endsAt: plus(seed.todayStart, 11),
      guaranteed: false,
    });
    await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 34),
      endsAt: plus(seed.todayStart, 35),
      guaranteed: true,
    });

    const slots = await computeAvailability(
      seed.storefrontSlug,
      seed.variantId,
      seed.todayStart.toISOString(),
      plus(seed.todayStart, 48),
    );
    expect(slots).not.toBeNull();
    if (!slots) throw new Error('Expected public availability slots.');
    expect(slots[0]).toMatchObject({ available_units: 1, blocking_reasons: [] });
    expect(slots[1]).toMatchObject({ available_units: 0 });
    expect(slots[1]?.blocking_reasons).toContain('fitting');
    expect(JSON.stringify(slots)).not.toContain('BE8 Customer');
  });

  it('central Payments distinguishes reservation and fitting finance without exposing evidence objects', async () => {
    const seed = await seedWorkspace('payments');
    const reservation = await insertReservation(seed, {
      pickupAt: plus(seed.todayStart, 12),
      dueAt: plus(seed.todayStart, 36),
      withPayment: true,
    });
    const fittingId = await insertFitting(seed, {
      startsAt: plus(seed.todayStart, 58),
      endsAt: plus(seed.todayStart, 59),
      feeMinor: 500,
    });
    const fittingPaymentId = await withAdmin(async (client) =>
      requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO payment
               (tenant_id,fitting_id,payment_method_id,amount_minor,currency,status,business_key)
             VALUES ($1,$2,$3,500,'PHP','pending',$4) RETURNING id`,
            [seed.tenantId, fittingId, seed.paymentMethodId, `be8-fit-payment:${fittingId}`],
          )
        ).rows,
        'fitting payment',
      ),
    );

    const payments = await getCentralPayments(
      {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        principalId: seed.principalId,
        permissionCodes: ['payments.view'],
      },
      {
        start: plus(seed.todayStart, -24),
        end: plus(seed.todayStart, 24),
        limit: 50,
      },
    );
    expect(payments.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reservation.paymentId,
          source: 'reservation',
          reservation_id: reservation.reservationId,
          fitting_id: null,
        }),
        expect.objectContaining({
          id: fittingPaymentId,
          source: 'fitting',
          reservation_id: null,
          fitting_id: fittingId,
        }),
      ]),
    );
    expect(JSON.stringify(payments)).not.toContain('file_id');
    expect(JSON.stringify(payments)).not.toContain('storage_key');

    await expect(
      getCentralPayments(
        {
          tenantId: seed.tenantId,
          branchId: seed.branchId,
          principalId: seed.principalId,
          permissionCodes: [],
        },
        { start: plus(seed.todayStart, -24), end: plus(seed.todayStart, 24), limit: 50 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
