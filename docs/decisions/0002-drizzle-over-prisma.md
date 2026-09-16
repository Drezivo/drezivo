# 0002. Drizzle and node-postgres

**Status:** Accepted for the existing scaffold, 15 September 2026.

## Context

The TRD recommends Drizzle plus pg, and the interrupted scaffold already uses them.
Availability exclusions, RLS and financial constraints require reviewed PostgreSQL SQL.

## Decision

Retain Drizzle and pg. Repositories own data access and shared transaction context.
Custom SQL migrations are version-controlled and tested; ORM declarations alone are not the complete schema.
Update the old Prisma/Jest conventions to this actual Drizzle/Vitest scaffold without changing the product.

## Alternatives and consequences

Prisma also supports custom SQL in its migration chain; the earlier assertion that unsupported features require an out-of-band chain was incorrect.
See [Prisma custom migration guidance](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features).
Retaining Drizzle avoids an unnecessary rewrite and keeps query code close to SQL. Both choices still require real constraint/RLS/concurrency tests.
No production migration or ORM superiority benchmark is claimed.
