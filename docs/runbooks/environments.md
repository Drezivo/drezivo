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
  Cloudflare R2 buckets and credentials, separate everything-with-a-credential from staging and development. Nothing in
  production is a "free tier" resource (TRD §1: "Do not use a free-tier suspension/retention
  assumption as a production recovery plan").

**Pilot (2026-09-30):** real businesses use production on free-tier hosting while the team collects
feedback, as a deliberate, time-boxed exception to the rule above. How it works and what it needs:
`docs/runbooks/pilot-operation.md`.

Production domains:

| Service | Domain |
| --- | --- |
| `web` (marketing and storefronts) | `drezivo.shop`, with storefronts at `drezivo.shop/s/<store-address>` |
| `app` (business app) | `partners.drezivo.shop` |
| Operator console (separate repositories) | `operator.drezivo.shop` |

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

- `TRUST_PROXY_HOPS` — number of reverse proxies in front of the API (default `0`). Set it to the
  real hop count on Render, Cloud Run, or behind a load balancer, or every anonymous visitor shares
  the proxy's address for per-IP rate limits. Never set it higher than the real count, or clients
  can spoof `X-Forwarded-For`.
- `EMAIL_PROVIDER` — `none` (default), `file`, or `resend`. Guest storefront reservation and
  fitting flows do not send customer email; the provider is used for business/owner and other
  operational notifications. `file` is for local development only and is refused in production.
- `EMAIL_FROM` and `RESEND_API_KEY` — required when `EMAIL_PROVIDER=resend`. The key is a secret.
- `EMAIL_FILE_SINK_DIR` — local folder for `EMAIL_PROVIDER=file`; each message is one JSON file.
- `TURNSTILE_SECRET_KEY` — required in staging and production to protect public reservation and
  fitting submissions. Local development may omit it; the verifier then logs one startup warning
  and skips the challenge. If set, invalid or missing challenge tokens are rejected.
- The worker must run for operational email to leave the outbox. It never sends guest verification,
  reservation proof, receipt, or reservation/fitting lifecycle email.
- `WORKER_ENABLED`: `true` or `false` (the default is `false`). Only these two words are accepted;
  any other value stops startup. `OBJECT_STORAGE_FORCE_PATH_STYLE` and
  `OBJECT_STORAGE_UPLOADS_ENABLED` follow the same strict boolean rule.
- `WORKER_MODE`: `continuous` (the default) or `drain`.
  - `continuous` is a long-lived process.
  - `drain` runs once and exits, for a scheduled job. See `docs/runbooks/worker-cloud-run.md`.
- `WORKER_DRAIN_SCOPE`: `all` (the default) or `fast`.
  - `all` runs every sweep, then the whole outbox.
  - `fast` only releases expired holds and sends queued email, for a frequent schedule.
- `WORKER_DRAIN_BUDGET_MS`: the longest a drain run keeps claiming work, from 1000 to 3300000.
  The default is 600000 (10 minutes). Keep it below the job's task timeout.
- `DREZIVO_ENV_FILE`: an absolute path to one mounted secret file, in `KEY=value` lines, for
  example Cloud Run's Secret Manager volume.
  - It is read in every mode.
  - Real environment variables take precedence over it.
  - A path that does not exist stops startup.

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
- `OBJECT_STORAGE_ENDPOINT` — required S3-compatible API endpoint. Staging/production must use
  Cloudflare R2's HTTPS S3 endpoint; there is no AWS hostname fallback.
- `OBJECT_STORAGE_REGION` — `auto` for Cloudflare R2. Local MinIO normally uses `us-east-1`.
- `OBJECT_STORAGE_BUCKET_PRIVATE` — private source/evidence bucket for catalogue sources,
  storefront assets, measurement guides, receipts, and future verification documents.
- `OBJECT_STORAGE_BUCKET_PUBLIC` — optional reserved bucket for a separately reviewed public
  derivative/CDN flow. The current private upload path does not require it.
- `OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY` — deployment-managed,
  bucket-scoped S3 API credentials. They stay in the API/worker environment only.
- `OBJECT_STORAGE_FORCE_PATH_STYLE` — `false` for R2; `true` for loopback MinIO.
- `OBJECT_STORAGE_UPLOADS_ENABLED` — production cutover gate for issuing new upload URLs. If omitted
  in production it defaults to `false`; outside production it defaults to `true`.
- Legacy `AWS_REGION`/`S3_*` variables are accepted only for loopback MinIO compatibility in local
  development/test. They cannot select AWS or any other remote provider in staging/production.
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
- Trial and subscription access windows are code-owned policy, not environment overrides. The
  current pilot uses a 14-day trial, 3-day reminder, 30-day read-only period, and 3-day storefront
  online window after a period ends. Do not add `TRIAL_PERIOD_DAYS` or `RENEWAL_GRACE_DAYS`; the API
  does not read them. See `contracts/src/tenancy/billing.ts` and `api/src/modules/billing/access.ts`.
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
- `NEXT_PUBLIC_STOREFRONT_ORIGIN` — public origin of `web`, used by the Storefront pages to show
  and copy the full store address. Without it, the app shows the `/s/<slug>` path only.

## `web` (Next.js marketing site + public tenant storefronts)

- `API_ORIGIN` — server-side API origin for server-rendered storefront pages (may be an internal
  address). Falls back to `NEXT_PUBLIC_API_ORIGIN`.
- `NEXT_PUBLIC_API_ORIGIN` — browser-reachable API origin for availability, holds, guest reservation
  proof/receipts, and fitting requests. Guest reservation calls use credentialed requests so the
  API-host-only cookie can be set/read. Must be listed in the API's `CORS_ALLOWED_ORIGINS` origin
  set alongside the `web` origin; the API must allow credentials only for exact listed origins.
- `NEXT_PUBLIC_SITE_URL` — canonical public origin used for metadata, canonical links, and the
  sitemap.
- `NEXT_PUBLIC_APP_ENV` — same as `app`.
- Guest reservation capability handling is cookie-only. The API sets a host-only, HttpOnly cookie
  scoped to one reservation's API path; never copy a capability into a URL, browser storage,
  analytics, referrer, or log. The storefront uses credentialed requests and API CORS must allow
  the exact storefront origin.

## `contracts` (`@drezivo/contracts`)

- `GITHUB_PACKAGES_TOKEN` (or equivalent) — used only in CI to publish the package to GitHub
  Packages (`docs/decisions/0003-shared-contracts-package.md`); never needed at runtime by any
  other repository beyond an ordinary package-registry auth token for `npm install`.

## `docs` (this repository)

No runtime environment variables — this repository has no build (see `CONTRIBUTING.md` in this
repository, "Repo specifics"). Security automation is deferred until the no-committed-`.env` rule
and the selected GitHub checks apply uniformly across the monorepo.
