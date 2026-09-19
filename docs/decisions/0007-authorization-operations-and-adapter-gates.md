# 0007. Authorization resolution, operational commands, and adapter gates

**Status:** accepted design decisions with implementation gaps
**Date:** 19 September 2026
**Owners:** API and operations owners; product/security review required before launch

## Context

The repository now contains a small implemented API surface and a larger documented target
surface. The current API wires owner onboarding (`GET /onboarding/current`, `POST /onboarding`,
and `POST /onboarding/{onboardingId}/abandon`) and the signed Clerk webhook inbox. Public
storefront reads and reservation holds are deliberately explicit `501 NOT_IMPLEMENTED` responses.
The scaffold is evidence of route shape and failure behavior only; it is not evidence of a working
booking system, provider recovery, tenant isolation in production, or launch readiness.

This record makes the choices that must remain stable while those modules are implemented and keeps
unknowns visible. It supplements the TRD and data model; it does not replace their route contracts.

## Decisions

### 1. Authorization is resolved server-side for every request

Clerk proves identity only. The API resolves the account or membership, tenant, branch grants,
permission codes, subscription restrictions, and any recent-auth requirement from current server
state. Client-selected organization, tenant, branch, role, price, or status is advisory input and
is rejected or ignored at the boundary. A missing, stale, ambiguous, or unsupported authorization
record fails closed with the stable error envelope.

Authorization must be applied before reading or mutating tenant-owned records. Repositories accept
the resolved scope as an explicit argument and must not offer an unscoped tenant query to callers.
The `api` workspace owns this resolution and the business transaction; `contracts` owns only the
wire schema and error vocabulary; `app` and `web` render the result.

### 2. Support activity uses explicit, narrow grants

An operator is not a tenant member by default. A `support_grant` is time-bound, tenant-scoped,
reason-coded, permission-specific, and revocable. Private evidence and exports require separate
capabilities. There is no universal impersonation or bypass role. Grant issuance, use, denial,
expiry, and revocation produce append-only audit metadata with actor, tenant, target, action,
outcome, request ID, and UTC time. Emergency access requires a recorded incident/reason and
post-event review.

### 3. Retry commands are safe operational commands, never blind replays

Only authorized operators may request a retry or replay. A retry command names one durable job or
provider event, records the reason and actor, checks that the target is in a retryable state, and
creates a new idempotent attempt linked to the original. Dead-letter jobs remain terminal until an
operator explicitly requeues them. Commands are bounded, rate-limited, and auditable; no command
repeats an uncertain payment/refund transfer without reconciliation against the merchant/provider
reference first.

### 4. Business repository ownership stays in `api`

The `api` service owns domain repositories, transactions, Drizzle mappings, migrations, tenant
scope, and worker handlers. The worker remains a second process entrypoint in that workspace so
business transitions and outbox handling share the same reviewed services. `contracts` never owns
queries or authorization. `app` and `web` never become alternate business repositories.

### 5. Idempotency is layered and intent-scoped

Every mutation requires a key generated once per user intent. The API scopes the key by a server-
derived principal and operation, stores the validated request hash, and replays the original safe
response for an exact repeat. A different payload under the same key is `409`; an in-progress match
returns retry guidance. Permanent business keys, conditional state transitions, and provider event
identifiers remain the protection after the HTTP retry record expires. Domain state, idempotency
outcome, audit event, and required outbox rows commit atomically.

### 6. Audit and outbox are durable transaction records

Security and business actions write redacted append-only audit metadata. Crash-surviving work is an
outbox/job row written in the same transaction as the business change. A worker claims with a
conditional lease, carries tenant context per job, retries with bounded backoff, and ends in
`succeeded` or `dead`. Unknown event types, missing tenant scope, expired/invalid leases, and
unsupported states fail closed and remain observable. External delivery is at-least-once; provider
idempotency or reconciliation is required where duplicate delivery matters.

### 7. Errors fail closed and reveal no foreign state

Unknown routes, enum values, state transitions, identities, tenant scope, and provider signatures
are rejected. Protected foreign objects use concealed `404` behavior where disclosure would reveal
existence. The stable envelope carries a safe `code`, safe `message`, `request_id`, and optional
field errors. Raw SQL, provider payloads, secrets, tokens, payment evidence, and unnecessary PII
never appear in responses or logs. Unimplemented routes use explicit `501 NOT_IMPLEMENTED` until
their transaction and contract are implemented.

### 8. Provider adapters require certification evidence

An adapter is not certified because it compiles or returns a happy-path mock. Before enabling a
provider in a paid pilot, the owning team must demonstrate: exact raw-signature verification where
applicable; replay and duplicate-event handling; timeout and ambiguous-result reconciliation;
provider idempotency behavior; bounded retry and terminal failure; safe redaction; tenant and
authorization checks; sandbox evidence for success, failure, and reversal; and an operator runbook
with alert ownership. Adapter selection, region, quotas, fees, retention, and legal terms remain
open until this evidence is reviewed and recorded.

## Current route contract versus target state

| Surface | Current behavior | Evidence boundary |
| --- | --- | --- |
| Owner onboarding current/create/abandon | Implemented with account-scoped idempotency, audit writes, and Clerk adapter boundary | Requires integration tests, provider reconciliation, and production configuration review |
| Clerk webhook ingest | Raw-body verification, normalized safe inbox projection, duplicate-safe provider identity | Worker processing and reconciliation evidence remain required |
| `GET /public/stores/{slug}` | `501 NOT_IMPLEMENTED` | No storefront data or availability claim exists |
| `GET /public/stores/{slug}/availability` | `501 NOT_IMPLEMENTED` | No capacity guarantee exists |
| `POST /public/stores/{slug}/holds` | `501 NOT_IMPLEMENTED` | No reservation, money, or outbox effect exists |
| `GET /internal/operator/v1/support-activity` and operator commands | Mounted fail-closed boundary; requires injected service authentication, server authorization, tenant-safe service, and validated projections | Route contract, permission checks, subject/tenant binding, idempotency-key format, and safe error mapping are tested; persistence and real service wiring remain gated |

## Gap register and verification gates

| ID | Gap / unknown | Owner | Verification gate before claiming readiness |
| --- | --- | --- | --- |
| G-01 | Exact permission matrix for every staff role, branch grant, subscription restriction, and support capability is incomplete | API + product/security | Route-by-route matrix reviewed; positive and cross-tenant/cross-branch negative tests pass |
| G-02 | Support-grant issuance, use, expiry, revocation, emergency review, and private-evidence capability are not fully wired; the HTTP boundary is present and fail-closed | API + operations | End-to-end grant lifecycle and immutable audit evidence reviewed |
| G-03 | Retry/replay command authorization and wire contract are bounded at the HTTP boundary, but persistence, state eligibility, rate limits, and reconciliation workflow remain unspecified | Operations + API | Runbook exercised against leased, dead, duplicate, and ambiguous provider jobs |
| G-04 | Repository scope enforcement and RLS behavior on a real supported Postgres/Neon configuration are unverified | API + database owner | Pooled-connection reuse, rollback, RLS, and tenant escape tests pass |
| G-05 | Concurrent double-fire coverage for each new mutation is incomplete while routes remain scaffolded | API + contracts | Sequential and `Promise.all` duplicate tests prove one effect and stable replay/409 |
| G-06 | Audit retention, access review, redaction tests, and alert ownership still need approved values | Security + operations | Retention schedule, redaction test, alert route, and incident drill recorded |
| G-07 | Outbox handlers and provider delivery adapters are incomplete; external exactly-once delivery is not promised | API + integrations | Lease/retry/dead-letter/replay tests plus provider sandbox certification evidence |
| G-08 | Hosting region, email sender, observability, payment/subscription providers, quotas, and legal terms remain open | Product + operations | Decision records cite approved providers, limits, contracts, and measured staging results |

## Non-claims

This ADR does not certify production security, payment correctness, availability concurrency,
disaster recovery, provider deliverability, or legal compliance. A passing scaffold build or route
test is insufficient. The gates above and the TRD release/security evidence must be complete before
the system is described as ready for paid traffic.

## References

- [Technical Requirements Document](../architecture/Drezivo-TRD.md)
- [Logical data model](../architecture/Drezivo-Data-Model.md)
- [API response envelope](../architecture/2026-09-16-api-response-envelope.md)
- [Worker ownership decision](0004-worker-in-api-repository.md)
- [Monorepo ownership decision](0006-monorepo.md)
- [Security incident runbook](../runbooks/security-incident.md)
