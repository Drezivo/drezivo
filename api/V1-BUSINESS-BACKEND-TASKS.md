# V1 Business Backend Implementation Tasks

## Purpose

This document is the implementation roadmap for the V1 backend that powers the rental-business owner and staff workspace at `app.domain.com`.

The business workspace is the first delivery priority. It must let a rental business manage its organization, staff, clothing, availability, customers, reservations, payments, fittings, calendar, and daily operations without relying on spreadsheets or chat threads.

Public storefront APIs, guest checkout, and the root landing page are intentionally deferred. The domain model and services created here must still be reusable by those later public flows.

Product decisions follow this source priority:

1. `../docs/product/Project Context — Clothing Rental SaaS.md`
2. `../docs/product/Clothing-rental-saas-pages.md`
3. `../docs/product/Clothing Rental SaaS — Customer Public Storefront Pages.md`
4. `../docs/product/Notes.md`

Backend implementation must also follow `AGENTS.md` in this directory.

---

## V1 Boundaries

### Included

- Backend implementation and API contracts consumed by the business frontend
- Clerk-authenticated users
- Multi-tenant organizations and memberships
- Owner-managed staff access
- Business onboarding and settings
- Clothing, configured sizes, categories, images, and operational availability blocks
- Date-specific availability and concurrency-safe reservation holds
- Customer records and history
- Owner/staff-created reservations and fittings for walk-ins, calls, and social-media requests
- Reservation, fitting, and payment lifecycle management
- GCash, Maya, cash, and other manually recorded payment methods
- Private receipt storage and manual payment review
- Unified business calendar and operations-first dashboard
- Transaction/status histories and essential audit attribution

### Excluded

- Public storefront and root landing-page APIs
- Guest email verification and secure guest status pages
- Marketplace or cross-business discovery
- Customer carts (multi-item reservations shipped in V1; see docs/decisions/0016-multi-item-reservations-edit-and-balances.md)
- Multiple physical copies of the same configured size
- Card, PayPal, PayMongo, or other integrated payment gateways
- Automatic payment verification or refunds
- Billing and subscriptions
- Platform-provider or data-entry roles
- Native applications
- Advanced analytics, BI, loyalty, accounting, or notification-center features

---

## Architecture Contract

### Platform and tenant hierarchy

`Platform` is the logical application boundary; it is not a tenant and does not require a database row.

```text
Drezivo Platform
├── Users (local profiles linked to Clerk identities)
└── Organizations (rental-business tenants)
    ├── Organization Members
    │   ├── OWNER
    │   └── STAFF
    ├── Business Profile and Settings
    ├── Categories
    ├── Clothing Items
    │   ├── Clothing Images
    │   └── Clothing Size Units
    │       ├── Availability Holds
    │       └── Operational Blocks
    ├── Customers
    │   ├── Reservations
    │   │   ├── Reservation History
    │   │   └── Payments and Receipts
    │   └── Fitting Appointments
    │       ├── Fitting History
    │       └── Payments and Receipts
    ├── Calendar (derived read model)
    └── Dashboard (derived read model)
```

A user may belong to multiple organizations. `OrganizationMember` is the authorization boundary between a user and an organization. Clerk answers who the user is; the backend database answers which organizations the user may access and what role they have there.

Every tenant-owned record must carry `organizationId`, including records whose organization could otherwise be inferred through a parent. Every repository lookup and mutation must include that identifier. IDs alone must never authorize access.

### Membership permissions

| Capability | OWNER | STAFF |
| --- | --- | --- |
| View and operate dashboard, calendar, clothing, customers, reservations, fittings, and payments | Yes | Yes |
| Update operational availability, fitting schedules, delivery options, and payment instructions | Yes | Yes |
| Update organization identity and security-sensitive settings | Yes | No |
| List organization members and pending invitations | Yes | No |
| Invite, add, resend, or cancel a staff invitation | Yes | No |
| Revoke a staff member | Yes | No |
| Promote, demote, or transfer ownership | Yes | No |

Membership rules:

- Only an `OWNER` can manage staff membership.
- Staff may read their own membership context but cannot access membership-management endpoints.
- Membership authorization is loaded from PostgreSQL for every request; a still-valid Clerk session must not preserve revoked access.
- An organization must always have at least one owner.
- The last owner cannot leave, be revoked, or be demoted until ownership is transferred.
- Invitations are organization-scoped, expiring, single-use, securely tokenized, and bound to a normalized email address.
- Accepting an invitation requires an authenticated Clerk identity whose verified email matches the invitation.

### Rental inventory and availability

- A clothing item is a rental product, not an ecommerce SKU.
- Each configured size represents exactly one independently bookable unit in V1.
- Duplicate quantity for the same size is not supported.
- A reservation contains exactly one clothing size unit.
- Pickup and return dates are inclusive local calendar dates.
- A reservation hold is represented internally as `[pickupDate, endExclusive)`, where `endExclusive` is the day after the return date plus the configured cleaning-buffer days.
- Pending, confirmed, and picked-up reservations retain their hold. Rejected, cancelled, and no-show reservations release it.
- A cancellation request does not release availability until an owner or staff member processes the cancellation.
- Cleaning, maintenance, and manually unavailable periods use the same overlap-checking boundary as reservation holds.
- Availability changes and booking creation must be atomic. A read-time availability check alone is never sufficient to protect a booking.

### Lifecycle types

Use controlled enums rather than free-text values.

```text
OrganizationRole
  OWNER | STAFF

ReservationStatus
  PENDING_CONFIRMATION | CONFIRMED | PICKED_UP | RETURNED |
  COMPLETED | REJECTED | CANCELLED | NO_SHOW

ReservationIssueType
  LATE_RETURN | DAMAGED

FittingStatus
  PENDING_CONFIRMATION | CONFIRMED | COMPLETED |
  REJECTED | CANCELLED | NO_SHOW

PaymentStatus
  UNPAID | PENDING_REVIEW | PAID | FAILED |
  REFUND_PENDING | REFUNDED

PaymentMethod
  GCASH | MAYA | CASH | OTHER

AvailabilityBlockType
  CLEANING | MAINTENANCE | UNAVAILABLE
```

Cancellation requests are tracked with request metadata, not as a mutually exclusive lifecycle status. Late returns and damage are operational issues, allowing the reservation lifecycle and its issues to be represented independently.

### Data conventions

- Store rental dates as PostgreSQL `date` values, not timestamps.
- Store fitting appointments as UTC instants and interpret schedules in the organization's IANA timezone.
- Default new Philippine organizations to `Asia/Manila` and `PHP`, while keeping both fields explicit.
- Store money using PostgreSQL numeric/decimal types, never floating point.
- Serialize API money fields as decimal strings with an ISO currency code.
- Snapshot prices, fees, deposits, selected size, and delivery details on a reservation so later catalog edits do not rewrite history.
- Normalize emails by trimming and lowercasing. Enforce organization-scoped uniqueness when a customer email is present.
- Permit an owner/staff-created customer to have no email. Later public guest flows will require verified email.
- Do not hard-delete reservations, fittings, payments, membership histories, or status histories.
- Archive clothing and categories when historical transactions reference them.

---

## API Contract

### Route and authorization conventions

- Prefix APIs with `/api/v1`.
- Scope all business resources under `/api/v1/organizations/:organizationId`.
- Authentication middleware resolves the local user from Clerk.
- Services verify the user's active `OrganizationMember` record before accessing tenant data.
- Owner-only membership routes perform an additional `OWNER` role check in the service layer.
- Never accept `organizationId` from a request body as the source of tenant ownership.
- Use action endpoints for lifecycle transitions, for example `POST /reservations/:reservationId/actions/confirm`.
- Require an `Idempotency-Key` header for transaction-creating commands such as reservation, fitting, and payment creation.
- Reject stale or invalid lifecycle transitions with `409 CONFLICT` and a stable application error code.

### Response envelopes

```json
{
  "data": {}
}
```

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 100,
    "totalPages": 5
  }
}
```

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Customer-safe explanation",
    "details": [],
    "requestId": "request identifier"
  }
}
```

### Required business route groups

```text
/api/v1/organizations
/api/v1/organizations/:organizationId
/api/v1/organizations/:organizationId/members
/api/v1/organizations/:organizationId/member-invitations
/api/v1/organizations/:organizationId/settings
/api/v1/organizations/:organizationId/assets
/api/v1/organizations/:organizationId/categories
/api/v1/organizations/:organizationId/clothing
/api/v1/organizations/:organizationId/clothing/:clothingId/sizes
/api/v1/organizations/:organizationId/availability
/api/v1/organizations/:organizationId/customers
/api/v1/organizations/:organizationId/reservations
/api/v1/organizations/:organizationId/payments
/api/v1/organizations/:organizationId/fittings
/api/v1/organizations/:organizationId/fitting-schedule
/api/v1/organizations/:organizationId/calendar
/api/v1/organizations/:organizationId/dashboard
```

Public-safe DTOs for later storefront use must be separate from owner DTOs. Owner DTOs must also omit storage keys, raw receipt locations, Clerk tokens, and verification secrets.

---

## Implementation Checklist

Tasks are ordered by dependency. A task is complete only when its acceptance criteria and relevant tests pass.

### Phase 1 — Backend foundation

- [ ] **FND-001 — Initialize the TypeScript API application**
  - **Depends on:** None
  - **Outcome:** A strict TypeScript Express application with development, build, start, lint, typecheck, and test scripts.
  - **Acceptance criteria:**
    - [ ] Source code uses feature-based organization.
    - [ ] Express major-version behavior is confirmed before choosing async error handling.
    - [ ] TypeScript strict mode is enabled without blanket suppressions.
    - [ ] The application starts and shuts down gracefully.

- [ ] **FND-002 — Implement validated configuration and logging**
  - **Depends on:** FND-001
  - **Outcome:** Centralized startup validation for server, database, Clerk, storage, and application settings, plus structured logging.
  - **Acceptance criteria:**
    - [ ] Production code does not read `process.env` outside the config module.
    - [ ] Startup fails clearly when required configuration is invalid.
    - [ ] Logs include request IDs and never include credentials, tokens, receipts, or complete request bodies.

- [ ] **FND-003 — Implement shared HTTP responses and errors**
  - **Depends on:** FND-001, FND-002
  - **Outcome:** Shared success, pagination, validation-error, application-error, and not-found behavior.
  - **Acceptance criteria:**
    - [ ] All routes use the documented envelopes.
    - [ ] Error codes come from shared constants.
    - [ ] Async failures reach one global error handler.
    - [ ] Unknown routes return the standard error shape.

- [ ] **FND-004 — Configure Drizzle, PostgreSQL, and test infrastructure**
  - **Depends on:** FND-001, FND-002
  - **Outcome:** A single shared Drizzle client, migration workflow, Jest configuration, factories, and isolated integration-test database.
  - **Acceptance criteria:**
    - [ ] No feature creates its own database client.
    - [ ] Tests cannot connect to development or production databases.
    - [ ] Integration tests can migrate, seed, and clean their database deterministically.
    - [ ] CI commands cover lint, typecheck, test, and build.

### Phase 2 — Identity, organizations, and owner-controlled staff

- [ ] **TEN-001 — Create user, organization, and membership schema**
  - **Depends on:** FND-004
  - **Outcome:** Local `User`, `Organization`, and `OrganizationMember` models supporting multi-organization membership and `OWNER`/`STAFF` roles.
  - **Acceptance criteria:**
    - [ ] Clerk user IDs are unique external identity references.
    - [ ] Membership is unique per user and organization.
    - [ ] Tenant-owned tables use explicit `organizationId` fields and indexes.
    - [ ] Database constraints prevent duplicate memberships.

- [ ] **TEN-002 — Resolve the authenticated actor at the request boundary**
  - **Depends on:** TEN-001
  - **Outcome:** Clerk verification middleware that resolves a typed local actor without embedding tenant authorization in Clerk claims.
  - **Acceptance criteria:**
    - [ ] Missing, invalid, and expired sessions return standardized authentication errors.
    - [ ] Local profile synchronization stores only required Clerk identifiers and profile fields.
    - [ ] Controllers receive a typed authenticated actor.

- [ ] **TEN-003 — Enforce organization authorization in services**
  - **Depends on:** TEN-001, TEN-002
  - **Outcome:** Shared membership resolution and policy helpers used by every protected business service.
  - **Acceptance criteria:**
    - [ ] Membership is checked from the database on every request.
    - [ ] Revoked members lose access on their next request.
    - [ ] Cross-tenant IDs produce a safe not-found or forbidden response without leaking existence.
    - [ ] Repositories never query a tenant-owned record by resource ID alone.

- [ ] **TEN-004 — Implement organization creation and onboarding state**
  - **Depends on:** TEN-003
  - **Outcome:** An authenticated user can create an organization and becomes its initial owner in one transaction.
  - **Acceptance criteria:**
    - [ ] Organization and initial owner membership are committed atomically.
    - [ ] Defaults are `Asia/Manila` and `PHP`.
    - [ ] Organization slugs are normalized and unique.
    - [ ] Onboarding completion is explicit and queryable.

- [ ] **MEM-001 — Implement owner-only member and invitation queries**
  - **Depends on:** TEN-003, TEN-004
  - **Outcome:** Owners can list active members and pending invitations; staff can read only their own membership context.
  - **Acceptance criteria:**
    - [ ] Staff receive `403 FORBIDDEN` from member lists and invitation lists.
    - [ ] Results never include another organization's members.
    - [ ] Invitation tokens are never returned by list endpoints.

- [ ] **MEM-002 — Implement secure staff invitations**
  - **Depends on:** MEM-001, FND-002
  - **Outcome:** Owners can invite staff, resend an invitation by rotating its token, cancel it, and accept it after matching-email authentication.
  - **Acceptance criteria:**
    - [ ] Tokens are random, hashed at rest, expiring, and single-use.
    - [ ] Only owners can create, resend, or cancel invitations.
    - [ ] Wrong-email, expired, cancelled, used, and cross-organization tokens are rejected.
    - [ ] Acceptance creates membership once and is safe against duplicate submissions.

- [ ] **MEM-003 — Implement revocation, role changes, and ownership transfer**
  - **Depends on:** MEM-001, MEM-002
  - **Outcome:** Owners can revoke staff and safely manage ownership without leaving an organization ownerless.
  - **Acceptance criteria:**
    - [ ] Staff cannot revoke or modify any member.
    - [ ] Revocation invalidates database authorization immediately.
    - [ ] The final owner cannot leave, be revoked, or be demoted.
    - [ ] Ownership transfer and related role changes run transactionally.
    - [ ] Membership changes record actor, target, action, and timestamp.

### Phase 3 — Business settings and object storage

- [ ] **SET-001 — Implement business profile and regional settings**
  - **Depends on:** TEN-004
  - **Outcome:** Organization-scoped business identity, contact, address, timezone, currency, and onboarding settings.
  - **Acceptance criteria:**
    - [ ] Owner-only fields are separated from staff-editable operational settings.
    - [ ] Timezone values are validated IANA identifiers.
    - [ ] Currency values use ISO codes.

- [ ] **SET-002 — Implement operational settings**
  - **Depends on:** SET-001
  - **Outcome:** Delivery options, rental policies, cleaning defaults, fitting configuration, GCash/Maya QR configuration, and payment instructions.
  - **Acceptance criteria:**
    - [ ] Delivery methods are organization-scoped and can be activated or archived.
    - [ ] Settings expose only fields needed by owner workflows.
    - [ ] Changes do not retroactively alter transaction snapshots.

- [ ] **STO-001 — Implement tenant-aware object metadata and signed uploads**
  - **Depends on:** TEN-003, FND-002
  - **Outcome:** Central S3-compatible storage service for validated upload purposes and object metadata.
  - **Acceptance criteria:**
    - [ ] Keys use generated tenant-aware prefixes and never trust client filenames.
    - [ ] File type, maximum size, purpose, and ownership are validated before signing.
    - [ ] Database metadata records organization, object key, purpose, visibility, content type, and size.
    - [ ] Credentials and private object keys are never returned to clients.

- [ ] **STO-002 — Enforce public and private asset policies**
  - **Depends on:** STO-001
  - **Outcome:** Public business/clothing assets and private receipts/documents use separate access rules.
  - **Acceptance criteria:**
    - [ ] Private files require current organization authorization and short-lived signed reads.
    - [ ] Public URLs are issued only for explicitly public assets.
    - [ ] Replacement and archival record the old object's cleanup state.
    - [ ] Cross-tenant file reads are rejected.

### Phase 4 — Clothing and availability

- [ ] **INV-001 — Implement category management**
  - **Depends on:** TEN-003
  - **Outcome:** Organization-scoped category create, list, update, order, and archive operations.
  - **Acceptance criteria:**
    - [ ] Names are unique within an organization according to normalized comparison.
    - [ ] Referenced categories are archived instead of hard-deleted.
    - [ ] List queries support fixed pagination and search.

- [ ] **INV-002 — Implement clothing management**
  - **Depends on:** INV-001, SET-001
  - **Outcome:** Clothing create, list, detail, update, and archive APIs with public/private field separation.
  - **Acceptance criteria:**
    - [ ] Money uses decimal values and currency from the organization.
    - [ ] Internal notes are never included in public-safe DTOs.
    - [ ] Search and filters cover name, category, size, color, and archive state.
    - [ ] Clothing referenced by a transaction cannot be hard-deleted.

- [ ] **INV-003 — Implement independently bookable size units**
  - **Depends on:** INV-002
  - **Outcome:** Each configured size is stored as one independently bookable unit with size-specific measurements.
  - **Acceptance criteria:**
    - [ ] An item cannot contain duplicate normalized size labels.
    - [ ] No quantity field or duplicate-copy behavior is introduced.
    - [ ] A size with transaction history is archived rather than deleted.
    - [ ] Availability can be queried separately for every configured size.

- [ ] **INV-004 — Implement clothing image management**
  - **Depends on:** INV-002, STO-002
  - **Outcome:** Owners/staff can attach, order, designate, replace, and remove clothing photos through stored-object references.
  - **Acceptance criteria:**
    - [ ] Images belong to the same organization and allowed upload purpose as the clothing.
    - [ ] Exactly one active primary image is supported when images exist.
    - [ ] Image ordering updates transactionally.

- [ ] **AVL-001 — Implement operational availability blocks**
  - **Depends on:** INV-003
  - **Outcome:** Cleaning, maintenance, and unavailable periods can be created, listed, edited, and released per size unit.
  - **Acceptance criteria:**
    - [ ] Date ranges use the documented half-open internal representation.
    - [ ] Invalid and reversed ranges are rejected.
    - [ ] Blocks cannot silently overlap an active booking hold.
    - [ ] Historical blocks are retained.

- [ ] **AVL-002 — Implement the availability query service**
  - **Depends on:** AVL-001
  - **Outcome:** One shared service answers whether a size is available for a requested inclusive pickup/return range and explains blocking reasons without customer data.
  - **Acceptance criteria:**
    - [ ] Cleaning-buffer days are included.
    - [ ] Adjacent non-overlapping ranges are handled correctly.
    - [ ] Archived or operationally unavailable sizes cannot be booked.
    - [ ] Owner-facing results may show source type but never another customer's private data in reusable public-safe results.

- [ ] **AVL-003 — Enforce atomic availability holds**
  - **Depends on:** AVL-002, FND-004
  - **Outcome:** PostgreSQL prevents two active holds for overlapping periods on the same size even under concurrent requests.
  - **Acceptance criteria:**
    - [ ] The protection is enforced inside the booking transaction at the database boundary.
    - [ ] Two simultaneous conflicting requests result in one success and one stable conflict error.
    - [ ] Released holds no longer prevent later reservations.
    - [ ] Rollbacks do not leave orphaned holds.

### Phase 5 — Customers

- [ ] **CUS-001 — Implement customer directory operations**
  - **Depends on:** TEN-003
  - **Outcome:** Owners/staff can create, list, search, view, and update organization-scoped customer records.
  - **Acceptance criteria:**
    - [ ] Manual customer creation permits a missing email.
    - [ ] Present emails are normalized and deduplicated within the organization only.
    - [ ] Search supports name, phone, email, and configured social identifiers.
    - [ ] Customer records are not visible across organizations.

- [ ] **CUS-002 — Implement customer notes and history projections**
  - **Depends on:** CUS-001
  - **Outcome:** Customer details include authorized notes and paginated reservation, fitting, and payment history.
  - **Acceptance criteria:**
    - [ ] Notes record their author and timestamps.
    - [ ] Histories are projections from source transactions, not duplicated mutable totals.
    - [ ] Summary totals use only the current organization and finalized payment states.

### Phase 6 — Reservations

- [ ] **RES-001 — Create reservation and history schema**
  - **Depends on:** CUS-001, INV-003, SET-002, AVL-003
  - **Outcome:** Organization-scoped reservations link one customer, one size unit, one delivery selection, one availability hold, and immutable price/detail snapshots.
  - **Acceptance criteria:**
    - [ ] Status uses the documented enum.
    - [ ] Rental price, security deposit, fees, totals, size label, and delivery details are snapshotted.
    - [ ] History entries record actor, transition, reason, and timestamp.
    - [ ] Database constraints prevent cross-organization relationships.

- [ ] **RES-002 — Implement manual reservation creation**
  - **Depends on:** RES-001
  - **Outcome:** Owners/staff can create pending reservations from walk-in, phone, or social-media requests.
  - **Acceptance criteria:**
    - [ ] Customer may be selected or created within the same transaction.
    - [ ] Verified email and receipt are optional for admin entry.
    - [ ] The reservation starts as `PENDING_CONFIRMATION` and immediately holds availability.
    - [ ] Idempotency prevents duplicate reservations from repeated submissions.
    - [ ] Availability failure rolls back the entire operation.

- [ ] **RES-003 — Implement reservation list and detail read models**
  - **Depends on:** RES-002
  - **Outcome:** Paginated operational APIs support the reservations page and details drawer.
  - **Acceptance criteria:**
    - [ ] Filters cover status, payment status, pickup/return range, clothing, and customer.
    - [ ] Search covers reservation number, customer, phone, and clothing.
    - [ ] Details include customer, item snapshot, dates, delivery, payment summary, verification state, notes, issues, and history.
    - [ ] Sort order is stable and indexed.

- [ ] **RES-004 — Implement reservation lifecycle actions**
  - **Depends on:** RES-002
  - **Outcome:** Confirm, reject, mark picked up, mark returned, complete, cancel, and mark no-show commands enforce a single state machine.
  - **Acceptance criteria:**
    - [ ] Invalid or repeated transitions return a stable conflict error.
    - [ ] Reject, cancel, and no-show release the hold transactionally.
    - [ ] Confirm, pickup, return, and completion preserve the scheduled cleaning boundary.
    - [ ] Every transition creates a history record.
    - [ ] No command hard-deletes the reservation.

- [ ] **RES-005 — Implement cancellation requests and operational issues**
  - **Depends on:** RES-004
  - **Outcome:** Staff can record/process cancellation requests and record/resolve late-return or damage issues independently of lifecycle status.
  - **Acceptance criteria:**
    - [ ] Recording a cancellation request does not release availability.
    - [ ] Processing cancellation performs the state transition and releases the hold atomically.
    - [ ] Overdue state is derived from due date, organization date, and lifecycle.
    - [ ] Issue history records actor, timestamps, notes, and resolution.

### Phase 7 — Fittings

- [ ] **FIT-001 — Implement fitting schedule configuration**
  - **Depends on:** SET-002
  - **Outcome:** Organization-scoped weekly hours, enabled days, breaks, appointment duration, per-slot capacity, timezone, and fitting fee.
  - **Acceptance criteria:**
    - [ ] Breaks and hours are validated for overlap and ordering.
    - [ ] Duration and capacity are positive bounded values.
    - [ ] Existing appointments retain their time and fee snapshots after settings change.

- [ ] **FIT-002 — Implement fitting slot availability and atomic capacity**
  - **Depends on:** FIT-001, FND-004
  - **Outcome:** Slot queries and booking transactions respect hours, breaks, duration, capacity, active pending appointments, and timezone.
  - **Acceptance criteria:**
    - [ ] Slot generation handles UTC conversion from organization-local schedules.
    - [ ] Concurrent requests cannot exceed configured capacity.
    - [ ] Rejected, cancelled, and no-show fittings release capacity.
    - [ ] Availability queries and booking commands share the same rules.

- [ ] **FIT-003 — Implement fitting appointment operations**
  - **Depends on:** FIT-002, CUS-001
  - **Outcome:** Owners/staff can manually create, list, view, confirm, reject, complete, cancel, and mark no-show fittings.
  - **Acceptance criteria:**
    - [ ] Customer may be selected or created during manual entry.
    - [ ] Verified email and receipt are optional for admin entry.
    - [ ] New fittings begin pending and immediately consume slot capacity.
    - [ ] Optional clothing relationships remain organization-safe.
    - [ ] Every transition records history and invalid transitions return conflicts.

### Phase 8 — Payments and private receipts

- [ ] **PAY-001 — Create payment records and associations**
  - **Depends on:** RES-001, FIT-003, CUS-001
  - **Outcome:** Payments are organization-scoped, use manual V1 methods, and belong to exactly one reservation or fitting.
  - **Acceptance criteria:**
    - [ ] A database constraint enforces exactly one payable association.
    - [ ] Amounts are non-floating-point decimals with currency.
    - [ ] Payment state is independent of reservation/fitting state.
    - [ ] Multiple manual records may represent installments while transaction totals remain derivable.

- [ ] **PAY-002 — Implement payment creation, review, and refund recording**
  - **Depends on:** PAY-001, STO-002
  - **Outcome:** Owners/staff can record payments, optionally attach receipts, review them, and record manual refund progress.
  - **Acceptance criteria:**
    - [ ] Receipt upload is optional for admin-entered payments.
    - [ ] Receipt reads are private, authorized, and signed for a short duration.
    - [ ] Status transitions follow the documented payment enum.
    - [ ] Refund status records an external/manual outcome and never triggers money movement.
    - [ ] Payment records and histories cannot be hard-deleted.

- [ ] **PAY-003 — Implement payment list, details, and summaries**
  - **Depends on:** PAY-002
  - **Outcome:** APIs support payment filtering, details, related booking links, and basic operational totals.
  - **Acceptance criteria:**
    - [ ] Filters cover status, method, payable type, customer, and date range.
    - [ ] Summary totals distinguish paid, pending, failed, and refunded amounts.
    - [ ] Only finalized paid records contribute to collected totals.
    - [ ] Raw storage keys are absent from all DTOs.

### Phase 9 — Calendar and dashboard

- [ ] **CAL-001 — Build the unified calendar projection**
  - **Depends on:** RES-005, FIT-003, AVL-001
  - **Outcome:** A derived service combines reservations, pickups, returns, fittings, and operational blocks without a separately editable calendar table.
  - **Acceptance criteria:**
    - [ ] Results are bounded by a required date range.
    - [ ] Events have stable types, source IDs, status, start/end, and customer-safe summaries.
    - [ ] Rental dates and fitting instants are rendered using organization timezone rules.
    - [ ] Cancelled/rejected source records follow explicit visibility filters.

- [ ] **CAL-002 — Implement calendar endpoints and daily details**
  - **Depends on:** CAL-001
  - **Outcome:** Week, month, day, and selected-day views can filter by activity type, clothing, and status.
  - **Acceptance criteria:**
    - [ ] Large ranges are rejected or capped.
    - [ ] Daily counts match the returned filtered events.
    - [ ] Detail links resolve only within the current organization.

- [ ] **DSH-001 — Build operational dashboard queries**
  - **Depends on:** RES-005, PAY-003, FIT-003, CAL-001
  - **Outcome:** Organization-timezone queries provide today's rentals, pickups, returns, fittings, pending reservations, overdue returns, upcoming rentals, and attention items.
  - **Acceptance criteria:**
    - [ ] “Today” is calculated using organization timezone.
    - [ ] Counts and lists use identical status definitions.
    - [ ] Overdue returns are derived and indexed efficiently.
    - [ ] Advanced analytics and notification-center data are not introduced.

- [ ] **DSH-002 — Implement the dashboard read endpoint**
  - **Depends on:** DSH-001
  - **Outcome:** One bounded read model supplies the initial business dashboard without excessive frontend round trips.
  - **Acceptance criteria:**
    - [ ] Sections have explicit item limits and links to paginated modules.
    - [ ] Queries fetch only required fields.
    - [ ] Empty organizations return valid zero/empty states.

### Phase 10 — Events, security, performance, and release

- [ ] **EVT-001 — Add durable domain-event/outbox hooks**
  - **Depends on:** RES-004, PAY-002, FIT-003
  - **Outcome:** Reservation, fitting, payment, and membership changes can enqueue later email delivery without coupling services to an email provider.
  - **Acceptance criteria:**
    - [ ] State mutation and outbox insertion commit atomically.
    - [ ] Events contain identifiers and safe metadata, not secrets or receipt contents.
    - [ ] Consumers can process events idempotently.
    - [ ] Public guest email flows remain deferred.

- [ ] **SEC-001 — Complete tenant and sensitive-data security review**
  - **Depends on:** All feature phases
  - **Outcome:** Authorization, DTOs, logs, storage, and database relationships are audited against tenant boundaries.
  - **Acceptance criteria:**
    - [ ] Every protected route has authentication and membership tests.
    - [ ] Every owner-only route has staff-denial tests.
    - [ ] Receipts, internal notes, tokens, and object keys cannot leak through responses or logs.
    - [ ] Revoked membership is checked against every feature.

- [ ] **PERF-001 — Add production indexes and query bounds**
  - **Depends on:** All read-model tasks
  - **Outcome:** Common list, availability, calendar, dashboard, and overdue queries have supporting indexes and bounded inputs.
  - **Acceptance criteria:**
    - [ ] Indexes lead with `organizationId` for tenant-scoped access patterns.
    - [ ] Availability overlap, status/date, customer search, and calendar queries are covered.
    - [ ] Pagination has enforced maximum page size and deterministic sorting.

- [ ] **DOC-001 — Publish the backend API and lifecycle reference**
  - **Depends on:** All feature phases
  - **Outcome:** API contracts, enums, state transitions, permissions, errors, pagination, money, dates, and storage flows are documented for the business frontend.
  - **Acceptance criteria:**
    - [ ] Documentation matches implemented Zod schemas and DTOs.
    - [ ] Owner-only membership operations are clearly labeled.
    - [ ] Example requests do not contain real credentials or personal data.

- [ ] **REL-001 — Pass the V1 business-backend release gate**
  - **Depends on:** SEC-001, PERF-001, DOC-001
  - **Outcome:** The backend is ready for business-frontend integration and controlled V1 deployment.
  - **Acceptance criteria:**
    - [ ] Fresh-database migrations apply successfully.
    - [ ] Lint, typecheck, unit tests, integration tests, and build pass.
    - [ ] No tests use development or production databases.
    - [ ] Required environment variables and operational setup are documented.
    - [ ] Known deferred storefront work is recorded without blocking owner workflows.

---

## Required Test Matrix

The following scenarios are release requirements, even when they are also listed under individual tasks.

### Tenant isolation and membership

- An owner or staff member cannot read or mutate another organization's resources by substituting IDs.
- A multi-organization user sees only the explicitly selected organization's data.
- Staff receive `403 FORBIDDEN` for member lists, invitations, revocation, role changes, and ownership transfer.
- Only owners can add, invite, resend, cancel, or revoke staff access.
- Revoked staff lose access on the next request despite an active Clerk session.
- Revocation in one organization does not remove access to another organization.
- The last owner cannot leave, be removed, or be demoted.
- Expired, reused, cancelled, wrong-email, and cross-organization invitations fail safely.

### Availability and transactions

- Rental dates include both pickup and return dates.
- Cleaning buffers block the correct days after return.
- Adjacent ranges become available only at the calculated exclusive end.
- Two simultaneous reservations for the same size and overlapping dates cannot both succeed.
- Different sizes of the same clothing item can be reserved independently.
- Rejecting or cancelling a reservation releases its hold.
- Requesting cancellation does not release its hold.
- Manual reservations without verified email or receipt still create a protected hold.
- Invalid reservation and fitting transitions return typed conflict errors without partial writes.
- Repeated idempotent create requests produce one transaction.
- Concurrent fitting requests never exceed configured slot capacity.

### Money, dates, and timezone

- Decimal money round-trips without floating-point loss.
- Historical price snapshots do not change after clothing or settings updates.
- Rental dates do not shift through timezone conversion.
- Fitting times convert correctly between UTC and the organization timezone.
- Dashboard “today,” overdue returns, and calendar boundaries use the organization's date.

### Files and privacy

- Cross-tenant object references cannot be attached or read.
- Private receipt URLs are authorized and expire.
- Public asset DTOs never expose private object keys.
- Internal notes, receipt metadata, tokens, and customer details are absent from public-safe DTOs and logs.

### Read models and API consistency

- Every endpoint uses the shared success or error envelope.
- Every list uses the fixed pagination metadata shape.
- Filters, counts, and detail projections apply the same status definitions.
- Empty organizations return valid empty states.
- Search and pagination remain organization-scoped and deterministically sorted.

---

## Definition of Done

The V1 business backend is complete when:

- An owner can create a rental business, configure it, and exclusively manage its staff.
- Revoked staff access is immediately denied by backend membership checks.
- Owners and staff can manage clothing, size-specific availability, customers, reservations, payments, and fittings.
- Conflicting rental reservations and over-capacity fittings are prevented atomically.
- Daily operations are visible through consistent reservation, calendar, payment, fitting, customer, and dashboard APIs.
- Tenant isolation and private-file access are proven by integration tests.
- Drizzle migrations, lint, typecheck, tests, and build pass from a clean environment.
- The implemented backend remains within the stated V1 boundaries and is ready for the separate business frontend to consume.
