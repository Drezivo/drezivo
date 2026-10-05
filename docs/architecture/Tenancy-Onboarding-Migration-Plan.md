# Tenancy and onboarding migration plan

**Status:** approved tenancy/onboarding foundation with additive owner identity and tenant bootstrap migrations applied in code
**Owner:** API and database maintainers  
**Source:** `Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation` in the Second Brain, 16 September 2026  
**Updated:** 1 October 2026
**Related:** [TRD](Drezivo-TRD.md), [Data Model](Drezivo-Data-Model.md), [ERD](Drezivo-ERD.dbml), [migration runbook](../runbooks/migrations.md)

This document defines the forward-only database work for tenancy onboarding. Reviewed SQL
migrations and service behavior are owned by their corresponding TBF tasks.

## Scope and ownership

| Record                                                                     | Scope             | Access and RLS boundary                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`                                                                  | Global            | The authenticated Clerk subject reads only its own row through transaction-local `app.principal_id`. No profile mirror.                                                            |
| `organization_onboarding`                                                  | Global pre-tenant | The creator reads only its own record. Operators use separately authorized, audited paths.                                                                                         |
| `onboarding_payment_verification`                                          | Global pre-tenant | Owner receives a safe status projection only. Operator payment evidence is not broadly readable.                                                                                   |
| `owner_onboarding_attempt`                                                 | Global pre-tenant | Account-locked single-flight provider state. Exact signed marker repair may update only the matching attempt.                                                                      |
| `bootstrap_idempotency_record`                                             | Global pre-tenant | Scoped to the authenticated account and operation. It never reuses tenant-scoped idempotency.                                                                                      |
| `global_audit_event`                                                       | Global pre-tenant | Append-only account/operator/system history. Owner reads are account-scoped; operator/system reads require explicit context and filters.                                           |
| `webhook_inbox`                                                            | Global pre-tenant | Exact-raw verified provider-event dedupe. API inserts only through a duplicate-safe function; worker reads/transitions rows and neither runtime role deletes them.                 |
| `membership_invitation`                                                    | Tenant-owned      | Standard tenant RLS plus local Owner authorization. Recipient email is AES-GCM encrypted and keyed-deduped; protected material never appears in ordinary logs or list projections. |
| `membership`, `subscription`, `subscription_event`, `subscription_payment` | Tenant-owned      | Existing tenant RLS applies. New lifecycle behavior is gated in services, not inferred from Clerk claims.                                                                          |

TBF-031 adds the actor/workspace resolution boundary after bootstrap. Migration
`0017_actor_workspace_resolution.sql` adds an index on `membership.clerk_user_id` and a narrow
`resolve_actor_workspaces` SECURITY DEFINER function. The function accepts only transaction-local
account principal context, returns safe workspace projections for active local memberships, and
cannot run while a tenant GUC is set. The API enters tenant scope only after resolving the active
Clerk organization, then reads the local membership, active branches, selected-branch grant,
current subscription, and positive plan entitlements under normal forced RLS. No global RLS
exception is granted to the HTTP process, and no Clerk role/claim is treated as authorization.

## Expand migration design

The next migration number after the existing reviewed sequence is reserved for an additive
tenancy-onboarding expansion. It creates:

- `account` with unique `clerk_user_id`, nullable `trial_consumed_at`, and nullable
  `current_owned_tenant_id`.
- `organization_onboarding` with unique `clerk_org_id`, owner-supplied `organization_name`, an
  optional validated `requested_slug`, selected plan, recoverable operation state, and a partial
  unique index permitting only one `incomplete` or `payment_pending` row per account.
- immutable `onboarding_payment_verification`, global `bootstrap_idempotency_record`, and
  append-only `global_audit_event`.
- `owner_onboarding_attempt` for account-locked, duplicate-safe Clerk organization creation and
  exact provider-outcome recovery.
- tenant-owned `membership_invitation`, including encrypted recipient material, keyed lookup
  digest, seven-day database-time expiry, dispatch revision, provider correlation, and a partial
  unique pending-intent index.
- nullable `clerk_membership_id` plus unique provider correlation on `membership`.

The same expansion adds RLS policies for global account-owned records using
`current_setting('app.principal_id', true)`. It extends the existing tenant-owned RLS list for
`membership_invitation`; it does not weaken the existing `webhook_inbox` restriction.

TBF-022 adds the forward-only `0013_webhook_inbox_privileges.sql` migration. It expands the
existing inbox with a canonical `event_type`, gives `drezivo_app` only an insert path (the
duplicate-safe `ON CONFLICT DO NOTHING` write is behind a security-definer function because
PostgreSQL's conflict check otherwise requires table SELECT), and gives `drezivo_worker` only
SELECT/UPDATE. No runtime role can delete inbox history. The same migration adds the narrowly
scoped system policy used by deferred organization-created marker repair; it cannot provision a
tenant, membership, subscription, or trial.

TBF-021 adds the forward-only `0014_owner_onboarding_details.sql` migration. It stores the
business display name and optional lowercase Clerk slug requested by the owner. The API exposes
these fields plus the opaque `clerk_org_id` needed for Clerk active-organization selection; it
never exposes Clerk profile fields. The owner commands are `POST /api/v1/onboarding`,
`GET /api/v1/onboarding/current`, and `POST /api/v1/onboarding/:onboardingId/abandon`.

Production hardening adds `0015_owner_onboarding_attempt.sql`. A verified primary email is
required before account or provider mutation. An account row lock creates one durable provider
attempt containing the original name, slug, idempotency record, and marker UUID before the API
calls Clerk. Unknown provider outcomes remain in progress and are repaired only by an exact
signed organization-created marker; they are never automatically retried into a second Clerk
organization. Abandonment accepts only the closed reason codes `not_now`, `wrong_details`,
`payment_concern`, and `other`.

Every owner mutation requires `Idempotency-Key` and uses `bootstrap_idempotency_record`, not the
tenant-scoped ledger. A seven-day idempotency retention window is used. The create command allows
5 requests per minute per verified user, current-state reads allow 30, abandonment allows 10,
and the raw JSON body is capped at 16 KiB before parsing. Incomplete onboarding is not automatically expired in
this phase. Explicit abandonment retains local onboarding and audit history and permits a replacement.
Migration `0021_clerk_organization_cleanup.sql` adds a durable pre-tenant cleanup queue: abandonment
and cleanup enqueue commit atomically, then the worker deletes only a Clerk organization that is
still abandoned, has no provisioned tenant, matches the onboarding record, and can be traced to a
durable owner-onboarding provider attempt. Provider deletion is idempotent and bounded-retry; unsafe
or provisioned organizations are never deleted by this flow. The signed Clerk webhook remains a
reconciliation input only and does not initiate cleanup. Provider success followed by local write
failure is repaired by the signed `organization.created` webhook marker; the webhook never provisions
a tenant or starts a trial.

Invitation recipients are explicitly outside this command boundary until TBF-040/042 provides
local invitation persistence and claim state; they must not be treated as owners by a future
owner-eligibility implementation.

TBF-030 originally exposed authenticated owner bootstrap at
`POST /api/v1/onboarding/{onboardingId}/bootstrap`. The current pilot UI calls
`POST /api/v1/onboarding/{onboardingId}/start-trial` with an empty body and an account-scoped
`Idempotency-Key`; that command selects the sole active Standard plan (`starter`) and delegates
tenant creation to the existing bootstrap command with derived idempotency keys. Each step is
replay-safe, and the bootstrap transaction creates the tenant graph atomically.
Migration `0016_tenant_bootstrap.sql` originally seeded version-1 Starter, Professional, and Business
rows; `0053_update_v1_entitlements_and_trial_policy.sql` set their historical 125/300/1,000
physical-asset and 0/2/10 Front Desk-seat limits. The current pilot offer is one Standard plan:
`0063_pilot_billing.sql` keeps `starter` v1 active at 30,000 PHP minor units/month, sets its limits
to 1,000 assets and 10 Front Desk seats, and deactivates Professional and Business v1. It moves
existing subscriptions to `starter` while recording prior plan ids in `subscription_event`, and
normalizes expired/restricted billing states for the derived pilot access model. The old rows remain
for audit history. The winning database transaction creates the tenant, `Main Branch`, Owner
membership/grant, draft storefront, Standard trial subscription, `trial_started` event, both audit
records, and a `tenant.bootstrapped` outbox event, then finalizes the safe response. `Main Branch` starts with canonical Business Hours
`08:00–20:00` and Sunday closed in `branch.operating_hours`; this is a safe bootstrap default, not
a fitting-specific schedule. A no-op worker handler acknowledges that event
until later consumers are introduced.

TBF-032 adds `0018_entitlement_runtime_privileges.sql` as the forward-only plan-data boundary.
It verifies the immutable v1 seed values and revokes runtime `INSERT`, `UPDATE`, and `DELETE`
on `plan` and `plan_entitlement` while preserving `SELECT` for the app and worker roles. The
shared entitlement service resolves the active v1 plan and required limits for actor context and
bootstrap, and its same-client quota guards lock the tenant before counting active physical assets
or active Front Desk memberships. TBF-040 extends the Front Desk count with unexpired pending
invitation reservations under the same tenant lock.

TBF-033 completes the Phase 3 lifecycle boundary without adding a new table. The existing
`subscription` and `subscription_event` records are transitioned by one shared database-time
service. This was the original seven-day grace design; the pilot replaces it with request-time
derived full/read-only/locked access based on subscription dates, a 30-day read-only window, and
an operator-granted read-only extension. The storefront stays online without new intake for the
first three days after the period ends, then goes offline. The current pilot has no alternate
sellable plan or owner-facing plan change. The Owner-only `POST /api/v1/subscription/plan` command
must resolve an active plan and cannot switch to a retired plan; future plan changes require a new
owner decision and migration.

TBF-040 adds `0019_membership_invitations.sql` and four authenticated tenant-context Owner routes
for local invitation state. Recipient email is normalized, HMAC-digested for exact tenant-local
dedupe, and AES-GCM encrypted with a separate deployment key; safe projections never expose the
email, digest, ciphertext, business key, or Clerk correlation. Pending rows reserve Front Desk
seats until database-time expiry, resend extends the same row and increments `dispatch_version`,
and cancellation/expiry release the reservation without deleting history. Create, resend, and
cancel write safe Clerk-dispatch outbox intents atomically with tenant idempotency. TBF-041 owns
provider dispatch, so this branch-internal prerequisite must not be deployed independently.

TBF-041 consumes those invitation intents through the durable outbox worker. The Clerk adapter
stores a backend-only private marker containing a fixed source, local invitation UUID, dispatch
version, and create/resend operation. Before creating an invitation, the worker searches the
provider by that exact marker; this recovers a provider acceptance after a worker crash and keeps
same-intent retries duplicate-safe. Resend revokes older active provider invitations for the same
local identity before creating its replacement. Cancellation revokes the locally correlated
provider invitation or searches all matching markers when correlation was not persisted yet;
revoked, expired, accepted, and missing provider rows are terminal safe no-ops.

Each create/resend invitation also receives a redirect URL built from the validated `STAFF_APP_URL`
and its local invitation UUID, with the Clerk organization ID as a non-authoritative activation
hint. Clerk adds the one-time invitation ticket and status to that callback. The configured URL is
per environment (loopback HTTP only for local development; HTTPS origin for staging/production)
and must be allowed by the matching Clerk instance. The ticket is consumed only by the Drezivo
callback; it is kept in browser memory, stripped from the address bar, and never sent to the API,
stored, or logged by application code. Do not set a global Account Portal fallback as a substitute
for this link-scoped flow.

The worker locks the tenant invitation, verifies pending status and dispatch version, resolves the
Clerk organization from the tenant row, and decrypts recipient email only inside the worker. A
conditional local update persists provider correlation; if cancellation or a newer dispatch wins
while Clerk is running, the newly created/found invitation is revoked as compensation. Every
provider call is awaited, and malformed local payloads/decryption failures become permanent
dead-letter outcomes while transient provider failures use the existing eight-attempt exponential
backoff. Pending outbox claims require `available_at <= now()`, and completion/dead-letter writes
require the exact lease token. TBF-041 dispatches invitation intents only; verified claiming is
TBF-042 and membership-removal dispatch is TBF-043.

TBF-042 adds `0020_verified_invitation_claim.sql` with nullable `membership.clerk_membership_id`
and a tenant-scoped provider-correlation uniqueness index. The claim endpoint requires a verified
Clerk user, active organization, accepted invitation, exact current dispatch marker, and
`org:member` provider membership before it creates or restores local Front Desk access. It locks
the invitation and tenant, excludes the invitation's own pending seat reservation during the
capacity check, installs the fixed v1 default branch grant, persists provider IDs, and returns the
existing actor-context projection through tenant idempotency. The accepted-invitation webhook
reuses the same transaction core under a system actor and leaves the inbox row received when
provider membership visibility is delayed; membership webhook events alone never grant access.
Invalid, foreign, expired, revoked, consumed, or Owner-role cases remain generic safe failures.
PostgreSQL concurrency, RLS, provider-ordering, and rollback evidence is required before this
task is marked complete.

The Drezivo invitation callback consumes only the invitation ID encoded in that link, completes
Clerk ticket sign-in/sign-up (including required verification or MFA), activates the target
organization, then retries the existing claim endpoint until local access is confirmed or a
terminal safe error is returned. Ordinary sign-in never accepts pending invitations. If the claim
is delayed, the invitee remains on a retryable access-finalization screen and cannot fall through
to owner onboarding. A successful claim leads directly to the only accessible workspace or to a
role-labeled workspace chooser when the user has multiple memberships. The same API-backed chooser
and validated switcher are available after sign-in and from the dashboard. Owner and Front Desk
roles belong to individual workspaces; Front Desk users inherit the tenant's current subscription
and trial restrictions and do not receive a personal trial. Independent sign-up still follows the
existing one-owned-business and lifetime-trial eligibility rules. No new tenant data or database
migration is introduced by this callback/workspace-selection behavior.

The catalogue sizing-mode boundary is recorded in forward-only migration `0055_product_sizing_modes.sql`.
It adds `product.sizing_mode` and makes `product_variant.size_label` nullable so a product can use
one canonical `NULL`-label Free size variant or one-or-more real sized variants, never both among
active rows. A deferred database trigger enforces the active-mode invariant, while the catalogue
command archives old variants and preserves their UUIDs for existing reservations, fittings,
allocations, and physical-asset history. This migration is destructive only in behavior (it does
not delete historical rows) and is independent of tenancy bootstrap or billing migrations.

TBF-031 adds `GET /api/v1/workspaces` and `GET /api/v1/actor-context`. Workspace discovery is
account-scoped and returns only provisioned tenants with an active local membership. Actor context
returns the current tenant, membership, all active branches and safe grants, the selected branch,
subscription summary, and numeric entitlements. `X-Drezivo-Branch-Id` is only a verified selector;
the Clerk token organization remains the tenant authority. Tenant lifecycle actions use one shared
policy matrix: restricted and cancelled workspaces are resolved, then only explicitly permitted
actions continue. Frontend workspace switching calls Clerk `setActive` with the opaque local
organization ID and clears the branch selector.

## Required constraints

- One Clerk user maps to one account; one Clerk organization maps to at most one onboarding and
  at most one tenant.
- One account has at most one unfinished onboarding and one current owned tenant.
- Owner onboarding captures only organization display name and optional slug before tenant
  bootstrap. Owner name, contact email, business type, branch address, and operating details are
  collected by the later tenant bootstrap/setup wizard rather than mirrored from Clerk.
- One tenant has one current subscription and one local membership per Clerk user.
- A pending invitation is unique for its tenant and protected recipient identity; active Front Desk
  membership plus unexpired pending invitations is counted under the tenant lock.
- Provider event dedupe remains globally unique by provider and provider event ID.
- A deferred constraint trigger preserves at least one active Owner at commit time. A transfer
  inserts or validates the successor before demoting or removing the current Owner.

## Backfill and validation

Backfill is bounded and resumable:

1. Insert minimum `account` rows from distinct existing `membership.clerk_user_id` values without
   copying names, emails, or Clerk profile fields.
2. Link a current owned tenant only where one active Owner relationship can be proven. Accounts
   with multiple active owner relationships, missing owner rows, or contradictory Clerk mappings
   are written to an operator review report and receive no automatic ownership selection.
3. Mark trial eligibility conservatively. Existing active owners are recorded as trial-consumed
   unless an audited exception proves no trial was granted.
4. Add provider membership correlation only after a reconciled Clerk read. Do not fabricate IDs.
5. Validate duplicate, missing-owner, tenant-mismatch, and conflicting-owner reports before the
   service switch. Do not enable owner onboarding while a reported ambiguity remains unresolved.

## Rollout and rollback

Apply the expand migration before code that requires the new tables. Backfill and validate on a
rehearsed local stack and the isolated Supabase staging project. Deploy the service switch only
after constraints and reports are clean. A rollback reverts application code to the compatible
pre-switch version; it never drops these records. Any data or policy defect is corrected by a new
forward-only migration and an audited repair action.

## Evidence required before TBF-010

- Local compose PostgreSQL applies all migrations through the migration ledger.
- Integration tests prove partial unique constraints, tenant/global RLS denial, global bootstrap
  idempotency, and last-Owner rejection with sequential and concurrent attempts.
- Backfill dry-run reports are reviewed and have no unclassified ambiguity.
- The runtime database role cannot create schema objects or bypass RLS.
