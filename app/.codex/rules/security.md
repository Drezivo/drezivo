---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/lib/**"
  - "tests/**"
  - "src/middleware.ts"
---

# Security

This repo has no server-side business logic to secure directly (TRD §1) — these rules cover
the client-side authentication boundary and safe handling of user-facing errors.

- `src/middleware.ts` is the only route gate. New routes are protected by default (deny
  list, not an allow list) — adding a public route means editing `isPublicRoute` there
  deliberately, not adding an early return somewhere else.
- Do not call protected backend endpoints from the authentication surface. If an API boundary
  is added later, document its token and error-handling contract before wiring it in.
- Never log or render raw Clerk error details or stack traces to the user; show a safe generic
  message and keep diagnostic details in development-only logs.
- Never persist a Clerk token or response containing PII in `localStorage` or `sessionStorage`.
- Constant-time comparison and secret handling belong to the backend; if that logic appears in
  this codebase, stop and move it to the owning service.
