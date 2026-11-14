import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeferredOutboxError, WorkerRunner, type OutboxRow } from '../runner.js';

const deferredRow: OutboxRow = {
  id: 'outbox-id',
  tenant_id: 'tenant-id',
  dedupe_key: 'file-object-cleanup:file-id',
  event_type: 'file.object_cleanup.requested',
  payload: { file_id: '00000000-0000-4000-8000-000000000001' },
  attempts: 3,
  max_attempts: 8,
};

afterEach(() => vi.useRealTimers());

describe('continuous outbox polling', () => {
  it('limits the default idle wait to 60 seconds and stops without waiting for the timer', async () => {
    vi.useFakeTimers();
    let claims = 0;
    const clientQuery = vi.fn((sql: string) => {
      if (sql.includes('WITH due AS')) claims += 1;
      return { rows: [] };
    });
    const db = {
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    } as unknown as Pool;
    const runner = new WorkerRunner({}, 2000, 60, db, 60_000);
    const running = runner.start();
    await vi.advanceTimersByTimeAsync(62_000);
    expect(claims).toBe(6);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(claims).toBe(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(claims).toBe(7);
    runner.stop();
    await running;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off while idle, caps the delay, and resets after finding work', async () => {
    vi.useFakeTimers();
    let claims = 0;
    const clientQuery = vi.fn((sql: string) => {
      if (sql.includes('WITH due AS')) {
        claims += 1;
        return { rows: claims === 5 ? [deferredRow] : [] };
      }
      return { rows: [] };
    });
    const db = {
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as unknown as Pool;
    const handler = vi.fn().mockResolvedValue(undefined);
    const runner = new WorkerRunner({ [deferredRow.event_type]: handler }, 2000, 60, db, 8000);
    const running = runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(claims).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(claims).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(claims).toBe(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(claims).toBe(4);
    await vi.advanceTimersByTimeAsync(8000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(claims).toBe(6);
    await vi.advanceTimersByTimeAsync(1999);
    expect(claims).toBe(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(claims).toBe(7);
    runner.stop();
    await running;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('worker runner deferred events', () => {
  it('releases a deferred event to pending without consuming a failure attempt', async () => {
    let claims = 0;
    const clientQuery = vi.fn((sql: string) => {
      if (sql.includes('WITH due AS')) {
        claims += 1;
        return { rows: claims === 1 ? [deferredRow] : [], rowCount: claims === 1 ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const dbQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const db = {
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
      query: dbQuery,
    } as unknown as Pool;
    const handler = vi.fn().mockRejectedValue(new DeferredOutboxError('File remains referenced; cleanup is deferred.', 3600));
    const runner = new WorkerRunner({ 'file.object_cleanup.requested': handler }, 1000, 60, db);

    await expect(runner.drainOnce({ budgetMs: 1000 })).resolves.toEqual({ processed: 1, stoppedBy: 'empty' });

    const deferCall = dbQuery.mock.calls[0];
    expect(deferCall?.[0]).toContain("SET status = 'pending'");
    expect(deferCall?.[0]).not.toContain('attempts =');
    expect(deferCall?.[1]).toEqual([
      deferredRow.id,
      'File remains referenced; cleanup is deferred.',
      3600,
      expect.any(String),
    ]);
  });
});
