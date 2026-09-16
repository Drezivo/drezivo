# Graph Report - C:\Users\Win10\Desktop\Projects\Company\Rentivo\graphify-out\input  (2026-09-15)

## Corpus Check
- Corpus is ~4,348 words - fits in a single context window. You may not need a graph.

## Summary
- 82 nodes · 140 edges · 7 communities
- Extraction: 95% EXTRACTED · 1% INFERRED · 4% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Checkout & Customer Payments|Checkout & Customer Payments]]
- [[_COMMUNITY_Rentivo Platform & Plans|Rentivo Platform & Plans]]
- [[_COMMUNITY_Inventory & Availability|Inventory & Availability]]
- [[_COMMUNITY_Reservations & Operations|Reservations & Operations]]
- [[_COMMUNITY_Payment Confirmation & Metrics|Payment Confirmation & Metrics]]
- [[_COMMUNITY_Notifications & Account Security|Notifications & Account Security]]
- [[_COMMUNITY_Storefront Policies & Verification|Storefront Policies & Verification]]

## God Nodes (most connected - your core abstractions)
1. `Clothing item / inventory` - 16 edges
2. `Rentivo` - 14 edges
3. `Reservation customer details` - 14 edges
4. `Business System` - 12 edges
5. `Branded Storefront` - 10 edges
6. `Reservation` - 10 edges
7. `Manual business-confirmed QR payments` - 9 edges
8. `Fitting Appointment` - 9 edges
9. `Payment ledger` - 9 edges
10. `Rental Calendar` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Cash payment` --conceptually_related_to--> `Payment receipt upload`  [AMBIGUOUS]
  Rentivo-PRD.md → Rentivo-PRD.md  _Bridges community 4 → community 0_
- `Discount selector` --conceptually_related_to--> `Customer profile`  [INFERRED]
  Rentivo-PRD.md → Rentivo-PRD.md  _Bridges community 3 → community 0_
- `Rentivo` --conceptually_related_to--> `Business plan`  [EXTRACTED]
  Rentivo-PRD.md → Rentivo-PRD.md  _Bridges community 1 → community 2_
- `Rentivo` --conceptually_related_to--> `Business System`  [EXTRACTED]
  Rentivo-PRD.md → Rentivo-PRD.md  _Bridges community 1 → community 3_
- `Rentivo` --conceptually_related_to--> `Automated SMS delivery`  [EXTRACTED]
  Rentivo-PRD.md → Rentivo-PRD.md  _Bridges community 1 → community 5_

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Rentivo three-surface product** — graphify_out_input_rentivo_prd_public_site, graphify_out_input_rentivo_prd_business_system, graphify_out_input_rentivo_prd_storefront [EXTRACTED 1.00]
- **Customer receipt submission and owner payment confirmation** — graphify_out_input_rentivo_prd_qr, graphify_out_input_rentivo_prd_payment_receipt, graphify_out_input_rentivo_prd_pending_confirmation, graphify_out_input_rentivo_prd_business_owner, graphify_out_input_rentivo_prd_paid, graphify_out_input_rentivo_prd_confirmed [EXTRACTED 1.00]
- **Subscription tiers govern operational capabilities** — graphify_out_input_rentivo_prd_starter, graphify_out_input_rentivo_prd_professional, graphify_out_input_rentivo_prd_business_plan, graphify_out_input_rentivo_prd_entitlements [EXTRACTED 1.00]

## Communities (7 total, 0 thin omitted)

### Community 0 - "Checkout & Customer Payments"
Cohesion: 0.12
Nodes (18): Add-ons & Penalties, BPI, Cash payment, Reservation customer details, Clothing Detail, Optional customer accounts, Pickup / Delivery Method, Discount selector (+10 more)

### Community 1 - "Rentivo Platform & Plans"
Cohesion: 0.13
Nodes (16): Automated payment gateway, Clothing rental business, Multi-tenancy and data isolation, Localization defaults, Multi-location / multi-branch inventory, Philippines launch market, Professional plan, Prospective Business Owner (+8 more)

### Community 2 - "Inventory & Availability"
Cohesion: 0.24
Nodes (14): Business plan, Rental Calendar, Catalog, Category, Cleaning, Clothing item / inventory, Confirmed reservation, Subscription entitlement enforcement (+6 more)

### Community 3 - "Reservations & Operations"
Cohesion: 0.33
Nodes (11): Business System, Customer profile, Dashboard, Fitting Appointment, Maximum appointments per slot, Manual tracking, Payment ledger, Pending payment status (+3 more)

### Community 4 - "Payment Confirmation & Metrics"
Cohesion: 0.24
Nodes (10): Storefront activation within 7 days, Reservation Received confirmation, Time-to-confirm, Storefront submission conversion, Manual business-confirmed QR payments, Success Metrics, Paid payment status, Payment receipt upload (+2 more)

### Community 5 - "Notifications & Account Security"
Cohesion: 0.33
Nodes (7): Email notifications, Notification reliability, Reservation Review, Active Sessions, Settings, Automated SMS delivery, Two-factor authentication

### Community 6 - "Storefront Policies & Verification"
Cohesion: 0.33
Nodes (6): Business Owner, Rental policies, Sensitive document security and privacy, Checkout requirements, Manage Storefront, Customer verification ID upload

## Ambiguous Edges - Review These
- `Automated SMS delivery` → `Notification reliability`  [AMBIGUOUS]
  Rentivo-PRD.md · relation: conceptually_related_to
- `Star rating and review count` → `Optional customer accounts`  [AMBIGUOUS]
  Rentivo-PRD.md · relation: conceptually_related_to
- `Payment receipt upload` → `Cash payment`  [AMBIGUOUS]
  Rentivo-PRD.md · relation: conceptually_related_to
- `Payment receipt upload` → `Paid payment status`  [AMBIGUOUS]
  Rentivo-PRD.md · relation: conceptually_related_to
- `Soft-held inventory` → `Real-time availability / no double-booking`  [AMBIGUOUS]
  Rentivo-PRD.md · relation: conceptually_related_to

## Knowledge Gaps
- **22 isolated node(s):** `Clothing rental business`, `Prospective Business Owner`, `Automated payment gateway`, `No-credit-card trial`, `Maximum appointments per slot` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Automated SMS delivery` and `Notification reliability`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Star rating and review count` and `Optional customer accounts`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Payment receipt upload` and `Cash payment`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Payment receipt upload` and `Paid payment status`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Soft-held inventory` and `Real-time availability / no double-booking`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Business System` connect `Reservations & Operations` to `Rentivo Platform & Plans`, `Inventory & Availability`, `Notifications & Account Security`, `Storefront Policies & Verification`?**
  _High betweenness centrality (0.268) - this node is a cross-community bridge._
- **Why does `Reservation customer details` connect `Checkout & Customer Payments` to `Reservations & Operations`, `Payment Confirmation & Metrics`, `Notifications & Account Security`, `Storefront Policies & Verification`?**
  _High betweenness centrality (0.254) - this node is a cross-community bridge._

## Audit scope and token accounting

This graph represents the original Rentivo-PRD.md v1.0 only, copied without modification into input/. It does not represent the enhanced PRD, research, TRD, or proposed database model. Source-line evidence refers to this frozen copy. Host semantic extraction token counts are unavailable from the collaboration tool; numeric zero placeholders are not measured zero usage.
