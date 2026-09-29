import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Drain mode (run once, then exit) against a real PostgreSQL as the `drezivo_worker` role: queue
 * emptied across tenants, event-type scoping, time budget between batches, overlapping runs
 * processing each row exactly once, explicit acknowledgement of domain events, and unknown event
 * types still dead-lettering.
 */
import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('worker drain mode', async () => {
  const { WorkerRunner } = await import('../../src/worker/runner.js');
  const { ACKNOWLEDGED_DOMAIN_EVENTS, acknowledgeDomainEvent } = await import('../../src/worker/handlers/domain-events.js');
  const { closePool } = await import('../../src/db/client.js');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  let workerPool: pg.Pool;

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
    workerPool = new pg.Pool({ connectionString: buildWorkerRoleDatabaseUrl(adminUrl), max: 4 });
  });
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await workerPool.end();
    await admin.end();
    await closePool();
  });

  async function tenant(): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const row = await admin.query<{ id: string }>(`INSERT INTO tenant (clerk_org_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      `org_drain_${suffix}`,
      `Drain ${suffix}`,
      `drain-${suffix}`,
    ]);
    const id = row.rows[0]?.id;
    if (!id) throw new Error('tenant insert returned no row');
    return id;
  }

  async function enqueue(tenantId: string, eventType: string, count = 1): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await admin.query(`INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload) VALUES ($1, $2, $3, '{}'::jsonb)`, [
        tenantId,
        `drain-test:${randomUUID()}`,
        eventType,
      ]);
    }
  }

  async function statusCounts(): Promise<Record<string, number>> {
    const rows = await admin.query<{ event_type: string; status: string; n: number }>(
      `SELECT event_type, status, count(*)::int AS n FROM outbox_event GROUP BY event_type, status`,
    );
    return Object.fromEntries(rows.rows.map((row) => [`${row.event_type}:${row.status}`, row.n]));
  }

  function counting(delayMs = 0) {
    const seen = new Map<string, number>();
    const handler = async (row: { id: string }) => {
      seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    };
    return { seen, handler };
  }

  it('empties the queue across tenants, then returns', async () => {
    const [a, b] = [await tenant(), await tenant()];
    await enqueue(a, 'test.event', 12);
    await enqueue(b, 'test.event', 3);
    const { seen, handler } = counting();
    const result = await new WorkerRunner({ 'test.event': handler }, 2000, 60, workerPool).drainOnce({ budgetMs: 60_000 });

    expect(result).toEqual({ processed: 15, stoppedBy: 'empty' });
    expect(seen.size).toBe(15);
    expect(await statusCounts()).toEqual({ 'test.event:succeeded': 15 });
  });

  it('claims only the requested event types', async () => {
    const t = await tenant();
    await enqueue(t, 'notification.email', 2);
    await enqueue(t, 'test.event', 3);
    const { handler } = counting();
    const result = await new WorkerRunner({ 'notification.email': handler, 'test.event': handler }, 2000, 60, workerPool).drainOnce({
      budgetMs: 60_000,
      eventTypes: ['notification.email'],
    });

    expect(result).toEqual({ processed: 2, stoppedBy: 'empty' });
    expect(await statusCounts()).toEqual({ 'notification.email:succeeded': 2, 'test.event:pending': 3 });
  });

  it('stops at the time budget between batches, finishing the batch in hand', async () => {
    const t = await tenant();
    await enqueue(t, 'test.event', 25);
    const { handler } = counting(20);
    const result = await new WorkerRunner({ 'test.event': handler }, 2000, 60, workerPool).drainOnce({ budgetMs: 50 });

    expect(result).toEqual({ processed: 10, stoppedBy: 'budget' });
    // The unclaimed rest is still pending, not stranded behind a lease.
    expect(await statusCounts()).toEqual({ 'test.event:succeeded': 10, 'test.event:pending': 15 });
  });

  it('handles each row exactly once when two runs overlap', async () => {
    const t = await tenant();
    await enqueue(t, 'test.event', 30);
    const { seen, handler } = counting(5);
    const runs = await Promise.all([
      new WorkerRunner({ 'test.event': handler }, 2000, 60, workerPool).drainOnce({ budgetMs: 60_000 }),
      new WorkerRunner({ 'test.event': handler }, 2000, 60, workerPool).drainOnce({ budgetMs: 60_000 }),
    ]);

    expect(runs.reduce((total, run) => total + run.processed, 0)).toBe(30);
    expect(seen.size).toBe(30);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it('acknowledges known domain events and still dead-letters unknown types', async () => {
    const t = await tenant();
    for (const eventType of ACKNOWLEDGED_DOMAIN_EVENTS) await enqueue(t, eventType);
    await enqueue(t, 'reservation.not_a_real_event');
    const handlers = Object.fromEntries(ACKNOWLEDGED_DOMAIN_EVENTS.map((eventType) => [eventType, acknowledgeDomainEvent]));
    await new WorkerRunner(handlers, 2000, 60, workerPool).drainOnce({ budgetMs: 60_000 });

    const counts = await statusCounts();
    for (const eventType of ACKNOWLEDGED_DOMAIN_EVENTS) expect(counts[`${eventType}:succeeded`]).toBe(1);
    expect(counts['reservation.not_a_real_event:dead']).toBe(1);
  });

  it('stops without claiming when stopped', async () => {
    const t = await tenant();
    await enqueue(t, 'test.event', 3);
    const runner = new WorkerRunner({ 'test.event': counting().handler }, 2000, 60, workerPool);
    runner.stop();

    expect(await runner.drainOnce({ budgetMs: 60_000 })).toEqual({ processed: 0, stoppedBy: 'stopped' });
    expect(await statusCounts()).toEqual({ 'test.event:pending': 3 });
  });
});
