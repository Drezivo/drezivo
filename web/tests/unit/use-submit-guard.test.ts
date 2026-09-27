import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSubmitGuard } from '@/lib/use-submit-guard';

/**
 * These two scenarios are the whole reason use-submit-guard.ts exists
 * (see its file header): a customer on a slow connection tapping "Reserve"
 * three times must produce exactly one hold, and a request that times out
 * and gets retried must replay with the SAME idempotency key, not a new one.
 */
describe('useSubmitGuard', () => {
  it('drops a duplicate submit that arrives while the first is still in flight (double-tap)', async () => {
    let resolveFirstCall: (value: string) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirstCall = resolve;
        }),
    );

    const { result } = renderHook(() => useSubmitGuard(action));

    // Two "taps" fired before the first call has resolved — this is the
    // double-tap on a slow connection the hook exists to prevent.
    let firstCallResult: string | undefined;
    let secondCallResult: string | undefined;
    act(() => {
      result.current.submit().then((value) => {
        firstCallResult = value;
      });
      result.current.submit().then((value) => {
        secondCallResult = value;
      });
    });

    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstCall('hold-created');
      await Promise.resolve();
    });

    expect(firstCallResult).toBe('hold-created');
    // The dropped duplicate resolves to undefined — it never reached `action`.
    expect(secondCallResult).toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('reuses the same idempotency key when the user retries after a timeout', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce('hold-created');

    const { result } = renderHook(() => useSubmitGuard(action));
    const keyBeforeFirstAttempt = result.current.idempotencyKey;

    // First attempt fails (simulated timeout).
    await act(async () => {
      await expect(result.current.submit()).rejects.toThrow('network timeout');
    });

    expect(result.current.idempotencyKey).toBe(keyBeforeFirstAttempt);

    // User taps "Reserve" again without changing any input — this must be
    // treated as a retry of the same intent, not a new one.
    await act(async () => {
      await result.current.submit();
    });

    expect(action).toHaveBeenNthCalledWith(1, keyBeforeFirstAttempt);
    expect(action).toHaveBeenNthCalledWith(2, keyBeforeFirstAttempt);
  });

  it('mints a new idempotency key only after resetIntent is called', () => {
    const { result } = renderHook(() => useSubmitGuard(vi.fn()));
    const originalKey = result.current.idempotencyKey;

    act(() => {
      result.current.resetIntent();
    });

    expect(result.current.idempotencyKey).not.toBe(originalKey);
  });
});
