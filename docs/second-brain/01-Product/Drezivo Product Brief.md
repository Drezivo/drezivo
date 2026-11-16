---
title: Drezivo Product Brief
type: product
status: current
source: Drezivo-PRD.md and ../04-Decisions/ADRs/0016-app-only-growth-scale-plans.md
updated: 2026-11-15
tags: [drezivo, product, prd]
---

# Drezivo Product Brief

Drezivo is a Philippines-first clothing-rental operations SaaS for small and medium businesses,
with a path to multi-branch and enterprise operation. The current catalog offers Free at ₱0 with
20 active garments and no Front Desk seats, Starter at ₱149/month with 125 active garments and no
Front Desk seats, and Standard at ₱299/month with 300 active garments and up to three Front Desk
seats. Growth is ₱499/month for 500 garments and five Front Desk seats; Scale is ₱999/month
for 1,000 garments and eight seats. Growth and Scale are available in onboarding and billing,
not the public pricing page. Free access is ongoing; paid plans use the existing fourteen-day
lifetime trial. See the
current [PRD](Drezivo-PRD.md) and [ADR 0015](../04-Decisions/ADRs/0015-starter-and-standard-plans.md)
and [ADR 0016](../04-Decisions/ADRs/0016-app-only-growth-scale-plans.md) for catalog details.

V1 focuses on one branch, catalogue and physical garments, guest single-garment booking, expiring
holds, manual cash or QR evidence review, pickup, return inspection, cleaning readiness, deposits,
exports, and audit. Branch expansion and enterprise controls arrive incrementally.

The [current PRD](Drezivo-PRD.md) is authoritative for product scope. This note is a linked
orientation summary, not a replacement.

## Catalogue subcategories

Product styles may have an optional free-form subcategory (up to 120 trimmed characters). The staff
form offers `LONG`, `MINI`, or a custom value; storefront cards/details display it, and the published
catalogue offers a single-select, case-insensitive filter. See the [PRD](Drezivo-PRD.md)
and [data model](../02-Architecture/Drezivo-Data-Model.md) for canonical behavior.
