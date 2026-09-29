---
title: Drezivo Architecture
type: architecture
status: current
owner: Drezivo team
source: "../../architecture/Drezivo-TRD.md, ../../decisions/0009-supabase-managed-postgresql.md, and ../../decisions/0010-cloudflare-r2-object-storage.md"
updated: 2026-09-28
tags: [drezivo, architecture, trd]
---

# Drezivo Architecture

```mermaid
flowchart LR
  web[web public Next.js] --> api[api Express REST]
  app[app staff Next.js] --> api
  contracts[contracts Zod OpenAPI] -. exact version .-> web
  contracts -. exact version .-> app
  contracts -. exact version .-> api
  api --> supabase[(Supabase PostgreSQL)]
  api --> clerk[Clerk]
  api --> r2[Cloudflare R2]
  api --> minio[MinIO local development]
  worker[api worker] --> supabase
```

The API is the authority for authorization, tenant scope, money, availability, and state
transitions. The browser is a client, never a trust boundary. The [TRD](../../architecture/Drezivo-TRD.md)
and [data model](../../architecture/Drezivo-Data-Model.md) contain the complete technical contract.

Customer address and optional social-profile handling follows the tenant-scoped, API-owned
boundary described in [[02-Architecture/Customer Address and Social Profile Fields]].

Supabase supplies managed PostgreSQL only. Clerk remains the identity provider. Cloudflare R2 is
the selected production object-storage target, while MinIO remains local; production cutover is
still gated on the inventory, cost, migration/rollback, legal/privacy and live-provider checks in
[[04-Decisions/Cloudflare R2 Object Storage]]. Browser clients never use Supabase database
credentials or its Data API. The API and worker connect as separate restricted roles; migration
tooling uses the direct administrative connection. See [[Supabase Managed PostgreSQL]].

The backend follows explicit feature boundaries between routes, controllers, services,
repositories, DTOs, and schemas. See [[02-Architecture/API Module Boundaries and Layering]] for
the accepted cleanup policy and infrastructure-module exception.

The staff Calendar's Clothing Availability tab is documented in
[[02-Architecture/Clothing Availability Timeline - Backend]]. It is a bounded asset-lane
projection: Reserved and Rented are continuous reservation bars with Pickup/Return boundary labels,
while all readiness and planned operational blocks render as Unavailable.
