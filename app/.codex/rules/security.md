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
the client-side half of the security boundary: auth wiring, the API client, and never
leaking what the server sends back.

- `src/middleware.ts` is the only route gate. New routes are protected by default (deny
  list, not an allow list) — adding a public route means editing `isPublicRoute` there
  deliberately, not adding an early return somewhere else.
- All API calls go through `lib/api-client.ts`'s `useApiClient()`. Never call `fetch()`
  directly against the API from a component — it would skip the fresh-token/fresh-org read,
  the request_id header, and the error envelope parsing.
- `lib/permissions.ts`'s `can()` is UX only. Never use it as the reason a mutating request
  is allowed to be sent — the server is the actual authorizer. Don't write a comment that
  says "safe because the UI already checked this."
- Never log or render a raw `ApiError` stack trace to the user; show `message` and
  `requestId` only (see `src/app/error.tsx`).
- Never persist a Clerk token or API response containing PII in `localStorage`/
  `sessionStorage`. TanStack Query's in-memory cache is fine; anything on disk is not.
- Constant-time comparison and secret handling are the API's problem, not this repo's — if
  you find yourself comparing a token or secret value in this codebase, stop, that logic
  does not belong here.
- Rate-limiting and generic auth errors are enforced server-side; this repo only renders
  what the API returns and must never invent a more specific error message than the
  envelope provided (avoids leaking which part of a credential was wrong).
