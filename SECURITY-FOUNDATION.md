# Drezivo Security Foundation

**Status:** design baseline for security review
**Owner:** [INSERT LEGAL ENTITY NAME] and the security owner
**Applies to:** `contracts`, `api`, `app`, `web`, documentation, CI, hosting, and the Drezivo second brain
**Last reviewed:** [INSERT DATE]

This document records the controls to design before production. It is a security baseline, not a
claim that the current scaffold is secure or certified. The implementation owner must turn each
control into code, provider settings, tests, alerts, and an operating procedure.

## 1. Security goals and boundaries

Drezivo is a multi-tenant rental operations service. The primary security goals are:

1. A user can read or change only the tenant, branch, and records that the server authorizes.
2. A stolen browser token has a short useful life and can be revoked quickly.
3. Duplicate requests cannot create duplicate reservations, charges, refunds, or side effects.
4. Sensitive information is minimized, encrypted in transit and at rest, and absent from logs.
5. Security events are detected, investigated, contained, and recovered with an evidence trail.
6. A control fails closed when identity, tenant scope, state, or validation is unknown.

This baseline does not promise that every attack can be prevented. It reduces exposure and defines
what the team must monitor and rehearse.

## 2. Threat model

| Threat | Example | Required response |
| --- | --- | --- |
| Credential attack | Password spray, credential stuffing, phishing | Clerk MFA, breached-password checks, rate limits, step-up verification, generic errors |
| Session theft | Malicious browser extension, XSS, leaked token | Short-lived Clerk tokens, secure cookies, CSP, token revocation, reauthentication |
| Tenant escape | A request changes another business's reservation | Server-side tenant and branch authorization, scoped queries, negative tests, audit event |
| Replay and double submit | Two reservation or refund requests arrive together | Idempotency key stored with the result, unique constraints, winning transaction only |
| Bot and scraping abuse | Login floods, catalogue scraping, checkout probing | Edge rate limits, bot challenge, per-route quotas, anomaly scoring, cost limits |
| Data exposure | Logs contain tokens, IDs, payment evidence, or private files | Structured redaction, access controls, short retention, S3 private objects, signed URLs |
| Supply-chain compromise | Malicious dependency or CI action | Lockfiles, dependency review, pinned actions, least-privilege tokens, provenance checks |
| Availability attack | Layer 7 flood or expensive search | CDN/WAF, bounded queries, request budgets, queue backpressure, autoscaling limits |
| Insider misuse | Staff exports customer data without a business need | Least privilege, approval for exports, immutable audit events, access review |
| Account takeover | New device or distant IP at an unusual hour | Risk signal, step-up MFA, session review, alert, revoke when confirmed |

## 3. Identity and session policy

Clerk is the identity provider. The API must verify the Clerk token at the request boundary and
must resolve a Drezivo actor, tenant, branch, and role from server-side records. A Clerk user ID
never grants tenant access by itself.

### 3.1 Clerk settings to configure

- Enable multi-factor authentication (MFA) for owners, administrators, finance roles, and support
  staff. Offer it to every user and require it for sensitive actions.
- Set an inactivity timeout and a maximum session lifetime in the Clerk Dashboard. Suggested first
  values are 30 minutes inactive and 12 hours maximum for staff. Reassess after real usage data.
- Keep the provider's short-lived session-token model. Do not put long-lived access tokens in
  browser storage or invent a second browser refresh flow around Clerk.
- Revoke all sessions after a confirmed account takeover, credential reset, role downgrade, or
  tenant removal. Require fresh authentication for exports, payout changes, role changes, and
  destructive actions.
- Keep claims small. Treat custom claims as cached hints, not the source of current authorization.
  The API reads current membership and role state from its database.

### 3.2 If a custom refresh flow is ever required

Use this only for a separate trusted service or a future native client. Store a cryptographically
random, opaque refresh token in a secure, `HttpOnly`, `SameSite` cookie. Store only a hash of the
token in the database. Rotate it on every successful use. A reused old token is a replay signal:
revoke the entire token family, all sessions for that device, and require sign-in again. Bind a
family to a device record without treating a fingerprint as proof of identity. Use a short access
token lifetime, an idle timeout, an absolute lifetime, and an explicit server-side revocation
record. Never accept a refresh token in a URL, log line, analytics event, or client-side storage.

## 4. Risk signals, location, and time

Risk scoring is a decision aid. IP geolocation is approximate and can be wrong for mobile networks,
VPNs, proxies, corporate gateways, and travellers. Do not automatically deny a legitimate customer
only because an IP appears outside the Philippines. Use high-confidence signals together and give a
user a safe recovery path.

Record the minimum needed: normalized IP or a keyed hash where full IP is not required, country and
region result, autonomous system or proxy flag, device/session ID, user ID, tenant ID, event time,
and the reason for the decision. Publish this processing in the Privacy Policy and set a retention
period in the approved schedule.

Suggested first policy, subject to a privacy impact assessment and calibration:

- Store every tenant's canonical IANA time zone, such as `Asia/Manila`, and store event timestamps
  in UTC. Convert to local time only for display and risk rules.
- Treat a new country, impossible travel, a hosting-provider or known-abuse network, repeated failed
  sign-ins, a new device, or a sudden privilege change as risk signals.
- Treat an unusual local hour as a weak signal. For example, a staff sign-in between 00:00 and
  05:00 in the tenant's time zone can request MFA or an alert. It must not be a sole blocking rule.
- Use progressive action: log, add friction, require MFA, restrict high-risk actions, then revoke
  and investigate. Do not silently delete data or lock out the only business owner.
- Let a tenant administrator review active sessions, revoke one device, revoke all devices, and
  report a false positive. Alert the tenant owner for high-confidence events without exposing a
  full IP address in ordinary email.

Example score bands for a first implementation:

| Score | Action |
| --- | --- |
| 0 to 29 | Allow and record a low-detail audit event |
| 30 to 59 | Allow ordinary reads, require MFA for sensitive writes, notify security telemetry |
| 60 to 79 | Require reauthentication and temporarily limit exports, role changes, and payment settings |
| 80 to 100 | Deny the high-risk operation, revoke the affected session when confidence is high, open an incident |

Review false positives weekly during launch. Keep the rule version in each decision so an
investigator can explain why an action was taken.

## 5. API and browser controls

- Validate every body, path, query, header, webhook, and file metadata value with a schema at the
  boundary. Unknown enum values and routes are rejected.
- Apply authorization after authentication and before every tenant-owned read or write. Check both
  tenant and branch scope. Add tests for cross-tenant and cross-branch IDs.
- Require an idempotency key for every mutating endpoint. Generate it once per user intent, persist
  the request fingerprint and response, and return the same result for retries. Reject a reused key
  with a different request body.
- Use parameterized queries, bounded pagination, maximum request and upload sizes, and query time
  limits. Never trust client-sent prices, totals, roles, inventory, or timestamps.
- Configure an allowlist CORS policy, CSRF protection for cookie-authenticated mutations, secure
  and `HttpOnly` cookies, `SameSite=Lax` or `Strict` where the flow permits, and a strict Content
  Security Policy (CSP) after testing all required scripts.
- Add HSTS, `X-Content-Type-Options: nosniff`, a frame-ancestors policy, a safe referrer policy,
  and cache rules that never cache private tenant responses.
- Rate-limit by route, account, IP prefix, and tenant. Use a distributed store so multiple API
  instances share limits. Return generic authentication errors and avoid account enumeration.
- Verify webhooks with the provider's signature over the exact raw request bytes, reject stale
  timestamps, and make handlers idempotent. Never trust a browser redirect as payment proof.
- Keep S3 buckets private. Give objects short-lived, least-privilege signed URLs and validate the
  tenant and object owner before issuing one. Scan uploads and reject executable content.

## 6. Data, database, and tenant isolation

- Use a separate database role for migrations and runtime reads/writes. Runtime credentials cannot
  create extensions, alter schemas, or drop tables.
- Enforce tenant scope in repository functions and, where practical, PostgreSQL row-level security
  (RLS) as a second barrier. RLS is not a substitute for application authorization tests.
- Encrypt Neon connections with TLS. Restrict network access to the API and migration runner. Keep
  backups encrypted, tested, and subject to the same retention and deletion policy.
- Hash passwords or secrets only with an approved password or secret hashing algorithm. Never store
  raw refresh tokens, payment card data, or government IDs unless an approved requirement exists.
- Classify fields as public, internal, personal, sensitive, or secret. Redact personal and secret
  values in logs, traces, error reports, and analytics. Use stable opaque IDs in operational logs.
- Keep an append-only audit record for sign-in, authorization changes, exports, payment evidence,
  reservation state changes, file access, risk decisions, and administrator actions. The event must
  include actor, tenant, target, action, outcome, request ID, and UTC time.

## 7. Bot defense and abuse operations

Put a managed CDN and web application firewall (WAF) in front of public web and API traffic. Start
with managed rules, request size limits, route quotas, and a challenge only after a suspicious
threshold. Do not rely on user-agent strings. Protect expensive availability searches, sign-in,
password recovery, file upload, and guest checkout separately.

Use queues for email, scans, exports, and other crash-surviving side effects. Each job needs a lease,
bounded retries, backoff, a dead-letter state, and an operator replay procedure. Set per-tenant
quotas so one customer cannot consume shared capacity.

## 8. Detection and response

Centralize structured security logs with synchronized UTC time, a request ID, severity, and a
redaction test. Alert on credential attacks, impossible travel, repeated refresh-token reuse,
privilege changes, cross-tenant authorization failures, unusual exports, webhook failures, queue
backlog, error-rate spikes, database saturation, and repeated WAF blocks.

Define these response stages:

1. **Triage:** assign an incident owner, preserve relevant logs, identify affected tenants and data,
   and record the first known time.
2. **Contain:** revoke sessions or keys, disable the affected integration, block abusive traffic,
   and preserve evidence before cleanup.
3. **Eradicate and recover:** patch the cause, rotate secrets, restore from a tested backup if needed,
   replay safe outbox jobs, and verify tenant isolation.
4. **Notify and learn:** follow contractual and Philippine notification duties, including the
   National Privacy Commission breach process where the threshold applies. Document the timeline,
   decisions, customer communication, and corrective action.

Run tabletop exercises at least twice a year and after material architecture changes. Test backup
restore, session revocation, tenant isolation, webhook replay, and loss of a provider.

## 9. Suggested configuration names

These are review starting points, not production values. Put actual secrets in the deployment
secret manager. Commit only the names and safe defaults in an example file.

```dotenv
# Runtime and time
APP_ENV=production
DEFAULT_TIME_ZONE=Asia/Manila
EVENT_TIME_STORAGE=UTC

# Clerk and sessions
CLERK_JWT_ISSUER=https://[INSERT-CLERK-FAPI-DOMAIN]
CLERK_JWT_AUDIENCE=[INSERT-API-AUDIENCE]
STAFF_SESSION_IDLE_MINUTES=30
STAFF_SESSION_MAX_HOURS=12
REAUTH_SENSITIVE_ACTION_MINUTES=10
CUSTOM_REFRESH_ENABLED=false
CUSTOM_ACCESS_TOKEN_MINUTES=10
CUSTOM_REFRESH_IDLE_DAYS=7
CUSTOM_REFRESH_ABSOLUTE_DAYS=30
CUSTOM_REFRESH_ROTATE=true
CUSTOM_REFRESH_REUSE_REVOKES_FAMILY=true

# Origin and request protection
WEB_ORIGIN=https://[INSERT-WEB-DOMAIN]
APP_ORIGIN=https://[INSERT-APP-DOMAIN]
API_ORIGIN=https://[INSERT-API-DOMAIN]
CORS_ALLOWED_ORIGINS=[INSERT-COMMA-SEPARATED-ORIGINS]
CSRF_PROTECTION_ENABLED=true
MAX_JSON_BYTES=1048576
MAX_UPLOAD_BYTES=10485760

# Rate limits and risk signals
RATE_LIMIT_STORE_URL=[SECRET-MANAGER-REFERENCE]
LOGIN_RATE_LIMIT_PER_IP=20/15m
LOGIN_RATE_LIMIT_PER_ACCOUNT=8/15m
PUBLIC_READ_RATE_LIMIT=120/1m
MUTATION_RATE_LIMIT=30/1m
GEO_RISK_MODE=signal_then_step_up
GEO_ALLOWED_COUNTRIES=PH
GEO_PROVIDER=[INSERT-APPROVED-PROVIDER]
RISK_SCORE_MFA_THRESHOLD=30
RISK_SCORE_RESTRICT_THRESHOLD=60
RISK_SCORE_BLOCK_THRESHOLD=80
UNUSUAL_LOCAL_HOUR_START=00:00
UNUSUAL_LOCAL_HOUR_END=05:00

# Storage and database
DATABASE_URL=[SECRET-MANAGER-REFERENCE]
S3_BUCKET=[INSERT-PRIVATE-BUCKET]
S3_REGION=[INSERT-REGION]
SIGNED_URL_TTL_SECONDS=300
UPLOAD_MALWARE_SCAN_REQUIRED=true

# Audit, telemetry, and recovery
AUDIT_LOG_RETENTION_DAYS=[INSERT-APPROVED-PERIOD]
SECURITY_EVENT_RETENTION_DAYS=[INSERT-APPROVED-PERIOD]
LOG_REDACTION_ENABLED=true
SENTRY_DSN=[SECRET-MANAGER-REFERENCE]
ALERT_WEBHOOK_URL=[SECRET-MANAGER-REFERENCE]
BACKUP_RPO_MINUTES=[INSERT-TARGET]
BACKUP_RTO_MINUTES=[INSERT-TARGET]
```

Do not copy these values into `.env`, a ticket, a pull request, or the Obsidian vault. The root and
repository `no-tracked-env` rules remain mandatory.

## 10. Delivery gates

Before a production launch, the owning team must provide evidence for:

- cross-tenant and cross-branch authorization tests, including concurrent double-submit tests;
- Clerk MFA, session timeout, revocation, and recovery settings;
- dependency, secret, container, and infrastructure scans with reviewed findings;
- WAF and rate-limit rules exercised against a staging load test;
- S3 private access and upload scanning tests;
- backup restore and disaster-recovery rehearsal with measured RPO and RTO (recovery point and
  recovery time objectives);
- an approved data inventory, privacy impact assessment, retention schedule, processor register,
  and incident notification runbook; and
- an owner and on-call route for every alert.

## References

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [NIST SP 800-63B-4 session management](https://pages.nist.gov/800-63-4/sp800-63b/session/)
- [Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens)
- [Clerk session options](https://clerk.com/docs/guides/secure/session-options)
- [Philippine Data Privacy Act, National Privacy Commission](https://privacy.gov.ph/data-privacy-act/)
- [NPC breach reporting guidance](https://privacy.gov.ph/pips-and-pics/breach-reporting/)
