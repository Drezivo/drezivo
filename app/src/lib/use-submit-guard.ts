"use client";

/**
 * THE non-negotiable hook. Every mutating control in this repo (button, form submit,
 * dialog confirm) is wired through useSubmitGuard — never a hand-rolled onClick handler
 * that calls the api-client directly. See .claude/rules/lessons.md for why this is a
 * shared hook and not per-screen code.
 *
 * It implements the client half of the TRD §4 idempotency contract:
 *  - a ref-backed pending guard (not state-backed): `disabled={isPending}` alone is not
 *    enough, because a second click or a queued keyboard Enter dispatched before React
 *    re-renders the disabled attribute can still reach the handler. `submitting.current`
 *    is read synchronously, before any state update, so a same-tick double-dispatch is
 *    dropped instead of firing a second request.
 *  - one idempotency key per user intent, minted once (on mount / dialog open) and reused
 *    across retries, so a retry after a timeout replays the original request instead of
 *    creating a duplicate. A new key is minted only when the caller explicitly signals the
 *    intent changed, via resetIntent() (e.g. the user edits the form after a failed submit).
 *  - the TRD §4 error envelope surfaced to the caller as `error`, never swallowed: submit()
 *    both sets `error` and re-throws, so a caller that wants to know can await it.
 */

import { useCallback, useRef, useState } from "react";
import { ApiError } from "./api-client";

export interface UseSubmitGuardResult<TArgs extends unknown[], TResult> {
  submit: (...args: TArgs) => Promise<TResult | undefined>;
  isPending: boolean;
  error: ApiError | Error | null;
  /** Stable for the lifetime of the current intent; pass to api-client as Idempotency-Key. */
  idempotencyKey: string;
  /** Call when the underlying intent changes (form edited after a failed submit, dialog reopened for a different target). */
  resetIntent: () => void;
}

function mintKey(): string {
  return crypto.randomUUID();
}

export function useSubmitGuard<TArgs extends unknown[], TResult>(
  handler: (idempotencyKey: string, ...args: TArgs) => Promise<TResult>
): UseSubmitGuardResult<TArgs, TResult> {
  const submitting = useRef(false);
  // Lazy one-time mint: a plain `useRef(mintKey())` would call mintKey() on every render
  // and throw the result away, which is wasteful and (worse) invites a future edit to
  // accidentally read the wrong render's value. Null-check init keeps it unambiguous.
  const keyRef = useRef<string | null>(null);
  if (keyRef.current === null) {
    keyRef.current = mintKey();
  }

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const resetIntent = useCallback(() => {
    keyRef.current = mintKey();
    setError(null);
  }, []);

  const submit = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (submitting.current) {
        // Already in flight for this intent — drop the duplicate dispatch silently. This
        // is the one place in the app allowed to swallow a "failure": there is no error,
        // just a redundant click that must not become a second request.
        return undefined;
      }
      submitting.current = true;
      setIsPending(true);
      setError(null);

      try {
        // keyRef.current is guaranteed non-null by the lazy-init above.
        const key = keyRef.current as string;
        return await handler(key, ...args);
      } catch (caught) {
        const normalized = normalizeError(caught);
        setError(normalized);
        throw normalized;
      } finally {
        submitting.current = false;
        setIsPending(false);
      }
    },
    [handler]
  );

  return {
    submit,
    isPending,
    error,
    idempotencyKey: keyRef.current,
    resetIntent,
  };
}

function normalizeError(caught: unknown): ApiError | Error {
  if (caught instanceof ApiError) return caught;
  if (caught instanceof Error) return caught;
  return new Error("Unknown error while submitting.");
}
