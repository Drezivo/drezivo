# Drezivo Product Requirements Document

**Version:** 2.0 (revised) · **Status:** V1 product definition · **Updated:** 15 September 2026

## 1. Product decision and release contract

Drezivo is a Philippines-first, multi-tenant clothing-rental operations SaaS. A tenant receives an operations workspace and a branded customer storefront. V1 lets a shop publish a real catalog, accept a guest request for one garment for a date range, hold the correct physical asset, review cash or merchant QR evidence, release the garment, inspect it on return, and reconcile rental money with a separate refundable security deposit.

This is incremental, not feature-complete interpretation of every supplied screen.

| Release | Outcome and scope | Gate |
|---|---|---|
| V0 discovery/pilot | 12–15 discovery interviews proposed; concierge onboarding and observed single-garment lifecycle using one default branch | Evidence of actual workflow and failure modes |
| V1 | Single branch; Owner and Front desk; styles/variants/assets; single-garment guest checkout; reservations, holds, manual cash/QR review, pickup, return, inspection, cleaning-ready state, deposits, exports, audit, minimal Drezivo operator admin | Release gates in §9 |
| V1.1 | Fittings with room/staff/resource capacity, multi-item booking UI, automated no-show/late reminders and partial physical returns | Promote only if pilot evidence supports it |
| V2 | Branches, branch permissions, transfers and custody | Separate migration/security gate |
| V3 conditional | Enterprise governance, SSO, advanced audit/reporting | Demand/readiness gate |

Tenant and default branch exist from account creation. Tenant-owned records carry tenant scope; operational records also carry the relevant branch. Platform plan definitions are global. The authoritative user-confirmed monthly prices (15 September 2026) are Starter ₱300, Professional ₱499, and Business ₱1,299. The ₱999/₱1,999/₱3,999 screenshot is outdated and must not be used. Willingness to pay, retention, and unit economics remain unmeasured; that is a validation topic, not a price-selection question.

## 2. Boundaries and users

Owner controls policies, payment instructions, money verification, users, and inventory. Front desk serves customers, updates operations, and records custody. Guest customers browse mobile-first without accounts. Drezivo operators provision tenants, manage entitlements/subscriptions, suspend access, and provide audited recovery support.

V1 excludes gateway/card settlement, automatic reconciliation, SMS, ratings/reviews, wishlist, cart, marketplace, native apps, live courier APIs, customer accounts, multi-item checkout, multi-branch transfers, and enterprise governance. Delivery is configurable text/fees. A QR image is only a merchant instruction.

## 3. Domain model and invariants

A style is customer-facing; a variant is size/color plus measurements; a physical asset has unique code, condition, location, custody, cleaning status, and alteration note. V1 selects one variant and allocates one eligible asset; reservation_lines already exists for V1.1 multi-item.

Availability uses half-open [pickup_at, return_at) intervals in tenant timezone (default Asia/Manila), plus preparation, pickup/return, inspection, and cleaning buffers. Cleaning, maintenance, and manual blocks are unavailable. Event date is separate. A late return flags affected future allocations and never overbooks.

Canonical reservation states are held, pending_confirmation, confirmed, picked_up, returned, completed, cancelled, expired, rejected. Payment evidence is independent: not_required, awaiting_upload, uploaded, under_review, verified, rejected, superseded. Uploaded evidence is never Paid.

Money lines are separate: rental charges, advance payments toward those charges, refundable security deposit, fitting fee (V1.1), delivery, discount, late/damage charge, refund. Immutable price/policy/deposit/buffer/delivery/customer snapshots are stored. Example: a ₱1,500 rental charge plus ₱2,000 security requires ₱3,500 total collection; the refundable ₱2,000 is not rental revenue. An advance is a payment toward the charge, not additional revenue; revenue recognition follows the business's accounting policy. Server recalculates money, quantities, eligibility, and scope.

### Hold and confirmation

On Continue to payment, one transaction validates fields, selects an asset, and creates an exclusive held reservation before displaying QR or accepting evidence. Initial TTL is 15 minutes. Receipt upload or cash submission changes evidence and reservation to pending_confirmation while retaining that allocation, but review is at most 24 hours from initial acquisition. Merchant approval verifies actual funds and atomically makes reservation confirmed, evidence verified, and allocation confirmed through its bounded rental/turnaround interval. Reject/ask-info is audited; asking for information cannot extend the maximum deadline. Expiry releases allocation. Late external payment is refund or a new booking with fresh availability; it cannot revive the old allocation. The 15-minute/24-hour values are proposed pilot defaults, not owner-confirmed policy; any later policy change must preserve already communicated deadlines.

Every mutation has disabled/pending state and early-return guard. One idempotency key per intent plus conditional transitions/database constraints means sequential and concurrent double-fire tests yield zero duplicate reservations, allocations, or postings.

## 4. Workflows and acceptance

### Onboarding/live publish (FR4, FR13, FR14)

Sign-up creates tenant, owner, default branch, draft storefront, proposed 14-day trial, PHP and Asia/Manila defaults. Wizard requires business name/contact, branch address/hours, payment instruction, duration, pickup/return, deposit, cancellation policy, privacy/contact copy, and one style/variant/asset. CSV import offers preview, row validation, duplicate detection, idempotent commit; invalid rows write nothing.

Publish requires contact, policy, payment instruction, and one active rentable asset. Preview must equal public route. Acceptance: anonymous mobile visitor opens URL, views a style, selects future date, gets real availability, and sees contact. Publish/first availability are instrumented.

### Guest booking (FR15–FR21)

Catalog supports search/category/size/color/price/date. V1 has one garment line; no cart/wishlist/reviews. Detail shows selected variant measurements, advance rental, separate deposit, dates, buffers, policies. Details captures minimum name, phone, email, variant, rental dates, optional event date, pickup/delivery, and method. Government ID is not default; enabled verification must state purpose/retention/access. QR/cash instructions appear only after hold; evidence upload is not Paid.

Review is read-only with snapshots, timezone dates, expiry, separate money lines. Confirmation says pending_confirmation, shows reference/evidence/expiry, never “Paid.” Resend guest link uses a hashed, expiring token; it reveals no reservation before verification and permits status, corrected evidence, cancellation, or reschedule. Reschedule validates replacement availability before releasing old allocation; failure leaves old booking intact.

### Operations (FR5–FR12)

Dashboard queues pickups, returns, pending evidence, expiring holds, overdue/late flags, cleaning/maintenance, and review work. Calendar shows assets and buffers with conflict reasons. Walk-in booking uses same allocator. Cash remains under_review until authorized verification confirms cash received.

Pickup records actor/time/condition and transitions confirmed → picked_up only if the garment is physically present, ready, and meets payment/policy prerequisites. Return records actual time, condition and notes, transitions picked_up → returned; inspection marks cleaning required or ready; completion follows the settlement checklist. V1 includes manual handling for no-shows, late return, payment exceptions and disrupted next bookings. Automated reminders and partial physical returns are V1.1. Deposit settlement is itemized: full release, partial refund less approved charge, or retention with reason and snapshot; refund cannot exceed the remaining refundable balance under concurrent requests. Async CSV exports show progress and require authorization.

### Fittings (FR11)

Fitting scheduling is V1.1 pending validation. V1 may store a note only and must not promise capacity or accept a fitting fee without resource controls. V1.1 models room/staff/resource, hours, breaks, duration, capacity, customer, garment, fee, status, and conflict checks.

## 5. Permissions and privacy

| Capability | Owner | Front desk |
|---|---|---|
| Assets/conditions/blocks | Full | Operational edits; no archive |
| Reservations/pickup/return/cleaning | Full | Create/update/custody |
| QR/payment instructions/refunds | Full | View; no edit/refund |
| Evidence | View/verify/reject | Operational view; no verify by default |
| Private ID/receipt documents | Audited full | Receipt only when assigned; ID denied by default |
| Policies/publish/users | Full | Read-only |
| Exports/deletion | Full audited | Request only |

Collect minimum name/contact/booking data. Social handles, DOB and IDs are opt-in with purpose, retention, restricted access, export and erasure. Every route/object/upload/export is server-authorized and tenant isolated.

## 6. Pricing, entitlements, notifications, operator admin, billing

### Authoritative plans

| | Starter | Professional | Business |
|---|---:|---:|---:|
| Monthly price | ₱300 | ₱499 | ₱1,299 |
| Active physical assets | Up to 50 | Up to 200 | Up to 1,000 (recommended bounded cap; confirm capacity budget before launch) |
| Owner + Front desk roles | Included | Included | Included |
| Core reliability, isolation, exports, returns/refunds | Included | Included | Included |
| Fittings with resource capacity | Not available until V1.1 ships; then plan entitlement TBD | Same | Same |
| Multi-item booking UI | V1.1 entitlement TBD | V1.1 entitlement TBD | V1.1 entitlement TBD |
| Branches/transfers | Not available; V2 only | Not available; V2 only | Not available; V2 only |
| Advanced reporting/governance | Not promised | Not promised | Future V3 decision |

The table separates customer price from proposed quotas and release availability. Asset quota counts active physical assets, not styles. A plan check is enforced at creation/import/activation and gives a clear upgrade or archive path; it never deletes records. Basic integrity and both V1 roles are available on every plan. No plan sells V2 branches early. Fitting is not available in V1 even if Professional or Business copy suggests it; marketing and entitlements change only when V1.1 ships. Seat counts are intentionally not promised until observed usage supports a bound; the recommended initial model is one Owner plus one Front desk seat on Starter, up to three Front desk seats on Professional, and up to ten on Business, subject to operator capacity review.

Pricing copy must use these exact PHP amounts and say monthly. Do not carry “Most Popular,” unlimited assets, dedicated support, payment integrations, or feature promises from the outdated screenshot without a separately approved entitlement and support budget. Reliability, roles, privacy, export, and safe financial lifecycle are never premium gates. Revenue and willingness-to-pay metrics remain hypotheses to measure through the pilot.

Notification outbox states are queued, sending, sent, failed with bounded retry. UI says queued until provider acknowledgment; no SMS promise.

Billing lifecycle is proposed: trial (14 days), active, past_due (7-day grace), restricted, cancelled. Operator V1 supports tenant provisioning, entitlement changes, suspension, time-bounded recovery/support grants, and actor/reason audit. Suspension blocks new bookings/publish changes but preserves returns, refunds, exports and existing-rental read access. Downgrade/cancel never deletes data or prevents returns/refunds.

## 7. Requirements map

FR1 public problem/CTA; FR2 solution; FR3 pricing/FAQ; FR4 onboarding; FR5 dashboard; FR6 reservations; FR7 interval calendar; FR8 inventory model; FR9 categories; FR10 customers; FR11 fittings V1.1; FR12 ledger/evidence; FR13 storefront/policies/QR; FR14 settings; FR15 storefront; FR16 catalog; FR17 detail; FR18 single-garment availability; FR19 guest details/hold/evidence; FR20 review/snapshots; FR21 confirmation/link; FR22 merchant verification/atomic confirmation.

Additional IDs: OR1 tenant provisioning; OR2 entitlement lifecycle; OR3 suspension continuity; OR4 recovery grant audit; OR5 hashed guest link; OR6 CSV preview/idempotent import; OR7 async exports; OR8 audit/recovery; OR9 deposit settlement; OR10 actual return/inspection/cleaning.

## 8. NFRs and falsification

Proposed targets: 99.9% monthly API availability; availability p95 ≤500ms and internal mutation p95 ≤1s at 100 tenants, 1,000 assets in the busiest tenant, 50 total requests/sec including 5 mutations/sec for 30 minutes; WCAG 2.2 AA core flows; 360px responsive; encrypted files with expiring access and file checks; no secrets/unneeded PII logs. Proposed infrastructure recovery target is RPO 15 minutes/RTO 4 hours, not a proven guarantee or a premium customer-plan feature. Detailed measurement conditions are in the TRD.

Tests before V1: concurrent/sequential double-fire for every mutation; tenant/role isolation; expiry measured from initial acquisition; confirm racing expiry; failed reschedule preserves old allocation; refund cap; cash verification; token/upload auth; duplicate CSV; notification failure; restore; late return flags; no-overbooking property tests.

## 9. Metrics and release gates

V0 proposes 12–15 discovery interviews and observed lifecycles. V1 requires five shops onboarded, 100 completed rental lifecycles across pilot, four independently operating pickup/return, three paid early signals, zero duplicate allocations/postings, and no critical privacy/isolation defect. Track publish time, availability latency, review time, expiry, confirmation, return/cleaning time, deposit reconciliation, support minutes, activation, retention, and pricing conversion. These are proposed gates, not completed evidence.

## 10. Version gates and references

V1.1 requires evidence fittings/capacity/multi-item/no-show/late/partial returns block shops. V2 requires transfer custody design, migration rehearsal, and branch audit. V3 requires enterprise demand, threat model, support/SLA budget, and contract review.

See [Drezivo-Market-Research.md](Drezivo-Market-Research.md) for evidence limits and findings. Screenshots are visual references, not authority; they do not require wishlist, cart, reviews, delivery APIs, or parity. Directional references: [Booqable](https://booqable.com/pricing/), [Goodshuffle](https://help.goodshuffle.com/en/articles/1643596-understanding-item-availability-and-conflicts), [Rentman](https://rentman.io/product-updates/managing-multiple-equipment-locations).

## 11. Implementation acceptance details

| Requirement | Concrete acceptance example |
|---|---|
| FR3, OR2 — correct commercial offer | Every plan surface and billing record shows ₱300/₱499/₱1,299 monthly; quotas are checked server-side, including concurrent CSV import/asset activation. Features not released cannot be purchased as available. |
| FR7–FR8 — time and rates | Customer selects a fixed-duration or daily tariff configured by the merchant. Show explicit pickup and return deadlines and the extra-day price. Charging duration is separate from blocked prep/cleaning time. Adjacent intervals work; a conflicting garment cannot be confirmed by another staff member. |
| FR8 — inventory history | Archiving a style/variant/asset hides new intake while preserving existing reservations and history. Refuse retirement with unresolved custody without a resolution workflow. Per-asset measurements and condition remain distinguishable. |
| FR9, FR13 — publish controls | Hidden categories and unpublished storefronts disappear from public results. Existing guests retain private access to their own accepted booking. Preview uses draft content without exposing it publicly. |
| FR10, OR5 — customer boundaries | A renter link opens only its own booking; guessing a reference or changing customer ID reveals nothing. Staff removal takes effect through server authorization. Customer erasure preserves legally required records using the documented retention/anonymization process. |
| FR12, FR22, OR9 — real collection | A uploaded screenshot shows proof submitted, not Paid. Owner approval records verified amount/reference. Partial payment displays remaining charge and deposit obligations separately. Two refund requests cannot consume the same remaining funds. |
| FR18–FR22 — deadline race | Two guests request the same physical garment; one obtains the hold and sees instructions. A receipt received after expiry enters payment exception handling. Confirmation racing expiry has one documented winner. |
| OR10 — fulfillment disruption | An overdue garment threatens the next pickup. The dashboard identifies the affected booking, blocks unsafe handover, and lets the owner record an agreed substitute/reschedule/refund. Actual return remains recordable. |
| OR6–OR8 — portability/recovery | A malformed import reports row errors without partial writes. Export includes understandable booking/financial references and stable IDs. A restore drill reconciles row counts, tenant boundaries, file versions and money totals. |

### Policy defaults versus validated facts

The launch geography and confirmed monthly prices come from the owner/initial brief. The following remain recommendations: trial 14 days, payment hold 15 minutes, maximum manual review 24 hours, renewal grace seven days, Business asset cap 1,000, and proposed seat limits. Policies must be visible before checkout and snapshotted. Test opening-hours treatment during the pilot; do not let an unattended overnight payment flow imply immediate confirmation.

Cancellation and no-show rules are merchant-configured, versioned and accepted before payment. Owner records reason, permitted deduction and refund obligation; Drezivo does not automatically impose a universal non-refundable fee. A requested extension needs fresh capacity and repricing; actual late custody still records if extension is denied. Minimum booking notice, maximum rental length, buffer minutes, refund timelines and delivery zones must have bounded validated configuration before a storefront goes live.

### Larger-business scope

V2 adds source/destination branch permissions, per-unit transfer dispatch/receipt, transit/delay/loss status, consolidated reporting with branch filters, and controlled customer visibility across branches. Transfer requests alone cannot create destination stock. Preserve historical branch ownership and do not equate branches with separate legal tenants.

V3 candidates are negotiated SSO and user lifecycle provisioning, approval thresholds and separation of duties for refunds/payment-destination changes, audit export and retention controls, governed integration credentials/webhooks, dedicated data isolation when contractually required, and documented incident/support commitments. Build each against a real customer's acceptance criteria and cost budget. Enterprise certification, statutory invoicing and multi-region disaster recovery are not implied by choosing this stack.
