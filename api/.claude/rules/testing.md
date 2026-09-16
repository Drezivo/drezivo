---
paths:
  - "tests/**"
  - "src/lib/**"
  - "src/components/**"
---

# Testing

- Verify behavior, not implementation. `tests/unit/use-submit-guard.test.tsx` asserts the
  handler was called once and with which idempotency keys — never the number of renders.
- Unit tests (Vitest + Testing Library) live in `tests/unit/`; end-to-end tests (Playwright)
  live in `tests/e2e/`. Run the specific file after changes (`npx vitest run <file>`), not
  the full suite.
- Flaky test? Fix it or delete it. Never retry to make it pass.
- Prefer real implementations. Mock only at system boundaries — `tests/unit` mocks the
  handler function passed into `useSubmitGuard`, never React itself.
- One behavior per test, Arrange-Act-Assert, descriptive names
  (`"fires exactly one request when submit is invoked twice before the first resolves"`).
- Never `expect(true)` or assert a mock was called without checking its arguments — the
  idempotency-key tests specifically assert the key *values*, not just call counts.
- Every new mutating dialog/form follows `confirm-reservation-dialog.tsx`'s pattern
  (`useSubmitGuard` + `useApiClient`); a PR adding one without a corresponding double-fire
  test is incomplete (CONTRIBUTING.md §3 checklist).
- `tests/e2e` cannot fabricate a signed-in Clerk session without real test credentials —
  until those exist, E2E coverage is limited to what's true for an anonymous visitor (see
  `tests/e2e/auth-redirect.spec.ts`). Don't skip writing the anonymous-path tests just
  because the authenticated path isn't covered yet.
