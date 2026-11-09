import { afterEach, describe, expect, it, vi } from 'vitest';

import { startSweepScheduler } from '../sweep-scheduler.js';

afterEach(() => vi.useRealTimers());

describe('maintenance sweep scheduler', () => {
  it('runs different sweeps at their configured independent intervals', async () => {
    vi.useFakeTimers();
    const holds = vi.fn().mockResolvedValue(undefined);
    const webhooks = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const scheduler = startSweepScheduler([
      { name: 'hold expiry', run: holds, intervalMs: 10_000 },
      { name: 'webhooks', run: webhooks, intervalMs: 60_000 },
      { name: 'cleanup', run: cleanup, intervalMs: 300_000 },
    ]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(holds).toHaveBeenCalledTimes(30);
    expect(webhooks).toHaveBeenCalledTimes(5);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('does not overlap the same sweep and waits for an active run on shutdown', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const scheduler = startSweepScheduler([{ name: 'test', run, intervalMs: 1000 }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish?.();
    await stop;
    expect(stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a failed sweep on the next interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error('test failure')).mockResolvedValue(undefined);
    const scheduler = startSweepScheduler([{ name: 'test', run, intervalMs: 1000 }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
