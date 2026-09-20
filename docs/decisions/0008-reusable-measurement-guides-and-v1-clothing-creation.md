# 0008. Reusable measurement guides and simplified V1 clothing creation

**Status:** accepted
**Date:** 20 September 2026
**Owners:** product + API + staff-app owners

## Context

Rental businesses frequently use one measurement/size-chart image across much of their catalogue. Requiring the owner to upload that same image for every style or every size would turn a 100-style catalogue with several size variants into hundreds of duplicate files and repetitive data entry.

Drezivo's authoritative inventory model remains three identities: `product` (customer-facing style), `product_variant` (size/color/pricing/measurements), and `physical_asset` (one actual rentable piece). The existing `product_variant.measurements` JSON can already be empty, but an empty map alone cannot distinguish "use the shop's standard guide" from "this size intentionally has no measurements."

The staff Add Clothing experience also does not need to expose serialized-asset mechanics for the common V1 case. A shop owner usually thinks "this gown has S, M, L and XL" rather than "create four variant records and then create four asset records."

## Decision

### 1. Measurement guides are reusable tenant resources

Add tenant-owned `measurement_guide` records backed by accepted/frozen `file_object` bytes with purpose `measurement_guide`. A guide has a name, lifecycle status, and `is_default` flag. At most one active guide is the tenant default.

Replacing the default means creating/selecting another guide as the default. Existing variants keep the exact guide ID they already reference; Drezivo does not silently rewrite catalogue presentation or historical expectations. A later explicit "apply new default to existing clothing" workflow may be designed separately.

### 2. Every variant has an explicit measurement source

`product_variant.measurement_mode` is one of:

- `default_guide` — `measurement_guide_id` is required and the structured `measurements` map is empty.
- `custom` — `measurement_guide_id` is null and structured variant measurements are used.
- `none` — `measurement_guide_id` is null and structured measurements are empty.

This prevents `{}` from carrying two meanings and avoids one image row per variant.

The staff UI defaults selected sizes to the current tenant guide, but each size can override to Custom or None. Structured measurement inputs are shown only for Custom sizes.

### 3. Shared variant values are entered once in V1

The Add Clothing command collects photos, product identity, one common color, pricing, deposit, and preparation/turnaround timing once. The API expands the selected size list into variants and copies those common values to each generated variant. Measurements remain independently configurable per size.

This is a wire/UI convenience, not denormalization of the database. Variants remain first-class rows so a later edit may give one size a different price, color, guide, or measurement map.

### 4. One selected size creates one initial physical piece in V1

For the V1 Add Clothing workflow, selecting S, M, L, XL creates four variants and four active physical assets, one asset per selected size. Asset codes are generated server-side.

There is no `quantity` or `stock` column. This V1 creation rule does not enforce one asset per variant in the database. Multiple physical assets may reference the same variant later when a shop owns duplicate copies of one size.

Plan quotas continue to count active physical assets, so the UI must communicate the number of Total Pieces that will be created before submission and the API must enforce quota capacity transactionally.

### 5. Availability is not part of Add Clothing

Add Clothing does not expose a calendar or a single mutable Available/Reserved/Rented status. Planned unavailability comes from `asset_allocation`; readiness/custody remain physical-asset state. Availability management stays in the dedicated calendar/operational workflows.

### 6. Fixed-duration and daily pricing remain supported

The simplified form maps to the existing `product_variant` pricing fields:

- fixed package: `pricing_mode = fixed_duration`, rental amount, `included_duration_minutes`, optional `extra_day_price_minor`;
- per-day: `pricing_mode = daily` and rental amount per day.

The UI may ask for included days and convert them to canonical minutes. Charging duration remains separate from preparation/turnaround blocking duration.

## Consequences

### Benefits

- One measurement image can serve hundreds of variants without file duplication.
- Common Add Clothing entry is much faster: shared values are entered once, not repeated per size.
- Exceptions remain possible at the variant level.
- Existing normalized product/variant/asset architecture is preserved.
- V1 stays simple without preventing duplicate pieces of the same size later.

### Costs and constraints

- The files subsystem must accept the `measurement_guide` purpose and freeze accepted bytes before a guide can reference them.
- Catalogue writes must validate guide ownership and active status inside tenant scope.
- Public catalogue/detail projections must resolve the referenced guide without exposing private storage keys.
- Replacing the tenant default is intentionally non-retroactive.
- Import/export formats must eventually represent measurement mode/guide identity without duplicating binary data.

## Rejected alternatives

**Upload a measurement image for every variant.** Rejected because it creates repetitive owner work, duplicated objects, and difficult replacement behavior.

**Treat empty `measurements` as "use default."** Rejected because empty would be ambiguous with intentionally absent measurement information.

**Store one quantity per variant instead of physical assets.** Rejected because availability, custody, cleaning, condition, late return, and overlapping reservations are per physical piece.

**Force owners to create physical assets manually during Add Clothing.** Rejected for the V1 common path. The database keeps serialized assets, but the UI generates one initial asset per selected size.

## References

- [Product Requirements Document](../product/Drezivo-PRD.md)
- [Logical Data Model](../architecture/Drezivo-Data-Model.md)
- [ERD](../architecture/Drezivo-ERD.dbml)
- [Technical Requirements Document](../architecture/Drezivo-TRD.md)
