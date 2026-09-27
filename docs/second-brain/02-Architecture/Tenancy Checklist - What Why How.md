---
title: Tenancy Checklist - What, Why, and How
type: architecture
status: current
owner: Drezivo platform team
source: "[Tenancy checklist](../../../api/TENANCY-ONBOARDING-V1-CHECKLIST.md); [Backend checklist](../../../api/V1-BACKEND-CHECKLIST.md); [[02-Architecture/Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation]]; [TRD](../../architecture/Drezivo-TRD.md); [Data Model](../../architecture/Drezivo-Data-Model.md); [ERD](../../architecture/Drezivo-ERD.dbml); [Migration plan](../../architecture/Tenancy-Onboarding-Migration-Plan.md)"
updated: 2026-09-18
tags:
  - drezivo
  - architecture
  - tenancy
  - onboarding
  - clerk
  - memberships
  - billing
  - team-guide
---

# Tenancy Checklist: What, Why, and How

This note translates the tenancy checklist into a short team guide. The checklist tracks delivery;
the PRD, TRD, data model, ERD, and accepted architecture note remain the authoritative design
sources.

## Architecture In One Minute

Clerk proves who a person is and identifies the active external organization. Drezivo decides what
that person may do through its own account, tenant, local membership, branch grants, lifecycle
state, and plan entitlements.

An owner journey starts before a tenant exists. The API creates the Clerk organization, stores a
resumable pre-tenant onboarding record, and creates a tenant only after successful bootstrap or
verified manual payment. The browser never chooses a tenant, role, quota, price, or provider outcome.

Every phase exists to make this boundary durable under retries, concurrent requests, provider
failures, worker delays, and revoked access.

## Delivery status

The task-level implementation status is **TBF-000 through TBF-042 implemented**, with TBF-041 and
TBF-042's disposable-PostgreSQL integration evidence still open, and **TBF-043 through TBF-062
planned**. Some
completed tasks still require a disposable PostgreSQL environment for their full integration
evidence; that does not change the implementation status recorded in the checklists.

The header in `api/TENANCY-ONBOARDING-V1-CHECKLIST.md` still describes the original Phase 0
milestone. Use the task checkboxes and `api/V1-BACKEND-CHECKLIST.md` for the current status.

## Phase 0: Canonical Decision and Contract Preparation

**What:** Align the product and technical specifications, define closed contracts and stable errors,
and define additive migration, RLS, backfill, and rollback boundaries.

**Why:** Tenancy is a cross-workspace boundary. If the API, database, contracts, and clients use
different lifecycle states or authority rules, a working feature can still create cross-tenant access
or duplicate business state.

**How:** The accepted lifecycle was recorded in the canonical documents. Zod/OpenAPI contracts
reject unknown states and client-supplied authority. The migration plan uses ordered additive changes,
explicit constraints, RLS policies, and forward-only correction rather than destructive rollback.

**Status:** Complete according to TBF-000 through TBF-002.

### TBF-000 - Align the canonical specifications

- **Why:** Conflicting trial, quota, membership, or authority language could make each workspace
  implement a different tenancy model.
- **What:** The PRD, TRD, data model, ERD, and onboarding checklist agree on the fourteen-day trial,
  one-trial-per-verified-person policy, 125/300/1,000 asset limits, 0/2/10 Front Desk caps,
  payment-pending onboarding, closure, and Clerk/Drezivo authority boundaries.
- **How:** Conflicting legacy statements were replaced in the canonical documents and the accepted
  lifecycle was recorded before implementation work began.
- **Dependencies:** None.
- **Status:** Complete.

### TBF-001 - Define shared contracts and stable errors

- **Why:** Clients and services need one closed vocabulary for lifecycle states, safe projections,
  and failure behavior before routes are implemented.
- **What:** The contracts package owns onboarding, invitation, subscription, operator, webhook-safe,
  actor-context, and stable-error schemas. Browser input cannot provide tenant, organization, role,
  price, entitlement, or seat authority.
- **How:** Zod schemas reject unknown states and OpenAPI is generated from the shared contract
  boundary. API modules consume the contracts instead of redefining wire shapes.
- **Dependencies:** TBF-000.
- **Status:** Complete.

### TBF-002 - Define migration and rollback boundaries

- **Why:** Tenancy data cannot be safely corrected by destructive rollback once it contains business
  history.
- **What:** Global pre-tenant and tenant-owned tables, RLS policies, uniqueness rules, backfill
  behavior, and forward-only correction boundaries are defined.
- **How:** Migrations are additive and ordered. Rollback means application rollback followed by a
  reviewed corrective migration; live lifecycle data is never removed as a rollback shortcut.
- **Dependencies:** TBF-000.
- **Status:** Complete.

## Phase 1: Global Account and Pre-Tenant State

**What:** Add the minimal account, organization onboarding, provider-attempt, payment-verification,
global idempotency, and pre-tenant audit records.

**Why:** A verified person must exist before a tenant exists. This makes interrupted onboarding
resumable without creating a fake tenant, branch, subscription, or trial. Tenant-scoped idempotency
cannot be used before a tenant exists, so bootstrap commands need a global account scope.

**How:** The account is keyed only by Clerk user ID and does not mirror profile data. Onboarding
statuses distinguish incomplete, abandoned, payment-pending, and provisioned work. Account locking,
global idempotency records, immutable audit history, and PostgreSQL/RLS tests make retries and
competing owner journeys safe.

**Status:** Complete according to TBF-010 through TBF-012.

### TBF-010 - Add minimal global account persistence

- **Why:** A verified person must have a local identity anchor before Drezivo can safely resume
  onboarding or enforce the one-current-owned-tenant rule.
- **What:** An account is keyed by Clerk user ID, tracks trial eligibility/consumption, and stores
  the current owned-tenant link without mirroring profile, email, session, or token data.
- **How:** Account row locks serialize concurrent creation, trial consumption, and owned-tenant
  claims. A person may still hold Front Desk memberships in other tenants.
- **Dependencies:** TBF-001, TBF-002.
- **Status:** Complete.

### TBF-011 - Add organization onboarding and pre-provision payment records

- **Why:** Owner setup can be interrupted, abandoned, or paid later; those states must survive
  without creating a partial tenant graph.
- **What:** Durable onboarding rows support `incomplete`, `abandoned`, `payment_pending`, and
  `provisioned` states. Immutable operator payment verification records remain global until a later
  activation step.
- **How:** Clerk organization IDs are unique and each account can have only one active unfinished
  onboarding. Abandonment retains provider correlation and history. Forced RLS keeps global records
  out of ordinary tenant listings.
- **Dependencies:** TBF-010.
- **Status:** Complete.

### TBF-012 - Add bootstrap-safe idempotency and audit primitives

- **Why:** Tenant-scoped idempotency is unavailable before a tenant exists, while onboarding and
  bootstrap still need retry-safe business effects and durable accountability.
- **What:** Account-scoped bootstrap idempotency stores bounded safe responses and global audit events
  record account, operator, or system actions with request IDs and database timestamps.
- **How:** Claims compare canonical payload hashes, reclaim expired keys atomically, and finalize in
  the same transaction as the business effect. Audit rows are append-only, redacted by the caller,
  and protected by global RLS and runtime privileges.
- **Dependencies:** TBF-010, TBF-011.
- **Status:** Complete.

## Phase 2: Clerk Integration and Owner Onboarding

**What:** Create one shared Clerk server adapter, safely receive Clerk webhooks, and implement the
create-only owner onboarding commands.

**Why:** Clerk is an external asynchronous provider, not Drezivo's authorization database. The
browser must not create or select an arbitrary organization, and a provider webhook must not create
a tenant or start a trial by assumption.

**How:** The API creates the organization and makes the verified creator its administrator. A durable
provider attempt and account-scoped idempotency key prevent duplicate organization creation. The raw
webhook route verifies exact bytes, allowlists event families, deduplicates provider events, and can
repair only an exact missing onboarding marker. Requests require verified primary email, rate limits,
generic failures, and bounded bodies.

**Status:** Complete according to TBF-020, TBF-021, and TBF-022. Invitation recipients remain
outside this owner command and use the later claim flow.

### TBF-020 - Build one shared Clerk server adapter

- **Why:** Provider calls scattered across routes and services would make verification, error
  handling, and secret protection inconsistent.
- **What:** A typed server adapter creates organizations, invitations, and membership changes and
  reads only the provider facts needed for verification.
- **How:** API modules inject the adapter rather than importing Clerk directly. Centralized config
  validates credentials, provider errors become safe typed failures, and raw provider bodies and
  secrets are never logged.
- **Dependencies:** TBF-001, TBF-010.
- **Status:** Complete.

### TBF-022 - Add raw verified Clerk webhook intake

- **Why:** Clerk events are asynchronous and replayable; accepting an unverified or over-broad event
  could grant access or create local state from attacker-controlled input.
- **What:** `/webhooks/clerk` verifies Svix signatures over exact raw bytes, allowlists organization,
  organization-invitation, and organization-membership families, deduplicates provider IDs, and
  stores only a redacted inbox payload.
- **How:** The route runs before global JSON parsing, enforces a bounded body and rate limit, and
  uses generic failures. Organization-created repair requires the exact onboarding marker and never
  provisions a tenant, membership, subscription, or trial inline.
- **Dependencies:** TBF-020 and the webhook inbox.
- **Status:** Complete.

### TBF-021 - Implement create-only owner onboarding commands

- **Why:** Every ordinary verified signup is an owner journey; accepting an arbitrary existing Clerk
  organization or retrying an unknown provider result could attach the wrong business.
- **What:** Verified users can create, read/resume, and abandon one owner onboarding. The response
  includes the opaque `clerk_org_id` needed for deterministic Clerk active-organization selection.
- **How:** Verified primary email is checked before account, idempotency, or Clerk mutation. Account
  locks serialize starts, a durable provider attempt carries the exact recovery marker and original
  requested details, and unknown provider outcomes recover only through the signed webhook path.
  Abandonment accepts only a closed reason code and raw bodies are bounded before parsing.
- **Dependencies:** TBF-011, TBF-012, TBF-020, TBF-022.
- **Status:** Complete. Invitation recipients use the later TBF-040/TBF-042 boundary.

## Phase 3: Tenant Bootstrap, Context, and Entitlements

**What:** Turn eligible onboarding into one tenant and resolve the actor's workspace, branch scope,
subscription, and entitlements on protected requests.

**Why:** This is the point where pre-tenant setup becomes an operational business. The system must
create the complete graph once, authorize every request from current local state, and enforce quotas
even when requests or workers race.

**How:** One idempotent transaction creates the tenant, default branch, Owner membership and grant,
draft storefront, trial subscription, immutable trial event, audit records, and outbox event. The
Clerk token organization selects the tenant; branch headers only select an already-authorized branch.
Forced RLS and transaction-local context protect tenant queries. A shared entitlement service resolves
seeded version-1 plans and locks the tenant while checking active assets and Front Desk membership.
Request-time and worker lifecycle reconciliation use database time and one restricted-action policy.

**Status:** Complete according to TBF-030 through TBF-033. Pending invitation reservations are
intentionally deferred to Phase 4.

### TBF-030 - Implement idempotent tenant bootstrap

- **Why:** A tenant must become usable as one complete graph or not exist at all; partial branches,
  memberships, subscriptions, or trials are unsafe.
- **What:** One eligible onboarding creates the tenant, default `Main Branch`, Owner membership and
  grant, draft storefront, trial subscription, immutable trial event, audits, and outbox event.
- **How:** A strict empty-body command locks account and onboarding rows, requires the matching active
  Clerk organization and an idempotency key, and commits all graph rows using database time and RLS.
  Payment-pending, abandoned, and provisioned records cannot bootstrap.
- **Dependencies:** TBF-021, TBF-012, TBF-001.
- **Status:** Complete.

### TBF-031 - Update actor, tenant, and workspace resolution

- **Why:** A valid Clerk session alone does not prove local membership, branch scope, or entitlement
  authority.
- **What:** Workspace discovery and actor context resolve the active Clerk organization, local active
  membership, authorized branches and grants, tenant lifecycle, subscription, and entitlements.
- **How:** The API derives tenant authority from the provider organization, then queries under forced
  tenant RLS. Browser branch selectors choose only already-authorized branches. Restricted and
  cancelled tenants reach the shared action policy instead of inheriting active permissions.
- **Dependencies:** TBF-030.
- **Status:** Complete.

### TBF-032 - Build the entitlement service over seeded plans

- **Why:** Prices and quotas must come from authoritative versioned plan data, never browser input or
  duplicated constants in individual modules.
- **What:** One internal service resolves active v1 Starter, Professional, and Business plans and
  enforces physical-asset and Front Desk capacity.
- **How:** The resolver fails closed on missing, inactive, malformed, non-v1, or unsupported plans.
  Quota guards lock the tenant row, count active physical assets and active Front Desk memberships,
  and retain the caller transaction lock through its write. Pending invitation reservations are added
  by TBF-040.
- **Dependencies:** TBF-030.
- **Status:** Complete.

### TBF-033 - Implement trial lifecycle and request-time gates

- **Why:** A delayed worker must not extend a trial or leave an expired tenant unrestricted, and
  restricted/cancelled behavior must be consistent across every endpoint.
- **What:** Database-time reconciliation transitions `trialing` to `past_due` and then `restricted`,
  while preserving terminal cancellation. Owners can change plans only during trial, subject to
  target-plan capacity checks.
- **How:** Actor-context requests and the subscription sweep share one locked transition service,
  deterministic event keys, and the existing restricted/cancelled action matrix. Plan changes use
  tenant idempotency and preserve the original trial/period timestamps. Paid-plan changes and payment
  activation remain deferred.
- **Dependencies:** TBF-030, TBF-032.
- **Status:** Complete.

## Phase 4: Front Desk Invitation and Membership

**What:** Add Owner-controlled local invitations first, then Clerk membership dispatch, verified
invitation claims, local-first removal, and approved Owner transfer.

**Why:** A Clerk organization member is not automatically a Drezivo user. Invitations must reserve
seats safely, claims must prove the intended relationship, removal must take effect immediately in
Drezivo, and a tenant must never lose its final active Owner.

**How:** TBF-040 stores a protected recipient identity, seven-day expiry, provider correlation, and
stable business key locally, counts active Front Desk memberships plus unexpired pending invitations
under a tenant lock, and commits safe outbox intents without calling Clerk. TBF-041 dispatches
those intents with bounded retry. TBF-042 verifies the current user, organization, provider
membership, local invitation, role, expiry, and seat capacity, including accepted-invitation webhook
reconciliation. Removal disables local access before
queuing provider removal; transfer installs a verified successor before changing the current Owner.

**Status:** TBF-040 complete; TBF-041 and TBF-042 implemented with PostgreSQL integration
evidence pending; TBF-043 planned.

### TBF-040 - Add local invitation state and safe Owner routes

- **Why:** Invitations must reserve seats and remain safe during provider outages before Clerk is
  contacted. Recipient identity must not leak through ordinary API projections.
- **What:** Owner-only create/list/resend/cancel routes persist tenant-owned invitation state with
  keyed email digest, AES-GCM ciphertext, seven-day database-time expiry, provider correlation,
  dispatch version, and stable business key.
- **How:** Tenant transactions re-check Owner authority and lifecycle, expire stale rows, lock the
  tenant for Front Desk capacity, and use tenant idempotency. Local state and safe outbox intents
  commit together; the worker does not call Clerk in this slice. Pending invitations count as
  reserved seats, while recipient email, ciphertext, digest, provider ID, and business key stay out
  of safe projections and logs.
- **Dependencies:** TBF-031, TBF-032.
- **Status:** Complete; full disposable-PostgreSQL concurrency/RLS evidence remains an acceptance
  prerequisite before deployment.

### TBF-041 - Dispatch Clerk invitation and membership changes through outbox

- **Why:** Provider calls must survive outages, process crashes, and worker restarts without
  fire-and-forget behavior or unbounded duplicate invitations.
- **What:** The durable worker dispatches TBF-040 create/resend/cancel intents through the shared
  Clerk adapter, with bounded leases/retries, private-marker recovery, stale-version protection,
  compensation, and safe terminal failure. Membership-removal dispatch is intentionally excluded.
- **How:** A claimed row is validated before a tenant-scoped lock. The worker resolves the Clerk
  organization from the local tenant, decrypts the recipient only at the provider boundary, and
  searches the exact private marker before creating a provider invitation. Resend revokes prior
  active provider invitations; cancellation searches marker-correlated rows when needed. A
  conditional local correlation update plus compensation handles races and crashes. The runner
  claims only due rows and requires the lease token for completion/dead-letter writes.
- **Dependencies:** TBF-020, TBF-040, and the existing outbox worker.
- **Status:** Implemented; disposable-PostgreSQL crash/concurrency/RLS evidence remains open before
  deployment.

### TBF-042 - Implement verified invitation claim

- **Why:** A provider invitation or organization membership must not grant Drezivo access by itself.
- **What:** An invited user can claim exactly one local Front Desk membership and fixed default
  branch grant after proving the current identity, active organization, accepted invitation,
  exact dispatch marker/current version, provider role, expiry, and seat state. Suspended/removed
  Front Desk memberships are restored; Owner memberships are never demoted.
- **How:** The claim route requires verified auth, active organization, a strict empty body, and
  Idempotency-Key. One tenant transaction locks the invitation and tenant, excludes its own pending
  reservation from the seat check, writes membership/provider correlation, accepts the invitation,
  appends a redacted audit event, and returns actor context. Accepted-invitation webhook
  reconciliation reuses the same core under a system actor and retries when provider membership
  visibility is delayed. Membership webhooks alone never grant local access; invalid/foreign/
  expired/revoked/consumed cases remain generic safe failures.
- **Dependencies:** TBF-040, TBF-041, TBF-022.
- **Status:** Implemented; disposable-PostgreSQL concurrency/RLS/provider-ordering evidence remains
  open before deployment.

### TBF-043 - Implement local-first membership removal and approved Owner transfer

- **Why:** Removing local access must take effect immediately, while the tenant must never lose its
  final active Owner.
- **What:** Local removal preserves history and queues Clerk removal. Approved transfer installs and
  verifies a successor before changing the current Owner.
- **How:** Services update local membership first, enforce the last-Owner invariant inside a
  transaction, and require reasoned business-contact evidence plus second internal approval for
  transfer. Provider removal remains an outbox operation.
- **Dependencies:** TBF-041, TBF-042.
- **Status:** Planned.

## Phase 5: Operator Payment, Recovery, and Closure

**What:** Add separate platform-operator authorization, manual payment activation, provider-loss
handling, and permanent tenant closure.

**Why:** A later business must not receive a second trial, and sensitive recovery actions must not be
available to ordinary tenant Owners. Provider loss must fail closed without deleting business history.
Manual billing also needs durable evidence so payment verification is not lost during provisioning
retries.

**How:** Operators use a separate audited Clerk-ID allowlist, fresh authorization, reason, and stable
business key. Immutable payment verification is recorded before payment-pending activation creates a
tenant and paid period. Provider loss restricts ordinary operations while retaining settlement data.
Closure moves the tenant to `cancelled`, preserves read-only settlement/export access, releases the
current-owned-tenant link, and makes replacement onboarding payment-pending. V1 does not add cards,
payment gateways, recurring charges, or payment credentials.

**Status:** Planned, TBF-050 through TBF-053.

### TBF-050 - Add platform-operator authorization and audit

- **Why:** Tenant Owners must not automatically gain platform recovery or payment-verification
  power.
- **What:** Dedicated operator routes use a separate Clerk-ID allowlist, fresh authorization,
  reason, stable business key, and immutable audit evidence.
- **How:** Operator identity is checked independently from tenant membership, and allowlist changes
  are audited and excluded from tenant APIs.
- **Dependencies:** TBF-010, TBF-001.
- **Status:** Planned.

### TBF-051 - Activate manual payment and payment-pending onboarding

- **Why:** V1 needs a recoverable manual-payment path before payment gateways and recurring billing
  exist.
- **What:** Verified operator evidence can activate an existing subscription or safely provision a
  replacement payment-pending business with an immutable paid period.
- **How:** Payment verification persists before activation, uses database verification time, and
  remains retry-safe. No route accepts card credentials or claims recurring billing.
- **Dependencies:** TBF-030, TBF-033, TBF-050.
- **Status:** Planned.

### TBF-052 - Handle external Clerk organization loss

- **Why:** A deleted or unreachable provider organization must not silently leave local operations
  authorized or delete business history.
- **What:** Provider loss restricts ordinary access and public intake while preserving settlement,
  returns, refunds, and export behavior defined by policy.
- **How:** Webhook/worker handling is idempotent and audited. Recovery is operator-only and follows
  an evidence-backed runbook.
- **Dependencies:** TBF-022, TBF-031, TBF-050.
- **Status:** Planned.

### TBF-053 - Implement operator-assisted permanent closure

- **Why:** A closed business must retain historical access without receiving another trial or being
  reopened through ordinary tenant routes.
- **What:** Closure sets the tenant to terminal `cancelled`, preserves read-only settlement/export
  access, releases the account’s current-owned-tenant link, and makes replacement onboarding
  payment-pending.
- **How:** Closure is reason-coded, audited, irreversible through tenant-owner routes, and serialized
  against replacement onboarding.
- **Dependencies:** TBF-050, TBF-051.
- **Status:** Planned.

## Phase 6: Integration and Operating Readiness

**What:** Add reconciliation, observability, adversarial integration/security evidence, and complete
the operating documentation.

**Why:** A passing build cannot prove tenant isolation, concurrent duplicate safety, provider recovery,
or safe behavior after a worker crash. Asynchronous webhooks and outbox jobs can drift from local
state unless the system detects and repairs that drift.

**How:** A reconciliation worker checks provider and local state and fails closed on ambiguity. Metrics
and alerts cover webhook failures, inbox lag, dead outbox jobs, lifecycle expiry, and mismatches without
PII. Real PostgreSQL/RLS tests cover cross-tenant access, pooled connection reuse, concurrent double
fires, browser organization switching, and delayed provider events. Runbooks and recovery exercises
cover webhook replay, payment, provider loss, closure, transfer, and terminal jobs.

**Status:** Planned, TBF-060 through TBF-062.

### TBF-060 - Reconciliation worker and observability

- **Why:** Webhooks, provider state, lifecycle expiry, and outbox jobs can drift or arrive late even
  when local commands are correct.
- **What:** Reconciliation detects mismatches, fails closed on ambiguity, creates actionable
  operator work, and exposes non-PII metrics and alerts for inbox, outbox, expiry, and provider
  failures.
- **How:** A periodic worker compares provider and local state through the existing adapters and
  records safe operational signals without storing raw payloads or personal data.
- **Dependencies:** TBF-022 and TBF-041 through TBF-053.
- **Status:** Planned.

### TBF-061 - Complete API integration and security suite

- **Why:** Unit tests and passing builds cannot prove RLS isolation, pooled-connection safety,
  concurrent duplicate handling, or safe browser/provider handoff.
- **What:** Real PostgreSQL/RLS, contract/envelope, double-fire, browser/API handoff, and secret-
  redaction evidence covers every implemented mutation.
- **How:** The suite runs as restricted runtime roles, exercises missing and mismatched context,
  and rejects provider secrets, raw webhook bodies, invitation tokens, emails, and payment evidence
  in logs, snapshots, and fixtures.
- **Dependencies:** All prior implementation tasks.
- **Status:** Planned.

### TBF-062 - Finish canonical documentation and runbooks

- **Why:** Product, architecture, operations, and implementation must tell one story before launch.
- **What:** Canonical documents, recovery runbooks, operator approval evidence, and deferred UI
  handoffs are complete and linked.
- **How:** Documentation review and recovery tabletop exercises verify webhook replay, manual
  payment, provider loss, closure, transfer, reconciliation, and terminal outbox recovery.
- **Dependencies:** TBF-060, TBF-061.
- **Status:** Planned.

## Team Rules to Remember

1. Clerk proves identity; Drezivo grants access.
2. A Clerk organization member is not automatically a Drezivo member.
3. The API and database, never the browser, decide tenant, role, branch, price, quota, and state.
4. No tenant or trial exists before a winning bootstrap transaction.
5. Webhooks reconcile provider facts; they do not independently grant access.
6. Local access is removed first; provider changes are queued through the outbox.
7. Unknown identity, membership, entitlement, provider state, or lifecycle state fails closed.
8. Drezivo subscription billing is separate from renter payment and rental finance.

## Reading Notes

- The accepted plan limits are 125 / 300 / 1,000 active physical assets and 0 / 2 / 10 Front Desk
  seats. Any older PRD table showing 50 / 200 / 1,000 is stale.
- The checklist header still says only Phase 0 is complete, but its task-level checkboxes and the
  backend checklist mark TBF-000 through TBF-042 implemented. This guide follows the task-level
  status and keeps the TBF-041/TBF-042 integration-evidence gates explicit.
- TBF-040 protects recipient email locally and writes safe provider-dispatch intents; TBF-041
  consumes those intents through Clerk with private-marker recovery and compensation. TBF-042 is
  the verified claim boundary, including accepted-invitation webhook reconciliation, and TBF-043
  is the local-first removal/transfer boundary.
- TBF-050 through TBF-053 are operator/payment/recovery/closure work. TBF-060 through TBF-062 are
  reconciliation, adversarial evidence, and final documentation work.

Related: [[00-Home/Drezivo Home]], [[02-Architecture/Drezivo Architecture]],
[[02-Architecture/Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation]],
[[02-Architecture/API Module Boundaries and Layering]]
