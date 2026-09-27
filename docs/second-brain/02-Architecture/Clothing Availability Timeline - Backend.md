---
title: Clothing Availability Timeline - Backend
type: architecture
status: implemented
owner: Drezivo platform team
source: "../../../api/V1-BACKEND-CHECKLIST.md; ../../architecture/Drezivo-TRD.md; ../../architecture/Drezivo-Data-Model.md; ../../../contracts/src/operations/calendar.ts"
updated: 2026-09-27
tags:
  - drezivo
  - architecture
  - operations
  - availability
  - calendar
---

# Clothing Availability Timeline — Backend

## Decision

The staff Calendar's Clothing Availability tab consumes one read-only endpoint:

`GET /api/v1/calendar/availability`

The endpoint returns physical-asset lanes grouped by product and variant. Its visual vocabulary is
deliberately limited to:

- `reserved`: pending-confirmation or confirmed rental, from scheduled pickup through scheduled due;
- `rented`: picked-up rental, from the recorded pickup custody time through the selected window;
- `unavailable`: readiness problems, recovery, cleaning, repair, manual blocks, and other planned
  blocks.

Pickup and Return are boundary labels on the reservation range, not separate agenda records or
colors. Fittings remain authoritative for exact-time booking protection but are excluded from this
day-based timeline. The frontend may show the safe unavailable reason in a detail drawer while the
grid continues to render only `Unavailable`.

## API boundary

The query requires branch-local `start_date` and `end_date` (`YYYY-MM-DD`, maximum 31 inclusive
dates). Optional product-name/category/size filters and `reserved|rented|unavailable` status filters
are validated by `@drezivo/contracts`. Asset lanes use an opaque keyset cursor with a 25-item default
and 50-item maximum. Without a catalogue filter, idle assets are omitted; search, category, or size
filters may return matching idle assets so staff can inspect a specific garment.

Rows include product name and a safe primary image URL, variant size/color/price, the physical asset
UUID, safe agenda source IDs, branch-timezone periods, boundary labels, and customer names when the
agenda is reservation-backed. Codes/SKUs, email addresses, phones, maintenance free text, storage
keys, and provider fields are not part of the projection.

## Authority and query shape

The Operations module owns the route/controller/service/repository layers. Verified staff auth,
tenant context, the existing rental-read lifecycle policy, and `reservations.manage` protect the
route. The repository bounds candidate assets in a materialized CTE before resolving agendas,
custody, customer summaries, or cover images, preventing the unbounded projection pattern that can
cause calendar scale regressions. The endpoint is advisory for display; final reservation creation
still rechecks exact asset availability transactionally.

Unavailable mutations remain on the existing idempotent maintenance-block command:
`POST /api/v1/catalogue/assets/:assetId/maintenance-blocks`. This timeline feature adds no calendar
table, worker, outbox event, or new mutation endpoint.

Related: [[00-Home/Drezivo Home]], [[02-Architecture/Drezivo Architecture]],
[[02-Architecture/Tenancy Checklist - What Why How]], [[02-Architecture/API Module Boundaries and Layering]]
