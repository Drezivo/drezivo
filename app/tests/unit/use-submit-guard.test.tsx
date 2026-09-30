import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

describe("useSubmitGuard", () => {
  it("sends one request for a double click", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    let release: () => void = () => undefined;
    const operation = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));

    await act(async () => {
      const first = result.current.submit(operation);
      const second = result.current.submit(operation);
      release();
      await Promise.all([first, second]);
    });

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("replays the same key when a network or server failure is retried", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const keys: string[] = [];
    const failing = vi.fn(async (key: string) => {
      keys.push(key);
      throw new DrezivoApiError("We could not reach Drezivo.", { status: 503 });
    });

    await act(async () => {
      await result.current.submit(failing).catch(() => undefined);
      await result.current.submit(failing).catch(() => undefined);
    });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("starts a new key after a successful save, so the next save is a new intent", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const keys: string[] = [];
    const saving = vi.fn(async (key: string) => {
      keys.push(key);
    });

    await act(async () => {
      await result.current.submit(saving);
      await result.current.submit(saving);
    });

    expect(keys[0]).not.toBe(keys[1]);
  });

  it("starts a new key after a definite rejection such as a stale version", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const keys: string[] = [];
    const rejected = vi.fn(async (key: string) => {
      keys.push(key);
      throw new DrezivoApiError("Someone else changed this.", { status: 409, code: "STALE_VERSION" });
    });

    await act(async () => {
      await result.current.submit(rejected).catch(() => undefined);
      await result.current.submit(rejected).catch(() => undefined);
    });

    expect(keys[0]).not.toBe(keys[1]);
  });
});
