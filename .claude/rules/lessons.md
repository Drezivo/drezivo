# Durable lessons

## 2026-09-16

- The root guide owns cross-repository orientation; implementation rules remain with each repo.
- `.codex` is a generated mirror for agent discovery. `.claude` remains the editable source.
- Local contracts bootstrap uses the exact filename `rentivoo-contracts-0.1.0.tgz`.

## 2026-09-30

- After Clerk sign-in, Clerk navigates to the fallback URL and then calls `router.refresh()`. A fast
  `router.replace()` from that page can be cancelled by the refresh, leaving it stuck. Leave
  post-auth pages with `window.location.replace()`, and run the resolution once per sign-in.
- Clerk's Next.js `setActive` settles only when its cache-invalidation server action succeeds; it
  has no failure path. Always bound it with a timeout that surfaces a retryable error.
- Owner previews of unpublished storefronts use Next Draft Mode plus an httpOnly, store-scoped
  token cookie; public pages stay cached, and the API opens reads only, never guest writes.
- Grid children holding long unbreakable text (URLs) need `min-w-0` / `minmax(0,1fr)` columns,
  or they push siblings such as a Copy button out of the card.
