---
title: Frontend Tenant Auth and Onboarding Flow
type: architecture
status: current
owner: Drezivo platform team
source: "[Tenancy checklist](../../../api/TENANCY-ONBOARDING-V1-CHECKLIST.md); [Backend checklist](../../../api/V1-BACKEND-CHECKLIST.md); [[02-Architecture/Tenancy Checklist - What Why How]]; [TRD](../../architecture/Drezivo-TRD.md); [Data Model](../../architecture/Drezivo-Data-Model.md); [ERD](../../architecture/Drezivo-ERD.dbml); [Migration plan](../../architecture/Tenancy-Onboarding-Migration-Plan.md)"
updated: 2026-09-18
tags:
  - drezivo
  - architecture
  - frontend
  - clerk
  - auth
  - onboarding
  - tenancy
---

# Frontend Tenant Authentication and Onboarding Flow

This guide translates the completed backend tenancy work into the sequence the frontend should
implement. It describes the user journey and the API boundaries, not a frontend code design.

The central rule is simple:

- Clerk proves who the person is and supplies the active organization context.
- Drezivo decides whether that person has a local account, tenant, membership, branch grant,
  subscription, and entitlement.
- The browser never creates a tenant, selects an arbitrary organization, assigns a role, supplies
  prices or limits, or treats a Clerk organization membership as Drezivo access.

The implementation status and rationale for each TBF are tracked in
[[02-Architecture/Tenancy Checklist - What Why How]].

## What is available now

The owner journey can use these backend boundaries:

| Purpose | Endpoint or provider action | When it is used |
| --- | --- | --- |
| Identity | Clerk sign-up/sign-in and email verification | Before any Drezivo mutation |
| Resume owner setup | `GET /api/v1/onboarding/current` | On every authenticated app entry before choosing a workspace |
| Start owner setup | `POST /api/v1/onboarding` | Once the verified user submits an organization name and optional slug |
| Abandon owner setup | `POST /api/v1/onboarding/:onboardingId/abandon` | When the owner intentionally pauses or abandons setup |
| Create the tenant graph | `POST /api/v1/onboarding/:onboardingId/bootstrap` | After an eligible onboarding has a selected plan |
| Discover workspaces | `GET /api/v1/workspaces` | After a tenant exists, or for an invited member |
| Resolve active workspace | `GET /api/v1/actor-context` | After Clerk active organization is selected |
| Change a trial plan | `POST /api/v1/subscription/plan` | After bootstrap, while the subscription is still trialing |

The optional Front Desk journey has these additional boundaries:

- Owner invitation management: `POST`, `GET`, resend, and cancel under
  `/api/v1/membership-invitations`.
- Invited-user claim: `POST /api/v1/membership-invitations/:invitationId/claim`.

TBF-040 through TBF-042 implement those invitation boundaries, but their disposable-PostgreSQL
integration evidence is still an acceptance gate. TBF-043 (membership removal and Owner transfer)
is not implemented yet.

## Rules for every API request

1. The frontend uses the Clerk SDK to establish the session and attach the Clerk session token to
   API requests. It does not create Clerk organizations, invitations, or memberships through a
   provider SDK intended for server use.
2. Do not send `clerk_user_id`, `tenant_id`, `organization_id`, `role`, branch grants, prices, or
   quota values as authority. The API derives identity from the verified token and derives tenant
   authority from the active Clerk organization.
3. Every command `POST` uses `Content-Type: application/json`. Mutation endpoints that declare
   idempotency require an `Idempotency-Key`; retry the same user intent with the same key rather
   than generating a new key for each network retry.
4. Bootstrap and claim accept only the strict empty JSON object `{}`. Do not omit the body or send
   an unrelated JSON object.
5. Read the standard envelope. Success is `{ success: true, data, request_id }`; failure is
   `{ success: false, error, request_id }`. Treat `request_id` as support/debug information, not as
   a client-side authorization value.
6. Use only safe projections returned by the API. Recipient email ciphertext/digests, provider
   metadata, invitation tokens, raw webhook payloads, and provider secrets never belong in browser
   state.
7. On a timeout after a command was sent, re-read state or retry the same idempotency key. Never
   call the provider directly to guess whether Drezivo completed the operation.

## Step-by-step owner sign-up and onboarding

### 1. Sign up and verify the person

Render Clerk's sign-up flow. The user is not ready for Drezivo onboarding until the primary email
is verified and a Clerk session exists.

The first Drezivo request should be `GET /api/v1/onboarding/current`. An unverified user is
rejected before account creation, idempotency claims, or Clerk organization mutations. The UI
should keep the user in the verification step and then retry the read after Clerk refreshes the
session.

There is no separate frontend "create account" form or account endpoint. The Drezivo account is
created or resumed by the owner-onboarding command after verification.

### 2. Resume or classify the current state

Use the response from `GET /api/v1/onboarding/current` to choose the next screen:

- `onboarding` is `null` and `has_current_owned_tenant` is false: show the create-organization
  form.
- `onboarding` is `incomplete`: resume the saved organization details and show the next required
  step. Do not create another organization.
- `onboarding` is `payment_pending`: show the payment/operator handoff. It is still pre-tenant and
  cannot be bootstrapped by the owner.
- `onboarding` is `abandoned`: show a resume/new-journey decision according to the returned safe
  projection; do not silently reuse it as a new active journey.
- `onboarding` is `provisioned`, or `has_current_owned_tenant` is true: skip owner setup and load
  workspaces.

An invited Front Desk user is not an owner and must not be sent through this create-organization
  journey. Invitation claim is a separate flow after TBF-040/TBF-041 provider dispatch.

### 3. Create the owner's organization and onboarding record

Collect only the organization name and optional requested slug. Submit:

`POST /api/v1/onboarding`

with the shared request shape and a new idempotency key for that user intent. The API then:

1. Ensures the verified Clerk user has the minimal Drezivo account.
2. Locks the account and onboarding attempt so competing browser tabs cannot start two provider
   operations.
3. Creates the Clerk organization with a private Drezivo onboarding marker.
4. Persists the resumable local onboarding record and returns a safe projection.

The response includes an opaque `clerk_org_id`. Activate that organization through the Clerk
frontend SDK (`setActive`) so subsequent requests carry the intended active organization. The
frontend must not use a provider-generated organization ID from any other source or select an
organization the API did not return.

If the request times out or reports an in-progress/provider-uncertain state, call
`GET /api/v1/onboarding/current` and retry the original command with the same idempotency key only
when the UI is still completing that same intent. Do not issue a second Clerk organization create.

### 4. Select a plan before bootstrap

The business flow is: choose Starter, Professional, or Business, then bootstrap the tenant. Plan
limits are authoritative in the backend: 125/300/1,000 active physical assets and 0/2/10 Front
Desk seats. The browser does not send prices or limits.

The pre-tenant plan-selection command is `POST /api/v1/onboarding/:onboardingId/plan` with the
strict body `{ "plan_code": "starter" | "professional" | "business" }` and a mandatory
`Idempotency-Key`. The command is account-scoped, validates the shared contract at the HTTP
boundary, persists only the selected plan code, and is registered in OpenAPI. Do not call
`POST /api/v1/subscription/plan` for this step; that route requires an existing tenant and is only
for a trial subscription after bootstrap.

The intended semantics are already defined:

- A lifetime-trial-eligible account remains `incomplete` after choosing a plan.
- An account that has consumed its lifetime trial becomes `payment_pending`.
- Plan selection alone creates no tenant, membership, subscription, or trial.

### 5. Bootstrap the complete tenant graph

Once the onboarding projection contains the selected plan and is still eligible, call:

`POST /api/v1/onboarding/:onboardingId/bootstrap`

with the strict body `{}` and a mandatory idempotency key.

The API checks the active Clerk organization against the saved `clerk_org_id`, then atomically:

- creates the tenant linked to that Clerk organization;
- creates the `Main Branch` in `Asia/Manila`;
- creates the active Owner membership and full Owner branch grant;
- creates the draft storefront;
- creates the fourteen-day trial subscription and immutable trial event;
- marks the account's trial/owned-tenant state;
- marks onboarding `provisioned`;
- writes the required audit and outbox records.

The response is the safe `tenantBootstrapResponse` projection: tenant, default branch, Owner
membership, branch grants, and subscription summary. No Clerk secret, invitation material, or
account profile data is returned.

An exact retry returns the original safe response. Abandoned, payment-pending, already-provisioned,
trial-consumed, or organization-mismatched onboarding does not create a partial graph.

### 6. Activate and load the workspace

After bootstrap, activate the returned Clerk organization again if the Clerk session changed, then
call:

1. `GET /api/v1/workspaces` to discover the tenant workspaces available to this user.
2. `GET /api/v1/actor-context` to load the active workspace projection.

The actor context is the frontend's initial authorization/state payload. It includes the local
tenant, active membership, authorized branches and grants, subscription/lifecycle state, and
numeric entitlements. Use it to render navigation and feature gates, but remember that every
mutation is authorized again by the API.

If the user switches organizations in Clerk, clear stale branch and tenant UI state and request a
new actor context. A branch selector may select only a branch already present in the returned
authorized branch list; it cannot grant itself access by sending a branch ID.

### 7. Optional Front Desk invitation and claim

Once the Owner workspace is active, the optional staff flow is:

1. Owner creates an invitation through the local invitation route. TBF-040 encrypts and digests the
   recipient locally, reserves a seat, and writes a safe outbox intent.
2. TBF-041 dispatches the intent to Clerk with a private correlation marker and retries safely.
3. The recipient signs in with Clerk, joins/accepts the invitation, and calls the claim endpoint
   with `{}` plus an idempotency key.
4. TBF-042 verifies the active organization, accepted provider invitation, exact marker/version,
   provider role, and local capacity before creating/restoring the local Front Desk membership and
   default branch grant.
5. The recipient calls `/workspaces` and `/actor-context` just like the Owner.

An organization-membership webhook by itself never grants Drezivo access. TBF-043 is still needed
for local-first removal and approved Owner transfer.

## State-to-screen and failure handling

| Backend state or result | Frontend action |
| --- | --- |
| No Clerk session | Show Clerk sign-in/sign-up |
| Primary email unverified | Keep the verification UI; retry after verification |
| No onboarding, no owned tenant | Show create organization |
| Incomplete onboarding | Resume saved setup; complete plan selection when its command exists |
| Provider operation in progress/unknown | Poll current state and retry the same idempotency key; never create a second organization |
| Payment-pending onboarding | Show payment/operator handoff; do not call bootstrap |
| Provisioned onboarding/current owned tenant | Discover workspaces and resolve actor context |
| `STALE_CONTEXT`/generic state conflict | Re-fetch onboarding/workspaces/context, then show the resulting state rather than guessing |
| Rate limit or transient provider failure | Back off and retry the same idempotency key where the command is idempotent |
| Foreign, expired, revoked, or consumed invitation | Show the generic safe failure; do not reveal which condition occurred |

The API's generic errors are intentional anti-enumeration behavior. The UI should present a useful
next action without trying to distinguish another person's tenant or invitation state.

## What is the last API in the owner journey?

`POST /api/v1/onboarding/:onboardingId/bootstrap` is the final provisioning command. It is the
last API that turns pre-tenant onboarding into a tenant graph.

After it succeeds, the normal workspace load is:

`GET /api/v1/workspaces` → Clerk `setActive` (if needed) → `GET /api/v1/actor-context`.

`GET /api/v1/actor-context` is therefore the last API in the initial sign-up/onboarding handoff
to the operational frontend. Later, the Owner may call `POST /api/v1/subscription/plan` to change
the trial plan, subject to capacity and lifecycle rules. That subscription command is not a
pre-tenant onboarding API.

## Frontend boundaries to keep explicit

- Do not create a Drezivo account separately from owner onboarding.
- Do not call Clerk's backend API or use Clerk private metadata from browser code.
- Do not trust a browser-supplied organization or tenant ID as authorization.
- Do not bootstrap until a selected plan is persisted by the backend.
- Do not infer local access from a Clerk organization membership or webhook.
- Do not store or display recipient email ciphertext, digest, provider metadata, invitation tokens,
  provider IDs, or raw webhook payloads.
- Do not hard-code plan prices, asset limits, or seat limits in a way that becomes authority.
- Do not retry a timed-out provider operation with a new idempotency key.

## Backend follow-up before frontend wiring is complete

The core owner path is implemented through account creation, Clerk organization creation,
resumable onboarding, pre-tenant plan selection, tenant bootstrap, workspace discovery, and actor
context. The plan-selection command is now exposed and documented; remaining work below is focused
on later membership, operator, reconciliation, and launch-readiness gates.

The remaining backend work does not block building the owner sign-up shell, but it does affect
production completion:

- TBF-040 through TBF-042 need disposable-PostgreSQL concurrency/RLS/provider-ordering evidence.
- TBF-043 owns membership removal and Owner transfer.
- TBF-050 through TBF-053 own operator payment, recovery, and closure.
- TBF-060 through TBF-062 own reconciliation, adversarial integration/security evidence, and final
  operating documentation.

## Checklist mapping

| Frontend concern | Backend boundary |
| --- | --- |
| Verified Clerk identity | TBF-020, TBF-021 |
| Account and resumable owner setup | TBF-010 through TBF-012, TBF-021 |
| Clerk event safety | TBF-020, TBF-022 |
| Tenant creation and initial trial | TBF-030 |
| Workspace/branch/permission context | TBF-031 |
| Authoritative plan limits | TBF-032 |
| Trial expiry and restricted actions | TBF-033 |
| Owner invitations | TBF-040, TBF-041 |
| Verified Front Desk claim | TBF-042 |
| Membership removal/transfer | TBF-043 (planned) |
| Payment/recovery/closure | TBF-050 through TBF-053 (planned) |
| Reconciliation and launch evidence | TBF-060 through TBF-062 (planned) |

Related: [[00-Home/Drezivo Home]], [[02-Architecture/Tenancy Checklist - What Why How]],
[[02-Architecture/Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation]],
[[02-Architecture/API Module Boundaries and Layering]]
