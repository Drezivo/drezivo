# Local development services

This runbook starts the local services required to rehearse PostgreSQL migrations and prepare
S3-compatible object storage. It is for development only. Production uses separately managed
PostgreSQL and private object storage.

## Services

[docker-compose.yaml](../../docker-compose.yaml) starts:

- PostgreSQL 17 on loopback port 5432, with the drezivo database and role. Password authentication
  uses the ignored `POSTGRES_PASSWORD` value in `api/.env` and must never be exposed beyond the
  developer machine.
- Adminer on loopback port 8080 for local PostgreSQL inspection. It is development-only and
  preconfigured to use the Compose `postgres` service.
- MinIO on loopback port 9000, with its console on loopback port 9001.
- A one-shot MinIO client that creates private drezivo-private and drezivo-public buckets
  without making either anonymous-readable.

The compose file pins the reviewed PostgreSQL, Adminer, and MinIO client images. Image tags are
checked when the local stack changes; see the [PostgreSQL official image](https://hub.docker.com/_/postgres) and
the [MinIO Compose example](https://github.com/minio/minio/blob/master/docs/orchestration/docker-compose/docker-compose.yaml).

## Start and migrate

1. Install Docker Desktop or another Docker engine that provides Docker Compose.
2. Fill the credential entries in the ignored `api/.env` file. `MINIO_ROOT_PASSWORD` and
   `S3_SECRET_ACCESS_KEY` must be the same value; use a unique local value. The API uses
   `http://127.0.0.1:9000` with path-style addressing for MinIO; production leaves the endpoint
   unset for AWS S3. Copy your Clerk development-instance values there as well. Do not commit
   any `.env*` file.
3. Run `docker compose --env-file api/.env up -d` from the repository root. This is the supported
   startup command. Compose needs the explicit file because it otherwise discovers only a root
   `.env` file and cannot interpolate the required MinIO credentials.
4. Run `docker compose --env-file api/.env ps`. PostgreSQL must be healthy and `minio-init`
   must exit successfully.
5. Open [Adminer](http://localhost:8080) when you need to inspect the database. Use `PostgreSQL`
   as the system, `postgres` as the server, `drezivo` as the username and database, and the
   local `POSTGRES_PASSWORD` value from `api/.env` as the password.
6. Set `DATABASE_URL_DIRECT`, or `DATABASE_URL`, to the loopback PostgreSQL connection for the
   drezivo role/database declared by compose.
7. Run `npm run db:migrate --workspace @drezivo/api`.
8. Confirm the migration ledger reports all numbered SQL files and no migration error.

The API's object-storage adapter is not wired in Phase 0. MinIO is present so its buckets and
credentials can be exercised when the file-storage slice is implemented; do not claim the API
uploads to MinIO before that adapter and its tests exist.

## Stop and reset

Run `docker compose --env-file api/.env down` to stop services while retaining volumes.
`docker compose --env-file api/.env down --volumes` deletes the local PostgreSQL and MinIO data
and is appropriate only when a local reset is intended. Existing volumes initialized under the
old trust-authentication setup must be recreated once, or the `drezivo` role password and
`pg_hba.conf` must be updated manually, before password login will work.

## Run the API

After the services are healthy, run migrations and start the API from `api/`:

```bash
cd api
npm run db:migrate
npm run dev
```

Alternatively, run `npm run db:migrate --workspace @drezivo/api` and
`npm run dev --workspace @drezivo/api` from the repository root. The server listens on port 3000
by default; verify it with `curl http://localhost:3000/health`. The worker is optional and remains
disabled unless `WORKER_ENABLED=true`; start it separately with `npm run dev:worker` from `api/`.
