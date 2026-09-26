# Fittings Prototype Review Gate

## Purpose

This document records the completed frontend review and the handoff boundary into production backend implementation.

The frontend prototype remains the UX reference for `/fittings` and `/fittings/schedule`. Prototype fixture shapes and local-only types are not backend contracts. Canonical production behavior is now frozen in [[Fittings Backend Decision Record]] and aligned with the [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).

## Current gate status

**Frontend review: COMPLETE**

**Backend BE-0 handoff: READY**

**Next phase:** BE-1 contracts and API surface.

No fitting SQL migration or production route should invent behavior outside the approved backend decision record.

## Approved frontend surface

### `/fittings`

Approved operational surface:

- Today's and upcoming fittings.
- Search by customer or garment.
- Status/date filters.
- Date/time, customer, garment summary, fitting fee/payment state, appointment status and attention state.
- Fitting Details Sheet.
- New Fitting flow.
- No room/staff/resource/capacity-slot management.

### Fitting Details Sheet

Approved sections:

- Customer.
- Appointment date/time.
- Appointment status.
- Garment preference/guarantee presentation.
- Fitting fee/payment state.
- Staff actions.
- Internal notes may be added during production integration according to the backend decision record.

Payment state remains separate from appointment status.

### `/fittings/schedule`

Approved product surface:

- Monday–Sunday fitting hours.
- Enabled/unavailable days.
- Multiple operating windows per day.
- Fitting duration.
- Breaks/closures presentation.
- No duplicate weekly appointment visualization; Calendar owns operational scheduled-event visualization.
- No room/staff/named-resource controls.

## Production deltas from the prototype

The following prototype behavior is intentionally tightened for the production backend:

- **Duration:** production duration is a strict branch setting. Start times align to 30-minute boundaries and duration must be at least 30 minutes and divisible by 30. Staff cannot override duration per appointment. The prototype's 45-minute option is not canonical.
- **Walk-ins:** production walk-ins require full name plus phone or email. Name-only local prototype records are not accepted by the production API.
- **Capacity:** production uses hidden internal branch capacity slots. The UI does not expose slots. Capacity means maximum simultaneous overlapping fittings, not a per-day limit.
- **Fee:** production fee is an optional fixed branch setting; staff cannot override it per appointment. The prototype ₱300 value remains fixture-only.
- **Guarantee:** production `Guaranteed` means a real eligible physical asset has been atomically allocated. Prototype `Guaranteed intent` is not a wire/database value.
- **Schedule settings:** production settings are branch-scoped even while the current product automatically uses the one default branch.

## Canonical appointment lifecycle

Persisted states:

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

Rules:

- New staff-created fitting always starts `pending`.
- `pending` already reserves one hidden capacity slot and every guaranteed garment.
- Completed/rejected/cancelled/no_show are terminal.
- Rejected/cancelled require a bounded internal reason.
- Status does not change automatically when time passes.
- After scheduled start, reschedule, garment changes, rejection and normal cancellation are frozen.
- `no_show` is allowed only after scheduled start.
- `completed` is allowed only at/after scheduled end.
- Normal staff operations never hard-delete a fitting.

## Capacity and schedule decisions

- Branch owns `fittings_enabled`, maximum simultaneous capacity, strict duration, fixed optional fee, weekly hours and date-specific closures.
- Capacity `N` is backed by `N` hidden internal capacity slots.
- One scheduled fitting atomically claims one slot.
- Database overlap protection is authoritative; no `count then insert` correctness path.
- Recurring breaks are gaps between multiple weekly operating windows.
- Date-specific closures cover holidays/private events/partial-day exceptions.
- A fitting must fit fully inside one weekly operating window and outside closures.
- Branch timezone is authoritative and snapshotted on the appointment.
- Configuration changes that would invalidate an existing future fitting are rejected.
- Disabling fittings blocks new create/reschedule only; existing appointments remain operable.

## Customer decisions

- First production slice is staff-created only.
- Core appointment model remains suitable for future public booking without requiring a redesign.
- Every fitting links to a real `customer`.
- New walk-in requires full name plus phone or email.
- Possible duplicate contact matches are advisory only; no automatic merge or silent reuse.

## Garment decisions

`Preference only`:

- variant required;
- no asset assignment;
- no inventory block;
- never presented as guaranteed.

`Guaranteed`:

- variant requested by staff;
- backend deterministically selects one eligible physical asset using the existing allocator;
- asset is claimed at fitting creation;
- asset allocation covers exactly the fitting period;
- no rental preparation/turnaround buffer is borrowed for fittings;
- failed claim fails the command instead of creating a fake guarantee.

Future pending/confirmed garment changes are allowed before start. Guaranteed replacement is atomic and preserves the previous guarantee if replacement fails.

## Atomic create and reschedule

Creation is atomic across:

- pending appointment;
- customer relationship;
- capacity-slot allocation;
- fitting lines;
- all guaranteed asset allocations;
- fitting-fee charge when fee > 0;
- audit metadata;
- approved safe outbox intent.

Reschedule is a dedicated command. It obtains replacement schedule/capacity/garment claims before releasing old claims. Failure leaves the original appointment unchanged.

## Finance decisions

- Branch may configure no fee or one fixed fitting fee.
- Appointment snapshots fee and currency at creation.
- Positive fee creates an immutable `fitting_fee` charge in the existing finance domain.
- Charge does not imply payment.
- Payment/evidence does not gate confirmation.
- No duplicate fitting-specific payment-status source of truth.
- Rejected/cancelled/no-show never auto-refund.
- Refunds/reversals remain explicit finance actions subject to existing finance permissions.

## Permissions and audit

Owner + Front Desk may perform operational fitting actions subject to state/time guards:

- view/list;
- create;
- confirm;
- reject;
- reschedule;
- cancel;
- edit future garment plan;
- complete;
- mark no-show;
- edit one optional bounded internal staff note.

Owner only may change fitting configuration:

- enabled state;
- capacity;
- duration;
- fee;
- weekly hours;
- closures.

Meaningful fitting/configuration mutations write append-only audit events through the existing audit infrastructure.

## Allocation release behavior

- `rejected` -> release capacity and guaranteed garments immediately.
- `cancelled` -> release immediately.
- `no_show` -> allowed after start; release remaining active blocks immediately.
- `completed` -> allowed at/after end; close/release active blocks then.

Released allocation rows remain historical records; they are not hard-deleted.

## Notifications and cross-product rollout

First fitting backend slice sends no customer-facing fitting email/SMS/reminders. Services remain outbox-ready for later notification consumers.

Production data rollout is staged:

1. `/fittings` and `/fittings/schedule`.
2. Calendar.
3. Dashboard.
4. Availability.
5. Payments.

Prototype/mock fitting data is removed from each dependent surface only when that surface is connected to verified production fitting data.

## Backend decision source

See [[Fittings Backend Decision Record]] for the full approved boundary and explicit non-goals.

## Freeze rules for BE-1+

- Do not copy `FittingPrototypeAppointment` or fixture object shapes into `@drezivo/contracts`.
- Do not expose hidden capacity-slot IDs as staff/public fitting fields.
- Do not reintroduce room/staff/named-resource assignment without a new product decision and coordinated PRD/TRD/Data Model/ERD update.
- Do not accept per-appointment duration or fee overrides.
- Do not add public fitting booking, customer reminders, automatic refunds, automatic status transitions or hard delete in the first backend slice.
- All mutating commands must use the existing idempotency contract and tenant/branch authorization conventions.
- Reschedule and guaranteed-garment replacement must preserve the current winning appointment when replacement fails.

## Backend handoff readiness

Current state: **READY FOR BE-1**.

BE-0 product/domain behavior is frozen and documented. Contracts and API-surface design may now begin. Database migrations remain gated behind approved BE-1 contracts according to [[Fittings Implementation Checklist]].
