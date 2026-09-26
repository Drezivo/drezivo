# Fittings Prototype Review Gate

## Purpose

This is the final frontend review gate before any fitting backend, API, database, or shared-contract work begins.

The fitting UI is still a **frontend prototype**. Its fixture shapes, labels, and local actions are not backend contracts.

## Current gate status

**Backend handoff: BLOCKED** until the unresolved product decisions below are canonicalized and the owner/front-desk workflow review is completed.

## Frontend surface under review

### `/fittings`

Reviewer should be able to:

- Find today's and upcoming fittings quickly.
- Search by customer or garment.
- Filter by appointment status and date.
- Understand customer, garment intent, fitting fee/payment state, appointment status, and attention state without opening every row.
- Open the Fitting Details Sheet from a row with keyboard or pointer input.
- Create a local fitting through Appointment → Garments/Fee → Review.

Approved prototype list fields:

- Date and time
- Customer
- Garment summary
- Fitting fee / payment state
- Appointment status
- Attention

Intentionally excluded from the list:

- Phone/email
- Long notes
- Measurements
- Receipt data
- Room/staff/resource fields

### Fitting Details Sheet

Approved prototype sections:

- Customer
- Appointment date/time
- Appointment status
- Garments and `Preference only` / `Guaranteed intent` / fixture-only guaranteed asset presentation
- Fitting fee and payment state
- Local-only appointment actions

Payment state remains separate from appointment status.

### New Fitting

Approved prototype inputs:

- Existing or walk-in customer
- Date
- Start time
- Duration
- One or more garment choices
- Garment intent per line
- Optional fitting fee
- Prototype payment state
- Review before local creation

The business-level default duration from `/fittings/schedule` is the starting duration for New Fitting. Staff may override the duration for one appointment.

### `/fittings/schedule`

Approved prototype interactions:

- Monday–Sunday fitting hours
- Day enabled/unavailable state
- Multiple working windows per day
- Business-level default appointment duration
- Local breaks and date-specific closures
- Fixture appointment blocks that open the same Fitting Details Sheet

No room, staff, resource, or capacity-slot management belongs in this frontend prototype.

## Decisions already made through prototype review

### No-show

`No-show` remains in the frontend status vocabulary. It means the appointment was scheduled but the customer did not attend.

This is approved as a useful staff-facing state for the prototype. It should still be canonicalized before becoming a backend enum.

### Default duration

The schedule configuration is the source of the **default fitting duration** in the prototype.

- Prototype default when no setting exists: 60 minutes.
- Supported prototype options: 30, 45, 60, 90 minutes.
- New Fitting initializes from that schedule value.
- Staff can override the duration for an individual fitting.
- The value is session-scoped prototype state, not persisted tenant configuration.

### Resource management

Room/staff/resource/capacity-slot controls are intentionally excluded from the fitting frontend prototype.

This does not rewrite or approve any backend capacity model. It only defines the current product surface.

## Frontend working status flow

The current UI demonstrates this working flow:

```text
Pending → Confirmed → Completed
    └──→ Rejected

Confirmed → Cancelled
Confirmed → No-show
```

Terminal prototype states currently have no further UI actions.

This flow is suitable for owner/front-desk review, but the exact backend lifecycle, transition rules, authorization, audit behavior, and cancellation semantics are **not canonical yet**.

## Prototype-only vocabulary — do not copy directly into wire enums

The following labels are approved for frontend review but must not automatically become API/database enums:

- `Pending`
- `Confirmed`
- `Completed`
- `Cancelled`
- `Rejected`
- `No-show`
- `Not required`
- `Pending review`
- `Verified`
- `Payment review`
- `Preference only`
- `Guaranteed intent`

The fixture fields in `fitting-prototype-data.ts` are visualization shapes only.

## Verification still required before final frontend sign-off

The implementation has code-level responsive, accessibility, and theme-token coverage, but these visual checks still need a real browser walkthrough:

- `/fittings` at 360px.
- `/fittings/schedule` at 360px.
- Fitting Details and New Fitting sheets at 360px.
- Light-theme contrast and state readability.
- Dark-theme contrast and state readability.

These checks are part of frontend sign-off and must not be treated as completed without visual evidence.

## Product decisions still blocking backend work

### 1. Canonical status model

Open:

- Final enum names
- Allowed transitions
- Who can perform each transition
- Whether rejected/cancelled/no-show are terminal
- Audit/history requirements

### 2. Fitting fee source

Open:

- Whether a business configures a default fitting fee
- Whether fee is optional per appointment
- Whether the current ₱300 fixture default should survive beyond the prototype

The current ₱300 value is mock data only.

### 3. Appointment notes

Open:

- Whether notes are needed in the initial V1.1 fitting workflow
- Whether notes are internal-only
- Whether structured reasons are needed for cancellation/rejection/no-show

### 4. Staff-only versus public fitting booking

Current prototype is staff-facing only.

Open:

- Whether public fitting booking is part of the first V1.1 slice
- If public booking exists, whether staff approval is required

### 5. Payment requirement before confirmation

Open:

- Whether a fitting fee must be verified before appointment confirmation
- Whether payment can remain pending after confirmation
- Whether no-fee fittings bypass payment entirely

The prototype intentionally does not synchronize payment state with appointment status.

### 6. Cancellation / rejection / refund behavior

Open:

- Cancellation cutoff rules
- Rejection reasons
- No-show policy
- Refund behavior for paid fitting fees
- Whether cancellation/rejection affects any garment intent or later reservation workflow

## Owner / front-desk review script

Use the current prototype and complete this in one session with a real operator or rental-business owner.

1. Find today's fittings without guidance.
2. Find an upcoming fitting for a named customer.
3. Explain what `Preference only` means.
4. Explain the difference between appointment status and payment state.
5. Open a fitting and identify customer, garment, appointment time, and fee.
6. Create a new fitting for an existing customer.
7. Create a walk-in, no-fee fitting.
8. Change the default duration in Schedule & Availability, return to New Fitting, and confirm the new default appears.
9. Disable one fitting day and add a break/closure.
10. Ask which fields/actions feel unnecessary or missing.
11. Confirm that scheduled fitting visualization belongs in the existing Calendar rather than this settings page.
12. Record any terminology the reviewer does not naturally understand.

### Review result template

- Reviewer role/business type:
- Date:
- Tasks completed without help:
- Tasks requiring explanation:
- Confusing labels:
- Missing information:
- Unnecessary information:
- Requested workflow changes:
- Decision changes triggered by review:

## Freeze rules

Before backend implementation begins:

- Route hierarchy must remain `/fittings` and `/fittings/schedule` unless review feedback requires a change.
- List fields, Details Sheet sections, New Fitting inputs, and schedule interactions must be explicitly accepted after review.
- Prototype fixture types must not be copied into Prisma, SQL, API contracts, or shared domain types.
- Prototype statuses/payment labels must be translated into an approved domain lifecycle first.
- A backend planning checklist may exist, but contracts, migrations, and production fitting routes must remain blocked until the open decisions in this document are resolved.

## Backend handoff readiness

Current state: **NOT READY**.

The frontend is ready for workflow review and the backend implementation checklist now exists as a planning artifact. Production backend implementation remains intentionally blocked by unresolved domain decisions and the pending real owner/front-desk review.
