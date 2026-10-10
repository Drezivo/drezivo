# 0016. Multi-item reservations, staff edits, balance payments and delivery requests

**Status:** Accepted
**Date:** 10 October 2026
**Owners:** Product owner

## Context

Pilot shops asked for four changes to reservations:

1. One booking that holds several items, from staff and from the storefront.
2. An Edit action on a reservation, so staff do not cancel and recreate it to fix a detail.
3. The renter's pickup or delivery answer recorded and shown, including when the shop has not
   configured delivery.
4. A way to continue a cancelled, expired or rejected reservation without retyping it.

The PRD scoped V1 to one garment per checkout and moved the multi-item UI to V1.1. The schema
already supported several `reservation_line` rows per reservation, one `asset_allocation` per line
and several `payment` rows per reservation, so no migration was needed. The owner accepted the
change for V1. It applies to every clothing category, not only dresses. The UI calls each one an
"item".

## Decision

### 1. Multi-item bookings

1. A reservation holds 1 to 10 items (`MAX_RESERVATION_LINES = 10` in
   `contracts/src/reservations/hold.ts`). Each item is one `reservation_line` with one physical
   asset allocation of its own. Drezivo never combines garments to satisfy one line.
2. Staff create and the storefront guest booking send the main `variant_id` plus
   `additional_variant_ids` (at most 9). All items share one pickup time, one return time, one
   customer and one fulfillment method.
3. Each line is quoted on its own with its variant's pricing. Rental and security deposit amounts
   are summed. The delivery fee is charged once per reservation, never once per item.
4. Asset claiming locks every candidate asset in UUID order and picks a distinct asset for each
   line. If any item has no free asset, nothing is created.
5. Pickup and return handle every item together; partial physical return remains out of scope.
   Each returned item is inspected on its own (`reservation_line_id` on the inspection request).
   Complete Rental waits until every item is ready.
6. Custody business keys keep the legacy single-item form when a reservation has one item, so
   existing rows and replays still match.

### 2. Staff edit (`PATCH /api/v1/reservations/:reservationId`)

1. Allowed only in `held`, `pending_confirmation` and `confirmed`, and only before an unconfirmed
   hold expires. The request carries `version` (stale versions fail) and an `Idempotency-Key`
   (operation `reservation.edit.v1`). The route requires `reservations.manage`.
2. Editable fields: customer details, event date, fulfillment method, pickup and return times, and
   the item list. `garments` is the full ordered list: keep an item by sending its `line_id`, add
   one by sending only `variant_id`, remove one by leaving it out. To change an item's size, remove
   the item and add the new size; changing the variant on a kept `line_id` is refused.
3. Kept items keep their booked price terms. Added items are priced at today's price.
4. Every item is re-checked for availability together. The edit releases the reservation's current
   allocations, keeps each item's current asset when it is still free, claims a free asset for the
   others, and renumbers lines. If any item cannot be placed, the whole edit rolls back.
5. If the amount due changes after money is committed (payment verified or not pending, or a
   receipt uploaded, under review or verified), the request must include
   `accept_price_change: true`, in either direction. Otherwise it fails with
   `PRICE_CHANGE_NOT_ACCEPTED`. Before money is committed, the pending first payment is re-amounted.

### 3. Balance payments

1. When an edit raises the amount due after money is committed, the first payment stays as
   recorded. The difference becomes a separate `payment` row with
   `business_key = reservation:<reservationId>:balance:<reservation version>`, status `pending`.
2. At most one balance is open at a time. A later edit re-amounts the open balance to what is
   still owed, or closes it as `failed` when nothing is owed. Collected balances are never changed.
3. Staff record a received balance with
   `POST /api/v1/reservations/:reservationId/balance-payments/:paymentId/collect`. It needs
   `reservations.manage`, `payments.manage` and `evidence.verify`, an `Idempotency-Key`
   (operation `reservation.balance.collect.v1`), and `verified_amount_minor` equal to the balance.
   It marks the payment `paid`, writes a `payment_verification` row keyed `verify:<paymentId>`,
   an audit event and an outbox event `reservation.balance_collected`.
4. Pickup is refused while a balance is open, and requires the first payment plus collected
   balances to cover the amount due. Rental completion is blocked while a balance is open.
5. When an edit lowers the total after money is in, the detail panel shows the refund owed. The
   edit itself does not record a refund.
6. The reservation list and detail payment summaries (`reservations.repository.ts`) exclude balance
   rows with `business_key NOT LIKE 'reservation:<id>:balance:%'`. They must never instead filter on
   the initial-payment key, because fixtures and older rows use other keys. Calendar, dashboard,
   customers, payments page, guest receipts, verification, settlement and workers were audited and
   are unaffected; any new query that reads "the" payment of a reservation must exclude balances the
   same way.

### 4. Delivery requests

1. The storefront always offers delivery. When the shop has not enabled delivery, the reservation
   records delivery terms `to_arrange` with a fee of 0, and the renter is told the shop will contact
   them about delivery and any fee. When delivery is enabled, terms are `set_fee` with the configured
   fee.
2. The delivery snapshot stores `fee_minor` and `terms`. Staff see a "Delivery requested" badge and
   a Delivery card, and can switch fulfillment in Edit.
3. The owner email for a new reservation lists every item and says when delivery is requested. It
   contains no renter contact details; staff read those in the app.

### 5. Continue a reservation

Cancelled, expired and rejected reservations show Continue to staff with `reservations.manage`.
It opens New Reservation pre-filled with the same customer, items and times. It creates a new
reservation with a new reference; the old one is never reopened.

## Invariants future changes must keep

- Each line has at most one current blocking allocation; the allocation exclusion constraint only
  covers blocking rows.
- Lock order: reservation, payment, receipt, allocations, then candidate assets sorted by UUID.
- The initial payment's verified facts are never rewritten by an edit.
- No code path may assume a reservation has exactly one line, one allocation or one payment. Read
  all lines and allocations; read the initial payment and balances separately.
- Every mutating endpoint here is idempotent per user intent and has sequential and concurrent
  double-fire tests.

## Consequences

- This supersedes the PRD's V1 "one garment per checkout" and "no multi-item checkout" scope, and
  the matching lines in the TRD, data model and agent rules. Partial physical returns, carts and
  automated reminders remain out of scope.
- Delivery stays manual: no courier integration, and `to_arrange` fees are agreed outside Drezivo.
- Shipped as stacked pull requests #241 (delivery), #242 (Continue), #243 (Edit), #244 (multi-item
  staff), #245 (multi-item storefront) and #246 (edit items, balances, per-item inspection). They
  merge in that order. #246 replaces #243's earlier rule that refused total increases after payment.

## Acceptance evidence

API integration tests against real PostgreSQL cover multi-item create, quote, pickup, return,
per-item inspection, cancellation and completion (`api/tests/integration/reservation-multi-garment.test.ts`),
and edit, item add/remove, price-change acceptance, balance creation, re-amounting, closing and
collection, including double-fire replays (`api/tests/integration/reservation-edit.test.ts`).
Storefront guest booking coverage includes extra items (`storefront-guest-booking`). App and web
unit tests cover the edit form, balance panel, extra items and Continue. Implementation details,
file map and local test setup are in `docs/reservation-checklist.md` section 23.
