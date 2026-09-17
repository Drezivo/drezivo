# Tenancy and onboarding migration plan

**Status:** approved Phase 0 migration design with additive Phase 2 owner identity migration applied in code
**Owner:** API and database maintainers  
**Source:** `Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation` in the Second Brain, 16 September 2026  
**Updated:** 16 September 2026  
**Related:** [TRD](Drezivo-TRD.md), [Data Model](Drezivo-Data-Model.md), [ERD](Drezivo-ERD.dbml), [migration runbook](../runbooks/migrations.md)

This document defines the forward-only database work for TBF-002. It does not create the tables.
TBF-010 onward own the reviewed SQL migrations and service behavior.

## Scope and ownership

| Record                                                                     | Scope             | Access and RLS boundary                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account`                                                                  | Global            | The authenticated Clerk subject reads only its own row through transaction-local `app.principal_id`. No profile mirror.                                            |
| `organization_onboarding`                                                  | Global pre-tenant | The creator reads only its own record. Operators use separately authorized, audited paths.                                                                         |
| `onboarding_payment_verification`                                          | Global pre-tenant | Owner receives a safe status projection only. Operator payment evidence is not broadly readable.                                                                   |
| `owner_onboarding_attempt`                                                 | Global pre-tenant | Account-locked single-flight provider state. Exact signed marker repair may update only the matching attempt.                                                     |
| `bootstrap_idempotency_record`                                             | Global pre-tenant | Scoped to the authenticated account and operation. It never reuses tenant-scoped idempotency.                                                                      |
| `global_audit_event`                                                       | Global pre-tenant | Append-only account/operator/system history. Owner reads are account-scoped; operator/system reads require explicit context and filters.                           |
| `webhook_inbox`                                                            | Global pre-tenant | Exact-raw verified provider-event dedupe. API inserts only through a duplicate-safe function; worker reads/transitions rows and neither runtime role deletes them. |
| `membership_invitation`                                                    | Tenant-owned      | Standard tenant RLS plus local Owner authorization. Protected recipient data never appears in ordinary logs or list projections.                                   |
| `membership`, `subscription`, `subscription_event`, `subscription_payment` | Tenant-owned      | Existing tenant RLS applies. New lifecycle behavior is gated in services, not inferred from Clerk claims.                                                          |

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
- tenant-owned `membership_invitation`, including protected recipient lookup material, seven-day
  expiry, provider correlation, and a partial unique pending-intent index.
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
this phase. Explicit abandonment retains history and permits a replacement. Provider success
followed by local write failure is repaired by the signed `organization.created` webhook marker;
the webhook never provisions a tenant or starts a trial.

Invitation recipients are explicitly outside this command boundary until TBF-040/042 provides
local invitation persistence and claim state; they must not be treated as owners by a future
owner-eligibility implementation.

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
rehearsed local stack, staging, and a representative Neon branch. Deploy the service switch only
after constraints and reports are clean. A rollback reverts application code to the compatible
pre-switch version; it never drops these records. Any data or policy defect is corrected by a new
forward-only migration and an audited repair action.

## Evidence required before TBF-010

- Local compose PostgreSQL applies all migrations through the migration ledger.
- Integration tests prove partial unique constraints, tenant/global RLS denial, global bootstrap
  idempotency, and last-Owner rejection with sequential and concurrent attempts.
- Backfill dry-run reports are reviewed and have no unclassified ambiguity.
- The runtime database role cannot create schema objects or bypass RLS.
