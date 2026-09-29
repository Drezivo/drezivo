import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX = '2';
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
  clerkOrgId: string;
  principalId: string;
  membershipId: string;
  branchId: string;
  customerId: string;
  variantId: string;
  cashMethodId: string;
  completedFittingId: string;
}

interface ErrorBody {
  error: { code: string };
}

interface CreatedFittingBody {
  data: { fitting: { id: string; internal_note: string | null } };
}

interface UpdatedSettingsBody {
  data: { settings: { capacity: number } };
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
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

async function seedWorkspace(
  label: string,
  role: 'owner' | 'frontdesk',
  permissions: PermissionCode[],
): Promise<Seed> {
  return withAdmin(async (client) => {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const clerkOrgId = `org_${suffix}`;
    const principalId = `user_${suffix}`;
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [clerkOrgId, suffix, `fit9-${suffix}`],
        )
      ).rows,
      'tenant',
    );
    const branchId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id,name,code,is_default,timezone,status)
           VALUES ($1,'Main','MAIN',true,'Asia/Manila','active') RETURNING id`,
          [tenantId],
        )
      ).rows,
      'branch',
    );
    const membershipId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO membership (tenant_id,clerk_user_id,role,status)
           VALUES ($1,$2,$3,'active') RETURNING id`,
          [tenantId, principalId, role],
        )
      ).rows,
      'membership',
    );
    await client.query(
      `INSERT INTO branch_membership (tenant_id,branch_id,membership_id,permission_codes)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [tenantId, branchId, membershipId, JSON.stringify(permissions)],
    );
    const plan = await client.query<{ id: string }>(
      `SELECT id FROM plan WHERE code='starter' AND version=1 AND active=true LIMIT 1`,
    );
    await client.query(
      `INSERT INTO subscription (tenant_id,plan_id,status,current_period_start,current_period_end)
       VALUES ($1,$2,'active',now(),now()+interval '30 days')`,
      [tenantId, requireId(plan.rows, 'starter plan')],
    );
    const customerId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id,full_name,email)
           VALUES ($1,'Security Customer',$2) RETURNING id`,
          [tenantId, `${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Security Gown','active') RETURNING id`,
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
      'cash method',
    );
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,2,60,500,'PHP',1)`,
      [tenantId, branchId],
    );
    await client.query(
      `INSERT INTO fitting_hours (tenant_id,branch_id,weekday,starts_local,ends_local)
       SELECT $1,$2,weekday,'09:00'::time,'17:00'::time FROM generate_series(1,7) weekday`,
      [tenantId, branchId],
    );
    await client.query('BEGIN');
    let completedFittingId: string;
    try {
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
      completedFittingId = requireId(
        (
          await client.query<{ id: string }>(
            `INSERT INTO fitting_appointment
               (tenant_id,branch_id,customer_id,booking_channel,status,period,timezone_snapshot,
                currency,fee_minor,business_key,version)
             VALUES ($1,$2,$3,'staff','pending',
                     tstzrange('2099-01-06T02:00:00Z','2099-01-06T03:00:00Z','[)'),
                     'Asia/Manila','PHP',0,$4,1)
             RETURNING id`,
            [tenantId, branchId, customerId, `seed:${suffix}`],
          )
        ).rows,
        'seed fitting',
      );
      await client.query(
        `INSERT INTO fitting_line (tenant_id,fitting_id,variant_id,garment_guaranteed)
         VALUES ($1,$2,$3,false)`,
        [tenantId, completedFittingId, variantId],
      );
      await client.query(
        `INSERT INTO fitting_slot_allocation (tenant_id,slot_id,fitting_id,period,is_blocking)
         VALUES ($1,$2,$3,tstzrange('2099-01-06T02:00:00Z','2099-01-06T03:00:00Z','[)'),true)`,
        [tenantId, slotId, completedFittingId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return {
      tenantId,
      clerkOrgId,
      principalId,
      membershipId,
      branchId,
      customerId,
      variantId,
      cashMethodId,
      completedFittingId,
    };
  });
}

function useClerk(seed: Pick<Seed, 'principalId' | 'clerkOrgId'>): void {
  clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
}

describe('FIT-BE-090 fitting HTTP authorization matrix', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createApp } = await import('../../src/app.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('allows Front Desk operational create/note while denying configuration mutation', async () => {
    const seed = await seedWorkspace('frontdesk', 'frontdesk', ['reservations.manage']);
    useClerk(seed);
    const app = createApp();

    const list = await request(app).get('/api/v1/fittings');
    expect(list.status).toBe(200);

    const created = await request(app)
      .post('/api/v1/fittings')
      .set('Idempotency-Key', `fit9-create-${randomUUID()}`)
      .send({
        customer: { source: 'existing', customer_id: seed.customerId },
        starts_at: '2099-01-05T02:00:00.000Z',
        garments: [{ variant_id: seed.variantId, garment_mode: 'preference' }],
      });
    expect(created.status).toBe(201);
    const fittingId = responseBody<CreatedFittingBody>(created).data.fitting.id;

    const noted = await request(app)
      .patch(`/api/v1/fittings/${fittingId}/note`)
      .set('Idempotency-Key', `fit9-note-${randomUUID()}`)
      .send({ version: 1, internal_note: 'Bounded staff note.' });
    expect(noted.status).toBe(200);
    expect(responseBody<CreatedFittingBody>(noted).data.fitting.internal_note).toBe(
      'Bounded staff note.',
    );

    const settingsDenied = await request(app)
      .put('/api/v1/fittings/settings')
      .set('Idempotency-Key', `fit9-settings-${randomUUID()}`)
      .send({ version: 1, enabled: true, capacity: 2, duration_minutes: 60, fee_minor: '500' });
    expect(settingsDenied.status).toBe(403);
    expect(responseBody<ErrorBody>(settingsDenied).error.code).toBe('FORBIDDEN');
  });

  it('allows Owner configuration mutation but fitting access alone cannot verify payments', async () => {
    const seed = await seedWorkspace('owner', 'owner', ['reservations.manage']);
    useClerk(seed);
    const app = createApp();

    const updated = await request(app)
      .put('/api/v1/fittings/settings')
      .set('Idempotency-Key', `fit9-settings-${randomUUID()}`)
      .send({ version: 1, enabled: true, capacity: 3, duration_minutes: 60, fee_minor: '500' });
    expect(updated.status).toBe(200);
    expect(responseBody<UpdatedSettingsBody>(updated).data.settings.capacity).toBe(3);

    const verifyDenied = await request(app)
      .post(`/api/v1/fittings/${seed.completedFittingId}/verify-payment`)
      .set('Idempotency-Key', `fit9-verify-${randomUUID()}`)
      .send({ verified_amount_minor: '500' });
    expect(verifyDenied.status).toBe(403);
    expect(responseBody<ErrorBody>(verifyDenied).error.code).toBe('FORBIDDEN');
  });

  it('conceals cross-tenant fitting IDs and rejects removed memberships before data access', async () => {
    const actor = await seedWorkspace('actor', 'owner', ['reservations.manage']);
    const foreign = await seedWorkspace('foreign', 'owner', ['reservations.manage']);
    useClerk(actor);
    const app = createApp();

    const concealed = await request(app).get(`/api/v1/fittings/${foreign.completedFittingId}`);
    expect(concealed.status).toBe(404);
    expect(responseBody<ErrorBody>(concealed).error.code).toBe('NOT_FOUND');

    await withAdmin(async (client) => {
      await client.query(`UPDATE membership SET status='removed' WHERE id=$1`, [
        actor.membershipId,
      ]);
    });
    useClerk(actor);
    const removed = await request(app).get('/api/v1/fittings');
    expect(removed.status).toBe(403);
    expect(responseBody<ErrorBody>(removed).error.code).toBe('FORBIDDEN');

    useClerk(actor);
    const customerLookup = await request(app).get(
      '/api/v1/fittings/intake-options?customer_search=Security',
    );
    expect(customerLookup.status).toBe(403);

    useClerk(actor);
    const payments = await request(app).get(
      '/api/v1/payments?start=2026-09-01T00:00:00.000Z&end=2026-09-02T00:00:00.000Z',
    );
    expect(payments.status).toBe(403);
  });

  it('excludes archived customers from fitting intake and existing-customer creation', async () => {
    const seed = await seedWorkspace('archived-intake', 'frontdesk', ['reservations.manage']);
    useClerk(seed);
    const app = createApp();

    await withAdmin(async (client) => {
      await client.query(`UPDATE customer SET archived_at = now() WHERE tenant_id = $1 AND id = $2`, [
        seed.tenantId,
        seed.customerId,
      ]);
    });

    const lookup = await request(app)
      .get('/api/v1/fittings/intake-options')
      .query({ customer_search: 'Security' });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({ data: { customers: [] } });

    const create = await request(app)
      .post('/api/v1/fittings')
      .set('Idempotency-Key', `fit9-archived-${randomUUID()}`)
      .send({
        customer: { source: 'existing', customer_id: seed.customerId },
        starts_at: '2099-01-05T02:00:00.000Z',
        garments: [{ variant_id: seed.variantId, garment_mode: 'preference' }],
      });
    expect(create.status).toBe(404);
    expect(responseBody<ErrorBody>(create).error.code).toBe('NOT_FOUND');
  });

  it('keeps existing fitting details readable after customer archive', async () => {
    const seed = await seedWorkspace('archived-history', 'frontdesk', ['reservations.manage']);
    useClerk(seed);
    await withAdmin(async (client) => {
      await client.query(`UPDATE customer SET archived_at = now() WHERE tenant_id = $1 AND id = $2`, [
        seed.tenantId,
        seed.customerId,
      ]);
    });

    const detail = await request(createApp()).get(`/api/v1/fittings/${seed.completedFittingId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toHaveProperty('data');
  });

  it('requires authentication and a valid branch operational grant on every fitting route', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp()).get('/api/v1/fittings');
    expect(unauthenticated.status).toBe(401);

    const seed = await seedWorkspace('nogrant', 'frontdesk', []);
    useClerk(seed);
    const forbidden = await request(createApp()).get('/api/v1/fittings');
    expect(forbidden.status).toBe(403);
    expect(responseBody<ErrorBody>(forbidden).error.code).toBe('FORBIDDEN');
  });
});
