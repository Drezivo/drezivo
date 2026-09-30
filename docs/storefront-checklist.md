# Storefront, Storefront CMS, and Settings Checklist

Living tracker for the public storefront, the owner-facing storefront CMS, and the business
settings area. Each box is ticked only after the listed verification has run and passed.

> Branch: `feat/storefront-cms-settings` (cut from `main` at `a5bea80`, 29 September 2026)
>
> Working copy: a fresh clone outside the shared checkout, so no local work-in-progress is touched.
>
> Push/merge: the branch stays local until the repository owner approves a push.

---

## Scope

| Area | Outcome |
| --- | --- |
| Public storefront (`web`) | Each published business gets a storefront at `/s/<slug>`: home, catalog, item detail, a rental-date drawer, guest reservation request, confirmation, guest status page, fitting request, rental info, and contact. All of it reads live API data instead of the static demo client. |
| Storefront CMS (`app`) | The owner edits identity, logo, cover, hero text, about text, contact and social links, homepage sections, featured clothing, rental policies, customer requirements, and store options. The owner can also preview, publish, and unpublish. |
| Settings (`app`) | Business information, regional settings, business preferences, notifications, security, and account (profile, authentication, sessions, preferences). |
| API (`api`) | Staff CMS and settings endpoints, the public read endpoints, and the guest verification, hold, receipt, and fitting-request endpoints. |

Out of scope, so it is not built: marketplace browsing, reviews and ratings (not in the data model),
a shopping cart or multiple garments per checkout, online payment gateways (V1 is manual QR or
transfer plus a receipt), and customer accounts.

## Decisions recorded before building

1. **Public fitting requests ship now.** The PRD deferred customer self-booking of fittings. The
   product owner asked for it on 29 September 2026. The existing channel-neutral fitting
   transaction is reused, and every public request starts as `pending` for staff review. This
   is recorded in `docs/decisions/0010-storefront-cms-and-guest-requests.md`.
2. **CMS content lives on the existing `storefront` row.** It uses the `branding`, `contact`,
   and a new `content` JSONB column. A strict Zod schema in `contracts` validates it, so nothing
   free-form reaches the database. Nothing is stored as raw HTML: text is plain and escaped on
   render.
3. **Optimistic concurrency.** `storefront.version` and `tenant_settings.version` make every edit
   a conditional `UPDATE ... WHERE version = $n`. A double submit or a stale tab gets `409`
   instead of silently overwriting.
4. **Email verification needs a delivery adapter.** None exists yet. Add an `EmailSender`
   interface with a local file sink for development and a Resend HTTP sender for deployed
   environments. In production, guest verification fails closed (`503`) when no sender is
   configured.
5. **Account, security, and sessions use Clerk's own profile component.** Password, 2FA, email
   and session revocation stay with the identity provider. Nothing is re-implemented.
6. **Currency stays PHP.** The money code is PHP-only in V1, so the currency setting is shown but
   locked.

## Security baseline (applies to every milestone)

- Every request body, query, and parameter is validated with a strict Zod schema at the boundary.
  Unknown keys and unknown enum values are rejected.
- Staff routes use Clerk auth, tenant context, and a permission check. Storefront and settings
  writes are Owner-only; reads are open to staff.
- Public routes resolve the tenant from a **published** slug only. A draft or unknown slug returns
  `404`, never `403`.
- Public responses are explicit DTO allowlists. No tenant id, branch id, asset id, customer data,
  or payment destination secret is returned before a hold exists.
- Public routes have a per-IP rate limit. Verification codes are also rate-limited per email
  address, attempt-limited (5), expire after 10 minutes, and are stored only as hashes. The
  resend endpoint always returns the same generic answer.
- Guest capability tokens are 32 random bytes. Only the SHA-256 hash is stored, and the tokens
  are scoped, expiring, and revocable. They never appear in URLs, local storage, or logs.
- Every mutation is duplicate-safe, using an `Idempotency-Key` store or a conditional state
  transition. New mutating endpoints ship with sequential and concurrent double-fire tests.
- Money, availability, and policy snapshots are always recomputed on the server.
- Request bodies, codes, tokens, and personal data are never logged.

---

## Milestone 0 — Prerequisites

- [x] Fresh clone on `main`, feature branch created.
- [x] `npm ci` succeeds (npm cache and temp on E:, because C: is full).
- [x] Baseline `typecheck`, `lint`, and `test` recorded before any change, so pre-existing failures
      are not blamed on this work.
- [x] Local stack: embedded PostgreSQL with all migrations applied, local S3-compatible storage,
      API, app, and web running against it. All data is local and disposable.
- [x] Reference study: `arquila.store` and `velissegowns.com` (visual system) plus
      `RootResource/Storefront` and `RootResource/Business` (flows) captured and summarized.

Baseline on `main` `a5bea80`, after building `contracts` (api, app, and web resolve it from `dist/`):

| Workspace | Typecheck | Tests |
| --- | --- | --- |
| contracts | clean | 147 passed |
| api | clean | 87 passed |
| app | clean | 223 passed, **14 failed before this work** (clothing, dashboard shell, onboarding, sign-in, reservations) |
| web | clean | 22 passed, **4 failed before this work** (static api-client, hold date selector, confirmation, submit guard) |

Local stack: embedded PostgreSQL 17 on `127.0.0.1:55640` (all 61 migrations applied by `npm run db:migrate`).
MinIO community builds are no longer published, so a small local S3 stand-in outside the repo runs on
`127.0.0.1:9100`. It verifies `x-amz-checksum-sha256` like S3.

## Milestone 1 — Contracts and database

- [x] `contracts/src/storefront/cms.ts`: branding, contact, content, checkout requirements, policy
      rules, slug, readiness, and the staff request and response shapes. Text is plain and
      bounded: control characters are rejected, and single-line fields reject line breaks.
      Social profiles are stored as handles, so the server builds every public URL.
- [x] `contracts/src/storefront/storefront.ts` and `catalogue.ts`: the public storefront, catalogue,
      item detail, day availability, and fitting slots. They replace the unused scaffold shapes.
- [x] `contracts/src/storefront/guest-booking.ts`: email verification, guest reservation request,
      receipt upload and submit, and guest fitting request. The superseded `holdIntentRequest`,
      `holdIntentResponse`, `guestAccessGrant`, and the old `guestReservationView` were removed.
- [x] `contracts/src/tenancy/settings.ts`: business information and notification preferences.
      Timezone and currency are read-only, because V1 money and time rules are PHP and
      Asia/Manila only.
- [x] Migration `0060_storefront_cms_settings.sql`:
  - storefront `content`, `checkout`, `version`, and `updated_at`, with shape checks;
  - `tenant_settings`, backfilled for existing tenants;
  - `guest_email_verification`, which stores digests and hashes only;
  - forced RLS and least-privilege grants on both new tables;
  - `resolve_guest_access_tenant()`, a `SECURITY DEFINER` tenant lookup for guest tokens.
- [x] Verified:
  - the migration applies on an empty database, and a re-run is a no-op through the ledger;
  - the app role sees no rows without tenant context;
  - `contracts` typecheck and lint are clean, and 158 tests pass;
  - OpenAPI regenerates.

## Milestone 2 — Staff API: storefront CMS and settings

- [x] `GET /storefront`: document, status, slug, public path, current policy, signed image
      previews, and publish readiness.
- [x] `PATCH /storefront`: replaces the whole document on a version check. Images must be accepted
      `storefront_asset` files from the same workspace. Featured items must be active clothing
      from the same workspace.
- [x] `POST /storefront/slug`: contract-validated and reserved-word-checked. A taken address
      returns `409`.
- [x] `POST /storefront/publish` and `POST /storefront/unpublish`: conditional transitions.
      Publishing requires all of:
  - a real policy;
  - active clothing;
  - a ready storefront payment method;
  - a contact phone or email.

  A suspended storefront cannot be republished by the owner.
- [x] `POST /storefront/policies`: appends the next immutable version. The policy JSON keeps the
      `delivery_rules.enabled` and `fee_minor` keys the booking quote already reads.
- [x] `GET /settings/business` and `PATCH /settings/business`. The business name updates
      `tenant.name`.
- [x] `GET /settings/notifications` and `PATCH /settings/notifications`.
- [x] Shared helpers:
  - `api/src/shared/idempotent-command.ts` handles claim, replay, and key reuse, runs the
    command's writes inside a savepoint, and records the outcome;
  - `api/src/middleware/staff-command.ts` provides the staff context, the key header, handlers,
    and the per-workspace rate limit.
- [x] Verified with `api/tests/integration/storefront-cms-settings.test.ts` and
      `storefront-cms-routes.test.ts` (10/10 on real PostgreSQL with RLS):
  - owner-only writes, with front desk getting `403`;
  - a stale version gets `409`;
  - a replay returns the identical response, and key reuse is rejected;
  - two concurrent edits of one version produce exactly one `200` and one `409`;
  - foreign images and products get `422`;
  - the publish gate works;
  - slugs are unique across workspaces;
  - unknown body keys get `422`;
  - a missing key gets `422`;
  - anonymous callers get `401`.

## Milestone 3 — Public read API

- [x] `GET /public/stores/:slug`: identity, content, sections, categories with counts, featured
      items (in owner order), new arrivals, policy, fulfillment, ready payment methods,
      checkout rules, and a fitting flag. The fitting flag is set only when fittings are enabled
      and the owner opted in.
- [x] `GET /public/stores/:slug/catalogue`: search across name, category, and description (LIKE
      wildcards are escaped), category, size, sort, and pages capped at 48, plus a size facet.
- [x] `GET /public/stores/:slug/products/:productId`: up to five images, active sizes, and
      measurements (custom values, the default guide image, or none).
- [x] `GET /public/stores/:slug/availability`: day states for one size, in store time. Days inside
      minimum notice are unavailable, and internal reasons collapse to `unavailable`.
- [x] `GET /public/stores/:slug/fitting-slots`: 30-minute starts inside the active branch Business Hours, with recurring closed weekdays, special closed dates, and capacity applied. It uses the same rules as fitting creation.
- [x] The repository was rewritten set-based. The old per-product image and variant loop (N+1)
      is gone. Images are signed in one query per response.
- [x] Fixed an existing bug: public product images were filtered on `is_private = false`, but
      staff uploads are always private, so the storefront would have shown no photos. The public
      read now signs accepted `catalogue_image` files.
- [x] `Cache-Control` headers:
  - catalogue data: `public, max-age=60, s-maxage=300, stale-while-revalidate=600`;
  - live data: `public, max-age=15, s-maxage=30`;
  - signed image URLs last one hour.
- [x] Per-IP limit of 240 reads a minute. `TRUST_PROXY_HOPS` (default 0) makes `req.ip` the real
      client behind a load balancer without trusting spoofed `X-Forwarded-For`.
- [x] Removed the 501 stub controller, DTO, and schema files. Four existing catalogue and fitting
      tests now read through the new service, and all 22 of their cases pass.
- [x] Verified with `api/tests/integration/storefront-public-read.test.ts` (5/5):
  - drafts, unknown slugs, and unpublished stores return `404`;
  - the projection contains no tenant, branch, or storefront id, account number, or storage key
    outside signed URLs;
  - the filters work, and `%` is matched literally;
  - `page_size` 500 and unknown keys get `422`;
  - an archived item returns `404`;
  - availability honours notice, a foreign size returns `404`, and a window over 62 days gets
    `422`;
  - fitting slots follow opt-in, active-branch Business Hours, recurring closed weekdays, special closed dates, and capacity.

> Accepted exposure: a signed image URL contains the files module's object key, which includes
> the tenant UUID. The UUID grants nothing, because no API trusts a browser-sent tenant id. If
> that changes, serve images through a CDN path keyed by file id.

## Milestone 4 — Guest reservation and fitting requests

- [x] Email sending (`api/src/integrations/email/email-sender.ts`):
  - an `EmailSender` interface with `FileEmailSender` (development) and `ResendEmailSender`
    (plain text, provider idempotency key, 10 s timeout);
  - chosen by `EMAIL_PROVIDER`. `none` makes verification answer `503` instead of pretending,
    and `file` is refused in production.
- [x] Notifications (`api/src/modules/notifications/email-notifications.ts`):
  - emails are composed in the business transaction, checked against the owner's preferences,
    and written to the outbox sealed with AES-GCM. No address or code is ever stored in
    plaintext;
  - the worker (`worker/handlers/email-delivery.ts`) only decrypts and sends, so it needs no new
    table access;
  - owner confirm, reject, and cancel now queue the matching customer email.
- [x] `POST /public/stores/:slug/verifications`:
  - a 6-digit code stored as a keyed digest, valid 10 minutes;
  - at most 5 codes per address per hour per store, and the answer is identical when throttled.
- [x] `POST /public/stores/:slug/verifications/confirm`:
  - 5 attempts per code, with a constant-time compare, and misses are committed;
  - it issues a 30-minute token, stored hashed, that can be spent 5 times.
- [x] `POST /public/stores/:slug/holds`:
  - it consumes the verification;
  - it enforces the checkout rules (required or hidden fields, handover time, whole days,
    notice, and maximum length);
  - it accepts online, storefront-ready payment methods only.

  The staff booking transaction was split into the shared `claimReservationAsset` and
  `createHeldReservation` steps, with staff behaviour unchanged. The guest capability is an HMAC
  of the reservation id, stored as a hash only, so retries replay the same token without it ever
  sitting in the idempotency store.
- [x] `POST /guest/reservations/:id/uploads` and `POST /guest/reservations/:id/receipts`:
  - the receipt key is bound to the reservation, and the object is checked for size, type,
    checksum, and magic bytes;
  - a successful submit attaches the receipt and moves the request to `pending_confirmation`
    in one transaction, then emails the customer and the owner.
- [x] `GET /guest/reservations/:id`:
  - the token is accepted only in a Bearer header, and responses are `no-store`;
  - a wrong or missing token gets a concealed `404`;
  - payment instructions (account details or a signed QR) show only while the request is open.
- [x] `POST /public/stores/:slug/fittings`:
  - it requires the owner's opt-in, a verified email, and a slot open by hours, closures, and
    capacity;
  - it creates a `pending` fitting with `booking_channel = 'storefront'` and preference-only
    garment lines.
- [x] Migration 0060 now also allows audit `actor_kind = 'guest'` and fitting
      `booking_channel = 'storefront'`. A too-strict published-timestamp check was dropped,
      because existing rows could have failed it on deploy.
- [x] Guest routes:
  - a 16 KB JSON body limit;
  - `no-store` responses;
  - per-IP budgets: 10 codes and 20 confirms per 15 minutes, 20 holds, 10 fittings,
    10 uploads, and 10 receipts.

  The old 501 `/holds` stub was removed.
- [x] Verified with `api/tests/integration/storefront-guest-booking.test.ts` (7/7) and
      `src/worker/handlers/__tests__/email-delivery.test.ts` (3/3):
  - codes are hashed, attempt-locked, and rate-limited, and a disabled provider gets `503`;
  - a replay returns the same token, and the token is absent from the idempotency store;
  - two guests racing for the last garment produce exactly one `201` and one `409`;
  - every checkout rule rejects, and a cash method gets `422`;
  - a foreign receipt gets `422`, and a double submit gets `409`;
  - emails go to the right recipients and are sealed;
  - a fitting slot race produces one `201` and one `409`;
  - a disabled preference sends nothing.

## Milestone 5 — Staff app: Storefront CMS and Settings

- [x] `/storefront`, the overview (follows the Manage Storefront reference):
  - cover and logo card, store address with copy, and social links;
  - a saved-draft preview in the chosen palette;
  - a details summary;
  - a status card with a clickable readiness checklist and publish or unpublish, disabled until
    the storefront is ready and hidden when suspended;
  - four cards: content, policies, requirements, and booking settings.
- [x] `/storefront/details`: name, tagline, description, four contrast-checked palettes, logo and
      cover upload (checksummed direct upload, finalized server-side), contact and social
      handles, and a store address change with a warning.
- [x] `/storefront/content`: announcement, hero, about, the seven section switches, and a
      featured clothing picker (up to 12, in pick order, with search).
- [x] `/storefront/policies`: rental, deposit, cancellation, damage, delivery (on or off, fee
      typed in pesos and stored in centavos), and privacy. Each save publishes a new immutable
      version.
- [x] `/storefront/requirements`: phone, social handle, and event date, each Required, Optional,
      or Don't ask. `/storefront/settings`: handover time, minimum notice, longest rental,
      online fitting requests, and links to Business Hours/Fitting Settings and payment methods. Public fitting slots consume the active branch Business Hours plus special closed dates; Storefront does not own a separate weekly fitting schedule.
- [x] `/settings`, with a section nav in the reference layout:
  - Business information: editable, with fixed regional details and a completeness summary;
  - Payment methods and Measurement guide: the existing pages, re-framed inside the nav;
  - Notifications: a master switch, renter and business emails, and a warning when no business
    email exists;
  - Profile and Security: Clerk's own profile component (password, 2FA, email, sessions), with
    the workspace role shown read-only.
- [x] Shared pieces:
  - `components/forms/form-kit.tsx`: field, switch, section, save bar, header, and states;
  - `lib/storefront-assets.ts`: the upload helper, now also used by the payment QR upload;
  - `StorefrontEditorProvider`: a submit guard per action, client validation with the same
    contract schemas, and field-level errors;
  - `useSettingsResource`: load, draft, and a guarded save.
- [x] Verified:
  - app typecheck is clean;
  - `tests/unit/storefront-cms-pages.test.tsx` passes 7/7: double-click saves send one request,
    an invalid email is blocked client-side with `aria-invalid`, the publish gate works, publish
    is called once, peso and centavo conversion is exact, and the business page saves once;
  - the full app suite is unchanged from the baseline (223 passed, the same 14 pre-existing
    failures).
- [x] Live browser walk-through on the local stack. The owner signed in, onboarded "Vergel's Suit
      Rental", and used the Storefront and Settings pages. Their findings are fixed in Milestone 9.

> Pre-existing tooling gap: `eslint` for `app` and `web` fails on `main` before any change
> (`eslint-config-next` cannot load `next/dist/compiled/babel/eslint-parser`). Typecheck and tests
> are the gates for these two workspaces until that dependency mismatch is fixed.

## Milestone 6 — Public storefront (`web`)

- [x] Design system taken from the two reference stores:
  - Newsreader (light serif display) and Jost (UI);
  - a full-bleed photo hero, hairline dividers, and no card shadows;
  - a 3:4 photo grid with name and price inline;
  - small tracked capitals on buttons only.

  The owner's palette arrives as `--sf-*` CSS variables (`components/store/theme.ts`, shared with
  the app preview through `STOREFRONT_THEMES`).
- [x] Home: announcement bar, hero, category index, featured, how renting works, new arrivals,
      about, before-you-rent, fitting call to action, and footer. Each section shows only when
      the owner enabled it and it has content.
- [x] Collection (`/catalog`): category tabs, search, size, and sort all live in the URL
      (shareable, Back works), with server-rendered page links and an empty state.
- [x] Item (`/items/:id`): gallery, sizes in garment order, price and deposit, tabs for Details,
      Measurements, and Rental info, Product JSON-LD, and per-item metadata.
- [x] Booking drawer: Dates → Details → Review → Pay → Request sent.
  - The calendar shows the reference legend (available, reserved, fitting, not available) and
    refuses a range that crosses a busy day or exceeds the maximum length.
  - Email verification, then details following the shop's requirements, pickup or delivery, and
    payment method.
  - Review shows an estimate, then the exact amounts from the server after the hold.
  - The pay step has a countdown, account details or QR, and a checksummed direct receipt upload.
  - One idempotency key per intent, and a 409 or 401 routes the guest back to the right step.
- [x] Rental info (`/policies`), fitting request (`/fittings`), and request status
      (`/booking#id.token`, `noindex`, no referrer).
- [x] The static demo storefront was removed: its static client, static capability, demo
      components, `/book/**`, `/guest/[token]`, demo tests, and demo images.
- [x] Verified with Playwright on the local stack (`E:/UserStorage/drezivo-local/sf-e2e.mjs`):
  - the full guest booking passes at 1440 px and 390 px with zero page errors;
  - a deliberate double click on "Hold my size" created exactly one reservation;
  - the request reached `pending_confirmation`;
  - the verification code, renter "request received", and owner "new request" emails were
    delivered by the worker.

  Every page has zero horizontal overflow at 1440 px and 390 px (the fittings overflow at 390 px
  was found and fixed). Web typecheck is clean. `tests/unit/storefront-format.test.ts` passes
  4/4; the web suite has 10 passing and the 1 pre-existing `use-submit-guard` failure.

## Milestone 7 — QA, security review, and falsification

- [x] Full end-to-end guest run (above). The owner-side CMS walk-through needs a Clerk sign-in
      (pending the owner).
- [x] Abuse checks (`E:/UserStorage/drezivo-local/security-probe.mjs`), all passing:
  - an HTML/JS payload stored in CMS text reaches the page escaped only;
  - draft and unknown stores both return `404`;
  - an injection-shaped slug is rejected;
  - a body over 16 KB and malformed JSON get `422`;
  - guest routes with no or forged tokens get `404`, and responses are `no-store`;
  - the verification rate limit trips (`429`);
  - a hold with a forged verification gets `401`;
  - staff routes without a session get `401`.
- [x] Found and fixed during QA:
  - public images were hidden by an `is_private` filter;
  - sizes sorted alphabetically instead of garment order;
  - a too-strict migration check could fail on existing rows;
  - off-month calendar days were announced as available to screen readers;
  - the fittings page overflowed on phones.
- [x] Final full-suite comparison with the baseline:
  - API integration: 386/386 (58 files);
  - API unit: 90/90;
  - security probe: 16/16.

  An earlier run showed 21 failures, and none came from product code:
  - one was a stale test expectation (alphabetical sizes), now fixed;
  - twenty came from a worn-out local `drezivo_test` database.

  In that database a 2 ms `physical_asset` update ran for over 5 minutes on a bad plan built from
  stale statistics. That run locked every other test out.

  Checked on fresh databases:
  - `main` passes the scale test;
  - this branch passes it 4 out of 4 times;
  - this branch passes the full suite.

  If local tests start timing out, recreate the test database.

## Milestone 8 — Documentation and hand-off

- [x] `docs/decisions/0010-storefront-cms-and-guest-requests.md` (the planned "0026" number was
      wrong; the repo's decisions are numbered from 0001, so it is 0010).
- [x] New variables in `docs/runbooks/environments.md`:
  - `TRUST_PROXY_HOPS`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`, `EMAIL_FILE_SINK_DIR`,
    and `STOREFRONT_PUBLIC_ORIGIN`;
  - app `NEXT_PUBLIC_STOREFRONT_ORIGIN`;
  - web `API_ORIGIN`, `NEXT_PUBLIC_API_ORIGIN`, and `NEXT_PUBLIC_SITE_URL`.
- [x] My docs are markdownlint-clean. The repo-wide `check:docs` fails on `main` before this work
      (115 table-style errors in other files, and a link to the private `SECURITY-FOUNDATION.md`).
- [x] Commit and push, approved by the owner: `829512a` on `origin/feat/storefront-cms-settings`.
      No PR opened and nothing merged.

## Milestone 9 — Fixes from the owner's walk-through

- [x] The storefront could not be tested without email delivery. `GUEST_VERIFICATION_MODE=dev_accept_any`
      (development only) sends no code and accepts any 6-digit code. This covers reservations and
      fitting requests alike.
  - Config refuses the mode when `NODE_ENV=production`.
  - A code is still bound to an address that asked for one, and to a published store.
  - Tests: `api/src/config/__tests__/guest-verification-mode.test.ts` and a new case in
    `storefront-guest-booking.test.ts`.
- [x] The pickup and delivery tiles changed only a hairline border, so a click looked like nothing
      happened. Both radio groups now use one `Choice` tile with a filled selected state and a
      visible keyboard focus ring.
- [x] Found while testing that: the calendar allowed ranges shorter than an item's minimum rental.
  - The server then refused the hold, and every 409 was shown as "Someone just reserved this size".
  - The calendar now enforces the same minimum the server does and says so in the dates step.
  - Any 409 now shows the server's own reason.
- [x] Clicking an image field on Storefront → Edit details scrolled the whole app shell up.
  - Cause: a visually hidden file input had no positioned ancestor inside the scroll pane.
  - Fixed in the field, and at the source: the shell's `main` scroller is now the positioning
    context for all pages.
- [x] Settings → Profile and Security showed the same Clerk panel, with its own duplicate menu.
  - Clerk's menu is now hidden, and our menu switches Clerk's hash route.
  - The highlight follows the page, and the role card shows on Profile only.
- [x] Settings → Measurement guide showed "Luna's Standard Measurement Guide" for every business.
  - The page kept its guide only in browser memory.
  - It now loads and saves the workspace's real default guide through the catalogue API, with
    one idempotency key per save and the upload done through the files module.
  - The in-memory context was deleted.
- [x] Storefront overview: a draft's address opened "Page not found" with no explanation.
  - It now says the link works after publishing.
  - Once the store is published, it offers an Open link.
- [x] Onboarding could sit on "Creating your workspace…" indefinitely while Clerk switched
      organizations.
  - That code predates this work.
  - After 20 seconds, the existing "Try loading workspace again" screen now appears. Retrying is
    safe because the workspace already exists.
  - Not reproduced locally: it needs a fresh Clerk sign-up.
- [x] Verified:
  - API, app, and web typecheck clean.
  - API config unit tests 12/12; guest-booking integration 8/8 on a fresh test database.
  - App unit tests: 232 passed. The same 14 failures fail on `main`, compared by name.
  - Web: 10 passed plus the one failure that also fails on `main`.
  - Playwright on the local store (`E:/UserStorage/drezivo-local/sf-dev-bypass.mjs`):
    - any code verifies;
    - a one-day range is refused with the minimum message;
    - the delivery and pickup tiles switch;
    - the hold reaches the payment step;
    - a fitting request is sent;
    - no page errors.

### Known gaps left as they are (outside this scope, recorded for follow-up)

- `eslint` for `app` and `web` cannot run on `main` (`eslint-config-next` parser mismatch).
- Two earlier gaps are now fixed in Milestone 10: dead-lettered domain events, and the missing
  drain mode.

## Milestone 10 — Worker hosting (Cloud Run Jobs, Stage 1)

- [x] Domain events no longer dead-letter.
  - The dispatcher that threw for every `reservation.*` event is removed.
  - The 10 event types the API writes to the outbox (reservation lifecycle and
    `payment.verified`) are acknowledged from one explicit list
    (`api/src/worker/handlers/domain-events.ts`), because nothing subscribes to them. Emails travel
    as `notification.email`.
  - Unknown types still dead-letter.
- [x] Drain mode: `WORKER_MODE=drain` runs the sweeps once, works through the outbox until it is
      empty or `WORKER_DRAIN_BUDGET_MS` is spent (checked between batches), then exits.
  - `WORKER_DRAIN_SCOPE=fast` only releases expired holds and sends email, for a 2-minute
    schedule. Expired holds block their garment until swept.
  - `SIGTERM` finishes the batch in hand.
- [x] Config: `WORKER_ENABLED` and `S3_FORCE_PATH_STYLE` accepted any non-empty text as true, so
      `WORKER_ENABLED=false` would have started the worker. They now accept only `true`/`false`.
- [x] `DREZIVO_ENV_FILE`: all worker secrets can live in one mounted Secret Manager file. It is
      read in every mode, real environment variables win, and a missing file stops startup.
- [x] Cloud Build config (`api/cloudbuild.yaml`) and a root `.gcloudignore` that excludes every
      `.env*`. The image can be built without local Docker, which crashes on this PC.
- [x] Runbook: `docs/runbooks/worker-cloud-run.md`, with the checked free-tier numbers and the
      PowerShell commands.
- [x] Verified:
  - API typecheck clean; `tests/integration/worker-drain.test.ts` 6/6 as `drezivo_worker`:
    empty, scoped, budget, two overlapping runs handle each row once, acknowledged and unknown
    types, stop; config unit tests 15/15.
  - The compiled `dist/worker.js` ran with `NODE_ENV=production` and a mounted settings file,
    and exited 0.
  - Production refuses `GUEST_VERIFICATION_MODE=dev_accept_any`.
  - Local Docker build not verified: Docker Desktop's engine crashed with `SIGBUS` on this
    machine.
- [ ] Owner creates the Google Cloud project and runs the runbook.

## Milestone 11 — Motion, UI/UX polish, and owner-side QA

Scope set by the owner on 2026-09-29: the business side (Settings and Storefront CMS) and the
storefront itself (workflow, alignment, design). Calendars were left untouched, as asked.

- [x] Storefront motion with GSAP (ScrollTrigger) and Lenis, all in
      `web/src/components/store/motion/motion-root.tsx`. Pages stay server-rendered and only carry
      `data-*` markers.
  - The hero is the one orchestrated moment: the photo settles, the heading rises from a mask, and
    the content fades as the visitor scrolls past it.
  - Photos unveil with a clip reveal, text eases in once, and product grids arrive in staggered
    batches.
  - The header tucks away on scroll down and returns on scroll up.
  - Route changes fade in, and item photos crossfade.
  - Reduced motion or no JavaScript shows everything immediately, without Lenis.
  - A shared scroll lock pauses Lenis for the menu and the booking drawer.
- [x] Found and fixed while checking the motion:
  - the hero heading stayed hidden, because GSAP kept the CSS start offset as pixels;
  - a hydration warning on `<html>`;
  - Next's smooth-scroll warning;
  - the storefront and app had no favicon;
  - the hero crop cut off faces;
  - the size tiles had no keyboard focus ring.
- [x] Owner-side walkthrough of all 12 Storefront and Settings pages at 1440 and 390 px, signed in
      as the owner (`E:/UserStorage/drezivo-local/owner-walk.mjs`), plus reversible edits
      (`owner-edit.mjs`). Found and fixed:
  - `/workspaces` and `/actor-context` share a limit of 30 requests a minute, and one full page
    load uses 4. After about seven reloads the whole dashboard showed "Workspace access needs
    attention". The limit is now 120 a minute per user.
  - The shell showed "Team Member" and "Workspace" when the actor context failed. It now shows
    nothing until the role is known, and retries with backoff.
  - Every Settings page overflowed on phones, because an implicit grid column took the menu's
    width.
  - On phones the Settings menu hid the current page off to the side. It now scrolls into view.
  - The Clerk profile was a white card with its own mobile menu. It now uses the dark dashboard
    tokens and has no duplicate menu.
  - The rental policy page showed example text only as placeholders, which a new shop could
    mistake for a written policy. A "Start from example text" button now fills it for editing.
  - The store address input silently dropped spaces. It now turns them into hyphens.
  - Unsaved changes were lost on reload. The shared save bar now asks first.
- [x] Verified:
  - `web`, `app`, and `api` typecheck clean.
  - App unit tests: 232 passed, with only the 14 failures that also fail on `main`. Web: only the
    1 failure that also fails on `main`.
  - Walkthrough: zero console errors and no horizontal overflow on every page at both widths.
  - Edits: a double-clicked save sent exactly one request; the tagline showed on the overview and
    was restored; `Vergel Suit` became `vergel-suit`; reload with edits prompted; the policy
    example filled the form and enabled Publish (nothing was published).
  - Guest booking and fitting flow re-run green.

## Milestone 12 — Owner preview, sign-in fix, layout and speed

- [x] Sign-in no longer sticks on "Opening your workspace". Clerk's post-sign-in
      `router.refresh()` cancelled the resolver's soft navigation. The resolver now runs once,
      leaves with `window.location.replace`, bounds `setActive` (10 s) and the whole check (20 s),
      and shows a retryable error instead of spinning.
  - Unit test: `app/tests/unit/post-auth-resolver.test.tsx`.
- [x] Owner preview of an unpublished storefront.
  - `GET /api/v1/storefront/preview` issues a one-hour HMAC token, derived from the digest key with
    a purpose label.
  - Public reads accept it via `X-Storefront-Preview`, answer `private, no-store`, and send
    `Vary`. Guest verification and holds stay published-only.
  - The web app enters preview through a POST route (the token is never in a URL), using Draft
    Mode plus an httpOnly cookie scoped to the store. It shows a preview bar, `noindex`, and
    booking and fitting requests turned off.
  - Integration test: `api/tests/integration/storefront-preview.test.ts`, 5 tests.
- [x] The sidebar opens expanded on first load.
- [x] The store address shows on its own wrapping line with Copy and Preview below it, so it
      never overflows the card (checked at 1440, 1024, and 390 px).
- [x] Speed.
  - Turbopack for `app` and `web` dev: the first visit to a page dropped from 1.5–4.5 s to about
    1 s, and warm navigation is 0.2–0.35 s including data.
  - `loading.tsx` for the dashboard and the storefront, so every click responds immediately.
  - The access gate shares the actor context with the shell, so each load makes one fewer API
    call.
  - The production build prerenders every dashboard page as static, with 170–256 kB of
    first-load JS.

## Milestone 13 — Section links, motion robustness, save and upload fixes

- [x] About and Contact links now scroll straight to their section.
  - They land just below the header, in 0.7 s, from the same page, from another page, during a
    scroll, and from the phone menu.
  - Verified: section top at 80 px in every case, with and without reduced motion.
- [x] The hero heading no longer sticks half-hidden after navigating. The storefront
      `loading.tsx` was removed: streaming ran the motion code before the page existed and caused
      a hydration warning.
  - Any unbound reveal target now shows itself after 2.5 s.
- [x] Saving the same form twice no longer fails with IDEMPOTENCY_KEY_REUSED (seen on fittings
      settings). The shared guard clears the key after success and after definite rejections, and
      keeps it only for retryable failures.
  - Tests: `app/tests/unit/use-submit-guard.test.tsx`.
- [x] Images with the wrong extension, such as a JPEG named `.png`, now upload. The real format is
      read from the file's bytes. HEIC, AVIF, and GIF get a clear message, and a rejected upload
      no longer loops on "can no longer be finalized".
  - Tests: `app/tests/unit/storefront-assets.test.ts`.
  - Verified end to end: finalize returned 200.

## Change log

| Date | Milestone | Change | Files |
| --- | --- | --- | --- |
| 2026-09-29 | 0 | Checklist created; branch cut from `main` `a5bea80` | `docs/storefront-checklist.md` |
| 2026-09-29 | 1 | CMS, public, guest-booking, and settings contracts; OpenAPI paths | `contracts/src/storefront/{cms,storefront,catalogue,guest-booking}.ts`, `contracts/src/tenancy/settings.ts`, `contracts/openapi/generate.ts`, `contracts/tests/*.test.ts` |
| 2026-09-29 | 1 | Migration for CMS columns, tenant settings, guest verification, guest tenant resolver | `api/src/db/migrations/0060_storefront_cms_settings.sql` |
| 2026-09-29 | 2 | Storefront CMS and settings services, routes, and shared command helpers | `api/src/modules/storefront-cms/*`, `api/src/modules/settings/*`, `api/src/modules/storefront/storefront-{media,policy}.ts`, `api/src/shared/idempotent-command.ts`, `api/src/middleware/staff-command.ts`, `api/src/app.ts` |
| 2026-09-29 | 2 | Integration fixture and tests | `api/tests/integration/helpers/storefront-fixture.ts`, `api/tests/integration/storefront-cms-{settings,routes}.test.ts` |
| 2026-09-29 | 3 | Public read service, set-based repository, routes with cache headers and per-IP limit; stub files removed | `api/src/modules/storefront/storefront.{repository,service,routes}.ts` (controller, dto, schemas deleted) |
| 2026-09-29 | 3 | `TRUST_PROXY_HOPS` config and `trust proxy` setting | `api/src/config/index.ts`, `api/src/app.ts` |
| 2026-09-29 | 3 | Public read tests; existing tests moved to the new service | `api/tests/integration/storefront-public-read.test.ts`, `catalogue-{archive-clothing-route,lifecycle-propagation,phase0}.test.ts` |
| 2026-09-29 | 4 | Email sender, sealed outbox notifications, worker delivery handler, config | `api/src/integrations/email/email-sender.ts`, `api/src/modules/notifications/email-notifications.ts`, `api/src/worker/handlers/email-delivery.ts`, `api/src/worker.ts`, `api/src/config/index.ts`, `api/src/shared/protected-recipient.ts` |
| 2026-09-29 | 4 | Guest verification, reservation, receipt, fitting services and routes; stub removed | `api/src/modules/guest-booking/*`, `api/src/modules/reservations/reservations.{command.service,command.repository,review.service,cancellation.service,controller,routes,service}.ts`, `api/src/modules/fittings/fittings.command.repository.ts`, `api/src/modules/files/files.service.ts`, `api/src/app.ts` |
| 2026-09-29 | 4 | Fitting channel `storefront`, audit actor `guest` | `contracts/src/fittings/state.ts`, `api/src/db/schema/fittings.ts`, `api/src/modules/fittings/fittings.repository.ts`, `api/src/db/migrations/0060_storefront_cms_settings.sql` |
| 2026-09-29 | 4 | Guest booking and email delivery tests | `api/tests/integration/storefront-guest-booking.test.ts`, `api/src/worker/handlers/__tests__/email-delivery.test.ts` |
| 2026-09-29 | 5 | App API client methods for storefront CMS and settings | `app/src/lib/drezivo-api.ts` |
| 2026-09-29 | 5 | Storefront CMS pages, editor provider, image field, palettes | `app/src/components/storefront/*`, `app/src/app/(dashboard)/storefront/**`, `contracts/src/storefront/cms.ts` (`STOREFRONT_THEMES`) |
| 2026-09-29 | 5 | Settings layout, nav, business, notifications, account pages; existing pages re-framed | `app/src/components/settings/*`, `app/src/app/(dashboard)/settings/**` |
| 2026-09-29 | 5 | Form kit, textarea, shared upload helper, tests | `app/src/components/forms/form-kit.tsx`, `app/src/components/ui/textarea.tsx`, `app/src/lib/storefront-assets.ts`, `app/tests/unit/storefront-cms-pages.test.tsx` |
| 2026-09-29 | 4 | Scaffold 501 test replaced with the real boundary behaviour | `api/src/__tests__/app.test.ts` |
| 2026-09-29 | 6 | Public storefront rebuilt on the live API; static demo removed | `web/src/app/s/[slug]/**`, `web/src/components/store/**`, `web/src/lib/{storefront-api,storefront-format,receipt-upload,seo}.ts`, `web/src/app/{globals.css,robots.ts}`, `web/tests/unit/storefront-format.test.ts` |
| 2026-09-29 | 6 | Garment size order in public reads; guest status link in renter emails | `api/src/modules/storefront/storefront.repository.ts`, `api/src/modules/notifications/email-notifications.ts`, `api/src/shared/guest-token.ts`, `api/src/config/index.ts` |
| 2026-09-29 | 8 | Decision record and environment variables | `docs/decisions/0010-storefront-cms-and-guest-requests.md`, `docs/runbooks/environments.md` |
| 2026-09-29 | 7 | Catalogue size expectation updated to garment order; full suite green on a fresh test database | `api/tests/integration/storefront-public-read.test.ts`, `docs/storefront-checklist.md` |
| 2026-09-29 | 9 | Development accept-any-code guest verification, refused in production | `api/src/config/index.ts`, `api/src/modules/guest-booking/guest-verification.service.ts`, `api/src/config/__tests__/guest-verification-mode.test.ts`, `api/tests/integration/storefront-guest-booking.test.ts`, `docs/runbooks/environments.md` |
| 2026-09-29 | 9 | Clear pickup/delivery tiles; minimum rental enforced in the calendar; real 409 reasons | `web/src/components/store/booking/booking-drawer.tsx`, `web/src/components/store/booking/availability-calendar.tsx` |
| 2026-09-29 | 9 | Shell no longer shifts on image fields; Profile/Security split; real measurement guide; draft address note; onboarding timeout | `app/src/components/shell/dashboard-shell.tsx`, `app/src/components/storefront/image-field.tsx`, `app/src/lib/storefront-assets.ts`, `app/src/components/settings/{settings-nav.tsx,use-location-hash.ts,account-settings-page.tsx,measurement-guide-settings-page.tsx,use-settings-resource.ts}`, `app/src/app/(dashboard)/layout.tsx`, `app/src/components/storefront/storefront-overview-page.tsx`, `app/src/components/onboarding/onboarding-plan.tsx`, app unit tests |
| 2026-09-29 | 10 | Worker drain mode, acknowledged domain events, strict booleans, mounted env file, Cloud Build, runbook | `api/src/worker.ts`, `api/src/worker/runner.ts`, `api/src/worker/handlers/domain-events.ts`, `api/src/config/{index.ts,load-env.ts}`, `api/src/middleware/idempotency.ts`, `api/cloudbuild.yaml`, `.gcloudignore`, `api/tests/integration/worker-drain.test.ts`, `api/src/config/__tests__/worker-config.test.ts`, `docs/runbooks/{worker-cloud-run.md,environments.md}` |
| 2026-09-29 | 11 | Storefront motion (GSAP, Lenis), favicon, hero and focus fixes | `web/src/components/store/motion/{motion-root.tsx,scroll.ts}`, `web/src/app/{layout.tsx,globals.css,icon.svg}`, `web/src/app/s/[slug]/layout.tsx`, `web/src/components/store/{home-sections,product-card,item-view,store-header}.tsx`, `web/src/components/store/booking/booking-drawer.tsx`, `web/package.json` |
| 2026-09-29 | 11 | Owner-side QA fixes: rate limit, role fallback, settings layout, Clerk theme, policy starter, slug input, unsaved-changes prompt, app favicon | `api/src/modules/tenancy/tenancy.routes.ts`, `app/src/components/shell/dashboard-shell.tsx`, `app/src/app/(dashboard)/settings/layout.tsx`, `app/src/components/settings/{settings-nav,account-settings-page}.tsx`, `app/src/components/storefront/{storefront-policy-pages,storefront-details-page}.tsx`, `app/src/components/forms/form-kit.tsx`, `app/src/app/icon.png` |
| 2026-09-30 | 12 | Owner preview, sign-in resolve fix, sidebar default, address card, Turbopack, loading states, shared actor context | `api/src/modules/storefront/{storefront-preview,storefront.repository,storefront.service,storefront.routes}.ts`, `api/src/modules/storefront-cms/*`, `contracts/src/storefront/cms.ts`, `app/src/components/auth/post-auth-resolver.tsx`, `app/src/lib/resolve-staff-landing.ts`, `app/src/components/shell/*`, `app/src/components/storefront/{storefront-overview-page,storefront-preview-button}.tsx`, `app/src/components/ui/sidebar.tsx`, `web/src/app/s/[slug]/{layout.tsx,loading.tsx,preview/route.ts,preview/exit/route.ts}`, `web/src/lib/{storefront-api,storefront-preview}.ts` |
| 2026-09-30 | 13 | Section links with Lenis, motion fallback, no storefront streaming, submit-guard key lifecycle, image type detection | `web/src/components/store/motion/{motion-root.tsx,scroll.ts}`, `web/src/app/globals.css`, `app/src/lib/{use-submit-guard,storefront-assets}.ts` |
