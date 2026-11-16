---
title: Drezivo Architecture
type: architecture
status: current
owner: Drezivo team
source: "Drezivo-TRD.md and ../04-Decisions/ADRs/"
updated: 2026-11-15
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
  worker[api worker] --> supabase
```

The API is the authority for authorization, tenant scope, money, availability, and state
transitions. The browser is a client, never a trust boundary. The [TRD](Drezivo-TRD.md)
and [data model](Drezivo-Data-Model.md) contain the complete technical contract.

Customer address and optional social-profile handling follows the tenant-scoped, API-owned
boundary described in [[02-Architecture/Customer Address and Social Profile Fields]].

Supabase supplies managed PostgreSQL only. Clerk remains the identity provider. Production object
storage targets Cloudflare R2 while local development keeps MinIO through the same S3-compatible
`ObjectStorage` boundary. Browser clients never use Supabase database or object-storage credentials.
The API and worker connect as separate restricted roles; migration tooling uses the direct
administrative connection. See [[Supabase Managed PostgreSQL]].

The backend follows explicit feature boundaries between routes, controllers, services,
repositories, DTOs, and schemas. See [[02-Architecture/API Module Boundaries and Layering]] for
the accepted cleanup policy and infrastructure-module exception.

Public media and optional anonymous storefront caching use the Cloudflare Worker with live API
visibility checks; see [[02-Architecture/object-storage-image-delivery-evolution]] and the
[Worker guide](../../../api/edge/media-worker/README.md).

The staff Calendar's Clothing Availability tab is documented in
[[02-Architecture/Clothing Availability Timeline - Backend]]. It is a bounded asset-lane
projection: Reserved and Rented are continuous reservation bars with Pickup/Return boundary labels,
while all readiness and planned operational blocks render as Unavailable.
