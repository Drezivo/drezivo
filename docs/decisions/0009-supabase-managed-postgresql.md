# 0009. Supabase as the managed PostgreSQL provider

**Status:** accepted
**Date:** 26 September 2026
**Owners:** product + API + platform owners

## Context

Drezivo has not stored production or development business data in Neon. The backend already uses
standard PostgreSQL through `node-postgres` and Drizzle rather than a Neon-specific driver. Its
database boundary depends on reviewed SQL migrations, custom restricted login roles, forced row-level
security (RLS), transaction-local tenant context, row and advisory locks, and PostgreSQL extensions.

The team has selected Supabase for managed PostgreSQL. This is a provider change, not a change to
the application authority model. Clerk remains the identity provider, the Express API remains the
only business-data interface, and S3/MinIO remains the object-storage boundary.

## Decision

Use Supabase as managed PostgreSQL only:

- Keep Drizzle, `node-postgres`, the existing SQL migrations, and the `DATABASE_URL` /
  `DATABASE_URL_DIRECT` configuration names.
- Disable the Supabase Data API because Drezivo does not authorize requests with Supabase Auth JWTs
  or `auth.uid()`. Browser and server-rendered clients continue to call the Express API.
- Keep `drezivo_app` and `drezivo_worker` as separate restricted login roles with deployment-managed
  passwords. Neither role owns tables or receives `BYPASSRLS`.
- Use the Supabase direct connection for migrations, backup, restore, and other single-session
  administration. A persistent API or worker uses a direct connection when its network supports it,
  otherwise the shared session pooler. Transaction pooling is reserved for serverless deployment and
  requires compatible client settings and a deliberately small application pool.
- Require encrypted production connections. Start with `sslmode=require`; prefer certificate-backed
  `sslmode=verify-full` when the deployment platform can mount the Supabase root certificate.
- Keep transaction-local `set_config(..., true)` tenant and actor context. Do not introduce
  session-scoped authorization state.
- Verify `btree_gist`, `btree_gin`, `pg_trgm`, and `pgcrypto` in staging before promotion.
- Use separate Supabase projects for staging and production. Backups, point-in-time recovery (PITR),
  and restore drills are deployment requirements, not guarantees inferred from a paid plan.

## Consequences

- No API contract, business module, Drizzle schema, or frontend database client changes are needed.
- Deployment must provision and rotate passwords for both custom runtime roles after migration and
  after any restore that does not preserve custom-role passwords.
- An IPv4-only migration runner needs an approved path to the direct endpoint, such as IPv6-capable
  CI or the Supabase IPv4 add-on. The session pooler is not the migration connection.
- Supabase Auth, Storage, REST, GraphQL, Realtime, and service-role keys are outside the current
  architecture. Adding one later requires a separate reviewed decision.
- Provider-specific recovery retention, connection limits, regions, and pricing must be verified
  before production purchase. Free-tier behavior is not a recovery plan.

## Deployment acceptance

- All migrations apply to an empty Supabase staging project through `DATABASE_URL_DIRECT`.
- API and worker smoke tests connect only as `drezivo_app` and `drezivo_worker` respectively.
- Forced RLS, cross-tenant denial, transaction reuse, exclusion constraints, and advisory-lock tests
  pass against the selected Supabase PostgreSQL major and connection mode.
- The Data API is disabled and default privileges for `anon`, `authenticated`, and `service_role`
  are audited before business data is loaded.
- Backup restoration is rehearsed and custom runtime-role credentials are restored out of band.

## References

- [Supabase: connect to PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: connection pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
- [Supabase: Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase: securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: Postgres extensions](https://supabase.com/docs/guides/database/extensions)
- [Supabase: database backups](https://supabase.com/docs/guides/platform/backups)
- [ADR 0002: Drizzle and node-postgres](0002-drizzle-and-node-postgres.md)
- [Technical Requirements Document](../architecture/Drezivo-TRD.md)
