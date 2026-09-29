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
process.env.DATABASE_POOL_MAX = '1';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

interface Seed {
  tenantId: string;
  fittingId: string;
  customerId: string;
  paymentId: string;
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

async function seedTenant(label: string): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_${suffix}`, suffix, `pool-${suffix}`],
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
    const membershipId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO membership (tenant_id,clerk_user_id,role,status)
           VALUES ($1,$2,'owner','active') RETURNING id`,
          [tenantId, `user_${suffix}`],
        )
      ).rows,
      'membership',
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,$2,$3) RETURNING id`,
          [tenantId, `Customer ${suffix}`, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Pool Gown','active') RETURNING id`,
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
       VALUES ($1,$2,true,1,60,500,'PHP',1)`,
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
      'slot',
    );
    await client.query('BEGIN');
    let fittingId: string;
    try {
      fittingId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO fitting_appointment
               (tenant_id,branch_id,customer_id,booking_channel,status,period,timezone_snapshot,
                currency,fee_minor,business_key,version)
             VALUES ($1,$2,$3,'staff','pending',
                     tstzrange('2099-01-05T02:00:00Z','2099-01-05T03:00:00Z','[)'),
                     'Asia/Manila','PHP',500,$4,1) RETURNING id`,
            [tenantId, branchId, customerId, `fit:${suffix}`],
          )
        ).rows,
        'fitting',
      );
      await client.query(
        `INSERT INTO fitting_line (tenant_id,fitting_id,variant_id,garment_guaranteed)
         VALUES ($1,$2,$3,false)`,
        [tenantId, fittingId, variantId],
      );
      await client.query(
        `INSERT INTO fitting_slot_allocation (tenant_id,slot_id,fitting_id,period,is_blocking)
         VALUES ($1,$2,$3,tstzrange('2099-01-05T02:00:00Z','2099-01-05T03:00:00Z','[)'),true)`,
        [tenantId, slotId, fittingId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const paymentId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO payment
             (tenant_id,fitting_id,payment_method_id,amount_minor,currency,status,business_key)
           VALUES ($1,$2,$3,500,'PHP','pending',$4) RETURNING id`,
          [tenantId, fittingId, paymentMethodId, `payment:${suffix}`],
        )
      ).rows,
      'payment',
    );
    void membershipId;
    return { tenantId, fittingId, customerId, paymentId };
  });
}

describe('FIT-BE-091 pooled RLS isolation', async () => {
  const { closePool, pool, withTenantTransaction } = await import('../../src/db/client.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('reuses one pooled backend without retaining another tenant context', async () => {
    const tenantA = await seedTenant('a');
    const tenantB = await seedTenant('b');

    const a = await withTenantTransaction(tenantA.tenantId, 'actor-a', async (client) => {
      const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const fitting = await client.query<{ id: string }>('SELECT id FROM fitting_appointment');
      const customer = await client.query<{ id: string }>('SELECT id FROM customer');
      const payment = await client.query<{ id: string }>('SELECT id FROM payment');
      return {
        pid: pid.rows[0]?.pid,
        fitting: fitting.rows,
        customer: customer.rows,
        payment: payment.rows,
      };
    });
    const b = await withTenantTransaction(tenantB.tenantId, 'actor-b', async (client) => {
      const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const fitting = await client.query<{ id: string }>('SELECT id FROM fitting_appointment');
      const customer = await client.query<{ id: string }>('SELECT id FROM customer');
      const payment = await client.query<{ id: string }>('SELECT id FROM payment');
      return {
        pid: pid.rows[0]?.pid,
        fitting: fitting.rows,
        customer: customer.rows,
        payment: payment.rows,
      };
    });

    expect(a.pid).toBe(b.pid);
    expect(a.fitting).toEqual([{ id: tenantA.fittingId }]);
    expect(a.customer).toEqual([{ id: tenantA.customerId }]);
    expect(a.payment).toEqual([{ id: tenantA.paymentId }]);
    expect(b.fitting).toEqual([{ id: tenantB.fittingId }]);
    expect(b.customer).toEqual([{ id: tenantB.customerId }]);
    expect(b.payment).toEqual([{ id: tenantB.paymentId }]);
  });

  it('fails closed with missing/empty tenant context and after a rollback on the reused connection', async () => {
    const tenantA = await seedTenant('rollback-a');
    const tenantB = await seedTenant('rollback-b');

    await expect(
      withTenantTransaction(tenantA.tenantId, 'actor-a', async (client) => {
        const rows = await client.query('SELECT id FROM fitting_appointment');
        expect(rows.rowCount).toBe(1);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const raw = await pool.connect();
    try {
      const tenantSetting = await raw.query<{ tenant: string | null }>(
        `SELECT nullif(current_setting('app.tenant_id', true),'') AS tenant`,
      );
      expect(tenantSetting.rows[0]?.tenant ?? null).toBeNull();
      expect((await raw.query('SELECT id FROM fitting_appointment')).rowCount).toBe(0);
      expect((await raw.query('SELECT id FROM customer')).rowCount).toBe(0);
      expect((await raw.query('SELECT id FROM payment')).rowCount).toBe(0);
    } finally {
      raw.release();
    }

    const bRows = await withTenantTransaction(tenantB.tenantId, 'actor-b', async (client) => ({
      fitting: (await client.query<{ id: string }>('SELECT id FROM fitting_appointment')).rows,
      customer: (await client.query<{ id: string }>('SELECT id FROM customer')).rows,
      payment: (await client.query<{ id: string }>('SELECT id FROM payment')).rows,
    }));
    expect(bRows).toEqual({
      fitting: [{ id: tenantB.fittingId }],
      customer: [{ id: tenantB.customerId }],
      payment: [{ id: tenantB.paymentId }],
    });
  });

  it('refuses an empty tenant id at the transaction helper boundary', async () => {
    await expect(withTenantTransaction('', 'actor', () => Promise.resolve(null))).rejects.toThrow(
      'tenantId is required',
    );
  });
});
