'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * The non-negotiable submit guard for every mutating control in this repo.
 *
 * Why this exists: a customer on a slow Philippine mobile connection who taps
 * "Reserve" three times must produce exactly one hold, not three. The
 * `disabled` HTML attribute alone is not sufficient — it is bypassed by a
 * keyboard Enter/Space fired before React re-renders, and by two pointer
 * events landing in the same tick before state commits. The guard below is a
 * ref, not state: it updates synchronously, so a second dispatch in the same
 * tick sees it immediately, before any re-render has happened.
 *
 * Idempotency contract (Drezivo-TRD.md, "Idempotency contract"): generate one
 * key per user INTENT, not per attempt. Reuse the same key across retries
 * (timeouts, dropped connections) so the server treats a retry as a replay of
 * the same request, not a new one. Only mint a new key when the user edits
 * the underlying intent (e.g. picks different rental dates) — call
 * `resetIntent()` for that; never mint a key inside `submit` itself.
 */

export interface SubmitGuardResult<TResult> {
  /** Wraps the mutation. A call that arrives while a previous call from this
   *  same hook instance is still in flight is dropped — it resolves to
   *  `undefined` without invoking `action` again. */
  submit: () => Promise<TResult | undefined>;
  isPending: boolean;
  error: Error | null;
  /** Send this as the `Idempotency-Key` header (or equivalent request field)
   *  on every attempt for the current intent, including retries. */
  idempotencyKey: string;
  /** Call when the user changes the intent itself (different dates, a
   *  different size) so the next `submit()` mints a fresh key. Do not call
   *  this on a failed attempt the user is simply retrying unchanged. */
  resetIntent: () => void;
}

function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function useSubmitGuard<TResult>(
  action: (idempotencyKey: string) => Promise<TResult>,
): SubmitGuardResult<TResult> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(generateIdempotencyKey);

  // Ref mirror of "is a request in flight". `isPending` state exists only to
  // drive the UI (disabled attribute, spinner) — it is not trustworthy as the
  // guard itself because state updates are asynchronous/batched. This ref is
  // read and written synchronously, so it is the actual double-submit guard.
  const inFlightRef = useRef(false);

  const submit = useCallback(async (): Promise<TResult | undefined> => {
    if (inFlightRef.current) {
      // The guard. A second tap, a keyboard repeat, or a stray duplicate
      // dispatch while a request is already in flight does nothing. Do not
      // "simplify" this away — this line is the whole point of the hook.
      return undefined;
    }

    inFlightRef.current = true;
    setIsPending(true);
    setError(null);

    try {
      return await action(idempotencyKey);
    } catch (caughtError) {
      const normalizedError =
        caughtError instanceof Error ? caughtError : new Error(String(caughtError));
      setError(normalizedError);
      // The idempotency key is deliberately NOT rotated on failure. If the
      // user taps "Reserve" again after a timeout, that retry must carry the
      // same key so the server replays the original outcome (or the winning
      // concurrent attempt's outcome) instead of creating a second hold.
      throw normalizedError;
    } finally {
      inFlightRef.current = false;
      setIsPending(false);
    }
  }, [action, idempotencyKey]);

  const resetIntent = useCallback(() => {
    setIdempotencyKey(generateIdempotencyKey());
  }, []);

  return { submit, isPending, error, idempotencyKey, resetIntent };
}
