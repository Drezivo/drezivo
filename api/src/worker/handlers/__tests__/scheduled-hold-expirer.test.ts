import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../shared/logger.js';
import { createScheduledHoldExpirer } from '../scheduled-hold-expirer.js';

afterEach(() => vi.restoreAllMocks());

describe('bounded scheduled hold expiry', () => {
  it('makes no business calls for an empty queue and recovers after a database failure', async () => {
    const discover = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const expire = vi.fn();
    const sweep = createScheduledHoldExpirer({ discover, expire });
    await expect(sweep.run()).rejects.toThrow('discovery failed');
    await expect(sweep.run()).resolves.toBe(0);
    expect(expire).not.toHaveBeenCalled();
    expect(discover.mock.calls).toEqual([[null], [null]]);
  });

  it('advances past failed tenants and respects the pass budget before starting another transaction', async () => {
    let clock = 0;
    const discover = vi.fn().mockResolvedValue([
      { tenant_id: 'a', lag_ms: 10 },
      { tenant_id: 'b', lag_ms: 20 },
      { tenant_id: 'c', lag_ms: 30 },
    ]);
    const expire = vi.fn().mockImplementation((id: string) => {
      clock += 2_600;
      if (id === 'a') return Promise.reject(new Error('locked'));
      return Promise.resolve(1);
    });
    const sweep = createScheduledHoldExpirer({ discover, expire, now: () => clock });
    await expect(sweep.run()).rejects.toThrow('due work retained');
    expect(expire.mock.calls).toEqual([['a'], ['b']]);
    discover.mockResolvedValue([]);
    await sweep.run();
    expect(discover).toHaveBeenLastCalledWith('b');
  });

  it('finishes the active transaction on shutdown without starting another or overlapping passes', async () => {
    let finish: ((count: number) => void) | undefined;
    const expire = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const discover = vi.fn().mockResolvedValue([
      { tenant_id: 'a', lag_ms: 0 },
      { tenant_id: 'b', lag_ms: 0 },
    ]);
    const sweep = createScheduledHoldExpirer({ discover, expire });
    const first = sweep.run();
    const second = sweep.run();
    await Promise.resolve();
    expect(discover).toHaveBeenCalledTimes(1);
    sweep.stop();
    finish?.(3);
    expect(await Promise.all([first, second])).toEqual([3, 3]);
    expect(expire.mock.calls).toEqual([['a']]);
    expect(await sweep.run()).toBe(0);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('emits only aggregate activity every five minutes, including failures and observed lag', async () => {
    const log = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    let clock = 0;
    const sweep = createScheduledHoldExpirer({
      discover: () => Promise.resolve([{ tenant_id: 'not-logged', lag_ms: 1_200 }]),
      expire: () => Promise.resolve(2),
      now: () => clock,
    });
    await sweep.run();
    expect(log).not.toHaveBeenCalled();
    clock = 300_000;
    await sweep.run();
    expect(log).toHaveBeenCalledWith(
      {
        discoveries: 2,
        businesses: 2,
        expired: 4,
        failures: 0,
        failureKinds: {},
        maxObservedLagMs: 1_200,
        windowMs: 300_000,
      },
      'scheduled hold expiry activity',
    );
  });

  it('reports a sanitized failure category without the underlying SQL error or business IDs', async () => {
    const log = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const sweep = createScheduledHoldExpirer({
      discover: () => Promise.resolve([{ tenant_id: 'not-logged', lag_ms: 0 }]),
      expire: () =>
        Promise.reject(Object.assign(new Error('private query detail'), { code: '55P03' })),
    });
    await expect(sweep.run()).rejects.toThrow('due work retained');
    sweep.stop();
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      failures: 1,
      failureKinds: { lock_timeout: 1 },
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/not-logged|private query detail/);
  });
});
