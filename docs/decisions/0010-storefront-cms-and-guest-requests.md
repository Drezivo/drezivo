# 0010. Storefront CMS, guest reservation requests, and public fitting requests

**Status:** accepted
**Date:** 29 September 2026
**Owners:** product + API + web owners

> **Superseded in part by [ADR 0012](0012-storefront-guest-email-free-bookings.md), accepted 5 October 2026.**
> The historical email-verification, bearer capability, and guest lifecycle-email decisions below no
> longer describe current behavior. Public fitting requests also no longer verify email. The CMS,
> storefront transaction, and fitting-capacity decisions remain in force.

## Context

The public storefront (`/s/<slug>`) was a static demo, and its API routes answered 501. Owners had
no way to edit what the storefront shows, and settings covered only payment methods and the
measurement guide. The PRD also deferred customer self-booking of fittings to a later V1.1 slice.
On 29 September 2026 the product owner asked for the storefront, a storefront CMS, complete
settings, and online fitting requests in one delivery.

## Decision

1. **The CMS content lives on the existing `storefront` row.** It uses `branding`, `contact`, and
   new `content` and `checkout` JSONB columns, plus `version` for optimistic concurrency.
   `@drezivo/contracts` (`storefront/cms.ts`) validates the whole document strictly on every
   write:
   - text is plain and bounded;
   - owners may enter a social handle or canonical HTTPS profile URL; the contract validates the
     platform host and profile path, then stores a normalized platform reference so the server
     builds every public URL from a fixed host. Facebook accepts page names and direct numeric
     Page URLs (`profile.php?id=<id>`), storing the latter as the validated page reference
     `profile.php?id=<id>`; share links are not accepted;
   - images are accepted `storefront_asset` file ids from the same workspace;
   - the theme is one of four contrast-checked palettes.
2. **Rental policies stay immutable versions** in `policy_snapshot`. Every save appends the next
   version, and the prose sits beside the `delivery_rules.enabled` and `fee_minor` keys the
   booking quote already reads.
3. **Guest reservation requests reuse the staff booking transaction.** It was split into
   `claimReservationAsset` and `createHeldReservation`. A guest must first prove control of an
   email with a one-time code, which is stored only as a keyed digest, expires in 10 minutes, and
   allows 5 attempts. The request is then held for 15 minutes, a receipt is uploaded, and the
   request moves to owner review.
4. **Guest capability tokens are an HMAC of the reservation id.** Only the SHA-256 hash is stored.
   Idempotent replays and the confirmation email can therefore return the same token without it
   ever sitting in a table. The token travels in a `Bearer` header, and in the URL fragment of
   the status link, which browsers never send to a server.
5. **Public fitting requests ship now**, reversing the PRD deferral:
   - they are opt-in per business (`checkout.fitting_requests`) and require fittings to be
     enabled in the fitting schedule;
   - they use the existing fitting creation rules (hours, closures, hidden capacity slots),
     create preference-only garment lines, start `pending`, and are marked
     `booking_channel = 'storefront'`.
6. **Emails are composed inside the business transaction.** They respect the owner's
   notification preferences and are stored sealed (AES-GCM) in the outbox. The worker only
   decrypts and sends, through `EMAIL_PROVIDER` (`none`, `file`, or `resend`). With `none`, guest
   verification answers 503 instead of pretending to send.

## Consequences

- Migration `0060_storefront_cms_settings.sql` adds the columns and the `tenant_settings` and
  `guest_email_verification` tables, a `SECURITY DEFINER` guest-tenant resolver, audit
  `actor_kind = 'guest'`, and fitting `booking_channel = 'storefront'`.
- A deployment needs `EMAIL_PROVIDER` and its secrets, `STOREFRONT_PUBLIC_ORIGIN` for status links,
  and `TRUST_PROXY_HOPS` behind a load balancer so per-IP limits see real addresses.
- The worker must run for verification codes to arrive. If it runs as a scheduled job, codes wait
  for the next run; see the hosting guide.
- Signed image URLs contain the files module's object key, which includes the tenant UUID. This
  is accepted, because no API trusts a browser-sent tenant id.
