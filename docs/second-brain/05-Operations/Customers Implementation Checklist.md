---
title: Customers Implementation Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-28
tags: [drezivo, customers, frontend, backend, reservations, fittings]
---

# Customers Implementation Checklist

This checklist defines the implementation order for the staff-facing `/customers` page.
The required sequence is **Frontend first → Backend endpoints → Wiring and production validation**.

The page is a customer directory and activity-history surface derived from the existing tenant-scoped
`customer` records plus authoritative Reservation and Fitting history. It is not a general CRM.

## Approved V1 behavior

- [ ] `/customers` matches the current Reservations and Fittings dashboard theme and layout.
- [ ] The default list shows active customers only.
- [ ] Customer profiles are tenant-scoped live data.
- [ ] Reservation and Fitting history is derived from their authoritative records; do not duplicate history onto `customer`.
- [ ] Historical reservation snapshots remain immutable when a live customer profile is edited.
- [ ] The table uses server-backed pagination with exactly **10 customers per page** in the frontend.
- [ ] Row actions are **View details**, **Edit**, and **Archive**.
- [ ] There is **strictly no hard-delete customer action or customer DELETE endpoint**.
- [ ] Archive is operational soft-archive and must not reuse `anonymized_at`, which remains a privacy/deletion lifecycle field.
- [ ] Archiving a customer preserves all Reservations, Fittings, payments, and historical snapshots.
- [ ] Archived customers are excluded from new Reservation and Fitting customer selectors.
- [ ] No standalone `+ New Customer` action in V1; customers continue to originate from Reservation/Fitting intake.

## Dashboard metrics

The page shows four compact summary cards using the same visual treatment as the Fittings summary cards.

- [ ] **All Customers** — count of active, non-anonymized customer profiles.
- [ ] **New This Month** — active customers created within the current branch-local calendar month.
- [ ] **Returning Customers** — customers with at least two completed engagements across completed Reservations and completed Fittings.
- [ ] **Upcoming Customers** — distinct customers with at least one future confirmed Reservation or confirmed Fitting.
- [ ] Cancelled, rejected, expired, or no-show activity does not qualify a customer as Returning or Upcoming.
- [ ] Calendar-month boundaries use the active branch IANA timezone rather than browser-local or raw UTC boundaries.

---

# Phase 1 — Frontend First

Build the complete customer-management UX first using API-shaped local prototype data isolated to the customer feature. The prototype data must be removed when production wiring is completed.

## 1. Route and page shell

- [x] Add `app/src/app/(dashboard)/customers/page.tsx`.
- [x] Add `app/src/components/customers/customers-page.tsx`.
- [x] Reuse the existing dashboard shell; `/customers` already exists in the sidebar/header navigation.
- [x] Match the Reservations/Fittings page container:
  - `bg-dashboard-canvas`.
  - `max-w-screen-2xl`.
  - responsive dashboard padding.
  - consistent `gap-5` section spacing.
- [x] Page heading:
  - Title: `Customers`.
  - Description: concise operational copy about customer profiles and rental/fitting history.
- [x] Do not introduce a new visual theme, page width, typography system, or navigation pattern.

## 2. Summary cards

- [x] Add four cards in a responsive grid.
- [ ] Match Fittings card height, icon tile, spacing, typography, borders, and loading skeletons.
- [x] Cards:
  - All Customers.
  - New This Month.
  - Returning Customers.
  - Upcoming Customers.
- [x] Use API-shaped summary data from the beginning so wiring does not require a component redesign.

## 3. Customer toolbar

- [x] Add search input with placeholder similar to `Search name, phone, or email...`.
- [x] Add status filter:
  - Active.
  - Archived.
  - All.
- [x] Default status filter to Active.
- [x] Show Clear Filters only when filters are active.
- [x] Search/status changes reset pagination to page 1.
- [ ] Keep URL query-state behavior consistent with Reservations where practical.
- [x] Do not search address, social media, or internal notes from the directory toolbar.

## 4. Customers table

- [x] Wrap the table in the same `Card` / `CardContent` treatment used by Reservations/Fittings.
- [x] Table columns:
  - Customer.
  - Contact.
  - Reservations.
  - Fittings.
  - Last Activity.
  - Next Activity.
  - Status.
  - Actions.
- [x] Customer cell shows:
  - avatar/initials.
  - full name.
  - `Customer since ...` using profile creation date.
- [x] Contact cell shows phone and/or email only.
- [x] Reservation/Fitting count cells show concise derived counts.
- [x] Last Activity shows type + date/time.
- [x] Next Activity shows type + date/time or `None scheduled`.
- [x] Status uses the dashboard badge vocabulary for Active/Archived.
- [x] Make lower-value columns responsive on smaller screens rather than forcing horizontal clutter.
- [x] Do not expose address, social media, or notes in the table.

## 5. Pagination

- [x] Define `CUSTOMERS_PAGE_SIZE = 10`.
- [x] Render no more than 10 customers on one page.
- [x] Use the same cursor-navigation state shape as Reservations/Fittings:
  - page index.
  - page cursor history.
  - next cursor.
  - `has_more`.
- [x] Pagination footer copy follows the existing dashboard style, for example:
  - `Page 1 · 10 customers loaded`.
- [x] Add Previous and Next actions.
- [x] Disable Previous on page 1.
- [x] Disable Next when `has_more = false`.
- [ ] Do not load every customer and paginate only in the browser.

## 6. Row actions

- [x] Add an Actions column using the existing dropdown/menu component pattern.
- [x] Actions are exactly:
  - View details.
  - Edit.
  - Archive.
- [x] There is no Delete action.
- [x] Already archived customers must not receive an active Archive action.
- [x] Clicking the action menu must not accidentally trigger row-level View Details behavior.

## 7. Customer Details Sheet

- [x] Add `customer-details-sheet.tsx` or an equivalent feature-local component.
- [x] Match the current Reservation/Fitting Sheet width, header, scrolling behavior, typography, borders, and section headings.
- [x] Header shows:
  - avatar/initials.
  - full name.
  - Active/Archived badge.
  - customer-since date.
- [x] Contact section shows authorized live profile data:
  - phone.
  - email.
  - address.
  - social media.
- [x] Summary section shows:
  - Reservation count.
  - Fitting count.
  - completed engagement count.
  - last activity.
  - next activity.
- [x] Internal Notes section is staff-only and never appears in list/search responses.

## 8. Reservation history inside Customer Details

- [x] Add a Reservation History section.
- [x] Initial history is bounded; do not render an unlimited lifetime history in one response.
- [x] Each history row shows:
  - reservation reference.
  - clothing snapshot/name.
  - pickup date/time.
  - return date/time.
  - reservation status.
  - rental amount/currency where appropriate.
- [x] Reservation history displays accepted historical snapshots rather than replacing historical facts with the customer's current edited profile.
- [ ] Add bounded Load More or cursor pagination inside the sheet.

## 9. Fitting history inside Customer Details

- [x] Add a Fitting History section.
- [x] Initial history is bounded.
- [x] Each history row shows:
  - fitting date/time.
  - fitting status.
  - relevant garment/preference summary when available.
  - fitting fee/payment summary when appropriate.
- [ ] Add bounded Load More or cursor pagination inside the sheet.

## 10. Edit Customer UX

- [x] Row `Edit` opens the customer sheet directly in edit mode or opens one shared feature-local edit surface.
- [x] `Edit Customer` from the detail sheet uses the same edit implementation.
- [x] Editable fields:
  - full name.
  - phone.
  - email.
  - address.
  - social media.
  - internal notes.
- [x] Keep the existing customer contact invariant: at least phone or email remains usable.
- [x] Address remains nullable because Fitting-only customer profiles may not have one.
- [x] Explain validation errors inline using existing dashboard form patterns.
- [x] No customer-history fields are editable from this form.

## 11. Archive Customer UX

- [x] Add an `AlertDialog` confirmation.
- [x] Confirmation makes preservation behavior explicit:
  - Reservation history remains.
  - Fitting history remains.
  - customer is no longer selectable for new bookings.
- [x] Destructive action label is `Archive Customer`, never `Delete Customer`.
- [x] Do not add Restore in the first V1 UI unless separately approved.

## 12. Frontend states

- [x] Summary loading state.
- [x] Table loading state.
- [x] Empty active-customer state.
- [x] Empty filtered state.
- [x] Permission-restricted state.
- [x] API error/retry state.
- [x] Detail-sheet loading state.
- [x] Detail-sheet not-found/concealed state.
- [x] Mutation pending/success/failure states.
- [x] Archive and Edit actions prevent duplicate submissions.

## 13. Frontend-first tests

- [x] Route renders the Customers page.
- [x] Four summary cards render from live API-backed values.
- [x] Table renders at most 10 rows.
- [x] Search/status changes reset pagination.
- [x] Previous/Next state behaves correctly.
- [x] Actions menu contains View details, Edit, Archive and no Delete.
- [x] Customer Details Sheet renders both Reservation and Fitting history sections.
- [x] Edit form preserves optional address behavior and contact requirement.
- [x] Archive confirmation uses preservation copy and contains no hard-delete language.
- [x] Responsive table behavior follows Reservations/Fittings conventions.

---

# Phase 2 — Backend Endpoints and Contracts

Build the customer API around the already-existing `customer`, `reservation`, and `fitting_appointment` authorities. Do not move Reservation/Fitting business state into the customer module.

## 14. Customer lifecycle schema

- [x] Add operational archive state with a forward migration, preferably `customer.archived_at timestamptz NULL`.
- [x] Do not overload `anonymized_at`; it remains separate privacy/deletion lifecycle state.
- [x] Add indexes required by the final list/search/sort plan after checking `EXPLAIN`/query shape.
- [x] Preserve tenant ownership and RLS behavior.
- [x] Add an optimistic concurrency field or use the repository's established `updated_at`/expected timestamp convention consistently for Edit and Archive.
- [x] No migration may introduce cascading deletion of Reservation/Fitting history.

## 15. Customer contracts

- [x] Add a dedicated `contracts/src/customers/` contract surface.
- [x] Define customer list query/response.
- [x] Define summary response.
- [x] Define customer detail response.
- [x] Define customer Reservation history response.
- [x] Define customer Fitting history response.
- [x] Define Edit request/response.
- [x] Define Archive request/response.
- [x] All responses use existing branded IDs, money strings, ISO timestamps, status schemas, and page-meta conventions.
- [x] Update generated OpenAPI from the contract generator; do not hand-maintain a drifting OpenAPI shape.

## 16. `GET /api/v1/customers`

- [x] Tenant-safe staff-only customer list.
- [x] Query supports:
  - `search`.
  - `status=active|archived|all`.
  - `cursor`.
  - bounded `limit`.
- [x] Frontend requests `limit=10`.
- [x] Search only:
  - name.
  - phone.
  - email.
- [x] Stable keyset pagination; avoid offset pagination for the production list.
- [x] Default sort should be deterministic, such as `lower(full_name), id` unless another approved customer sort is chosen.
- [x] Response includes only safe directory fields plus derived aggregates required by the table.
- [x] Derive Reservation count and Fitting count without N+1 queries.
- [x] Derive Last Activity across both modules.
- [x] Derive Next Activity across both modules.
- [x] Default excludes anonymized profiles and defaults to non-archived profiles.

## 17. `GET /api/v1/customers/summary`

- [x] Return:
  - `all_customers`.
  - `new_this_month`.
  - `returning_customers`.
  - `upcoming_customers`.
- [x] Use active branch timezone for monthly boundary calculations.
- [x] Returning Customers requires at least two completed qualifying engagements.
- [x] Upcoming Customers is a distinct-customer count, not a booking count.
- [x] Keep the query bounded/aggregated; no per-customer loop from the service layer.

## 18. `GET /api/v1/customers/:customerId`

- [x] Conceal foreign/unauthorized customer IDs as not found.
- [x] Return live profile fields:
  - full name.
  - phone.
  - email.
  - address.
  - social media.
  - notes.
  - created/updated timestamps.
  - archived state.
- [x] Return bounded summary fields needed by the Sheet.
- [x] Do not return unrelated private payment/evidence/provider data.

## 19. `GET /api/v1/customers/:customerId/reservations`

- [x] Cursor-paginated customer Reservation history.
- [x] Default/bounded page size; frontend initially requests 10.
- [x] Tenant + authorized branch scope is explicit.
- [x] Use Reservation snapshot fields for historical facts.
- [x] Return only fields needed for customer history UI.
- [x] Stable newest-first ordering using created timestamp plus ID as tie-breaker.

## 20. `GET /api/v1/customers/:customerId/fittings`

- [x] Cursor-paginated Fitting history.
- [x] Default/bounded page size; frontend initially requests 10.
- [x] Tenant + authorized branch scope is explicit.
- [x] Return only fitting history fields needed by the Sheet.
- [x] Stable newest-first ordering using period start/created timestamp plus ID as tie-breaker.

## 21. `PATCH /api/v1/customers/:customerId`

Implementation note (2026-09-28): the tenant-scoped route, middleware, controller, service,
repository mutation, idempotency, optimistic timestamp check, and redacted audit record are
implemented in the backend. The acceptance boxes below remain open until PostgreSQL integration
evidence is available.

- [ ] Requires authorized staff access.
- [ ] Supports only live profile fields approved by the Edit UX.
- [ ] Normalize email/contact fields consistently with current Reservation/Fitting customer creation.
- [ ] Validate at least one usable phone/email contact remains.
- [ ] Address remains optional at customer-profile level.
- [ ] Reservation creation still enforces its stricter address requirement separately.
- [ ] Mutation is idempotent/version protected according to project mutation conventions.
- [ ] Editing live profile data never updates historical `reservation.customer_snapshot` values.
- [ ] Audit the mutation with a safe redacted summary; never log notes/contact payloads unnecessarily.

## 22. `POST /api/v1/customers/:customerId/archive`

Implementation note (2026-09-28): the explicit archive command is implemented as a soft archive
with tenant idempotency, optimistic concurrency, immutable history preservation, and a redacted
audit event. The acceptance boxes below remain open until PostgreSQL integration evidence is
available.

- [ ] Explicit archive command; do not implement `DELETE /api/v1/customers/:id`.
- [ ] Requires idempotency key + optimistic concurrency guard.
- [ ] Sets operational archive state only.
- [ ] Does not mutate or delete:
  - Reservations.
  - Reservation snapshots.
  - Fittings.
  - Payments.
  - custody/history records.
- [ ] Archive is safe with existing/future obligations; it prevents customer reuse for new booking intake but does not cancel already-created bookings.
- [ ] Repeated same-intent archive is idempotent.

## 23. Reservation/Fitting customer-selector behavior

Implementation note (2026-09-28): Reservation and Fitting intake searches and existing-customer
resolution now exclude operationally archived and anonymized profiles. Existing linked bookings
remain readable through their authoritative history/detail paths. Focused PostgreSQL evidence passes
for the customer, reservation-intake, and fitting-security suites; the broader suite still has
unrelated timeout failures, so the acceptance items remain open until the baseline is green.

- [ ] Update Reservation existing-customer lookup to exclude archived profiles.
- [ ] Update Fitting existing-customer lookup to exclude archived profiles.
- [ ] Continue excluding anonymized profiles.
- [ ] Existing bookings linked to an archived profile remain readable and actionable.

## 24. Authorization boundary

Implementation note (2026-09-28): customer directory, profile mutations, and Reservation/Fitting
selectors reuse the existing `reservations.manage` capability under verified staff and tenant
context. Customer history remains branch-scoped; no new customer permission was introduced.
Focused PostgreSQL authorization and isolation evidence passes; the broader suite remains gated by
unrelated timeout failures.

- [ ] Keep the live customer profile tenant-scoped.
- [ ] Reservation/Fitting history respects the authorized branch boundary.
- [ ] V1 remains single-branch operationally, but queries must not establish a future cross-branch data leak.
- [ ] Reuse the current approved staff capability for this implementation rather than inventing a new permission without a broader permissions decision.
- [ ] If `reservations.manage` remains the chosen permission, document that explicitly in contracts/API tests.

## 25. Backend tests

Implementation note (2026-09-28): focused integration coverage now exercises archived-customer
selector exclusion, direct-ID rejection, Front Desk authorization, reservation detail, and
fitting/history readability after archive. Those focused PostgreSQL tests pass. The full suite
still has unrelated timeout failures and remains the final baseline gate.

- [ ] Customer list returns exactly the requested bounded page and no cross-tenant rows.
- [ ] Cursor page 2 does not duplicate page 1.
- [ ] Search works for name/phone/email and not private fields.
- [ ] Active/Archived/All status behavior is correct.
- [ ] Summary metrics follow the approved definitions.
- [ ] Last Activity selects the latest qualifying Reservation/Fitting event.
- [ ] Next Activity selects the earliest qualifying upcoming Reservation/Fitting event.
- [ ] Customer detail conceals foreign IDs.
- [ ] Reservation history remains snapshot-based.
- [ ] Fitting history is branch/tenant safe.
- [ ] Edit does not rewrite historical Reservation snapshots.
- [ ] Archive preserves Reservation/Fitting rows.
- [ ] Archived customer disappears from Reservation/Fitting intake search.
- [ ] Existing bookings for archived customers remain readable/actionable.
- [ ] There is no customer hard-delete route.
- [ ] Mutations replay idempotently and reject stale/different intent safely.

---

# Phase 3 — Wiring Frontend to Backend

Replace the isolated frontend prototype source with the production customer API without redesigning the already-approved UI.

## 26. API client

- [x] Extend `app/src/lib/drezivo-api.ts` with:
  - `getCustomers()`.
  - `getCustomerSummary()`.
  - `getCustomerDetail()`.
  - `getCustomerReservations()`.
  - `getCustomerFittings()`.
  - `updateCustomer()`.
  - `archiveCustomer()`.
- [x] Validate the customer list and summary responses through shared contracts.
- [x] Use the same auth/token/error-envelope conventions as Reservations/Fittings.
- [x] Remove all customer prototype fixture data once live wiring is complete.

## 27. Wire summary cards

- [x] Load production `/customers/summary` data.
- [x] Cards have independent loading/error handling where useful without creating inconsistent page state.
- [x] Refresh summary after an action that changes customer status or qualifying metrics.

## 28. Wire list/search/filter/pagination

- [x] Fetch `GET /customers` with `limit=10`.
- [x] Send search/status/cursor rather than filtering the current 10 rows client-side.
- [x] Reset cursor history when search/status changes.
- [x] Keep page state stable after retry where possible.
- [x] Archive mutation refreshes the current list; if the last row of a later page disappears, handle pagination without leaving an empty impossible page.

## 29. Wire Customer Details Sheet

- [ ] Fetch customer detail only when a customer is selected.
- [ ] Fetch Reservation/Fitting histories with bounded requests.
- [ ] Do not require the table list response to expose private detail-only fields.
- [ ] Keep history pagination independent for Reservations and Fittings.
- [ ] Retry one failed history section without forcing unrelated successful sections to disappear when practical.

## 30. Wire Edit

- [ ] Submit `PATCH /customers/:id` with idempotency/concurrency fields.
- [ ] Disable duplicate Save while pending.
- [ ] On success refresh:
  - selected customer detail.
  - affected list row.
  - summary only if a displayed metric can change.
- [ ] Preserve Sheet position/state after successful edit where practical.
- [ ] Stale-version response asks staff to refresh rather than silently overwriting another edit.

## 31. Wire Archive

- [x] Submit explicit archive command only after confirmation.
- [x] Disable duplicate Archive while pending.
- [x] On success:
  - close/update the detail Sheet appropriately.
  - refresh list.
  - refresh summary cards.
- [ ] Verify archived profile no longer appears in Reservation customer search.
- [ ] Verify archived profile no longer appears in Fitting customer search.
- [ ] Verify existing linked Reservation/Fitting detail still resolves correctly.

## 32. Production UI tests

- [x] Mock contract-valid API responses rather than feature-local prototype data.
- [x] Confirm 10-row pagination wiring.
- [x] Confirm search/status query serialization.
- [ ] Confirm details lazy loading.
- [ ] Confirm independent Reservation/Fitting history pagination.
- [ ] Confirm Edit payload and post-success refresh.
- [x] Confirm Archive payload and post-success refresh.
- [ ] Confirm no Delete action exists anywhere on the Customer page/sheet.

## 33. End-to-end/manual validation

- [ ] Open `/customers` as Owner/authorized Staff.
- [ ] Confirm visuals match Reservations/Fittings on desktop and responsive widths.
- [ ] Confirm summary values against seeded known data.
- [ ] Search by name, phone, and email.
- [ ] Navigate at least two customer pages with exactly 10 rows on a full page.
- [ ] Open Customer Details and inspect profile data.
- [ ] Verify Reservation history against `/reservations`.
- [ ] Verify Fitting history against `/fittings`.
- [ ] Edit customer contact information and confirm old Reservation snapshots do not change.
- [ ] Archive a customer and confirm history remains.
- [ ] Confirm archived customer is no longer selectable for a new Reservation.
- [ ] Confirm archived customer is no longer selectable for a new Fitting.
- [ ] Confirm no hard-delete control exists in the UI or API.

## 34. Documentation cleanup

- [ ] Update [[02-Architecture/Customer Address and Social Profile Fields]] because its current statement that no general customer-edit surface exists becomes superseded by this feature.
- [ ] Document the live-profile vs Reservation-snapshot boundary.
- [ ] Document Archive vs anonymization semantics.
- [ ] Document the four customer summary metric definitions.
- [ ] Document the chosen customer-management permission boundary.
- [ ] Keep this checklist updated as tasks are completed.

---

# Definition of Done

The Customers feature is complete only when all of the following are true:

- [ ] `/customers` visually matches the Reservations/Fittings dashboard theme.
- [x] Four production summary cards are backed by authoritative data.
- [x] Customer table is server-paginated at 10 rows per page.
- [x] Search and Active/Archived/All filtering are production-backed.
- [ ] Customer Details Sheet shows live profile plus bounded Reservation and Fitting history.
- [ ] Edit changes only the live customer profile.
- [ ] Existing Reservation snapshots remain historically unchanged.
- [ ] Archive preserves history and removes the profile from new-booking customer selectors.
- [ ] No hard-delete UI or API exists.
- [ ] Tenant and branch authorization tests pass.
- [ ] Contracts, API, App, and focused integration tests pass.
- [ ] Relevant typecheck/lint/build checks pass or unrelated baseline failures are documented.
- [ ] Manual browser validation passes for the complete Owner/Staff workflow.
