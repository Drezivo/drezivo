# Drezivo API

Express 5 + TypeScript API and durable-worker entrypoints for Drezivo. Drizzle/PostgreSQL is the
data layer and Vitest is the test runner. The public storefront read routes are wired for isolated
testing; reservation mutations still return structured HTTP 501 (`NOT_IMPLEMENTED`) until the
transactional reservation service is complete.

The worker is disabled by default (`WORKER_ENABLED=false`). Notification delivery remains
unavailable until a provider and delivery-state integration are configured, so queued events fail
closed rather than being acknowledged as delivered. The object-storage adapter is also not wired
yet; local MinIO is provisioned for the upcoming storage slice, but the API does not upload files
to it today.

Owner invitation state is persisted locally with tenant RLS, keyed recipient lookup, encrypted
recipient material, seven-day database-time expiry, and pending-seat reservations. TBF-040 writes
safe Clerk-dispatch outbox intent only; Clerk delivery is intentionally implemented by TBF-041.

## Prerequisites

- Node.js 22–24 (the repository requires `>=22 <25`).
- npm with workspace support.
- Docker Desktop or another Docker engine providing Docker Compose.

## Local development

Run these commands from the repository root (`D:\drezivo`):

```powershell
docker compose --env-file api/.env up -d
docker compose --env-file api/.env ps
```

The explicit `--env-file api/.env` is required because Compose otherwise looks for a root
`.env` file. Before starting, put your local Clerk development credentials and matching MinIO
credentials in the ignored `api/.env`; never commit or paste secret values into documentation.
The Compose stack exposes PostgreSQL on `127.0.0.1:5432`, Adminer on
`http://127.0.0.1:8080`, MinIO on `127.0.0.1:9000`, and the MinIO console on
`127.0.0.1:9001`. PostgreSQL should report `healthy` and `minio-init` should exit successfully
after creating the private buckets.

Open [Adminer](http://localhost:8080) to inspect the local database. Select `PostgreSQL` as the
system, use `postgres` as the server, `drezivo` as both the username and database, and enter the
local `POSTGRES_PASSWORD` value from `api/.env`. Adminer is bound to loopback and is not a
production database administration surface.

Apply the database migrations from either location:

```powershell
# From api/
cd api
npm run db:migrate

# Or from the repository root
npm run db:migrate --workspace @drezivo/api
```

Start the HTTP API:

```powershell
# From api/
npm run dev

# Or from the repository root
npm run dev --workspace @drezivo/api
```

The server listens on `PORT` (3000 by default). Verify it with:

```powershell
curl http://localhost:3000/health
```

Browser requests are protected by the API's explicit `CORS_ALLOWED_ORIGINS` allowlist. For local
frontend testing, set it to `http://localhost:3000` in the ignored `api/.env` file. Values are
comma-separated origins only; wildcards, paths, and credentials in an origin are rejected at
startup. The API supports credentialed requests only from an allowlisted origin, which is required
by the public guest-cookie flow. Production must provide its own deployment-managed allowlist and
must never use `*` or inherit the local origin.

## Staff actor and workspace context

After Clerk authentication, the staff app uses `GET /api/v1/workspaces` to list provisioned
businesses where the current Clerk subject has an active local membership. Selecting a row changes
Clerk's active organization; the API does not trust an organization header from the browser.
`GET /api/v1/actor-context` then resolves the token organization to the local membership, active
branches, branch grants, subscription, and plan entitlements. The optional
`X-Drezivo-Branch-Id` header selects an already-authorized active branch; it never grants access.
Restricted and cancelled tenants resolve to the shared lifecycle policy so each later command can
allow or reject the action explicitly. The resolver fails closed for unknown organizations and
suspended or removed memberships.

Start the optional worker in a second terminal only when `WORKER_ENABLED=true`:

```powershell
cd api
npm run dev:worker
```

Stop the local services while retaining their volumes, or reset all local data when intended:

```powershell
docker compose --env-file api/.env down
docker compose --env-file api/.env down --volumes
```

The PostgreSQL volume must be recreated once after switching from the previous trust-authentication
configuration, because PostgreSQL applies initialization authentication settings only when the
data directory is first created. If the data must be retained, set the `drezivo` role password and
update `pg_hba.conf` manually instead.

## API commands

Run from `api/` (or add `--workspace @drezivo/api` from the repository root):

```powershell
npm run build           # Compile to dist/
npm run typecheck       # TypeScript validation without emitting
npm run lint            # ESLint
npm run test            # Unit tests (integration tests excluded)
npm run test:integration
npm run db:generate     # Generate reviewed SQL migrations
npm run db:migrate:status # Read pending migrations and validate the Drezivo ledger without writes
npm run db:studio       # Open Drizzle Studio
npm run seed:clothing:local -- --storefront-slug <slug>  # Preview only
npm run seed:clothing:local -- --storefront-slug <slug> --apply  # Create missing local drafts
npm start               # Run the compiled server
npm run start:worker    # Run the compiled worker
```

The clothing seeder is development-only: it requires `NODE_ENV=development` and the loopback
Compose `drezivo` admin connection to the local `drezivo` database. It previews without writing by
default, and `--apply` creates up to 20 synthetic draft styles using the normal catalogue service.
Existing `LOCAL-SEED-*` style codes are skipped on reruns. Each style receives one size and its
normal initial inventory piece; no photos are generated or uploaded, so attach images later in the
app. The selected storefront must belong to an active workspace/branch with clothing-management
access, and the default active categories must exist. The API's normal physical-asset quota still
applies.

From the repository root, add `--workspace @drezivo/api` before the argument separator:

```powershell
npm run seed:clothing:local --workspace @drezivo/api -- --storefront-slug <slug> --apply
```

## Environment and production

The API loader reads host/process variables first, then `.env.<NODE_ENV>`, with `.env` as the
shared local fallback for development/test. Production and staging deliberately do not load the local
`.env`; deploy `DATABASE_URL`, Clerk keys, and `OBJECT_STORAGE_*` values through the deployment
secret manager instead. Production/staging use Cloudflare R2's HTTPS S3 endpoint with region `auto`
and virtual-hosted addressing. Local MinIO uses `http://127.0.0.1:9000`, region `us-east-1`, and
`OBJECT_STORAGE_FORCE_PATH_STYLE=true`.

Runtime Clerk, object-storage, and database integrations require validated environment
configuration. Invitation protection additionally requires separate 32-byte base64url
`INVITATION_EMAIL_ENCRYPTION_KEY` and `INVITATION_EMAIL_DIGEST_KEY` values; tests should inject
test-only values rather than inventing production credentials. `CORS_ALLOWED_ORIGINS` is a required
comma-separated list of exact browser origins; set `http://localhost:3000` for local development.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.
