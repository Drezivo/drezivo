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
- Streaming (`loading.tsx`) plus pathname-keyed GSAP breaks storefront motion: the effect runs before
  the page exists and GSAP touches unhydrated HTML. The storefront has no `loading.tsx`, and every
  reveal target unbound by GSAP (`data-motion-bound`) reveals itself via a CSS fallback.
- With Lenis, handle same-page `#section` links yourself (capture click, `preventDefault` only, so
  the link's own onClick still runs), resize Lenis after route changes, and queue scrolls until any
  scroll lock (menu, drawer) is released. `scroll-margin-top` is the single header offset.
- `useSubmitGuard` must clear the idempotency key after success and after definite 4xx
  rejections; keeping it made the next save (new version in the body) fail as
  IDEMPOTENCY_KEY_REUSED. Keep the key only for network, 408, 429, and 5xx retries.
- Browsers report an image's type from its extension. Detect JPEG/PNG/WebP from the first bytes
  before authorizing an upload; web images are often JPEGs named `.png`.
