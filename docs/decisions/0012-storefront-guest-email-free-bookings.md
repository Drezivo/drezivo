# 0012. Email-free guest reservation and fitting flow

**Status:** Accepted
**Date:** 5 October 2026
**Owners:** Product owner

## Context

The prior storefront flow required email OTP before a guest could reserve or request a fitting, and
sent customers proof links and reservation lifecycle messages. The product owner chose to remove
guest email verification and guest-directed mail across all storefront flows while retaining an
email address as required contact information. The reservation must still have a useful proof page
without treating an ID/reference or unverified email as authentication.

## Decision

1. Guest reservations and public fitting requests require no email verification. Turnstile and
   existing per-IP limits remain on both public write endpoints. Email stays required contact data;
   it is not proof of identity.
2. Do not send a guest a verification code, reservation link, receipt acknowledgement, or any
   reservation/fitting lifecycle email. This also applies to staff-created reservation lifecycle
   events. Continue owner/business notifications and unrelated operational email.
3. Match a guest customer only on exact normalized full-name plus email within the tenant. Since the
   values are unverified, never update an existing customer profile from guest-submitted fields.
4. At reservation creation, set a host-only, HttpOnly cookie on the API host, scoped to that
   reservation's `/api/v1/guest/reservations/{id}` path. Use `SameSite=Strict`, `Secure` in staging
   and production, and expiry 30 days after the reservation due time. The frontend uses credentialed
   API requests under exact-origin CORS. No bearer or query-token compatibility remains.
5. The reservation ID may select the proof page, but never grants access. After receipt submission,
   redirect to a no-index proof page showing reservation details, prompt the guest to screenshot it,
   and confirm before leaving with a “Done screenshot?” dialog. A browser-native generic before-leave
   prompt is the fallback for reload/close; screenshot completion cannot be technically verified.
6. A forward migration cancels pending and leased guest verification/reservation/fitting customer
   email outbox rows, erases their sealed payloads, preserves business-directed messages, and drops
   the now-unused guest email-verification table. The worker permanently rejects legacy guest email
   keys. Messages already accepted by an email provider cannot be recalled.

## Consequences and rollout

- Public booking and fitting routes, shared contracts/OpenAPI, storefront UI, worker delivery, and
  privacy/product documentation change together. Receipt uploads and reservation reads authorize
  only through the scoped cookie; the URL contains no secret.
- Production and staging must configure API Turnstile secret and storefront site key. Credentialed
  CORS must allow the exact storefront origin.
- Before migration `0070_storefront_guest_no_email.sql`, stop/drain old API and worker processes and
  temporarily pause guest submissions. Apply the migration, deploy the updated API/worker and web
  release together, then resume traffic. This avoids old code reading the dropped table or delivering
  unsent customer mail. The release is temporarily disruptive by design.
- This decision supersedes ADR 0010 items 3, 4, and the guest-email portion of item 6. It does not
  change CMS ownership, reservation transaction boundaries, fitting scheduling, or owner/business
  notifications.

## Acceptance evidence

Integration coverage proves anonymous reservation/fitting submission without OTP, required Turnstile
in protected environments, no guest lifecycle outbox events, cookie-only reservation access,
idempotent cookie replay, exact customer matching without profile mutation, and preserved owner
notifications. Web coverage proves the proof page content and navigation confirmation. Migration and
worker tests prove queued legacy customer messages are not delivered.

## Related decisions

- [ADR 0010](0010-storefront-cms-and-guest-requests.md) remains the source for CMS and original guest
  transaction structure, with superseded email/access provisions marked above.
- [Drezivo TRD §3](../architecture/Drezivo-TRD.md#3-authentication-authorization-and-tenant-isolation)
  defines the current access boundary.
- [Pilot operation](../runbooks/pilot-operation.md) and [worker deployment](../runbooks/worker-cloud-run.md)
  define release operations.
