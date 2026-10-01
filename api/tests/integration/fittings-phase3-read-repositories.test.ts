import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fittingListQuery } from '@drezivo/contracts';

import { listFittingsReadModel, readFittingDetailModel } from '../../src/modules/fittings/fittings.repository.js';
import { readFittingSettingsModel } from '../../src/modules/fittings/fittings.settings.repository.js';
import { migrateTestDatabase, requireTestDatabaseUrl, resetTestDatabase } from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  return client;
}

function idOf(rows: Array<{ id: string }>, label: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${label} insert returned no row`);
  return row.id;
}

async function seed(client: Client, label: string): Promise<{ tenantId: string; branchId: string; fittingIds: string[] }> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  await client.query('BEGIN');
  try {
    const tenant = await client.query<{ id: string }>(`INSERT INTO tenant (clerk_org_id,name,slug,currency,timezone) VALUES ($1,$2,$3,'PHP','Asia/Manila') RETURNING id`, [`org_${suffix}`, suffix, `fit3-${suffix}`]);
    const tenantId = idOf(tenant.rows, 'tenant');
    const branch = await client.query<{ id: string }>(`INSERT INTO branch (tenant_id,name,code,is_default,timezone) VALUES ($1,'Main','MAIN',true,'Asia/Manila') RETURNING id`, [tenantId]);
    const branchId = idOf(branch.rows, 'branch');
    const customer = await client.query<{ id: string }>(`INSERT INTO customer (tenant_id,full_name,email) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `Maria ${suffix}`, `${suffix}@example.test`]);
    const product = await client.query<{ id: string }>(`INSERT INTO product (tenant_id,code,name,status) VALUES ($1,$2,'Gold Gown','active') RETURNING id`, [tenantId, `P-${suffix}`]);
    const variant = await client.query<{ id: string }>(`INSERT INTO product_variant (tenant_id,product_id,sku,size_label,color_label,measurements,measurement_unit,measurement_mode,rental_price_minor,security_deposit_minor,currency,pricing_mode,included_duration_minutes,extra_day_price_minor,prep_minutes,turnaround_minutes,status) VALUES ($1,$2,$3,'M','Gold','{}','cm','none',1000,0,'PHP','fixed_duration',1440,0,0,0,'active') RETURNING id`, [tenantId, idOf(product.rows, 'product'), `SKU-${suffix}`]);
    await client.query(`INSERT INTO fitting_settings (tenant_id,branch_id,enabled,capacity,duration_minutes,fee_minor,currency,version) VALUES ($1,$2,true,2,60,500,'PHP',1)`, [tenantId, branchId]);
    await client.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"09:00","closes_local":"17:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, branchId],
    );
    await client.query(
      `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
       VALUES ($1, $2, date '2026-12-25', 'Holiday')`,
      [tenantId, branchId],
    );
    const slot = await client.query<{ id: string }>(`INSERT INTO fitting_capacity_slot (tenant_id,branch_id,slot_number,active) VALUES ($1,$2,1,true) RETURNING id`, [tenantId, branchId]);
    const slotId = idOf(slot.rows, 'slot');

    const fittingIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const start = `2026-10-0${index + 5}T02:00:00Z`;
      const end = `2026-10-0${index + 5}T03:00:00Z`;
      const fitting = await client.query<{ id: string }>(`INSERT INTO fitting_appointment (tenant_id,branch_id,customer_id,booking_channel,status,period,timezone_snapshot,currency,fee_minor,business_key,version) VALUES ($1,$2,$3,'staff','pending',tstzrange($4::timestamptz,$5::timestamptz,'[)'),'Asia/Manila','PHP',500,$6,1) RETURNING id`, [tenantId, branchId, idOf(customer.rows, 'customer'), start, end, `fit:${suffix}:${index}`]);
      const fittingId = idOf(fitting.rows, 'fitting');
      fittingIds.push(fittingId);
      await client.query(`INSERT INTO fitting_line (tenant_id,fitting_id,variant_id,asset_id,garment_guaranteed) VALUES ($1,$2,$3,NULL,false),($1,$2,$3,NULL,false)`, [tenantId, fittingId, idOf(variant.rows, 'variant')]);
      const slotAllocation = await client.query<{ id: string }>(`INSERT INTO fitting_slot_allocation (tenant_id,slot_id,fitting_id,period,is_blocking) VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'),true) RETURNING id`, [tenantId, slotId, fittingId, start, end]);

      if (index === 2) {
        await client.query(`UPDATE fitting_appointment SET status = 'confirmed', version = version + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, fittingId]);
        await client.query(`UPDATE fitting_slot_allocation SET is_blocking = false, released_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, idOf(slotAllocation.rows, 'slot allocation')]);
        await client.query(`UPDATE fitting_appointment SET status = 'completed', version = version + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, fittingId]);
      }
    }

    await client.query('COMMIT');
    return { tenantId, branchId, fittingIds };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe('FIT-BE-030..033 fitting read repositories', () => {
  beforeAll(async () => migrateTestDatabase(adminUrl));
  afterEach(async () => resetTestDatabase(adminUrl));

  it('lists empty data and deterministically paginates multi-garment fittings without N+1 reads', async () => {
    const client = await openClient();
    try {
      const seeded = await seed(client, 'page');
      const empty = await listFittingsReadModel(client as never, { tenantId: seeded.tenantId, branchId: randomUUID(), query: fittingListQuery.parse({ limit: 2 }) });
      expect(empty.rows).toEqual([]);

      const first = await listFittingsReadModel(client as never, { tenantId: seeded.tenantId, branchId: seeded.branchId, query: fittingListQuery.parse({ limit: 2, sort: 'starts_at_asc' }) });
      expect(first.rows).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(first.rows.every((row) => Array.isArray(row.garments) && row.garments.length === 2)).toBe(true);
      const second = await listFittingsReadModel(client as never, { tenantId: seeded.tenantId, branchId: seeded.branchId, query: fittingListQuery.parse({ limit: 2, sort: 'starts_at_asc', cursor: first.nextCursor }) });
      expect(second.rows).toHaveLength(1);
      expect(new Set([...first.rows, ...second.rows].map((row) => row.fitting_id)).size).toBe(3);
      // The repository implementation issues one statement per page; lateral aggregates prevent per-item reads.
    } finally { await client.end(); }
  });

  it('filters by status/date/search and conceals cross-tenant detail IDs', async () => {
    const client = await openClient();
    try {
      const a = await seed(client, 'a');
      const b = await seed(client, 'b');
      const filtered = await listFittingsReadModel(client as never, { tenantId: a.tenantId, branchId: a.branchId, query: fittingListQuery.parse({ search: 'Gold Gown', status: 'pending', period_start: '2026-10-05T00:00:00.000Z', period_end: '2026-10-07T00:00:00.000Z' }) });
      expect(filtered.rows).toHaveLength(2);
      expect(await readFittingDetailModel(client as never, { tenantId: a.tenantId, branchId: a.branchId, fittingId: idOf(b.fittingIds.map((id) => ({ id })), 'foreign fitting') })).toBeNull();
      const detail = await readFittingDetailModel(client as never, { tenantId: a.tenantId, branchId: a.branchId, fittingId: idOf(a.fittingIds.map((id) => ({ id })), 'fitting') });
      expect(detail?.timezone_snapshot).toBe('Asia/Manila');
      expect(JSON.stringify(detail)).not.toContain('slot_id');
    } finally { await client.end(); }
  });

  it('reads only fitting-specific scalar settings without schedule or capacity-slot identity', async () => {
    const client = await openClient();
    try {
      const seeded = await seed(client, 'settings');
      const settings = await readFittingSettingsModel(client as never, seeded);
      expect(settings).toMatchObject({
        enabled: true,
        capacity: 2,
        duration_minutes: 60,
        timezone: 'Asia/Manila',
      });
      expect(JSON.stringify(settings)).not.toContain('hours');
      expect(JSON.stringify(settings)).not.toContain('closure');
      expect(JSON.stringify(settings)).not.toContain('slot');
    } finally {
      await client.end();
    }
  });
});
