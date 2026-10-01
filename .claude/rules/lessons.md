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

## 2026-10-01

- Building a response with `schema.parse({ ... })` hides missing fields from TypeScript, because
  `parse` takes `unknown`. Add `satisfies TheType` to the object literal. A new `ActorContext.access`
  field was missed this way in the invitation claim and crashed every staff join.
- A timed-out integration test leaves its query running and holding locks, and the next run hangs
  behind it. Terminate `drezivo_branch_test` backends, or recreate the database, before re-running.
- Seed tests that bulk-insert then query should `ANALYZE` the tables. Stats sampled while a table
  was empty produced a minutes-long nested-loop UPDATE.
- `lpad(n::text, 3, '0')` truncates 1000 to "100". Size the pad to the largest seed count.
- Retiring a plan must be refused at selection time. A later refusal (bootstrap) strands the owner
  on an onboarding that can never finish.
- Cross-repository signed formats (operator proof links) need one shared test vector in both
  repositories. Allow clock skew when checking the expiry, because the hosts differ.
- Run every workspace's own test script before pushing (`npm run test --workspace @drezivo/contracts`
  included). CI runs the contracts tests, and fixtures there break when a contract gains a field.
- Never cache a storefront read whose answer can become "not found" (publish state, access). When
  a revalidation gets a 404, Next keeps serving the cached 200, so an unpublished or lapsed store
  stayed online indefinitely. Verify caching behavior on a production build, not `next dev`.
- After editing shared code, restart the Turbopack dev server before trusting a route's behavior;
  an already-compiled route kept running the old module and looked like a real bug.
- A contract field with `.default()` is required in `z.infer` (the output type), so test fixtures
  typed as the parsed request need the new field even though the API accepts it missing.
- When CSS sets a start state with `translateY(105%)`, animate GSAP to `y: 0`, not `yPercent: 0`:
  GSAP reads the computed matrix into `y` pixels, so a `yPercent` tween leaves the offset in place
  (the landing headline, every line reveal, and the preloader wordmark all stayed hidden).
- Next's `<Link>` handles clicks in React's root listener before any `document` bubble listener sees
  them. To run a page transition first, listen in the capture phase and `preventDefault()` there;
  Link then skips its own navigation.
- Anything visible at first paint (a preloader, a mosaic overlay) must be sized by CSS, never by a
  JavaScript measurement after hydration: the mosaic re-gridding from 12x8 to 5x11 cost 0.44 CLS.
- Headings split into per-line spans need a trailing space in each line, or the accessible name
  reads words glued together ("Plans that growwith your shop").
- A three.js `ShaderMaterial` that includes `colorspace_fragment` treats its output as linear; author
  colours in sRGB and convert (`pow(c, 2.2)`) or dark grounds come out lifted and muddy.
- Route-level CSS files are unlayered and beat Tailwind utilities; never set `display` in a class
  that a utility like `hidden lg:grid` has to toggle.
- Marketing pages are always on paper; never style them with app theme tokens (`text-foreground`,
  `prose-invert`, `dark:` variants). An OS in dark mode turns that into light text on light paper.
  QA marketing pages with `colorScheme: 'dark'` and `'light'`, not just the browser default.
- Never `git worktree remove --force` a worktree whose `node_modules` are junctions into the main
  checkout: it deletes through them (it wiped `api/`, part of `app/`, and both env files). Remove
  the junctions first with `cmd /c rmdir`, check none remain, then `git worktree prune`.
- Marketing sizes come only from the fluid scale in `web/src/app/globals.css` (`--text-at-*`,
  `--spacing-at-*` → `text-at-hero`, `py-at-section`, …). Never add a raw `text-[1.0625rem]` or a
  one-off `clamp()`. Coded app mockups use `.at-m-*`, which is relative to the mockup root;
  plain `em` compounds when nested (a 0.6875em chip inside a 0.75em list renders at 0.52).
- Check marketing layouts from 280px to 1440px with `qa-widths.mjs`, not just at 390px.
  `whitespace-nowrap` headlines need a font token that fits the narrowest phone.
- Lenis `scrollTo(element)` already subtracts the target's CSS `scroll-margin-top`. Adding an
  `anchors.offset` as well applies the offset twice. Keep one offset: scroll-margin.
- After a client-side route change, call `lenis.resize()` before scrolling to a `#hash`. Lenis
  keeps the previous page's scroll limit and clamps the target short.
- In a phone swipe row, a scroll-scrubbed reveal on the off-screen card plays unseen. Use
  `gsap.matchMedia` and give phones a one-shot scene that brings the card into view.
