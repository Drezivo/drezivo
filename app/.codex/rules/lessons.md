# Lessons

Append-only. Newest entry on top. Each entry: what broke, why, the fix, and how to spot it
next time. Never delete an entry — if a lesson stops applying, say so in a new entry instead
of erasing the old one; the history of what we got wrong is the point.

---

## 2026-09-15 — The submit guard is one shared hook, not per-screen code

**What could break:** Every mutating control (confirm a reservation, verify payment
evidence, publish the storefront, save a settings form) needs the same three things: a
ref-backed in-flight guard, one idempotency key per user intent reused across retries, and
the TRD §4 error envelope surfaced instead of swallowed. It would be easy to write this
inline in each dialog/form — a `useState` pending flag and a `useRef` for the key — since
none of it is hard on its own.

**Why that's wrong:** A per-screen guard is forgotten exactly once, and that once is a
double charge. Nine route groups and growing means nine (and counting) chances to get the
ref-vs-state distinction wrong, forget to reuse the key on retry, or swallow an error
silently. A shared hook (`src/lib/use-submit-guard.ts`) makes the correct behavior the path
of least resistance — a new mutating control gets it for free by calling the hook, and a
missing double-fire test is a visible gap in review rather than a subtle bug in one screen.

**The fix:** `useSubmitGuard` is the only sanctioned way to wire a mutating control. Every
new one is built by copying `confirm-reservation-dialog.tsx` or
`evidence-review-dialog.tsx`, not by re-deriving the guard logic. `lib/api-client.ts` also
enforces this at the network layer — `assertMutationHasIdempotencyKey` throws if a POST/
PATCH/DELETE reaches it without a key, so a screen that bypasses the hook fails loudly in
development instead of silently shipping an unguarded write.

**How to spot it next time:** grep for `fetch(` or a bare `api.post(`/`api.patch(` call
outside `use-submit-guard.ts` and `api-client.ts` itself — if a component calls the client
directly without going through `useSubmitGuard`'s `submit()`, that's the same mistake
recurring.

## 2026-09-15 — Scaffold verification

Use the exact packed contracts filename `rentivoo-contracts-0.1.0.tgz`. Poll long-running install/build sessions through completion. Shell hooks retain `.sh`; CommonJS hooks need an explicit module scope. Codex settings mirrors are reference-only, not native hook registration.
