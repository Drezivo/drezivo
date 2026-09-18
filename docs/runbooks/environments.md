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
  services in [local development](local-development.md), or an ephemeral preview backed by a
  non-production Neon branch. Seed only synthetic data, never a clone of live personal data.
- **Staging** — a persistent pre-production environment that mirrors production configuration
  (same Node LTS, same Neon major version, same region where practical) so a migration or a
  deploy is rehearsed under realistic conditions before it reaches production.
- **Production** — serves real tenants. Separate Clerk project, separate Neon project, separate
  S3 buckets, separate everything-with-a-credential from staging and development. Nothing in
  production is a "free tier" resource (TRD §1: "Do not use a free-tier suspension/retention
  assumption as a production recovery plan").

DECISION NEEDED: name the specific hosting accounts/projects for each environment (Vercel
team/project per environment, container host project per environment, Neon project/branch
naming convention) once TRD §12's "remaining selection" of hosting plans/region is made.

## `api` (Express API server + worker, two entrypoints from one image)

- `NODE_ENV` — `development` | `staging` | `production`. Gates verbose logging and
  dev-only conveniences; never gates a security control on its own.
- `PORT` — the port the HTTP server binds. The worker entrypoint does not need this.
- `DATABASE_URL` — the pooled Neon connection string used for ordinary request-time queries, or
  the loopback PostgreSQL URL during local compose development. TRD §9: Neon pooling is
  transaction-based; session-level state must not be assumed to survive checkout.
- `DATABASE_URL_DIRECT` — the direct (non-pooled) Neon connection string, used first by
  migration and admin tooling when supplied. Local compose uses its direct loopback PostgreSQL
  endpoint for both variables.
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
- `CLERK_SECRET_KEY` — server-side Clerk SDK credential, used to verify JWTs (signature,
  issuer, expiry, audience/authorized-party) per TRD §3.
- `CLERK_WEBHOOK_SIGNING_SECRET` — verifies the signature on Clerk's membership-change webhooks
  before they enter the signed, deduplicated webhook inbox (TRD §3, "Membership freshness").
- `INVITATION_EMAIL_ENCRYPTION_KEY` — deployment-managed 32-byte base64url key used to encrypt
  tenant invitation recipient email before it is stored. Keep it separate from the digest key.
- `INVITATION_EMAIL_DIGEST_KEY` — deployment-managed 32-byte base64url HMAC key used for exact
  tenant-local pending-recipient dedupe. It is never exposed to clients or logs.
- `AWS_REGION` — region for S3 and any AWS-hosted dependency.
- `S3_BUCKET_PRIVATE_EVIDENCE` — bucket name for private evidence (receipts, verification
  documents). Originals are private; access is short-lived (TRD §7, proposed five-minute
  downloads).
- `S3_BUCKET_PUBLIC_DERIVATIVES` — bucket (or bucket + CDN path) for optimized public catalogue
  image derivatives.
- AWS credentials for signing S3 presigned URLs — DECISION NEEDED: confirm whether these are
  supplied via an IAM role attached to the compute environment (preferred, per TRD §7's "Use
  IAM roles") rather than static access-key environment variables. If the chosen container host
  cannot attach an IAM role, name the access-key variables here explicitly before launch.
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
