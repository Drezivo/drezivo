# Tenancy and onboarding migration plan

**Status:** approved Phase 0 migration design, not yet applied  
**Owner:** API and database maintainers  
**Source:** `Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation` in the Second Brain, 16 September 2026  
**Updated:** 16 September 2026  
**Related:** [TRD](Drezivo-TRD.md), [Data Model](Drezivo-Data-Model.md), [ERD](Drezivo-ERD.dbml), [migration runbook](../runbooks/migrations.md)

This document defines the forward-only database work for TBF-002. It does not create the tables.
TBF-010 onward own the reviewed SQL migrations and service behavior.

## Scope and ownership

| Record                                                                     | Scope             | Access and RLS boundary                                                                                                          |
| -------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `account`                                                                  | Global            | The authenticated Clerk subject reads only its own row through transaction-local `app.principal_id`. No profile mirror.          |
| `organization_onboarding`                                                  | Global pre-tenant | The creator reads only its own record. Operators use separately authorized, audited paths.                                       |
| `onboarding_payment_verification`                                          | Global pre-tenant | Owner receives a safe status projection only. Operator payment evidence is not broadly readable.                                 |
| `bootstrap_idempotency_record`                                             | Global pre-tenant | Scoped to the authenticated account and operation. It never reuses tenant-scoped idempotency.                                    |
| `global_audit_event`                                                       | Global pre-tenant | Append-only account/operator/system history. Owner reads are account-scoped; operator/system reads require explicit context and filters. |
| `webhook_inbox`                                                            | Global pre-tenant | Existing provider-event dedupe remains restricted to webhook/reconciliation processing.                                          |
| `membership_invitation`                                                    | Tenant-owned      | Standard tenant RLS plus local Owner authorization. Protected recipient data never appears in ordinary logs or list projections. |
| `membership`, `subscription`, `subscription_event`, `subscription_payment` | Tenant-owned      | Existing tenant RLS applies. New lifecycle behavior is gated in services, not inferred from Clerk claims.                        |

## Expand migration design

The next migration number after the existing reviewed sequence is reserved for an additive
tenancy-onboarding expansion. It creates:

- `account` with unique `clerk_user_id`, nullable `trial_consumed_at`, and nullable
  `current_owned_tenant_id`.
- `organization_onboarding` with unique `clerk_org_id`, selected plan, recoverable operation
  state, and a partial unique index permitting only one `incomplete` or `payment_pending` row per
  account.
- immutable `onboarding_payment_verification`, global `bootstrap_idempotency_record`, and
  append-only `global_audit_event`.
- tenant-owned `membership_invitation`, including protected recipient lookup material, seven-day
  expiry, provider correlation, and a partial unique pending-intent index.
- nullable `clerk_membership_id` plus unique provider correlation on `membership`.

The same expansion adds RLS policies for global account-owned records using
`current_setting('app.principal_id', true)`. It extends the existing tenant-owned RLS list for
`membership_invitation`; it does not weaken the existing `webhook_inbox` restriction.

## Required constraints

- One Clerk user maps to one account; one Clerk organization maps to at most one onboarding and
  at most one tenant.
- One account has at most one unfinished onboarding and one current owned tenant.
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
