# Pilot operation (free tier, no separate worker)

How Drezivo runs during the pilot: real businesses use it on free hosting while the team collects
feedback. It covers what changed because there is no separate worker service, how subscriptions
and payments work, the settings each service needs, and how to switch back to a dedicated worker
later.

## Addresses

| What | Address |
| --- | --- |
| Marketing site | `https://drezivo.shop` |
| A business's storefront | `https://drezivo.shop/s/<store-address>` |
| Business app (owners and staff) | `https://partners.drezivo.shop` |
| Internal operator console | `https://operator.drezivo.shop` (separate repositories) |

## Background work without a worker service

The worker code still exists and still runs, but inside the API service instead of as its own paid
service. The API starts it as a supervised child process when `EMBEDDED_WORKER=true`.

- The child uses its own database login, `drezivo_worker`, exactly like the separate worker did,
  through `WORKER_DATABASE_URL`.
- If the child exits, the API restarts it with a growing delay. When the API stops, the child stops
  too.
- Render's free plan sleeps after 15 minutes without requests, and the worker sleeps with it. That
  is fine: only requests create work, and a request wakes both.

What each former worker job does now:

| Job | During the pilot |
| --- | --- |
| Emails: business/owner reservation and fitting notices, staff invitations, operator billing notices | Sent by the embedded worker within about a second, with retries. Guest customers receive no verification, receipt, reservation, fitting, or lifecycle email. |
| Releasing expired holds | Embedded worker. New bookings also release expired holds themselves, and staff cannot close a live hold (next section) |
| Staff invitations, Clerk webhook retries, abandoned sign-up cleanup | Embedded worker |
| Trial and subscription ending | No job needed. Access is worked out on every request from the subscription dates (next sections) |

## Staff holds cannot be forgotten

When staff reserve a garment in **New reservation**, the garment is held for 15 minutes while they
finish the customer details and payment. While the hold is live:

- the reservation panel cannot be closed until the hold is **completed or cancelled**, or it
  expires;
- navigating to another page keeps the panel open, and refreshing the page reopens it on the same
  hold, with the typed customer details;
- closing or reloading the tab asks for confirmation.

This lives in `app/src/lib/pending-hold.ts` and
`app/src/components/reservations/pending-hold-guard.tsx`.

## Storefront guest email behavior

Guest storefront reservations and fitting requests require an email as contact information, but do
not verify that address and do not send customer-directed mail. After a reservation receipt is
submitted, the storefront shows a private proof page, asks the customer to screenshot it, and guards
navigation with a confirmation. The API-host-only, reservation-path-scoped HttpOnly cookie—not the
reservation ID or reference—authorizes that page and receipt workflow. There is no email recovery
link. The shop can contact the guest independently using the information provided.

Owner/business notification preferences remain independent: during the pilot, the owner's email
toggles are hidden and the API ignores saved toggles (`NOTIFICATION_PREFERENCES_ENFORCED = false`).
Business notices go to the business email in Settings → Business information. Migration
`0070_storefront_guest_no_email.sql` removes queued customer-directed verification and reservation/
fitting lifecycle email rows while preserving business-directed rows. Stop old API and worker
processes before applying that migration so an in-flight older worker cannot deliver a queued guest
message; deploy the updated API/worker/web release together before accepting storefront traffic.

## Subscription: one plan, trial, and manual payment

- **One plan, Standard:** ₱300 a month, up to 1,000 active physical assets and 10 Front Desk seats.
  Internally the plan code stays `starter`; migration `0063_pilot_billing.sql` deactivates the
  former Professional and Business rows while preserving them for history.
- **Sign-up:** an owner signs up (for example with Google), names the business, confirms **"Start
  your 14-day trial?"**, and lands on the dashboard. There is no plan choice and no billing page.
- **Paying:** the owner opens **Subscribe** from the banner or prompt.
  1. They pick one of Drezivo's payment methods, which shows its QR code, account name and number.
  2. They pay ₱300, then send the reference number and a screenshot or PDF of the receipt.
  3. An operator checks it in the operator console and approves or rejects it. The owner is emailed
     either way.
  4. On approval, the next paid month starts from the approval date or from the old end date,
     whichever is later.

Access is derived at request time, where the "end" is the trial end or the paid-through date:

| Time | Business app | Storefront |
| --- | --- | --- |
| Before the end (the last 3 days show a countdown) | Full | Online, taking bookings |
| From the end, first 3 days | View-only, with a Subscribe prompt | Online, but not taking bookings or fittings |
| From the end, days 4 to 30 | View-only, with a Subscribe prompt | Offline |
| More than 30 days after the end | Locked: only Subscribe | Offline |

An operator can give a **view-only extension** until a chosen date. The business stays view-only
and the storefront stays online without bookings until then.

Payments are reviewed in the operator console by the `platform_owner` and `platform_operator`
roles. `support_operator` can only look. Each business has at most one proof waiting at a time.
Operators open a proof through a link that works for 5 minutes. The operator API signs it, and this
API checks it at `GET /api/v1/operator/payment-proofs/<link>` before redirecting to the stored file.

## Settings per service

Never commit these values. They live in each host's settings.

**API (Render):**

- `EMBEDDED_WORKER=true`
- `WORKER_DATABASE_URL`: the Supabase session pooler address for the `drezivo_worker` user,
  ending in `?sslmode=require`. It must differ from `DATABASE_URL`.
- `TURNSTILE_SECRET_KEY`: from Cloudflare, see below. Required in staging and production; local
  development can omit it and will log that challenges are skipped.
- `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, and `RESEND_API_KEY`
- `CORS_ALLOWED_ORIGINS=https://drezivo.shop,https://partners.drezivo.shop`
- `OPERATOR_PROOF_LINK_SECRET`: at least 32 random characters, the same value as on the operator
  API. Without it, operators cannot open proofs of payment.

**Operator API (separate repository):**

- `OPERATOR_PROOF_LINK_SECRET`: the same value as the API's
- `BUSINESS_API_PUBLIC_URL`: the API's public address, for example `https://api.drezivo.shop`

**Web (`drezivo.shop`):**

- `NEXT_PUBLIC_SITE_URL=https://drezivo.shop`
- `NEXT_PUBLIC_PARTNERS_URL=https://partners.drezivo.shop`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

**Business app (`partners.drezivo.shop`):**

- `NEXT_PUBLIC_STOREFRONT_ORIGIN=https://drezivo.shop`
- `NEXT_PUBLIC_API_ORIGIN`: the API address

## One-time setup

1. **Supabase:** in the SQL editor, run
   `ALTER ROLE drezivo_worker WITH LOGIN PASSWORD '<long random password>';`. Then apply the
   migrations through `0063_pilot_billing.sql` (in `api/`, set `DATABASE_URL_DIRECT` and run
   `npm run db:migrate`). The migration can be run again safely.
2. **Cloudflare:** Dashboard → Turnstile → Add widget for `drezivo.shop` (Managed mode). Put the
   site key in the web app and the secret key in the API.
3. **Clerk:** Configure → Attack protection → turn on Bot sign-up protection (CAPTCHA "Smart").
   Also add `partners.drezivo.shop` to the domains and allowed origins.
4. **Resend:** verify the sender domain for business/owner and operational notices. Storefront
   guests do not receive email from reservation or fitting flows.
5. **Operator console:** add Drezivo's payment methods (up to 10: GCash, Maya, bank) with their QR
   images.

## Switching back to a dedicated worker

When the team moves to a paid Render plan or its own server:

1. Deploy the worker as its own service: `docs/runbooks/worker-cloud-run.md`, or a Render
   background worker running `node dist/worker.js` with `WORKER_MODE=continuous`.
2. On the API, set `EMBEDDED_WORKER=false` and remove `WORKER_DATABASE_URL`.
3. To bring back the owner email toggles, set `SHOW_NOTIFICATION_SETTINGS = true` in
   `app/src/lib/features.ts` and `NOTIFICATION_PREFERENCES_ENFORCED = true` in the API.

The access rules above do not depend on a worker, so nothing else changes.
