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

interface LoadSeed {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
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

async function seedRepresentativeLoad(count = 3000): Promise<LoadSeed> {
  return withAdmin(async (client) => {
    const suffix = randomUUID().slice(0, 8);
    const tenantId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone)
           VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`,
          [`org_load_${suffix}`, `Load ${suffix}`, `fit9-load-${suffix}`],
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
    const principalId = `user_load_${suffix}`;
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
           VALUES ($1,'Load Customer',$2) RETURNING id`,
          [tenantId, `load-${suffix}@example.test`],
        )
      ).rows,
      'customer',
    );
    const productId = requireId(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id,code,name,status)
           VALUES ($1,$2,'Load Gown','active') RETURNING id`,
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
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version)
       VALUES ($1,$2,true,1,60,0,'PHP',1)`,
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
    try {
      const inserted = await client.query<{ lines: string; allocations: string }>(
        `WITH appointments AS (
           INSERT INTO fitting_appointment
             (id,tenant_id,branch_id,customer_id,booking_channel,status,period,timezone_snapshot,
              currency,fee_minor,business_key,version)
           SELECT gen_random_uuid(),$1,$2,$3,'staff','pending',
                  tstzrange(
                    '2098-01-01T00:00:00Z'::timestamptz + gs * interval '30 minutes',
                    '2098-01-01T00:00:00Z'::timestamptz + (gs + 1) * interval '30 minutes',
                    '[)'
                  ),
                  'Asia/Manila','PHP',0,'load:' || gs::text,1
             FROM generate_series(0,$6::integer - 1) AS gs
           RETURNING id, period
         ),
         lines AS (
           INSERT INTO fitting_line (tenant_id,fitting_id,variant_id,garment_guaranteed)
           SELECT $1,id,$4,false FROM appointments
           RETURNING fitting_id
         ),
         allocations AS (
           INSERT INTO fitting_slot_allocation
             (tenant_id,slot_id,fitting_id,period,is_blocking)
           SELECT $1,$5,id,period,true FROM appointments
           RETURNING fitting_id
         )
         SELECT
           (SELECT count(*)::text FROM lines) AS lines,
           (SELECT count(*)::text FROM allocations) AS allocations`,
        [tenantId, branchId, customerId, variantId, slotId, count],
      );
      expect(inserted.rows[0]).toEqual({ lines: String(count), allocations: String(count) });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    await client.query('ANALYZE fitting_appointment');
    return { tenantId, branchId, membershipId, principalId };
  });
}

describe('FIT-BE-094 representative fitting load and query plans', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getFittingList } = await import('../../src/modules/fittings/fittings.service.js');
  const { getOperationalCalendar } =
    await import('../../src/modules/operations/operations.service.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('serves bounded list/calendar reads over thousands of appointments using the intended indexes', async () => {
    const seed = await seedRepresentativeLoad(3000);
    const readContext = {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: seed.membershipId,
      principalId: seed.principalId,
      permissionCodes: ['reservations.manage' as const],
      effectiveTenantStatus: 'active' as const,
    };

    const scopedCount = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM fitting_appointment
            WHERE tenant_id=$1 AND branch_id=$2`,
          [seed.tenantId, seed.branchId],
        );
        return result.rows[0]?.count ?? '0';
      },
    );
    expect(scopedCount).toBe('3000');

    const list = await getFittingList(readContext, {
      limit: 20,
      sort: 'starts_at_asc',
      period_start: '2098-01-01T00:00:00.000Z',
      period_end: '2098-01-02T00:00:00.000Z',
    });
    expect(list.items).toHaveLength(20);
    expect(list.page_meta.has_more).toBe(true);
    expect(list.page_meta.next_cursor).not.toBeNull();

    const calendar = await getOperationalCalendar(readContext, {
      start: '2098-01-01T00:00:00.000Z',
      end: '2098-01-02T00:00:00.000Z',
    });
    expect(calendar.events).toHaveLength(48);
    expect(calendar.events.every((event) => event.source === 'fitting')).toBe(true);

    const denseCalendar = await getOperationalCalendar(readContext, {
      start: '2098-01-01T00:00:00.000Z',
      end: '2098-03-04T00:00:00.000Z',
    });
    expect(denseCalendar.events).toHaveLength(2_000);
    expect(denseCalendar.truncated).toBe(true);
    expect(denseCalendar.events[0]?.period.start).toBe('2098-01-01T00:00:00.000Z');
    expect(denseCalendar.events.at(-1)?.period.start).toBe('2098-02-11T15:30:00.000Z');

    await withAdmin(async (client) => {
      const orderedPlan = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT id
           FROM fitting_appointment
          WHERE tenant_id=$1::uuid
            AND branch_id=$2::uuid
            AND lower(period) >= '2098-01-01T00:00:00Z'::timestamptz
            AND lower(period) < '2098-01-02T00:00:00Z'::timestamptz
          ORDER BY lower(period), id
          LIMIT 20`,
        [seed.tenantId, seed.branchId],
      );
      const overlapPlan = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT id
           FROM fitting_appointment
          WHERE tenant_id=$1::uuid
            AND branch_id=$2::uuid
            AND period && tstzrange(
              '2098-01-01T00:00:00Z'::timestamptz,
              '2098-01-02T00:00:00Z'::timestamptz,
              '[)'
            )`,
        [seed.tenantId, seed.branchId],
      );
      const orderedText = JSON.stringify(orderedPlan.rows[0]?.['QUERY PLAN']);
      const overlapText = JSON.stringify(overlapPlan.rows[0]?.['QUERY PLAN']);
      expect(orderedText).toContain('fitting_appointment_tenant_branch_start_id_idx');
      expect(overlapText).toContain('fitting_appointment_tenant_branch_period_gist_idx');

      const materialized = await client.query<{ matviewname: string }>(
        `SELECT matviewname
           FROM pg_matviews
          WHERE schemaname='public'
            AND (matviewname ILIKE '%fitting%' OR matviewname ILIKE '%availability%')`,
      );
      expect(materialized.rows).toEqual([]);
    });
  }, 20_000);
});
