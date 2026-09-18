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
npm run db:studio       # Open Drizzle Studio
npm start               # Run the compiled server
npm run start:worker    # Run the compiled worker
```

## Environment and production

The API loader reads host/process variables first, then `.env.<NODE_ENV>`, with `.env` as the
shared local fallback for non-production modes. Production deliberately does not load the local
`.env`; deploy `DATABASE_URL`, Clerk keys, AWS region/bucket names, and credentials through the
deployment secret manager instead. Leave `S3_ENDPOINT` unset for AWS S3. For local MinIO,
`S3_ENDPOINT=http://127.0.0.1:9000` and `S3_FORCE_PATH_STYLE=true` are used.

Runtime Clerk, object-storage, and database integrations require validated environment
configuration; tests should inject mocks rather than inventing credentials.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.

