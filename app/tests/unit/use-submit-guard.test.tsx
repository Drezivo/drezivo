import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

describe("useSubmitGuard", () => {
  it("fires exactly one request when submit is invoked twice before the first resolves (double-click)", async () => {
    let resolveHandler: (() => void) | undefined;
    const handler = vi.fn(
      (_idempotencyKey: string) =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        })
    );

    const { result } = renderHook(() => useSubmitGuard(handler));

    let firstCall: Promise<unknown> = Promise.resolve();
    let secondCall: Promise<unknown> = Promise.resolve();
    act(() => {
      firstCall = result.current.submit();
      secondCall = result.current.submit();
    });

    // The second dispatch must be dropped synchronously by the ref guard, before either
    // promise settles — not merely "eventually" only one network call happened.
    expect(handler).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveHandler?.();
      await Promise.all([firstCall, secondCall]);
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reuses the same idempotency key on a retry after a timeout, and mints a new one after resetIntent", async () => {
    const seenKeys: string[] = [];
    const handler = vi.fn(async (idempotencyKey: string) => {
      seenKeys.push(idempotencyKey);
      throw new Error("simulated network timeout");
    });

    const { result } = renderHook(() => useSubmitGuard(handler));

    // First attempt fails (simulated timeout).
    await act(async () => {
      await result.current.submit().catch(() => undefined);
    });

    // Retry of the SAME intent (e.g. user clicks "Retry" on the same dialog).
    await act(async () => {
      await result.current.submit().catch(() => undefined);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);

    // The user edits the form / reopens the dialog for a different target — this is a new
    // intent and must never replay the abandoned key.
    act(() => {
      result.current.resetIntent();
    });

    await act(async () => {
      await result.current.submit().catch(() => undefined);
    });

    expect(seenKeys).toHaveLength(3);
    expect(seenKeys[2]).not.toBe(seenKeys[0]);
  });

  it("surfaces the error to the caller instead of swallowing it", async () => {
    const failure = new Error("boom");
    const handler = vi.fn(async () => {
      throw failure;
    });

    const { result } = renderHook(() => useSubmitGuard(handler));

    await act(async () => {
      await expect(result.current.submit()).rejects.toThrow("boom");
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.isPending).toBe(false);
  });
});
