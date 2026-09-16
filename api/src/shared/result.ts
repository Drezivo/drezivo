/**
 * A minimal discriminated-union Result type for domain code paths where "did not happen"
 * is an expected outcome, not an exceptional one (e.g. "hold already expired" during a
 * confirm attempt) — AGENTS.md forbids `null`-as-error-sentinel, so those paths return a
 * typed Result instead of throwing AND instead of returning a bare null. Reserve thrown
 * AppError subclasses (see errors.ts) for outcomes that should end the request; use Result
 * for outcomes a caller is expected to branch on.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
