---
title: Fittings Backend Decision Record
type: product-domain-decision-record
status: approved-for-implementation
owner: Drezivo team
updated: 2026-10-01
tags: [drezivo, v1.1, fittings, backend, decisions, domain]
---

# Fittings Backend Decision Record

## Purpose

This document freezes the product and domain behavior for the first production implementation of Drezivo Fittings. It is the decision source for Backend Phase BE-0 in [[Fittings Implementation Checklist]].

The approved frontend prototype remains the UX reference, but prototype fixtures and local-only types are not API/database contracts. Where the approved backend behavior intentionally tightens the prototype, the backend decision in this file wins for production integration.

Canonical architecture must remain aligned with the [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).

## Release boundary

- First production slice is **staff-created fittings only**.
- Owner and Front Desk can perform fitting operations.
- Public/customer self-booking is deferred.
- Core appointment/domain contracts must remain channel-neutral enough to add public booking later without redesigning the appointment model.
- No customer-facing fitting notifications, SMS, or automated reminders ship in the first backend slice.
- Fitting services may write safe outbox-ready domain events where useful; delivery behavior is deferred.

## Branch fitting configuration

Fitting configuration is branch-scoped. In the current single-default-branch product the frontend may present this as business-level configuration, but persistence belongs to the branch.

Fitting-specific configuration for each branch has:

- enabled state;
- maximum simultaneous fittings;
- strict fitting duration;
- optional fixed fitting fee.

The branch itself separately owns canonical Business Hours through `branch.operating_hours`: one opening time, one closing time, recurring closed weekdays, optimistic version, and update timestamp. Whole-day special closures live in `branch_closure`. The branch timezone remains authoritative for both.

Only Owner may change fitting configuration. Owner and Front Desk may view it.

Disabling fittings:

- blocks creation of new fittings;
- blocks rescheduling an existing fitting to a new period;
- does not cancel or invalidate existing appointments;
- does not block lifecycle actions on existing appointments.

Configuration changes must not invalidate future appointments already accepted by the system. Capacity reduction, Business Hours changes, recurring closed-weekday changes, or special closed-date changes that conflict with accepted future fittings are rejected. Duration and fee changes apply only to newly created fittings because appointments snapshot their effective period/fee.

## Capacity and concurrency model

The product does **not** expose rooms, staff assignment, named resources, or capacity slots.

Backend capacity uses hidden internal capacity slots:

- Branch configuration defines maximum **simultaneous** fittings, not a daily appointment count.
- Capacity `N` is represented by `N` internal branch capacity slots.
- A fitting claims exactly one hidden slot for its appointment period.
- Capacity slots are implementation details and are not exposed in the staff fitting UI or public contracts.
- Slot allocations use database-enforced overlap protection; correctness must not depend on `count then insert`.
- Creation/reschedule and capacity-setting mutation must be serialized against the relevant branch fitting configuration so capacity cannot be reduced while a competing booking is being accepted.

Example with capacity `3`: any number of fittings may occur in one day, but at no instant may more than three appointment periods overlap.

## Time, duration, hours, and closures

Scheduling grid:

- Fitting start times align to 30-minute boundaries.
- Configured duration must be at least 30 minutes and a multiple of 30 minutes.
- Duration is a **strict branch rule**, not a per-appointment override.
- Existing appointments retain their stored period if the configured duration later changes.

A fitting is schedulable only when its entire appointment period:

- fits inside the active branch Business Hours opening/closing window;
- occurs on a weekday not listed in `closed_weekdays`;
- does not fall on a `branch_closure` local date;
- has an available hidden capacity slot;
- can claim every requested guaranteed garment.

V1 Business Hours deliberately use one shared daily opening/closing window rather than fitting-specific per-weekday windows or recurring-break gaps. `branch_closure` represents whole-day special closures such as holidays or private events.

Branch timezone is authoritative. Staff enters local branch date/time; the backend stores the bounded timestamp period plus a timezone snapshot.

## Appointment lifecycle

Canonical persisted states:

```text
pending
confirmed
completed
rejected
cancelled
no_show
```

Allowed transitions:

```text
pending   -> confirmed
pending   -> rejected
pending   -> cancelled
confirmed -> completed
confirmed -> cancelled
confirmed -> no_show
```

`completed`, `rejected`, `cancelled`, and `no_show` are terminal.

Rules:

- Every newly created staff fitting starts as `pending`.
- `pending` is already a real scheduled appointment and reserves capacity plus guaranteed garments.
- Payment/evidence state is independent from appointment state.
- Status never changes automatically because time passes.
- A past `confirmed` fitting may be flagged as requiring an outcome, but staff must explicitly record `completed` or `no_show`.
- `rejected` and `cancelled` require a bounded internal reason.
- `no_show` requires no free-text reason and is allowed only after scheduled start.
- `completed` is allowed only at or after scheduled end.
- Once scheduled start is reached, the appointment plan is frozen: no reschedule, garment-plan edits, rejection, or normal cancellation.
- Fittings are never hard-deleted through normal staff operations. Accidental records are cancelled with a reason. Privacy/anonymization remains a separate governed process.
- State transitions use conditional/locked guards plus optimistic versioning where appropriate; arbitrary client status replacement is not allowed.

## Allocation release rules

`pending` and `confirmed` appointments hold capacity and guaranteed garment allocations.

Release behavior:

- `rejected`: release capacity and guaranteed garments immediately.
- `cancelled`: release immediately.
- `no_show`: allowed only after start; release remaining capacity/garment blocks immediately.
- `completed`: allowed only at/after end; release/close active allocations then.

Allocation history remains retained for audit; release does not mean deleting allocation records.

## Customers and walk-ins

Every production fitting links to a real `customer` record.

Staff may:

- select an existing customer; or
- create a new walk-in customer.

New walk-in minimum:

- full name; and
- at least one usable contact method: phone or email.

Name-only production walk-ins are not accepted.

Possible duplicate detection is advisory only. If phone/email resembles an existing customer, staff can choose the existing record or deliberately create a new customer. Drezivo never silently merges or reuses a customer based on phone/email alone.

## Garment preference and guarantee

Each fitting line references a product variant.

Preference-only line:

- requires a variant;
- has no physical asset assignment;
- creates no fitting asset allocation;
- must never be presented as guaranteed.

Guaranteed line:

- requests a variant;
- backend deterministically selects one eligible physical asset using the existing serialized-garment allocator;
- physical asset is claimed atomically at fitting creation;
- asset allocation covers exactly the fitting appointment period;
- rental prep/turnaround buffers are not reused for fittings;
- a failed guarantee claim fails the atomic creation/change rather than creating a fake guarantee.

Once selected, the physical asset remains assigned unless staff deliberately changes the garment plan or a valid reschedule requires replacement. Drezivo does not silently swap a guaranteed asset.

Future `pending` or `confirmed` fittings may change garment lines before scheduled start. Guaranteed-garment replacement is atomic: claim the replacement before releasing the previous guarantee; failure preserves the old plan. Once start time is reached or the fitting is terminal, garment planning is immutable.

## Atomic creation and reschedule

Fitting creation is atomic. A successful create must commit together:

- appointment in `pending`;
- customer link;
- one hidden capacity-slot allocation;
- all fitting lines;
- every guaranteed physical-asset allocation;
- fitting-fee charge when the snapshotted fee is greater than zero;
- audit event and any approved safe outbox intent.

If any required capacity/garment/financial write fails, no fitting is created.

Date/time changes are a dedicated `reschedule` command, not generic field editing.

Reschedule validates the replacement period first and atomically obtains replacement capacity/garment claims before the old booking is released. If replacement validation or claims fail, the original appointment and allocations remain unchanged. The appointment keeps the same ID and history.

## Fee and finance rules

Fitting fee configuration is branch-scoped:

- fee may be disabled (`0`) or one fixed nonnegative amount;
- staff cannot override fee per appointment;
- appointment snapshots `fee_minor` and `currency` at creation;
- later fee changes affect new fittings only.

If snapshotted fitting fee is greater than zero, creation also creates an immutable `fitting_fee` charge through the existing finance domain.

The charge represents an obligation, not payment receipt.

Payment rules:

- payment is **not** required before `pending -> confirmed`;
- no fitting-specific duplicate payment-status field becomes a second source of truth;
- existing finance payment/evidence records remain authoritative;
- cancellation/rejection/no-show never automatically create a refund;
- refunds/reversals are explicit existing-finance actions.

## Notes, reasons, and audit

A fitting may have one optional bounded `internal_note`:

- visible/editable to Owner and Front Desk;
- never exposed through future customer/public fitting APIs;
- not used as a substitute for structured status, payment, guarantee, or reason fields.

Meaningful mutations write append-only audit events through Drezivo's existing audit infrastructure, including at least:

- created;
- confirmed;
- rejected;
- cancelled;
- completed;
- marked no-show;
- rescheduled;
- garment-plan/guarantee change;
- fitting-configuration change.

Audit metadata is safe/redacted and records actor, action, entity, request ID, and bounded summary rather than unrestricted sensitive before/after payloads.

## Permissions

Owner and Front Desk may perform operational fitting actions:

- list/view;
- create;
- confirm;
- reject;
- reschedule before start;
- cancel before start;
- modify future garment plan;
- complete at/after end;
- mark no-show after start;
- edit internal note.

Owner only may mutate fitting-specific configuration:

- enabled state;
- maximum simultaneous fittings;
- strict duration;
- fitting fee.

Business Hours and special closed dates are mutated through the Settings domain, not the Fittings domain.

Existing finance authorization remains authoritative for payment verification and refunds; fitting permissions do not grant new finance authority.

## Cross-product rollout

Production integration now uses one ownership boundary:

1. `/fittings` owns fitting appointments and opens a Fitting Settings modal for enabled/capacity/duration/fee.
2. Business Information Settings owns Business Hours and special closed dates for the active branch.
3. Calendar consumes real fitting appointments while Business Hours frame the visible schedule and closed-day presentation.
4. Storefront fitting slots and staff fitting validation consume the same Business Hours/closure rules.
5. Dashboard, Availability and Payments consume their existing fitting projections without owning schedule configuration.

Prototype/mock fitting data in those surfaces must be removed only when that surface's production integration is implemented and verified.

## Explicit first-slice non-goals

- Public/customer fitting booking.
- Customer fitting accounts/guest links.
- Room assignment.
- Staff assignment.
- Named fitting resources.
- User-visible capacity slots.
- Per-appointment duration override.
- Per-appointment fee override.
- 15-minute scheduling increments.
- Automatic status transitions.
- Automatic refund policy.
- Automated fitting reminders.
- Customer-facing email/SMS fitting delivery.
- Hard delete.
- Separate fitting event-sourcing subsystem.
- A separate fitting-owned weekly-hours or closure subsystem.

## BE-0 implementation consequence

The original `fitting_hours` / `fitting_closure` model was removed before production users existed, when the product boundary was simplified to shared branch Business Hours. Migration `0063_branch_business_hours.sql` performs the destructive roll-forward and rejects incompatible legacy partial-day/split-window data rather than silently broadening availability. Canonical PRD/TRD/Data Model/ERD and implementation records must describe this newer ownership boundary.
