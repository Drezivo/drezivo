---
paths:
  - "tests/**"
  - "src/lib/**"
  - "src/components/**"
---

# Testing

- Verify behavior, not implementation. Authentication tests assert the user-visible state and
  Clerk boundary calls — never the number of renders.
- Unit tests (Vitest + Testing Library) live in `tests/unit/`; end-to-end tests (Playwright)
  live in `tests/e2e/`. Run the specific file after changes (`npx vitest run <file>`), not
  the full suite.
- Flaky test? Fix it or delete it. Never retry to make it pass.
- Prefer real implementations. Mock only at system boundaries, such as Clerk hooks, never
  React itself.
- One behavior per test, Arrange-Act-Assert, descriptive names
  (`"fires exactly one request when submit is invoked twice before the first resolves"`).
- Never `expect(true)` or assert a mock was called without checking its arguments — the
  idempotency-key tests specifically assert the key *values*, not just call counts.
- `tests/e2e` cannot fabricate a signed-in Clerk session without real test credentials. Keep
  E2E coverage focused on anonymous auth routes until test credentials exist.
