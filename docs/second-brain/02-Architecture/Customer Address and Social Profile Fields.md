---
title: Customer Address and Social Profile Fields
type: architecture-decision
status: implemented
owner: Drezivo team
source: "[PRD](../../product/Drezivo-PRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), [ERD](../../architecture/Drezivo-ERD.dbml), and [TRD](../../architecture/Drezivo-TRD.md) — 2026-09-28"
updated: 2026-10-11
tags: [drezivo, customer-data, reservations, fittings, privacy]
---

# Customer Address and Social Profile Fields

Customer profiles now retain a nullable `address` and nullable optional `social_media` value.
Both values are tenant-scoped live profile data. An address is required before a reservation is
created or submitted, while social media is never copied into reservation history. Fitting
walk-ins may provide either value, but neither is required for a fitting.

Reservations snapshot the address at acceptance so later profile changes do not rewrite booking
facts. Existing addressless profiles remain valid. During the narrow reservation flow, staff can
fill a missing address atomically while the selected profile is locked; no general customer-edit
surface is introduced. A held pre-change snapshot with no address can be repaired at submission
without changing its other historical contact facts.

Lists, selectors, URLs, browser persistence, logs, and search stay limited to the existing
name/email/phone behavior. Address appears only in authorized reservation detail, while address
and social media appear only in authorized fitting detail. The schema bounds nonblank supplied
addresses to 500 characters and social values to 320 characters.

Customer profile and intake authorization use the existing `reservations.manage` capability under
verified staff and tenant context. Operationally archived or anonymized profiles are excluded from
Reservation/Fitting intake search and existing-customer resolution, but existing linked bookings
remain readable through their branch-scoped history/detail projections. The live profile remains
tenant-scoped and never replaces historical snapshots.

## 2026-10-11 — Confirmed reservation snapshot correction

Staff may correct only `full_name`, `phone`, `email`, and `address` on a **confirmed** reservation
from its detail sheet. The versioned, idempotent API command updates that reservation's
`customer_snapshot` and version only; the customer profile and any sibling reservation remain
unchanged. It rejects held and pending-confirmation bookings and rejects date/time, event date,
fulfillment/delivery, payment, receipt, allocation, and custody fields. Customer profile changes
remain in Customer management. This is distinct from New Reservation completion, where the selected
profile can be edited explicitly as part of that new booking flow.

Source: [PRD Operations](../../product/Drezivo-PRD.md) and
[TRD reservation commands](../../architecture/Drezivo-TRD.md).

See [[02-Architecture/Drezivo Architecture]] for the API and tenant boundary, and
[[99-Archive/Reservations Checklist]] for the reservation lifecycle.
