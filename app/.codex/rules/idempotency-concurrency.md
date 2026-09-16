# Idempotency, Concurrency & Security — NON-NEGOTIABLE

> AUTO-LOADED. Standing client directive (origin: ORION double-submit review, 2026-07-18).
> Absolute rules: a change violating any of them is wrong even if it "works".
> Scenario that must NEVER be possible: slow internet, user presses a button 3×, three
> requests fire, three business effects happen. One press = one effect.

## Frontend (every mutating control)

1. Every handler issuing a mutating request (POST/PATCH/PUT/DELETE) has an **in-flight
   guard**: the triggering control is `disabled` with a pending state AND the handler
   early-returns when already pending (state/ref — the disabled attribute alone is not
   enough; keyboard/double-dispatch bypasses it).
2. Dialogs must not allow confirm → close → reopen → confirm to fire a second live request
   for the same intent.
3. Where the backend accepts `Idempotency-Key`, generate the key **once per user intent**
   (dialog open / ref), never per attempt — a retry after timeout must reuse the key.
4. Prefer one shared submit-guard hook/util per project; don't hand-roll the guard per screen.

## Backend (every mutating endpoint)

5. Every mutating endpoint carries at least ONE of:
   a. **Idempotency-Key store** (replay returns the original result);
   b. **Conditional state-transition UPDATE** (`... WHERE id=? AND status='expected'`,
      rowcount checked; loser gets 409/no-op replay) with ALL side effects inside the
      winning branch/transaction only;
   c. **DB unique constraint** + graceful unique-violation recovery — the recovery re-query
      MUST run outside the aborted transaction (Postgres aborts the whole tx on error);
   d. Delegation to a **central idempotent posting/transaction layer**.
6. Duplicate delivery — sequential or concurrent — produces exactly one business effect.
   The duplicate returns the prior result or a clean 409, never a 500, never a second effect.
7. Every NEW mutating endpoint ships with a **double-fire test**: two sequential identical
   requests and two concurrent (`Promise.all`) identical requests → assert single effect.
8. No fire-and-forget side effects. Crash-surviving work goes through an outbox/queue with
   lease-claim (conditional UPDATE) + bounded retry, ending in a terminal state — never
   silently dropped, never unbounded retry.

## Security imperatives

9. Validate ALL input at the boundary (schema validation); unknown fields rejected or
   stripped. Parameterized queries only; never string-build SQL/shell from user input.
10. Constant-time comparison for secrets/tokens. Webhook HMAC is computed over the exact
    raw bytes received, never a re-serialization.
11. Never log or return secrets, tokens, password hashes, or PII. Secrets live in env /
    gitignored files only — never in tracked code or docs.
12. Auth endpoints rate-limited; generic auth errors (no user enumeration); session/JWT
    expiry enforced server-side.
13. Server-side authorization on every route, tenant/scope-aware; the client is never
    trusted for scope, role, price, or cost fields (server recomputes money/quantities).
14. Fail closed: an unrecognized enum/route/state in a validation chain is a rejection,
    never a pass-through.
