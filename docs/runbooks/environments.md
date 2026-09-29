# Environments

**No `.env` file of any kind is ever committed — not `.env`, not `.env.local`, not
`.env.example`, in the monorepo.** This is enforced by the tracked-`.env` check and by the
`protect-files.sh` hook locally. Planned security automation is described in
[`security-automation.md`](security-automation.md). This document is
where environment variable **names** live instead — in prose, so nobody is tempted to paste a
working value next to the name the way an `.env.example` invites. A missing required variable
must fail the process at startup with a clear message, never silently at the first request that
needs it (`CONTRIBUTING.md` §7).

## Environments

Three environments, each with its own secrets/accounts or projects, least privilege, per TRD
§1:

- **Development** — a developer's own machine, using the loopback-only PostgreSQL and MinIO
  services in [local development](local-development.md), or an isolated non-production Supabase
  project/preview environment. Seed only synthetic data, never a clone of live personal data.
- **Staging** — a persistent pre-production environment that mirrors production configuration
  (same Node LTS, same Supabase PostgreSQL major and connection mode, same region where practical)
  so a migration or a deploy is rehearsed under realistic conditions before it reaches production.
- **Production** — serves real tenants. Separate Clerk project, separate Supabase project, separate
  R2 buckets, separate everything-with-a-credential from staging and development. Nothing in
  production is a "free tier" resource (TRD §1: "Do not use a free-tier suspension/retention
  assumption as a production recovery plan").

DECISION NEEDED: name the specific hosting accounts/projects for each environment (Vercel
team/project per environment, container host project per environment, Supabase project/environment
naming convention) once TRD §12's "remaining selection" of hosting plans/region is made.

## `api` (Express API server + worker, two entrypoints from one image)

- `NODE_ENV` — `development` | `staging` | `production`. Gates verbose logging and
  dev-only conveniences; never gates a security control on its own.
- `PORT` — the port the HTTP server binds. The worker entrypoint does not need this.
- `DATABASE_URL` — the runtime PostgreSQL connection string, or the loopback PostgreSQL URL during
  local Compose development. The API deployment authenticates as `drezivo_app`; the worker
  deployment uses the same variable name but authenticates as `drezivo_worker`. A persistent
  process uses the Supabase direct endpoint when IPv6/direct networking is available, otherwise
  the shared session pooler. A serverless deployment may use transaction pooling only after its
  client behavior and per-instance pool size have been verified. Production URLs require encrypted
  transport through `sslmode=require`, or preferably certificate-backed `verify-full`.
- `DATABASE_URL_DIRECT` — the privileged direct Supabase PostgreSQL connection used first by
  migration, backup, restore, and administrative tooling. It must never be supplied to the API or
  worker runtime. Local Compose uses its direct loopback PostgreSQL endpoint for both variables.
- `TEST_DATABASE_URL` — test-only; the integration suite (`api` `npm run test:integration`)
  connects exclusively through this, never `DATABASE_URL`. The harness refuses any value that is
  not localhost or whose database name does not contain "test", because tests truncate their
  database between cases. Optional `TEST_DATABASE_APP_PASSWORD` overrides the local
  `drezivo_app` role password the harness sets (localhost only) so RLS binds under the real
  runtime role. Never set either in production environments.
- `DATABASE_MIGRATION_ROLE` / the fact that migrations run under a distinct, more privileged
  Postgres role than the application's request-time runtime role — the runtime role itself must
  have no ownership, DDL, `BYPASSRLS`, or blanket administrative grant (TRD §3). Name the actual
  role via the connection string's credentials, not a separate variable that could drift from
  it.

### Supabase database boundary

- Disable the Supabase Data API. Drezivo uses Clerk plus the Express API and does not authorize
  database access with Supabase Auth claims.
- Do not configure Supabase publishable, anonymous, secret, or service-role keys in `app`, `web`,
  or `api`; none is required for the selected PostgreSQL-only integration.
- Provision separate deployment-managed passwords for `drezivo_app` and `drezivo_worker` after
  the migration creates those roles. Reapply them after a restore when the backup does not preserve
  custom-role passwords.
- Copy every hostname and username from the Supabase Connect dialog. Shared-pooler custom-role
  usernames include the project reference and must not be constructed from memory.
- Audit privileges for Supabase's `anon`, `authenticated`, and `service_role` roles before loading
  business data, even when the Data API is disabled.
- `CLERK_SECRET_KEY` — server-side Clerk SDK credential, used to verify JWTs (signature,
  issuer, expiry, audience/authorized-party) per TRD §3.
- `CLERK_WEBHOOK_SIGNING_SECRET` — verifies the signature on Clerk's membership-change webhooks
  before they enter the signed, deduplicated webhook inbox (TRD §3, "Membership freshness").
- `CORS_ALLOWED_ORIGINS` — required comma-separated exact browser origins. Development uses
  `http://localhost:3000`; production must use an explicit deployment-managed allowlist. Wildcards,
  paths, credentials, and empty entries are rejected at startup. Credentialed requests are enabled
  only after an incoming `Origin` exactly matches this list.
- `INVITATION_EMAIL_ENCRYPTION_KEY` — deployment-managed 32-byte base64url key used to encrypt
  tenant invitation recipient email before it is stored. Keep it separate from the digest key.
- `INVITATION_EMAIL_DIGEST_KEY` — deployment-managed 32-byte base64url HMAC key used for exact
  tenant-local pending-recipient dedupe. It is never exposed to clients or logs.
- `OBJECT_STORAGE_ENDPOINT` — required explicit S3-compatible API endpoint. Staging and production
  use the HTTPS account-scoped Cloudflare R2 endpoint; local development uses the loopback MinIO
  endpoint. Staging and production startup reject AWS endpoints and endpoints with a base path.
- `OBJECT_STORAGE_REGION` — `auto` for staging/production R2; a local signing region such as
  `us-east-1` for MinIO.
- `OBJECT_STORAGE_BUCKET_PRIVATE` — required environment-specific private source/evidence bucket.
  Originals remain private and access uses short-lived signed reads (TRD §7, proposed five-minute
  downloads).
- `OBJECT_STORAGE_BUCKET_PUBLIC` — optional until Stage B public catalogue derivatives are
  implemented. Keep public derivatives separate from source/evidence objects.
- `OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY` — deployment-managed
  Cloudflare R2 S3 API credentials, separately provisioned for staging and production and scoped
  to only the required bucket. Local development uses MinIO credentials; developers do not need
  Cloudflare credentials. These values never belong in `app` or `web`.
- `OBJECT_STORAGE_FORCE_PATH_STYLE` — `false` for staging/production R2's virtual-hosted endpoint
  and `true` for local MinIO path-style addressing.
- `OBJECT_STORAGE_UPLOADS_ENABLED` — optional boolean; defaults to `false` in production and
  `true` outside production. Explicitly set it to `true` only after the production R2 readiness and
  reconciliation gates pass. Setting it to `false` stops new upload authorizations while preserving
  finalization and signed reads on the configured provider. Use the migration runbook's
  pre-deployment drain procedure before switching from a legacy production release to the R2-only
  runtime.

The API has no AWS endpoint/region fallback and does not use the AWS credential-provider chain.
The AWS SDK is used only to speak the S3-compatible protocol. Bucket-scoped credentials do not
enforce Drezivo tenant prefixes; tenant authorization and server-generated storage keys remain
application responsibilities. Production R2 cutover is gated on the object inventory, migration/
rollback design, R2 compatibility tests, selected host configuration, and privacy review in
[ADR 0010](../decisions/0010-cloudflare-r2-object-storage.md).

- `EMAIL_PROVIDER_*` — sender verification credentials for the email adapter (TRD §1 recommends
  an SES adapter, "subject to deliverability pilot"). DECISION NEEDED: exact variable names
  depend on the confirmed provider (TRD §12 lists "email sender and quotas" as a remaining
  selection).
- `OTEL_EXPORTER_*` / error-monitoring DSN — DECISION NEEDED: names depend on the confirmed
  observability sink (TRD §12: "observability service" is a remaining selection). Until then,
  structured logs still ship without these — see `docs/runbooks/oncall-checklist.md`.
- `SUBSCRIPTION_COLLECTION_PROVIDER_*` — DECISION NEEDED: TRD §12 defers this selection; V1 may
  use audited operator verification of subscription collection instead of an automated provider
  (TRD §6), in which case no provider credential exists yet.
- `IDEMPOTENCY_RECORD_RETENTION_DAYS` — proposed seven days for general mutations (TRD §4).
  Configurable rather than hard-coded so it can be tuned after pilot without a deploy.
- `HOLD_EXPIRY_MINUTES` — proposed 15 minutes (TRD §5, PRD §11 "policy defaults"). Same
  reasoning: configurable, not hard-coded, because it is an explicit "recommendation" pending
  pilot validation.
- `PAYMENT_REVIEW_MAX_HOURS` — proposed 24 hours maximum manual review deadline (TRD §5, PRD
  §11).
- `TRIAL_PERIOD_DAYS` / `RENEWAL_GRACE_DAYS` — seven days each (TRD §6, PRD §11).
- `OUTBOX_MAX_ATTEMPTS` — proposed eight attempts before terminal failure (TRD §8).
- `CONTRACTS_PACKAGE_VERSION` — not an env var but a `package.json` dependency pin on
  `@drezivo/contracts` (`docs/decisions/0003-shared-contracts-package.md`); listed here as a
  reminder that the contract version in use is part of what "which environment is running what"
  means.

## `app` (Next.js staff/business dashboard)

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — client-side Clerk key for staff sign-in and
  organization switching. `NEXT_PUBLIC_*` variables are bundled into client JavaScript; never
  put a secret in one.
- `CLERK_SECRET_KEY` — server-side, used only in server components/route handlers that need to
  verify a session before calling the API; TRD §1 is explicit that Next.js "does not become a
  second source of financial or availability logic," so this key authenticates, it does not
  authorize business writes.
- `API_BASE_URL` — the `api` server's base URL for this environment. Next.js server rendering
  calls the API through scoped service/request adapters (TRD §1); it never holds a database
  connection string directly.
- `NEXT_PUBLIC_API_ORIGIN` — the browser-reachable API origin used by the authenticated onboarding
  client. This is an origin only, without a secret or token; Clerk still supplies the bearer token
  for each request.
- `NEXT_PUBLIC_APP_ENV` — surfaces the environment name in client UI (e.g., a staging banner)
  without leaking anything sensitive.

## `web` (Next.js marketing site + public tenant storefronts)

- `API_BASE_URL` — same rule as `app`: the public storefront calls the API for catalogue,
  availability, and hold creation; it does not talk to the database directly.
- `NEXT_PUBLIC_APP_ENV` — same as `app`.
- Guest capability handling needs no client secret: TRD §3 requires bearer capability links kept
  out of logs, analytics, referrers, and shared caches — this is a handling rule for `web`'s
  code, not an environment variable.

## `contracts` (`@drezivo/contracts`)

- `GITHUB_PACKAGES_TOKEN` (or equivalent) — used only in CI to publish the package to GitHub
  Packages (`docs/decisions/0003-shared-contracts-package.md`); never needed at runtime by any
  other repository beyond an ordinary package-registry auth token for `npm install`.

## `docs` (this repository)

No runtime environment variables — this repository has no build (see `CONTRIBUTING.md` in this
repository, "Repo specifics"). Security automation is deferred until the no-committed-`.env` rule
and the selected GitHub checks apply uniformly across the monorepo.
