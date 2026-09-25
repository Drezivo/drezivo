---
title: API Security Review 2026-09-23
type: security-review
status: remediation-open
owner: Drezivo platform team
source: "Read-only review of api/ at commit 1f3b34159be72c84228cced5327b93bd67ca5141, including the reservation phase-3 working tree"
updated: 2026-09-23
tags: [drezivo, security, api, backend, remediation]
---

# API Security Review 2026-09-23

> [!danger] Outcome
> The API is not ready for a production-security certification. The review found three high-severity
> issues and several medium/low hardening gaps. This is a source-level review, not proof of deployed
> production controls.

## Review snapshot

- Repository: `api/`
- Branch: `feat/reservation-phase3-review`
- Commit: `1f3b34159be72c84228cced5327b93bd67ca5141`
- Scope: tracked API source/configuration, dependency lockfiles, migrations, routes, webhooks,
  workers, storage, CI, and the dirty reservation phase-3 work present during the review
- Review mode: read-only; no source, configuration, database, or environment changes
- Route coverage: 53 explicit HTTP route declarations plus registered workers and sweeps

Related: [[00-Home/Drezivo Home]], [[02-Architecture/API Module Boundaries and Layering]],
[[02-Architecture/Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation]],
[[05-Operations/Reservations Checklist]]

## High-severity findings

### SEC-API-001 — Clerk access-removal events are discarded

**Evidence:** [`clerk-webhook-reconciler.ts`](../../../api/src/worker/handlers/clerk-webhook-reconciler.ts)
marks every event except `organization_invitation.accepted` as processed. Supported inbox events
include organization deletion and membership update/deletion.

**Attack path:** a user removed from a Clerk organization retains an otherwise valid Clerk session.
Because the deletion/update webhook is acknowledged without changing the local membership, tenant
authorization can continue to resolve the stale local membership as active.

**Impact:** removed or downgraded users may retain tenant access until another local control changes
their membership or the provider session expires.

**Remediation:**

- [ ] Implement event-specific reconciliation for organization deletion and membership update/deletion.
- [ ] Suspend or remove the local membership and grants in the same transaction as audit recording.
- [ ] Restrict the mapped tenant when its Clerk organization is deleted.
- [ ] Mark an inbox event processed only after the local transaction commits.
- [ ] Leave unknown/unimplemented event types retryable or dead-lettered instead of processed.
- [ ] Add signed-webhook tests for deletion, downgrade, duplicate, stale, and out-of-order delivery.

### SEC-API-002 — Required local session lifecycle controls are absent

**Evidence:** [`auth.ts`](../../../api/src/middleware/auth.ts) uses `clerkMiddleware()` and protected
routes require a Clerk user ID, but the reviewed source contains no local session registry, idle or
absolute expiry, logout revocation, step-up age, or concurrent-session cap.

**Attack path:** a stolen, administratively revoked, or over-age provider session continues to reach
protected routes when its provider token remains cryptographically valid and local membership is active.

**Impact:** compromised sessions lack the server-side containment required by the security foundation.

**Remediation:**

- [ ] Add a local registry keyed to the Clerk session and user/device context.
- [ ] Enforce user status, revocation, idle expiry, and absolute expiry on every protected request.
- [ ] Revoke the local session on logout and security-sensitive account changes.
- [ ] Enforce the configured per-user concurrent-session cap under serialization.
- [ ] Require recent reauthentication for sensitive administrative and financial operations.
- [ ] Test revoked, expired, downgraded, concurrent, and stolen-session scenarios.

### SEC-API-003 — High-severity Drizzle ORM advisory

**Evidence:** [`api/package.json`](../../../api/package.json) resolves `drizzle-orm` 0.44.7. The
production dependency audit reported [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9),
an SQL-injection advisory involving improperly escaped SQL identifiers, fixed in 0.45.2 and later.

No attacker-controlled SQL identifier path was found in the reviewed application: dynamic values use
bind parameters, and sort clauses are selected from closed switches. The vulnerable package is present,
but reachable exploitation was not demonstrated.

**Remediation:**

- [ ] Upgrade `drizzle-orm` to 0.45.2 or a later compatible release.
- [ ] Run migration, query-generation, typecheck, unit, and PostgreSQL integration suites.
- [ ] Add a production dependency-audit gate to CI.

## Medium-severity findings

### SEC-API-004 — Clerk audience and authorized-party checks are not pinned

[`auth.ts`](../../../api/src/middleware/auth.ts) calls `clerkMiddleware()` without `audience` or
`authorizedParties`, and [`config/index.ts`](../../../api/src/config/index.ts) has no corresponding
validated settings.

- [ ] Configure the expected JWT audience and allowed frontend origins/authorized parties.
- [ ] Add negative tests for tokens issued to another application or party.

### SEC-API-005 — Uploaded files bypass malware scanning

[`files.service.ts`](../../../api/src/modules/files/files.service.ts) verifies size, content type,
checksum, and the first 16 bytes before [`files.repository.ts`](../../../api/src/modules/files/files.repository.ts)
sets the file to `accepted`. The existing `scanning` state is not used.

- [ ] Quarantine uploaded objects and transition them to `scanning`.
- [ ] Scan and fully decode/re-encode supported images before acceptance.
- [ ] Allow only the scanner to transition `scanning` to `accepted` or `rejected`.
- [ ] Block application reads until acceptance and test malicious, malformed, and polyglot fixtures.

### SEC-API-006 — Rate limits are instance-local and proxy identity is undefined

[`rate-limit.ts`](../../../api/src/middleware/rate-limit.ts) uses a process-local `Map`. The app does
not set an explicit trusted proxy hop/CIDR policy, while several keys fall back to `req.ip`.

- [ ] Move rate-limit state to a bounded shared store.
- [ ] Configure and test the exact trusted proxy topology.
- [ ] Normalize client IPs and combine IP, account, tenant, and route keys where appropriate.
- [ ] Verify limits across multiple API replicas and spoofed forwarding headers.

### SEC-API-007 — Boolean environment values are parsed incorrectly

[`config/index.ts`](../../../api/src/config/index.ts) uses `z.coerce.boolean()` for
`WORKER_ENABLED` and `S3_FORCE_PATH_STYLE`. JavaScript treats both the strings `"false"` and `"0"`
as truthy, so an intended disabled worker can start processing durable work.

- [ ] Replace coercion with an explicit parser for accepted true/false spellings.
- [ ] Reject unknown values and add configuration unit tests.

### SEC-API-008 — Security and private-cache headers are missing

[`app.ts`](../../../api/src/app.ts) configures an exact CORS allowlist but does not centrally set
HSTS, `X-Content-Type-Options`, framing restrictions, referrer/permissions policy, or `no-store`
for authenticated tenant responses.

- [ ] Add centralized security-header middleware, accounting for headers already set by the edge.
- [ ] Add explicit private/no-store cache policy for authenticated and sensitive responses.
- [ ] Test headers on success, validation failure, authentication failure, and preflight responses.

### SEC-API-009 — Worker exception text is persisted and logged as safe

[`worker/runner.ts`](../../../api/src/worker/runner.ts) assigns raw `error.message` to
`safe_last_error` and logs it. Provider and database exception messages can contain recipient,
object, or query details.

- [ ] Map failures to allowlisted error codes and sanitized summaries.
- [ ] Apply structured redaction before logs or dead-letter persistence.
- [ ] Test representative provider, database, and malformed-payload exceptions.

## Lower-severity hardening

### SEC-API-010 — Storage requests have no timeout

[`s3-object-storage.ts`](../../../api/src/integrations/storage/s3-object-storage.ts) calls `fetch`
without an abort deadline. Add bounded timeouts, safe retries, and dependency-unavailable mapping.

### SEC-API-011 — Production transport security is not validated in configuration

[`config/index.ts`](../../../api/src/config/index.ts) accepts database and S3 URLs without a
production-only TLS requirement. Require PostgreSQL TLS and HTTPS object-storage endpoints in
production, with explicit local-test exceptions.

### SEC-API-012 — CI supply-chain coverage is incomplete

[`ci.yml`](../../../.github/workflows/ci.yml) runs a pinned secret scanner and SHA-pinned actions,
but it has no dependency/container vulnerability gate. [`api/Dockerfile`](../../../api/Dockerfile)
uses a mutable Node image tag. [`.github/dependabot.yml`](../../../.github/dependabot.yml) ignores
all semver-major upgrades, which can suppress security upgrades for pre-1.0 packages.

- [ ] Add production dependency and container-image vulnerability gates.
- [ ] Pin the runtime base image by digest and generate an SBOM/provenance record.
- [ ] Permit security upgrades across semver-major boundaries or add package-specific exceptions.

## Reservation phase-3 assessment

The in-progress reservation review flow applies staff authentication, tenant context, lifecycle
policy, strict validation, idempotency keys, and multi-permission checks. The persistence flow uses
tenant/branch predicates, row locks, database time, optimistic versions, savepoints, immutable
audit records, and durable outbox events. Prices and payment intent amounts are server-derived.

No dedicated phase-3 submit/confirm/reject integration tests were present in the reviewed snapshot.
The existing PostgreSQL integration suite could not be run locally, so RLS, concurrent transitions,
failure rollback, and replay behavior remain unproven for this phase.

- [ ] Add submit/confirm/reject integration tests for RLS and cross-tenant/cross-branch access.
- [ ] Race confirmation, rejection, expiry, and duplicate idempotency submissions.
- [ ] Inject failures after each mutation and prove savepoint rollback plus safe idempotency results.
- [ ] Verify non-cash confirmation requires the latest accepted immutable receipt and authoritative
  merchant verification.

## Verification evidence

| Check | Result |
|---|---|
| Typecheck | Passed |
| Build | Passed |
| Unit tests | 82/82 passed across 20 files |
| Lint | Failed on three missing explicit return types in the new reservation review code |
| Production dependency audit | One high-severity advisory |
| Full dependency audit | One high and four moderate advisories; moderates are development tooling |
| Tracked credential scan | No credential, private-key, or tracked environment-file material found |
| Diff whitespace validation | Passed |
| PostgreSQL integration tests | Not run: `TEST_DATABASE_URL` unset and Docker access unavailable |

Lint locations at review time:

- [`reservations.review.service.ts`](../../../api/src/modules/reservations/reservations.review.service.ts)
  lines 533 and 547
- [`reservations.service.ts`](../../../api/src/modules/reservations/reservations.service.ts) line 321

## Verified positive controls

- Exact CORS allowlist; wildcard, credential, and path-bearing origins are rejected.
- Clerk webhook signature verification uses the exact raw body and durable inbox deduplication.
- Protected staff routes consistently derive tenant/branch authority server-side.
- Active reservation writes use server recomputation, database locks/constraints, idempotency,
  audit records, and outbox events.
- RLS is enabled and forced for tenant-owned tables, with restricted application/worker roles in migrations.
- S3 upload authorization binds content type and checksum to tenant-scoped private keys.
- Invitation recipient email uses keyed lookup digests and AES-256-GCM encrypted storage.
- Client errors are generic and the HTTP request logger does not serialize headers or bodies.
- CI actions are SHA-pinned; the container installs with scripts disabled and runs as a non-root user.

## Coverage and limitations

This review did not verify Clerk dashboards, deployed environment variables, live secrets, actual
database roles/TLS, S3 bucket policies, cloud IAM, WAF/CDN behavior, runtime log access, backups,
or incident-response configuration. Gitleaks, Semgrep, Trivy, and similar standalone scanners were
not installed locally; CI's pinned Gitleaks configuration and a tracked-file pattern scan were reviewed.

The working tree changed concurrently during the review. Verification was repeated against the final
observed phase-3 snapshot, but later edits require a fresh recheck.

## Recheck procedure

- [ ] Resolve all high-severity findings before production release.
- [ ] Record remediation commits beside each `SEC-API-*` item.
- [ ] Set `TEST_DATABASE_URL` to an isolated disposable database and run the full integration suite.
- [ ] Run typecheck, lint, unit tests, build, production/full dependency audits, secret scanning,
  static analysis, and container scanning from a clean working tree.
- [ ] Exercise Clerk revocation/deletion, token audience, multi-replica rate-limit, upload malware,
  reservation concurrency, and idempotency adversarial tests.
- [ ] Review deployed Clerk, database, storage, IAM, WAF/CDN, and logging controls separately.
- [ ] Change this note's status to `remediated-pending-recheck` only after evidence is linked.
- [ ] Change the status to `closed` only after an independent recheck confirms the fixes.

## Review history

### 2026-09-23 — Initial read-only review

Recorded the source-level findings, current reservation phase-3 assessment, locally executed checks,
and controls that could not be proven without provider or deployed-infrastructure access.
