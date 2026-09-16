# 0002. Drizzle and node-postgres

**Status:** Accepted for the existing scaffold, 15 September 2026.

## Context

The TRD recommends Drizzle plus pg, and the interrupted scaffold already uses them.
Availability exclusions, RLS and financial constraints require reviewed PostgreSQL SQL.

## Decision

Retain Drizzle and pg. Repositories own data access and shared transaction context.
Custom SQL migrations are version-controlled and tested; ORM declarations alone are not the complete schema.
Update the old ORM and test conventions to this Drizzle/Vitest scaffold without changing the product.

## Consequences

Drizzle keeps typed query code close to PostgreSQL while reviewed SQL migrations express constraints and row-level security. The choice still requires real constraint, row-level security, and concurrency tests.
No production migration benchmark is claimed.
