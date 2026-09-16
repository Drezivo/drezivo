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

- [ ] **TBF-010 — Add minimal global account persistence**
  - **Depends on:** TBF-001, TBF-002.
  - **Outcome:** A minimal account record tracks Clerk identity, trial eligibility, and current
    owned-tenant link without mirroring Clerk profile data.
  - **Acceptance:**
    - [ ] Clerk user ID is unique and is the only required identity field.
    - [ ] No name, email, Clerk session, token, or profile sync is added.
    - [ ] Trial consumption and current-owned-tenant update are serialized per account.
    - [ ] A person can hold many Front Desk memberships but only one current owned tenant.
  - **Tests/evidence:** Concurrent account/trial and owned-tenant tests produce one winner.

- [ ] **TBF-011 — Add organization onboarding and pre-provision payment records**
  - **Depends on:** TBF-010.
  - **Outcome:** Interrupted owner setup and later paid activation are durable without a tenant.
  - **Acceptance:**
    - [ ] Onboarding has statuses incomplete, abandoned, payment-pending, and provisioned.
    - [ ] Clerk organization ID is unique; one incomplete/payment-pending record exists per
          account.
    - [ ] Abandonment retains history and provider correlation while allowing a replacement.
    - [ ] Pre-provision payment verification is immutable, operator-audited, and linked to a
          tenant only after successful activation.
    - [ ] Global records are unavailable to ordinary tenant listing endpoints.
  - **Tests/evidence:** Retry, abandon, and competing-incomplete-onboarding tests are green.

- [ ] **TBF-012 — Add bootstrap-safe idempotency and audit primitives**
  - **Depends on:** TBF-010, TBF-011.
  - **Outcome:** Pre-tenant commands use global idempotency rather than tenant-scoped request
    records.
  - **Acceptance:**
    - [ ] Same intent/retry returns the first safe response.
    - [ ] Reused key with changed payload fails safely.
    - [ ] Audit records identify account/operator/system actor namespace, action, outcome,
          request ID, and UTC time without sensitive payloads.
  - **Tests/evidence:** Sequential and Promise.all duplicate tests create one business effect.

## Phase 2: Clerk integration and owner onboarding

- [ ] **TBF-020 — Build one shared Clerk server adapter**
  - **Depends on:** TBF-001, TBF-010.
  - **Outcome:** API modules use a typed integration boundary instead of calling Clerk from
    arbitrary services.
  - **Acceptance:**
    - [ ] Adapter creates organizations, invitations, and membership changes.
    - [ ] Adapter reads only the provider facts required to verify current organization/member
          state.
    - [ ] Provider errors are mapped to safe typed failures; secrets and raw bodies are not logged.
    - [ ] Configuration is validated centrally and absent configuration fails closed.
  - **Tests/evidence:** Unit tests mock only the adapter boundary.

- [ ] **TBF-022 — Add raw verified Clerk webhook intake**
  - **Depends on:** TBF-020, existing webhook inbox.
  - **Outcome:** Clerk events are signature-verified over raw bytes, deduplicated, persisted, and
    queued for reconciliation before tenant behavior depends on them.
  - **Acceptance:**
    - [ ] Route precedes global JSON parsing.
    - [ ] Allowlist only organization, organization-invitation, and organization-membership
          event families. Reject or ignore all Clerk user-profile events; Drezivo does not mirror
          Clerk user profile fields in v1.
    - [ ] Route-specific raw-body size and rate limits apply before durable processing. Failures
          are generic and disclose neither verification nor reconciliation state.
    - [ ] Signature failure, malformed body, stale/unknown event, and duplicate provider ID fail
          or no-op safely.
    - [ ] Handler stores minimum safe payload and no raw secret/token is logged.
    - [ ] Organization-created reconciliation can repair a missing incomplete onboarding but
          cannot provision a tenant or start a trial.
  - **Tests/evidence:** Exact-raw-body verification plus duplicate/out-of-order, disallowed-event,
    rate-limit, and oversize-request tests.

- [ ] **TBF-021 — Implement create-only owner onboarding commands**
  - **Depends on:** TBF-011, TBF-012, TBF-020, TBF-022.
  - **Outcome:** A verified public user can create, read/resume, and abandon one onboarding.
  - **Acceptance:**
    - [ ] API, not browser, creates the Clerk organization.
    - [ ] The creator is made the provider organization administrator.
    - [ ] The API persists incomplete state and returns safe data for Clerk active-organization
          selection.
    - [ ] An arbitrary existing Clerk-admin organization cannot be submitted for bootstrap.
    - [ ] Existing Front Desk membership elsewhere does not block first owner onboarding.
    - [ ] Invitation recipients bypass owner onboarding and use the verified claim flow.
    - [ ] Current owned tenant or unfinished onboarding blocks a new owner journey.
    - [ ] Request-size and rate limits apply. Errors are generic and do not reveal another
          account's or onboarding record's existence.
  - **Tests/evidence:** Provider success/local-write failure recovery, duplicate create,
    invitation-recipient, rate-limit, and request-size tests.

## Phase 3: Tenant bootstrap, context, and entitlements

- [ ] **TBF-030 — Implement idempotent tenant bootstrap**
  - **Depends on:** TBF-021, TBF-012, TBF-001.
  - **Outcome:** A trial-eligible onboarding atomically creates tenant, default branch, Owner
    membership/grant, draft storefront, subscription, and trial event.
  - **Acceptance:**
    - [ ] Database time starts the seven-day trial.
    - [ ] Account trial state and current-owned-tenant link are updated in the same winning
          transaction.
    - [ ] Provisioned onboarding cannot bootstrap again.
    - [ ] Every tenant-owned row has server-resolved tenant scope and required RLS protection.
  - **Tests/evidence:** Sequential/concurrent bootstrap creates exactly one complete tenant graph.

- [ ] **TBF-031 — Update actor, tenant, and workspace resolution**
  - **Depends on:** TBF-030.
  - **Outcome:** Protected routes resolve current Clerk identity, active organization, local active
    membership, branch grant, tenant state, and entitlement server-side.
  - **Acceptance:**
    - [ ] Workspace listing shows only provisioned businesses with active local membership.
    - [ ] Missing/mismatched/removed/suspended membership and unprovisioned organization deny.
    - [ ] A user can be Front Desk in one tenant and Owner in its single owned tenant.
    - [ ] Cross-tab organization switching uses the active organization on each request.
    - [ ] A restricted tenant reaches the shared action-policy gate, not active or blanket
          cancelled handling. Only explicitly approved settlement, return, refund, and export
          paths may continue.
  - **Tests/evidence:** Cross-tenant, wrong-active-org, revoked-membership, and cross-tab tests.

- [ ] **TBF-032 — Seed plans and build the entitlement service**
  - **Depends on:** TBF-030.
  - **Outcome:** Versioned plans expose correct price and quota data through one server service.
  - **Acceptance:**
    - [ ] Seed Starter/PHP 300/75 assets/1 Front Desk, Professional/PHP 499/250/3, and
          Business/PHP 1,299/1,000/10 using minor units.
    - [ ] Entitlement resolution rejects unknown/inactive plan versions.
    - [ ] Service exposes concurrency-safe guards for seat and active-asset quota.
    - [ ] Asset import preview remains read-only; any future commit/activation calls the same
          guard before writes.
  - **Tests/evidence:** Plan seed and overage tests include concurrent seat/asset claims.

- [ ] **TBF-033 — Implement trial lifecycle and request-time gates**
  - **Depends on:** TBF-030, TBF-032.
  - **Outcome:** Trialing, normal past-due grace, and restricted state are reliable even when the
    worker is delayed.
  - **Acceptance:**
    - [ ] Trial change applies a new plan's limits immediately and records immutable event.
    - [ ] Downgrade blocks when current assets or counted seats exceed the new plan.
    - [ ] Trial ends to seven-day normal-access past_due grace, then restricted.
    - [ ] Restricted policy allows existing-rental settlement, returns, refunds, and exports only.
    - [ ] One shared restricted-action matrix is used by tenant context and every endpoint, so
          restricted access cannot accidentally inherit active or cancelled behavior.
    - [ ] Request-time state checks and durable expiry work agree.
  - **Tests/evidence:** Database-time boundary tests for every transition and duplicate job replay.

## Phase 4: Front Desk invitation and membership

- [ ] **TBF-040 — Add local invitation state and safe Owner routes**
  - **Depends on:** TBF-031, TBF-032.
  - **Outcome:** Only a current Owner can create, list, resend, or cancel Front Desk invitations.
  - **Acceptance:**
    - [ ] Invitation has normalized protected email, seven-day expiry, provider correlation,
          status, and stable business key.
    - [ ] Seat count includes active Front Desk plus unexpired pending invitation.
    - [ ] Resend does not consume a second seat; cancellation/expiry releases it.
    - [ ] Front Desk receives no member/invitation management access.
    - [ ] Owner-and-tenant rate limits apply. Generic responses do not disclose whether an email
          already has an account or invitation.
  - **Tests/evidence:** Cap, expiry, resend, cancellation, and owner-vs-frontdesk authorization tests.

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
