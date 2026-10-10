---
title: Drezivo Product Brief
type: product
status: current
source: ../../product/Drezivo-PRD.md
updated: 2026-10-02
tags: [drezivo, product, prd]
---

# Drezivo Product Brief

Drezivo is a Philippines-first clothing-rental operations SaaS for small and medium businesses,
with a path to multi-branch and enterprise operation. The pilot sells one Standard plan at PHP
300/month, with up to 1,000 active physical assets and 10 Front Desk seats. Its internal plan code
is `starter`; future plans are undecided. See the current [PRD](../../product/Drezivo-PRD.md) and
[ADR 0011](../../decisions/0011-single-standard-pilot-plan.md).

V1 focuses on one branch, catalogue and physical garments, guest booking of up to 10 items, expiring
holds, manual cash or QR evidence review, pickup, return inspection, cleaning readiness, deposits,
exports, and audit. Branch expansion and enterprise controls arrive incrementally.

The [current PRD](../../product/Drezivo-PRD.md) is authoritative for product scope. This note is a linked
orientation summary, not a replacement.

## Catalogue subcategories

Product styles may have an optional free-form subcategory (up to 120 trimmed characters). The staff
form offers `LONG`, `MINI`, or a custom value; storefront cards/details display it, and the published
catalogue offers a single-select, case-insensitive filter. See the [PRD](../../product/Drezivo-PRD.md)
and [data model](../../architecture/Drezivo-Data-Model.md) for canonical behavior.
