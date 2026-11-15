import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Client, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureAppRoleLogin,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = buildWorkerRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX = '3';
const { pool, closePool, withSystemTenantTransaction } = await import('../../src/db/client.js');
const { createTestTenant } = await import('./helpers/factories.js');
const { expireDueHoldsForTenant, expireDueHoldsForAllTenants } =
  await import('../../src/worker/handlers/hold-expirer.js');
const { createScheduledHoldExpirer, discoverDueHoldTenants } =
  await import('../../src/worker/handlers/scheduled-hold-expirer.js');
const {
  releaseExpiredReservationHolds,
  appendExpiredReservationAuditEvents,
  appendExpiredReservationOutboxEvents,
} = await import('../../src/modules/reservations/reservations.command.repository.js');

const admin = new Client({ connectionString: adminUrl });
beforeAll(async () => {
  await migrateTestDatabase(adminUrl);
  await ensureAppRoleLogin(adminUrl);
  await ensureWorkerRoleLogin(adminUrl);
  await admin.connect();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase(adminUrl);
});
afterAll(async () => {
  await closePool();
  await admin.end();
});

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error('Expected fixture row');
  return row;
}

async function seed(): Promise<{
  tenantId: string;
  branchId: string;
  storeId: string;
  policyId: string;
  methodId: string;
}> {
  const { id: tenantId } = await createTestTenant();
  return withSystemTenantTransaction(tenantId, 'worker:test', async (client) => {
    const branchId = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id, name, code, timezone) VALUES ($1, 'Test', 'MAIN', 'Asia/Manila') RETURNING id`,
          [tenantId],
        )
      ).rows,
    ).id;
    const storeId = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO storefront (tenant_id, branch_id, slug) VALUES ($1::uuid, $2, $1::uuid::text) RETURNING id`,
          [tenantId, branchId],
        )
      ).rows,
    ).id;
    const policyId = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO policy_snapshot (tenant_id, storefront_id, version, rental_rules, deposit_rules,
        cancellation_rules, delivery_rules, privacy_notice, effective_at)
       VALUES ($1, $2, 1, '{}', '{}', '{}', '{}', 'Test', now()) RETURNING id`,
          [tenantId, storeId],
        )
      ).rows,
    ).id;
    const methodId = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot)
       VALUES ($1, 'Cash', 'cash', '{}') RETURNING id`,
          [tenantId],
        )
      ).rows,
    ).id;
    return { tenantId, branchId, storeId, policyId, methodId };
  });
}

async function hold(
  workspace: Awaited<ReturnType<typeof seed>>,
  options: { count?: number; status?: string; deadline?: string | null } = {},
): Promise<string[]> {
  return withSystemTenantTransaction(workspace.tenantId, 'worker:test', async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reservation (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
         reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
         rental_total_minor, due_now_minor, hold_expires_at)
       SELECT $1, $2, $3, $4, $5, gen_random_uuid()::text, $6, now() + interval '2 days',
              now() + interval '3 days', 'Asia/Manila', '{}', 100, 100, $7::timestamptz
         FROM generate_series(1, $8::int) RETURNING id`,
      [
        workspace.tenantId,
        workspace.branchId,
        workspace.storeId,
        workspace.policyId,
        workspace.methodId,
        options.status ?? 'held',
        options.deadline === undefined
          ? new Date(Date.now() - 60_000).toISOString()
          : options.deadline,
        options.count ?? 1,
      ],
    );
    return rows.map((row) => row.id);
  });
}

async function edit(
  tenantId: string,
  id: string,
  status: string,
  deadline: string | null,
): Promise<void> {
  await withSystemTenantTransaction(tenantId, 'worker:test', (client) =>
    client.query(
      'UPDATE reservation SET status=$3, hold_expires_at=$4 WHERE tenant_id=$1 AND id=$2',
      [tenantId, id, status, deadline],
    ),
  );
}

async function allocation(
  workspace: Awaited<ReturnType<typeof seed>>,
  reservationId: string,
): Promise<string> {
  return withSystemTenantTransaction(workspace.tenantId, 'worker:test', async (client) => {
    const product = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id, code, name, status) VALUES ($1, $2, 'Test', 'active') RETURNING id`,
          [workspace.tenantId, randomUUID()],
        )
      ).rows,
    ).id;
    const variant = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO product_variant (tenant_id, product_id, sku, size_label, measurements, rental_price_minor,
         security_deposit_minor, currency, status, included_duration_minutes)
       VALUES ($1, $2, $3, 'M', '{}', 100, 0, 'PHP', 'active', 1440) RETURNING id`,
          [workspace.tenantId, product, randomUUID()],
        )
      ).rows,
    ).id;
    const asset = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO physical_asset (tenant_id, branch_id, variant_id, asset_code) VALUES ($1,$2,$3,$4) RETURNING id`,
          [workspace.tenantId, workspace.branchId, variant, randomUUID()],
        )
      ).rows,
    ).id;
    const line = first(
      (
        await client.query<{ id: string }>(
          `INSERT INTO reservation_line (tenant_id, reservation_id, variant_id, name_snapshot, measurements_snapshot,
         pricing_snapshot, rental_minor) VALUES ($1,$2,$3,'Test','{}','{}',100) RETURNING id`,
          [workspace.tenantId, reservationId, variant],
        )
      ).rows,
    ).id;
    await client.query(
      `INSERT INTO asset_allocation (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
       VALUES ($1,$2,$3,$4,'reservation_hold',tstzrange(now()+interval '2 days',now()+interval '3 days','[)'),true)`,
      [workspace.tenantId, workspace.branchId, asset, line],
    );
    return asset;
  });
}

describe('durable reservation expiry under runtime RLS', () => {
  it('tracks creation, review extension, no-op updates, null deadlines, confirmation, cancellation and deletion', async () => {
    const workspace = await seed();
    const id = first(await hold(workspace));
    expect((await pool.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(1);
    const future = new Date(Date.now() + 60_000).toISOString();
    await edit(workspace.tenantId, id, 'pending_confirmation', future);
    expect(
      first(
        (
          await pool.query<{ expires_at: Date }>(
            'SELECT expires_at FROM reservation_expiry_schedule',
          )
        ).rows,
      ).expires_at.toISOString(),
    ).toBe(future);
    expect(await createScheduledHoldExpirer().run()).toBe(0);
    const before = first(
      (await admin.query<{ xmin: string }>('SELECT xmin::text FROM reservation_expiry_schedule'))
        .rows,
    ).xmin;
    await edit(workspace.tenantId, id, 'pending_confirmation', future);
    expect(
      first(
        (await admin.query<{ xmin: string }>('SELECT xmin::text FROM reservation_expiry_schedule'))
          .rows,
      ).xmin,
    ).toBe(before);
    for (const status of ['confirmed', 'cancelled', 'held']) {
      await edit(workspace.tenantId, id, status, null);
      expect((await pool.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(0);
    }
    await edit(workspace.tenantId, id, 'held', future);
    await withSystemTenantTransaction(workspace.tenantId, 'worker:test', (client) =>
      client.query('DELETE FROM reservation WHERE id=$1', [id]),
    );
    expect((await pool.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(0);
  });

  it('backfills existing due/future held and review reservations, excluding terminal/null-deadline rows', async () => {
    const workspace = await seed();
    await hold(workspace, { count: 2 });
    await hold(workspace, {
      status: 'pending_confirmation',
      deadline: new Date(Date.now() + 60_000).toISOString(),
    });
    await hold(workspace, { status: 'confirmed' });
    await hold(workspace, { deadline: null });
    const migration = await readFile(
      new URL('../../src/db/migrations/0098_reservation_expiry_schedule.sql', import.meta.url),
      'utf8',
    );
    await admin.query('BEGIN');
    try {
      await admin.query(`DROP TRIGGER reservation_expiry_schedule_insert ON reservation;
        DROP TRIGGER reservation_expiry_schedule_update ON reservation;
        DROP FUNCTION sync_reservation_expiry_schedule(); DROP TABLE reservation_expiry_schedule`);
      await admin.query(migration);
      expect((await admin.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(3);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('expires held and pending reviews exactly once across two workers and releases allocations atomically', async () => {
    const workspace = await seed();
    const id = first(await hold(workspace));
    await allocation(workspace, id);
    await hold(workspace, { status: 'pending_confirmation' });
    const workers = [createScheduledHoldExpirer(), createScheduledHoldExpirer()];
    const counts = await Promise.all(workers.map((worker) => worker.run()));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(
      (await admin.query("SELECT * FROM reservation WHERE status='expired' AND version=2")).rows,
    ).toHaveLength(2);
    expect((await admin.query('SELECT is_blocking FROM asset_allocation')).rows).toEqual([
      { is_blocking: false },
    ]);
    expect(
      (await admin.query("SELECT * FROM audit_event WHERE action='reservation.expired'")).rows,
    ).toHaveLength(2);
    expect(
      (await admin.query("SELECT * FROM outbox_event WHERE event_type='reservation.hold_expired'"))
        .rows,
    ).toHaveLength(2);
    expect((await pool.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(0);
    expect(await workers[0]?.run()).toBe(0);
  });

  it('rolls back expiry, schedule deletion and effects on a later write failure, then catches up', async () => {
    const workspace = await seed();
    const id = first(await hold(workspace));
    await allocation(workspace, id);
    const blocker = new Client({ connectionString: adminUrl });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE audit_event IN SHARE MODE');
    const sweep = createScheduledHoldExpirer();
    try {
      await expect(sweep.run()).rejects.toThrow('due work retained');
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
    expect(first((await admin.query('SELECT status, version FROM reservation')).rows)).toEqual({
      status: 'held',
      version: 1,
    });
    expect((await pool.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(1);
    expect((await admin.query('SELECT is_blocking FROM asset_allocation')).rows).toEqual([
      { is_blocking: true },
    ]);
    expect(await createScheduledHoldExpirer().run()).toBe(1);
  });

  it('skips a locked reservation, honors an extension/confirmation, and retries after rollback', async () => {
    const workspace = await seed();
    const id = first(await hold(workspace));
    const lock = await pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query("SELECT set_config('app.tenant_id', $1, true)", [workspace.tenantId]);
      await lock.query('SELECT id FROM reservation WHERE id=$1 FOR UPDATE', [id]);
      expect(await createScheduledHoldExpirer().run()).toBe(0);
      await lock.query(
        "UPDATE reservation SET status='pending_confirmation', hold_expires_at=now()+interval '1 hour' WHERE id=$1",
        [id],
      );
      await lock.query('COMMIT');
      expect(await createScheduledHoldExpirer().run()).toBe(0);
      await edit(workspace.tenantId, id, 'confirmed', new Date(Date.now() - 1000).toISOString());
      expect(await createScheduledHoldExpirer().run()).toBe(0);
      await edit(workspace.tenantId, id, 'held', new Date(Date.now() - 1000).toISOString());
      await lock.query('BEGIN');
      await lock.query("SELECT set_config('app.tenant_id', $1, true)", [workspace.tenantId]);
      await lock.query("UPDATE reservation SET status='confirmed' WHERE id=$1", [id]);
      expect(await createScheduledHoldExpirer().run()).toBe(0);
      await lock.query('ROLLBACK');
      expect(await createScheduledHoldExpirer().run()).toBe(1);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
  });

  it('races request-time reclaim without duplicate audit or outbox effects', async () => {
    const workspace = await seed();
    const id = first(await hold(workspace));
    const assetId = await allocation(workspace, id);
    await Promise.all([
      createScheduledHoldExpirer().run(),
      withSystemTenantTransaction(workspace.tenantId, 'worker:test', async (client) => {
        await client.query('SELECT id FROM physical_asset WHERE id=$1 FOR UPDATE', [assetId]);
        const rows = await releaseExpiredReservationHolds(client, {
          tenantId: workspace.tenantId,
          branchId: workspace.branchId,
          assetIds: [assetId],
          batchSize: 100,
        });
        await appendExpiredReservationAuditEvents(client, {
          tenantId: workspace.tenantId,
          requestId: 'test:reclaim',
          rows,
        });
        await appendExpiredReservationOutboxEvents(client, { tenantId: workspace.tenantId, rows });
      }),
    ]);
    expect(
      (await admin.query("SELECT * FROM audit_event WHERE action='reservation.expired'")).rows,
    ).toHaveLength(1);
    expect(
      (await admin.query("SELECT * FROM outbox_event WHERE event_type='reservation.hold_expired'"))
        .rows,
    ).toHaveLength(1);
  });

  it('bounds backlog batches to 100 and retains legacy scan for rollback', async () => {
    const workspace = await seed();
    await hold(workspace, { count: 205 });
    const sweep = createScheduledHoldExpirer();
    expect(await sweep.run()).toBe(100);
    expect(await sweep.run()).toBe(100);
    expect(await expireDueHoldsForAllTenants()).toBe(5);
    expect(await sweep.run()).toBe(0);
  });

  it('rotates across more than ten due businesses even when the first businesses remain due', async () => {
    for (let index = 0; index < 12; index += 1) await hold(await seed());
    const firstPage = await discoverDueHoldTenants(null);
    expect(firstPage).toHaveLength(10);
    const secondPage = await discoverDueHoldTenants(first(firstPage.slice(-1)).tenant_id);
    expect(new Set([...firstPage, ...secondPage].map((row) => row.tenant_id)).size).toBe(12);
    const failedTenant = first(firstPage).tenant_id;
    const processed = new Set<string>();
    const sweep = createScheduledHoldExpirer({
      expire: (id) => {
        if (id === failedTenant) return Promise.reject(new Error('test failure'));
        processed.add(id);
        return Promise.resolve(0);
      },
    });
    await expect(sweep.run()).rejects.toThrow('due work retained');
    await expect(sweep.run()).rejects.toThrow('due work retained');
    expect(processed.size).toBe(11);
  });

  it.each([1, 10, 100])(
    'uses one statement and zero tenant transactions for %i idle businesses',
    async (count) => {
      await admin.query(
        `INSERT INTO tenant (clerk_org_id, name, slug)
      SELECT 'org_idle_'||n, 'Idle', 'idle-'||n FROM generate_series(1,$1::int) n`,
        [count],
      );
      const queries = vi.spyOn(Client.prototype, 'query');
      expect(await createScheduledHoldExpirer().run()).toBe(0);
      expect(queries).toHaveBeenCalledTimes(1);
      expect(queries.mock.calls[0]?.[0]).toContain('FROM reservation_expiry_schedule');
    },
  );

  it('allows API-role reservation updates to maintain the private schedule', async () => {
    const workspace = await seed();
    const id = first(await hold(workspace));
    const app = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [workspace.tenantId]);
      await app.query("UPDATE reservation SET status='cancelled' WHERE id=$1", [id]);
      await app.query('COMMIT');
      expect((await pool.query('SELECT * FROM reservation_expiry_schedule')).rows).toHaveLength(0);
    } finally {
      await app.end();
    }
  });

  it('restricts cross-tenant discovery to metadata and denies runtime writes/trigger invocation', async () => {
    const a = await seed();
    const b = await seed();
    await hold(a);
    await hold(b);
    expect(await discoverDueHoldTenants(null)).toHaveLength(2);
    expect((await pool.query('SELECT id FROM reservation')).rows).toHaveLength(0);
    await withSystemTenantTransaction(a.tenantId, 'worker:test', async (client) => {
      expect((await client.query('SELECT tenant_id FROM reservation')).rows).toEqual([
        { tenant_id: a.tenantId },
      ]);
    });
    expect(await expireDueHoldsForTenant(a.tenantId, 100, true)).toBe(1);
    expect(
      first(
        (
          await admin.query<{ status: string }>(
            'SELECT status FROM reservation WHERE tenant_id=$1',
            [b.tenantId],
          )
        ).rows,
      ).status,
    ).toBe('held');
    await expect(pool.query('DELETE FROM reservation_expiry_schedule')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(pool.query('SELECT sync_reservation_expiry_schedule()')).rejects.toMatchObject({
      code: '42501',
    });
    const app = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });
    await app.connect();
    try {
      await expect(app.query('SELECT * FROM reservation_expiry_schedule')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await app.end();
    }
  });

  it('rejects mismatched schedule ownership even for an administrative backfill', async () => {
    const a = await seed();
    const b = await seed();
    const id = first(await hold(a));
    await expect(
      admin.query('UPDATE reservation_expiry_schedule SET tenant_id=$1 WHERE reservation_id=$2', [
        b.tenantId,
        id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('sets system context in one statement and resets it after commit/rollback on pool reuse', async () => {
    const a = await seed();
    const b = await seed();
    await hold(a);
    await hold(b);
    // Hold two connections so both transactions below reuse exactly the same third connection.
    const held: PoolClient[] = [await pool.connect(), await pool.connect()];
    try {
      for (const fail of [false, true]) {
        const queries = vi.spyOn(Client.prototype, 'query');
        const work = withSystemTenantTransaction(
          a.tenantId,
          'worker:test-context',
          async (client) => {
            const state = first(
              (
                await client.query<{
                  tenant: string;
                  principal: string;
                  actor: string;
                }>(`SELECT current_setting('app.tenant_id') AS tenant,
            current_setting('app.principal_id') AS principal, current_setting('app.actor_kind') AS actor`)
              ).rows,
            );
            expect(state).toEqual({
              tenant: a.tenantId,
              principal: 'worker:test-context',
              actor: 'system',
            });
            if (fail) throw new Error('test rollback');
          },
        );
        if (fail) await expect(work).rejects.toThrow('test rollback');
        else await work;
        expect(
          queries.mock.calls.filter(
            ([query]) => typeof query === 'string' && query.includes('set_config'),
          ),
        ).toHaveLength(1);
        queries.mockRestore();
        const context = first(
          (
            await pool.query<{
              tenant: string | null;
              actor: string | null;
              principal: string | null;
            }>(`SELECT nullif(current_setting('app.tenant_id',true),'') AS tenant,
          nullif(current_setting('app.actor_kind',true),'') AS actor, nullif(current_setting('app.principal_id',true),'') AS principal`)
          ).rows,
        );
        expect(context).toEqual({ tenant: null, actor: null, principal: null });
        await withSystemTenantTransaction(b.tenantId, 'worker:test-b', async (client) => {
          expect((await client.query('SELECT tenant_id FROM reservation')).rows).toEqual([
            { tenant_id: b.tenantId },
          ]);
        });
      }
      await expect(
        withSystemTenantTransaction('', 'worker:test', () => Promise.resolve(1)),
      ).rejects.toThrow('required');
    } finally {
      held.forEach((client) => client.release());
    }
  });
});
