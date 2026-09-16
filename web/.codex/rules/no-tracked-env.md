---
paths:
  - "**/.env*"
  - ".env.example"
---

# No tracked env files

Every `.env*` file is gitignored. The one exception is `.env.example`, which is tracked and
carries variable **names only** — never a real value, never a working credential, never
anything that looks like one even as a placeholder that could be copy-pasted into production.

## Required variable names (values documented in `docs/runbooks/environments.md`, never here)

- `NEXT_PUBLIC_API_BASE_URL` — the public Express API origin this site calls.
- `NEXT_PUBLIC_SITE_URL` — the canonical `drezivo.com` origin used for SEO and canonical tags.
- `GUEST_CAPABILITY_COOKIE_DOMAIN` — the parent domain the HttpOnly guest capability cookie is
  scoped to.

A missing required variable must fail fast at startup with a clear message, never silently at
the first request that needs it.

## If a secret or `.env` file is ever accidentally committed

1. **Rotate the leaked value first, immediately.** The credential is burned the moment it is
   pushed — clones, forks, and provider caches keep it regardless of what happens next.
2. Only after rotation, scrub history (e.g. `git filter-repo` / BFG) to reduce future exposure.
3. Deleting the file and considering it handled is never acceptable — the value is already
   compromised and must be treated as such until rotated, not just removed from the tree.
