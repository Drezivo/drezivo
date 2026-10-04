---
title: Guest Reservation Email Verification Removal Plan
type: implementation-plan
status: superseded
owner: Drezivo team
source: "Owner request (2026-10-04); ../../decisions/0010-storefront-cms-and-guest-requests.md"
updated: 2026-10-05
tags: [drezivo, reservations, storefront, guest-access, email]
---

# Guest Reservation Email Verification Removal Plan

**Status:** Superseded by the accepted 5 October 2026 decision and current implementation in this
worktree. This note preserves the earlier proposal below for history; do not follow its recovery,
compatibility, fitting-verification, or guest-email requirements.

## Current decision (2026-10-05)

- No email verification for any storefront guest flow, including reservations and fittings. Email is
  required contact information only; never send guest verification, receipt, reservation, fitting,
  or lifecycle email. Owner/business notices remain separate.
- Turnstile and per-IP rate limits remain. Normalize email and match customers only on exact
  full-name-plus-email; unverified guest input never updates an existing customer profile.
- Reservation creation sets an API-host-only, reservation-path-scoped HttpOnly cookie (`Secure` in
  staging/production, `SameSite=Strict`). The URL contains only a reservation ID, never a capability.
- After receipt submission, show the reservation proof page, ask for a screenshot, and confirm
  before navigation. No email recovery path is offered.
- Cancel queued guest-directed email rows but preserve owner/business rows. Stop old API/worker
  processes before migration 0070; provider-accepted email cannot be recalled.

See [ADR 0012](../../decisions/0012-storefront-guest-email-free-bookings.md), the [TRD](../../architecture/Drezivo-TRD.md),
and [pilot runbook](../../runbooks/pilot-operation.md) for canonical behavior. The earlier proposal
below records prior thinking only.

## Goal and security boundary

Customers can submit an online reservation and payment receipt without first proving control of
their email address. Email remains required contact information. Email verification becomes an
optional way to receive a private reservation link and future customer updates, not a prerequisite
for placing a reservation.

The browser receives access through a reservation-scoped guest capability at booking time. The
capability, not a reservation reference or email address, authorizes access. Keep it within the
existing guest-access boundary (host-only cookie); never put it in a URL, local storage, analytics,
or a broad parent-domain cookie.

## Planned customer and API flow

1. Remove the pre-booking email-code step from the booking drawer. Collect the customer's email as
   contact information and let the customer submit the reservation and receipt without an OTP.
2. Keep configured Turnstile verification at reservation submission, retain per-IP rate limits, and
   exclude the single-use Turnstile token from the idempotency fingerprint so a safe retry can use a
   fresh challenge.
3. Allow guest reservation creation without an email-verification token. Temporarily accept the
   legacy token for old web clients, then deploy the compatible API before the updated web app.
4. Preserve browser access to the reservation after booking. Add an optional “email me my private
   link” recovery path under `/s/{slug}/booking`, using reservation reference and email followed by
   email-code verification. Return a generic response to avoid revealing whether a reservation,
   reference, or email exists. Send the private link only to the email already stored on that
   reservation. The emailed URL must carry only a short-lived, single-use exchange credential, not
   the raw guest capability; exchange it server-side for the existing host-only cookie.
5. Make access-link requests idempotent and rate-limited. A valid verification token must match the
   reservation reference and stored email before the API sends the private link.

## Customer matching and persisted verification

- Within the same tenant, reuse a customer only when normalized full name and email exactly match
  an active, non-archived, non-anonymized customer. Otherwise create a separate customer.
- Do not use fuzzy matching or update customer profile data from unverified booking details.
  Serialize lookup/insert so concurrent submissions do not create duplicate matches.
- Add per-reservation verified-email state with a forward migration. Backfill prior online
  reservations as verified because the existing flow required verification before creation.

## Notifications and scope

- Before email verification, suppress customer emails containing the private link or
  reservation-detail-rich updates. Owner notifications remain unchanged.
- After successful verification, send the private link to the stored email and enable applicable
  customer updates.
- Keep the shared verification UI/API and `guest_email_verification` storage needed by public
  fitting requests. Removing reservation's precondition must not remove fitting verification.

## Documentation and decision updates

Update the guest reservation contracts and OpenAPI, storefront/privacy wording, and the current
PRD when implementation is approved and shipped. Add a dated decision record that explicitly
supersedes item 3 of [ADR 0010](../../decisions/0010-storefront-cms-and-guest-requests.md), which
currently requires email proof before a guest reservation request. Preserve the ADR's historical
reasoning rather than silently rewriting it. Reconcile that ADR's item 4 fragment-link wording with
the root architecture rule that guest capability secrets stay out of URLs. Link this plan to
[[Reservations Checklist]] and [[Drezivo Home]].

## Acceptance tests

- Reservation creation and payment-receipt submission succeed without an email OTP; email remains
  required and the guest capability remains scoped to that reservation.
- Reference or email alone cannot authorize reservation access; the raw capability never appears
  in URLs, and an emailed exchange credential is short-lived, single-use, and scoped correctly.
- Unverified customers receive no private link or detail-rich customer notification. Successful
  verification sends the link only to the stored email and enables the intended updates.
- Correctly and incorrectly matched reference/email recovery requests produce generic public
  responses; only a valid code can trigger link delivery.
- Turnstile enforcement, per-IP limiting, and idempotent retries work, including retries with a
  fresh single-use Turnstile token.
- Customer matching follows exact normalized full-name-plus-email rules under concurrent submits;
  unverified inputs do not mutate an existing profile.
- Legacy verified-token clients remain compatible during rollout, while public fitting requests
  still require email verification.

## Related notes

- [[Reservations Checklist]]
- [[Drezivo Home]]
