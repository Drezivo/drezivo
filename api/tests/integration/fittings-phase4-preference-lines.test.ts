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
process.env.DATABASE_POOL_MAX ??= '10';
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

async function seedPreferenceTenant(label: string): Promise<Seed> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenant (clerk_org_id, name, slug, currency, timezone)
       VALUES ($1, $2, $3, 'PHP', 'Asia/Manila') RETURNING id`,
      [`org_${suffix}`, suffix, `fit-pref-${suffix}`],
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
       VALUES ($1, 'Preference Customer', $2) RETURNING id`,
      [tenantId, `${suffix}@example.test`],
    );
    const customerId = requireId(customer.rows, 'customer');
    const product = await client.query<{ id: string }>(
      `INSERT INTO product (tenant_id, code, name, status)
       VALUES ($1, $2, 'Preference Gown', 'active') RETURNING id`,
      [tenantId, `P-${suffix}`],
    );
    const variant = await client.query<{ id: string }>(
      `INSERT INTO product_variant
         (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
          measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
          included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
       VALUES ($1, $2, $3, 'M', 'Ivory', '{}', 'cm', 'none', 1000, 0, 'PHP',
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
      `INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
       SELECT $1, $2, weekday, '09:00'::time, '17:00'::time
         FROM generate_series(1, 7) AS weekday`,
      [tenantId, branchId],
    );

    return { tenantId, branchId, customerId, variantId };
  } finally {
    await client.end();
  }
}

describe('FIT-BE-042 preference-only fitting garments', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createStaffFittingCommand } =
    await import('../../src/modules/fittings/fittings.command.service.js');

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

  it('stores a variant preference without any physical asset claim and returns preference semantics', async () => {
    const seed = await seedPreferenceTenant('create');
    const membershipId = randomUUID();
    const response = await createStaffFittingCommand(
      {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        membershipId,
        principalId: `user_${membershipId}`,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
      {
        customer: { source: 'existing', customer_id: seed.customerId as never },
        starts_at: '2099-01-09T02:00:00.000Z',
        garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
      },
    );

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    if (!response.body.success) throw new Error('Expected fitting creation to succeed.');

    const garment = response.body.data.fitting.garments[0];
    expect(garment).toMatchObject({ garment_mode: 'preference', assigned_asset: null });
    expect(garment?.variant.variant_id).toBe(seed.variantId);

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const persisted = await admin.query<{
        garment_guaranteed: boolean;
        asset_id: string | null;
        allocation_count: string;
        physical_asset_count: string;
        capacity_claim_count: string;
      }>(
        `SELECT fl.garment_guaranteed,
                fl.asset_id,
                (SELECT count(*)::text
                   FROM asset_allocation aa
                  WHERE aa.tenant_id = fl.tenant_id
                    AND aa.fitting_line_id = fl.id) AS allocation_count,
                (SELECT count(*)::text
                   FROM physical_asset pa
                  WHERE pa.tenant_id = fl.tenant_id
                    AND pa.variant_id = fl.variant_id) AS physical_asset_count,
                (SELECT count(*)::text
                   FROM fitting_slot_allocation fsa
                  WHERE fsa.tenant_id = fl.tenant_id
                    AND fsa.fitting_id = fl.fitting_id
                    AND fsa.is_blocking) AS capacity_claim_count
           FROM fitting_line fl
          WHERE fl.tenant_id = $1
            AND fl.fitting_id = $2::uuid`,
        [seed.tenantId, response.body.data.fitting.id],
      );
      expect(persisted.rows).toEqual([
        {
          garment_guaranteed: false,
          asset_id: null,
          allocation_count: '0',
          physical_asset_count: '0',
          capacity_claim_count: '1',
        },
      ]);
    } finally {
      await admin.end();
    }
  });

  it('persists optional address and social media for a new fitting walk-in and returns them only in detail', async () => {
    const seed = await seedPreferenceTenant('walk-in-profile');
    const membershipId = randomUUID();
    const response = await createStaffFittingCommand(
      {
        tenantId: seed.tenantId,
        branchId: seed.branchId,
        membershipId,
        principalId: `user_${membershipId}`,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
      {
        customer: {
          source: 'new',
          customer: {
            full_name: 'Walk-in Profile Customer',
            phone: '09175550002',
            address: '789 Fitting Street, Quezon City',
            social_media: '@fittingcustomer',
          },
        },
        starts_at: '2099-01-09T02:00:00.000Z',
        garments: [{ variant_id: seed.variantId as never, garment_mode: 'preference' }],
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        fitting: {
          customer: {
            full_name: 'Walk-in Profile Customer',
            address: '789 Fitting Street, Quezon City',
            social_media: '@fittingcustomer',
          },
        },
      },
    });
    if (!response.body.success) throw new Error('Expected fitting creation to succeed.');

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const customer = await admin.query<{ address: string | null; social_media: string | null }>(
        `SELECT c.address, c.social_media
           FROM customer c
           JOIN fitting_appointment f ON f.tenant_id = c.tenant_id AND f.customer_id = c.id
          WHERE f.tenant_id = $1 AND f.id = $2`,
        [seed.tenantId, response.body.data.fitting.id],
      );
      expect(customer.rows).toEqual([
        { address: '789 Fitting Street, Quezon City', social_media: '@fittingcustomer' },
      ]);
    } finally {
      await admin.end();
    }
  });
});
