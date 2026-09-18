# Tenancy, Owner Onboarding, Clerk, Memberships, and Billing V1 Checklist

**Status:** Phase 0 complete; Phase 1 onward remain staged and unimplemented
**Canonical decision record:** [Second Brain architecture note](../Drezivo-Second-Brain/02-Architecture/Tenancy%2C%20Onboarding%2C%20Clerk%2C%20Memberships%2C%20and%20Billing%20Foundation.md)
**Canonical specifications to align first:** [PRD](../docs/product/Drezivo-PRD.md),
[TRD](../docs/architecture/Drezivo-TRD.md), [Data Model](../docs/architecture/Drezivo-Data-Model.md),
and [ERD](../docs/architecture/Drezivo-ERD.dbml)

## How to use this checklist

This checklist deliberately breaks the foundation into small, reviewable slices. Do not combine
multiple phases into one pull request. Before a task is marked complete:

- Its contract, migration, service, route, worker, and consumer impact have been reviewed.
- Every mutation has an idempotency strategy and sequential plus concurrent double-fire tests.
- Tenant scope, local membership, entitlement, and state are resolved server-side.
- Unknown provider state, missing context, or failed reconciliation denies access.
- The relevant targeted tests, typecheck, lint, and build have run. A passing scaffold check is not
  production certification.

The older [V1-BUSINESS-BACKEND-TASKS.md](V1-BUSINESS-BACKEND-TASKS.md) is a broader historical
roadmap. It contains incompatible assumptions for this foundation, including excluded billing,
multi-owner organization creation, and direct organization-scoped routing. Do not use its tenancy
or billing tasks as authority for this work.

## Non-negotiable outcomes

- A public verified person is an owner candidate, not automatically an Owner membership.
- Backend-created Clerk organization plus local incomplete onboarding is the only owner-start path.
- One verified person has one unfinished onboarding, one current owned tenant, and one lifetime
  seven-day trial.
- A person may be Front Desk in other tenants.
- Front Desk membership is created only from a Drezivo invitation and verified Clerk claim.
- The app switches only among provisioned businesses with active local membership.
- Starter / Professional / Business enforce 75 / 250 / 1,000 active physical assets and
  1 / 3 / 10 Front Desk seats.
- Trial expiry has seven days of normal past-due grace, then restricted access.
- Later businesses remain payment-pending until audited manual operator payment.
- Clerk webhook or organization loss never creates access by assumption.

## Phase 0: Canonical decision and contract preparation

- [x] **TBF-000 — Align the canonical specifications**
  - **Depends on:** None.
  - **Outcome:** PRD, TRD, Data Model, ERD, and this checklist agree on the accepted lifecycle.
  - **Acceptance:**
    - [x] Replace 14-day trial and one-trial-per-tenant language with seven-day,
          one-trial-per-verified-person policy.
    - [x] Replace 50 / 200 / 1,000 asset limits with 75 / 250 / 1,000.
    - [x] State Front Desk caps of 1 / 3 / 10 and count active members plus unexpired invites.
    - [x] Document payment-pending onboarding, one current owned tenant, closure, and external
          Clerk organization deletion restriction.
    - [x] Record that Clerk proves identity while Drezivo authorizes local membership and
          entitlements.
  - **Tests/evidence:** Documentation review finds no conflicting old lifecycle statement.

- [x] **TBF-001 — Define shared contracts and stable errors**
  - **Depends on:** TBF-000.
  - **Outcome:** The contracts package owns onboarding, invitation, subscription, operator, and
    webhook-safe DTOs before API routes exist.
  - **Acceptance:**
    - [x] Add closed schemas for onboarding status, plan code, trial/billing state, invitation
          status, actor context, and safe operator-action responses.
    - [x] Membership status accepts only `active`, `suspended`, and `removed`. `pending` is
          invitation state, not membership state.
    - [x] Add request schemas for create/resume/abandon onboarding, choose plan, bootstrap,
          invite/resend/cancel/claim, plan change, payment verification, closure, and owner transfer.
    - [x] Add stable error codes for trial consumed, existing owned tenant, incomplete onboarding,
          seat/asset overage, invalid invitation, stale provider state, and restricted tenant.
    - [x] Tenant-owned writes do not accept tenant ID, Clerk organization ID, role, price,
          entitlement, or seat count as authority.
    - [x] OpenAPI and envelope behavior remain backward compatible.
  - **Tests/evidence:** Contract schema tests reject unknown states and client-supplied authority.

- [x] **TBF-002 — Define migration and rollback boundaries**
  - **Depends on:** TBF-000.
  - **Outcome:** The database rollout is additive, ordered, and safe to deploy before consumers.
  - **Acceptance:**
    - [x] Identify new global pre-tenant versus tenant-owned tables and their RLS policy.
    - [x] Specify indexes and unique/partial-unique constraints for one unfinished onboarding,
          one Clerk organization mapping, current owned tenant, one current subscription, invite
          intent, and provider event dedupe.
    - [x] Specify backfill/default behavior for existing tenant and membership rows.
    - [x] Define rollback as application rollback plus forward-only corrective migration, never
          destructive schema reversal of live lifecycle data.
  - **Tests/evidence:** Migration review includes real Postgres constraint and RLS test plan.

## Phase 1: Global account and pre-tenant state

- [x] **TBF-010 — Add minimal global account persistence**
  - **Depends on:** TBF-001, TBF-002.
  - **Outcome:** A minimal account record tracks Clerk identity, trial eligibility, and current
    owned-tenant link without mirroring Clerk profile data.
  - **Acceptance:**
    - [x] Clerk user ID is unique and is the only required identity field.
    - [x] No name, email, Clerk session, token, or profile sync is added.
    - [x] Trial consumption and current-owned-tenant update are serialized per account.
    - [x] A person can hold many Front Desk memberships but only one current owned tenant.
  - **Tests/evidence:** Local PostgreSQL integration tests cover concurrent account creation,
    trial consumption, owned-tenant claims, cross-account RLS denial, and Front Desk
    memberships (`npm run test:integration --workspace @drezivo/api`).

- [x] **TBF-011 — Add organization onboarding and pre-provision payment records**
  - **Depends on:** TBF-010.
  - **Outcome:** Interrupted owner setup and later paid activation are durable without a tenant.
  - **Acceptance:**
    - [x] Onboarding has statuses incomplete, abandoned, payment-pending, and provisioned.
    - [x] Clerk organization ID is unique; one incomplete/payment-pending record exists per
          account.
    - [x] Abandonment retains history and provider correlation while allowing a replacement.
    - [x] Pre-provision payment verification is immutable, operator-audited, and linked to a
          tenant only after successful activation.
    - [x] Global records are unavailable to ordinary tenant listing endpoints.
  - **Tests/evidence:** PostgreSQL integration tests run as the non-superuser `drezivo_app`
    role and cover concurrent same-organization retry, competing active onboardings,
    owner/tenant RLS isolation, incomplete and payment-pending abandonment, trial-consumed
    plan transitions, concurrent plan changes, immutable business-key payment records,
    owner-safe payment projections, and no tenant/subscription side effect.

- [x] **TBF-012 — Add bootstrap-safe idempotency and audit primitives**
  - **Depends on:** TBF-010, TBF-011.
  - **Outcome:** Pre-tenant commands use global idempotency rather than tenant-scoped request
    records.
  - **Acceptance:**
    - [x] Same intent/retry returns the first safe response.
    - [x] Reused key with changed payload fails safely.
    - [x] Audit records identify account/operator/system actor namespace, action, outcome,
          request ID, and UTC time without sensitive payloads.
  - **Tests/evidence:** `tests/integration/bootstrap-primitives.test.ts` runs as the
    non-superuser `drezivo_app` role; the PostgreSQL suite passed with 27 tests covering
    sequential/concurrent claims, changed payloads, account/operation scope, expired-key reclaim,
    in-progress claims, atomic rollback, owner and tenant RLS isolation, account/operator/system
    audit reads, bounded JSON, and immutable audit privileges.

## Phase 2: Clerk integration and owner onboarding

- [x] **TBF-020 — Build one shared Clerk server adapter**
  - **Depends on:** TBF-001, TBF-010.
  - **Outcome:** API modules use a typed integration boundary instead of calling Clerk from
    arbitrary services.
  - **Acceptance:**
    - [x] Adapter creates organizations, invitations, and membership changes.
    - [x] Adapter reads only the provider facts required to verify current organization/member
          state.
    - [x] Provider errors are mapped to safe typed failures; secrets and raw bodies are not logged.
    - [x] Configuration is validated centrally and absent configuration fails closed.
  - **Tests/evidence:** `src/integrations/clerk/__tests__/clerk.adapter.test.ts` covers
    organization creation, provider-fact membership reads, invitation create/revoke, membership
    mutations, input validation, malformed provider responses, and safe typed provider failures.

- [x] **TBF-022 — Add raw verified Clerk webhook intake**
  - **Depends on:** TBF-020, existing webhook inbox.
  - **Outcome:** Clerk events are signature-verified over raw bytes, deduplicated, persisted, and
    queued for reconciliation before tenant behavior depends on them.
  - **Acceptance:**
    - [x] Route precedes global JSON parsing.
    - [x] Allowlist only organization, organization-invitation, and organization-membership
          event families. Reject or ignore all Clerk user-profile events; Drezivo does not mirror
          Clerk user profile fields in v1.
    - [x] Route-specific raw-body size and rate limits apply before durable processing. Failures
          are generic and disclose neither verification nor reconciliation state.
    - [x] Signature failure, malformed body, stale/unknown event, and duplicate provider ID fail
          or no-op safely.
    - [x] Handler stores minimum safe payload and no raw secret/token is logged.
    - [x] Organization-created reconciliation can repair a missing incomplete onboarding but
          cannot provision a tenant or start a trial.
  - **Tests/evidence:** Unit coverage verifies exact raw bytes, Clerk/Svix signatures, canonical
    normalization, safe redaction, duplicate/disallowed no-ops, malformed/oversized requests,
    and rate limiting. PostgreSQL integration coverage passed as `drezivo_app`/`drezivo_worker`
    with insert-only/read-update privilege checks, duplicate ingestion, marker repair, competing
    onboarding, and proof that repair creates no tenant, branch, membership, subscription, or
    trial side effect.

- [x] **TBF-021 — Implement create-only owner onboarding commands**
  - **Depends on:** TBF-011, TBF-012, TBF-020, TBF-022.
  - **Outcome:** A verified public user can create, read/resume, and abandon one onboarding.
  - **Acceptance:**
    - [x] API, not browser, creates the Clerk organization.
    - [x] The creator is made the provider organization administrator.
    - [x] The API persists incomplete state and returns safe data for Clerk active-organization
          selection, including the authenticated owner's opaque `clerk_org_id`.
    - [x] Owner commands require a verified primary Clerk email before account, idempotency, or
          provider mutation.
    - [x] Concurrent owner starts serialize on the account row and persist one durable provider
          attempt with the exact recovery marker and original requested details.
    - [x] Unknown provider outcomes remain recoverable and are never automatically retried into a
          second Clerk organization.
    - [x] Abandonment accepts only the closed `reason_code` enum and stores no free text.
    - [x] The 16 KiB onboarding limit is enforced on raw request bytes before JSON parsing.
    - [x] An arbitrary existing Clerk-admin organization cannot be submitted for bootstrap.
    - [x] Existing Front Desk membership elsewhere does not block first owner onboarding.
    - [ ] Invitation recipients bypass owner onboarding and use the verified claim flow boundary;
          invitation persistence and claim enforcement remain deferred to TBF-040/042.
    - [x] Current owned tenant or unfinished onboarding blocks a new owner journey.
    - [x] Request-size and rate limits apply. Errors are generic and do not reveal another
          account's or onboarding record's existence.
  - **Tests/evidence:** `POST /api/v1/onboarding`, `GET /api/v1/onboarding/current`, and
    `POST /api/v1/onboarding/:onboardingId/abandon` use account-scoped bootstrap idempotency.
    Create is limited to 5 requests/minute per verified user, reads to 30/minute, abandonment to
    10/minute, and raw JSON bodies to 16 KiB. Same-key retries replay, changed payloads fail with
    `IDEMPOTENCY_KEY_REUSED`, dependency failures remain single-flight, and provider-success/
    local-write recovery uses the signed `organization.created` marker. Adapter, auth, parser,
    contract, and API unit tests pass; PostgreSQL integration tests require the disposable
    `TEST_DATABASE_URL` described in `tests/integration/helpers/test-db.ts`.

## Phase 3: Tenant bootstrap, context, and entitlements

- [x] **TBF-030 — Implement idempotent tenant bootstrap**
  - **Depends on:** TBF-021, TBF-012, TBF-001.
  - **Outcome:** A trial-eligible onboarding atomically creates tenant, default branch, Owner
    membership/grant, draft storefront, subscription, and trial event.
  - **Acceptance:**
    - [x] Database time starts the seven-day trial.
    - [x] Account trial state and current-owned-tenant link are updated in the same winning
          transaction.
    - [x] Provisioned onboarding cannot bootstrap again.
    - [x] Every tenant-owned row has server-resolved tenant scope and required RLS protection.
    - [x] The strict empty-body command requires the authenticated active Clerk organization and
          account-scoped idempotency key.
    - [x] The complete graph includes the default branch, Owner grant, draft storefront,
          trialing subscription, immutable trial event, tenant audit, and outbox event.
  - **Tests/evidence:** `tests/integration/tenant-bootstrap.test.ts` covers complete graph creation,
    concurrent same-key replay, organization mismatch concealment, database-time trial period, and
    single-graph assertions. Full PostgreSQL evidence requires the disposable `TEST_DATABASE_URL`.

- [x] **TBF-031 — Update actor, tenant, and workspace resolution**
  - **Depends on:** TBF-030.
  - **Outcome:** Protected routes resolve current Clerk identity, active organization, local active
    membership, branch grant, tenant state, and entitlement server-side.
  - **Acceptance:**
    - [x] `GET /api/v1/workspaces` returns only provisioned tenants with an active local
          membership through the narrow `resolve_actor_workspaces` database function.
    - [x] `GET /api/v1/actor-context` derives tenant authority from the Clerk token organization,
          then resolves active membership, branches, selected-branch grants, subscription, and
          positive numeric entitlements under forced RLS.
    - [x] Missing/mismatched/removed/suspended membership, unknown organization, missing default
          branch, and invalid branch selectors fail closed without cross-tenant disclosure.
    - [x] A user can be Front Desk in one tenant and Owner in its single owned tenant; role and
          branch grants are local database state, never Clerk claims.
    - [x] Workspace switching uses Clerk `setActive` with the opaque organization ID from the
          server projection and clears the branch selector before refetching context.
    - [x] Restricted and cancelled tenants resolve to the shared action-policy gate; they are not
          blanket-denied by context middleware and do not inherit active permissions.
  - **Tests/evidence:** Unit policy tests and the real PostgreSQL suite pass as the non-superuser
    `drezivo_app` role. `tests/integration/actor-workspace-resolution.test.ts` covers
    active-membership listing, wrong-principal/tenant-scoped RLS isolation, branch selection,
    entitlements, and lifecycle resolution.

- [x] **TBF-032 — Build the entitlement service over seeded plans**
  - **Depends on:** TBF-030.
  - **Outcome:** Versioned plans expose correct price and quota data through one server service.
  - **Acceptance:**
    - [x] Resolve the immutable TBF-030 Starter/Professional/Business v1 seed rows and reject
          unknown or conflicting plan definitions.
    - [x] Entitlement resolution rejects unknown, inactive, malformed, and non-v1 plan versions.
    - [x] Same-client guards lock the tenant row and enforce active physical-asset and Front Desk
          membership quotas under concurrency.
    - [x] Asset import preview remains read-only; future commit/activation paths must call the
          same guard before writes. Pending invitation reservations remain TBF-040 behavior.
    - [x] Runtime API and worker roles can read plan data but cannot mutate plan or entitlement
          rows; reviewed migrations remain the plan-management boundary.
  - **Tests/evidence:** `src/modules/entitlements/__tests__/entitlements.service.test.ts` and
    `tests/integration/entitlements.test.ts` cover seed resolution, malformed/inactive plans,
    privilege enforcement, rollback, exact limits, tenant isolation, and concurrent seat/asset
    claims. Full PostgreSQL evidence requires the disposable `TEST_DATABASE_URL`.

- [x] **TBF-033 — Implement trial lifecycle and request-time gates**
  - **Depends on:** TBF-030, TBF-032.
  - **Outcome:** Trialing, normal past-due grace, and restricted state are reliable even when the
    worker is delayed.
  - **Acceptance:**
    - [x] Trial change applies a new plan's limits immediately and records an immutable event through
          `POST /api/v1/subscription/plan`; paid-plan changes remain deferred.
    - [x] Downgrade blocks when current active assets or counted Front Desk seats exceed the new plan.
    - [x] Trial ends to a seven-day normal-access `past_due` grace, then `restricted`, using database
          time and the original trial boundary.
    - [x] Restricted policy allows existing-rental settlement, returns, refunds, and exports only.
    - [x] One shared restricted-action matrix is used by tenant context and every endpoint, so
          restricted access cannot accidentally inherit active or cancelled behavior.
    - [x] Request-time state checks and the durable subscription expiry sweep use the same transition
          service and deterministic event keys.
  - **Tests/evidence:** `tests/integration/subscription-lifecycle.test.ts` covers database-time trial
    and grace boundaries, delayed-worker catch-up, request-time actor-context reconciliation, replay-safe
    plan changes, owner-only authorization, and downgrade capacity rejection. Full PostgreSQL evidence
    requires the disposable `TEST_DATABASE_URL`.

## Phase 4: Front Desk invitation and membership

- [x] **TBF-040 — Add local invitation state and safe Owner routes**
  - **Depends on:** TBF-031, TBF-032.
  - **Outcome:** Only a current Owner can create, list, resend, or cancel Front Desk invitations.
  - **Acceptance:**
    - [x] Invitation stores a normalized keyed digest, AES-GCM protected email, seven-day
          database-time expiry, provider correlation, status, dispatch version, and stable business key.
    - [x] Seat count includes active Front Desk memberships plus unexpired pending invitations;
          expired reservations are released under the tenant lock.
    - [x] Resend retains one row and one seat while incrementing dispatch version; cancellation
          and expiry release the reservation without deleting history.
    - [x] Front Desk receives no invitation-management access; recipient/provider fields are
          excluded from ordinary projections and logs.
    - [x] Owner-and-tenant rate limits apply. Generic responses do not disclose whether an email
          already has a Clerk or Drezivo account or an existing invitation.
  - **Tests/evidence:** `tests/integration/membership-invitations.test.ts` covers protected
        recipient reuse, seat reservation/release, resend versioning, safe list projections, and
        Front Desk denial. Full PostgreSQL concurrency/RLS evidence requires the disposable
        `TEST_DATABASE_URL`; dispatch remains intentionally deferred to TBF-041.

- [ ] **TBF-041 — Dispatch Clerk invitation and membership changes through outbox**
  - **Depends on:** TBF-020, TBF-040, existing outbox worker.
  - **Outcome:** Local invitation/removal state survives provider outage and worker restart.
  - **Acceptance:**
    - [ ] Local state and outbox event commit together.
    - [ ] Lease, retry bound, provider idempotency/correlation, and terminal failure are visible.
    - [ ] No fire-and-forget Clerk request exists.
  - **Tests/evidence:** Crash-before/after-provider-acceptance and duplicate worker-claim tests.

- [ ] **TBF-042 — Implement verified invitation claim**
  - **Depends on:** TBF-040, TBF-041, TBF-022.
  - **Outcome:** Accepted Clerk invitation activates one local Front Desk membership and grant.
  - **Acceptance:**
    - [ ] Claim verifies current authenticated user, active organization, Clerk membership, local
          invitation correlation, expiry, role, and seat state.
    - [ ] Duplicate claim and duplicate webhook event activate one membership.
    - [ ] Unknown provider-created membership does not grant Drezivo access.
    - [ ] User and network rate limits apply. Generic failures do not distinguish invalid, expired,
          revoked, or already-claimed invitations to an unauthorized caller.
  - **Tests/evidence:** Wrong organization, expired/cancelled invite, duplicate, webhook-order,
    and rate-limit tests.

- [ ] **TBF-043 — Implement local-first membership removal and approved owner transfer**
  - **Depends on:** TBF-041, TBF-042.
  - **Outcome:** Revocation takes effect immediately; sole-owner transfer remains operator-only.
  - **Acceptance:**
    - [ ] Local removal precedes queued Clerk removal and preserves history.
    - [ ] Existing protected request fails after removal despite valid Clerk session.
    - [ ] A tenant always has at least one active Owner. The final active Owner cannot self-remove,
          be removed, or be demoted; an approved transfer atomically installs a verified successor
          before the prior Owner loses the role.
    - [ ] Owner transfer requires documented business-contact evidence, reason, and second internal
          approval before changes.
  - **Tests/evidence:** Revocation race, last-Owner rejection, successor-first transfer, and
    missing-approval transfer tests.

## Phase 5: Operator payment, recovery, and closure

- [ ] **TBF-050 — Add platform-operator authorization and audit**
  - **Depends on:** TBF-010, TBF-001.
  - **Outcome:** Dedicated operator routes use an audited Clerk-ID allowlist separate from tenant roles.
  - **Acceptance:**
    - [ ] Tenant Owner is not automatically an operator.
    - [ ] Operator actions require fresh authorization, reason, stable business key, and audit event.
    - [ ] Allowlist changes are themselves audited and never exposed in tenant APIs.
  - **Tests/evidence:** Tenant-owner/operator boundary and audit-completeness tests.

- [ ] **TBF-051 — Activate manual payment and payment-pending onboarding**
  - **Depends on:** TBF-030, TBF-033, TBF-050.
  - **Outcome:** Verified operator payment activates existing subscriptions or safely provisions
    payment-pending replacement businesses.
  - **Acceptance:**
    - [ ] Existing tenant payment creates immutable subscription payment/event and paid period.
    - [ ] Payment-pending verification persists before external/tenant activation and remains
          recoverable if provisioning retries.
    - [ ] Activation starts paid period from database verification time.
    - [ ] No route claims recurring billing or accepts a card/payment credential.
  - **Tests/evidence:** Duplicate verification, retry-after-partial-failure, and audit tests.

- [ ] **TBF-052 — Handle external Clerk organization loss**
  - **Depends on:** TBF-022, TBF-031, TBF-050.
  - **Outcome:** A deleted/unresolvable provider organization immediately restricts local access and
    public intake without deleting business data.
  - **Acceptance:**
    - [ ] Worker/webhook transition is idempotent and audited.
    - [ ] Ordinary staff access, new intake, publish, assets, and invitations deny.
    - [ ] Settlement, returns, refunds, and export policy remains available as defined.
    - [ ] Recovery is operator-only and has a documented evidence/runbook path.
  - **Tests/evidence:** Deletion replay, worker retry, and restricted-capability matrix tests.

- [ ] **TBF-053 — Implement operator-assisted permanent closure**
  - **Depends on:** TBF-050, TBF-051.
  - **Outcome:** The sole owner can later replace a permanently closed business without a second trial.
  - **Acceptance:**
    - [ ] Closure is reason-coded, sets the persisted tenant state to `cancelled`, and is
          irreversible through ordinary tenant routes.
    - [ ] Former owner has only read-only settlement/export access.
    - [ ] Account current-owned-tenant link releases only after successful closure.
    - [ ] Replacement onboarding is payment-pending, never trialing.
  - **Tests/evidence:** Closure/replacement race and historical-access tests.

## Phase 6: Final integration and operating readiness

- [ ] **TBF-060 — Reconciliation worker and observability**
  - **Depends on:** TBF-022, TBF-041 through TBF-053.
  - **Outcome:** Webhook/outbox drift, expiry, provider failures, and terminal jobs are observable
    and recoverable.
  - **Acceptance:**
    - [ ] Periodic reconciliation checks provider/local membership and organization linkage.
    - [ ] Unexpected provider state fails closed and creates actionable operator work.
    - [ ] Metrics/alerts cover webhook verification failures, inbox lag, outbox dead state,
          expiring trial/grace, and reconciliation mismatch without PII.
  - **Tests/evidence:** Reconciliation of delayed, duplicate, and missing provider events.

- [ ] **TBF-061 — Complete API integration/security suite**
  - **Depends on:** All prior implementation tasks.
  - **Outcome:** The foundation has adversarial evidence, not only happy-path unit tests.
  - **Acceptance:**
    - [ ] Real Postgres/RLS tests prove tenant read/write isolation and missing-context denial.
    - [ ] Contract/API envelope tests cover all new commands and stable failure codes.
    - [ ] Double-fire tests cover every mutation.
    - [ ] Browser/API handoff tests cover active-organization changes and resumed onboarding.
    - [ ] No provider secret, raw webhook, invitation token, email, or payment evidence appears in
          logs, snapshots, or fixtures.
  - **Tests/evidence:** Targeted suite plus workspace typecheck, lint, test, and build output.

- [ ] **TBF-062 — Finish canonical documentation and runbooks**
  - **Depends on:** TBF-060, TBF-061.
  - **Outcome:** Product, architecture, operations, and implementation behavior tell the same story.
  - **Acceptance:**
    - [ ] PRD/TRD/Data Model/ERD and Second Brain note match implemented behavior.
    - [ ] Runbooks cover Clerk webhook setup/test replay, manual operator payment, provider-org
          loss, closure, transfer, reconciliation, and terminal outbox recovery.
    - [ ] Operator roles and approval evidence are documented without secrets or customer data.
    - [ ] Any deferred consumer UI work has explicit API contract and acceptance handoff.
  - **Tests/evidence:** Documentation review and recovery tabletop results are recorded.

## Deferred from this foundation

- Credit-card collection, payment gateways, automated recurring collection, and provider billing
  webhooks.
- Customer account authentication and public storefront changes beyond restricted intake gates.
- Multiple owned businesses per person.
- Self-service ownership transfer, self-service permanent closure, and Clerk organization deletion UI.
- New asset/import product work beyond wiring the entitlement guard into commands when those modules
  are implemented.
- Business-information and notification settings screens. These follow the identity, tenant, and
  subscription foundation.
