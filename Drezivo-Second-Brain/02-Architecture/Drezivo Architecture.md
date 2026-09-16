---
title: Drezivo Architecture
type: architecture
status: current
source: ../../Drezivo-TRD.md
updated: 2026-09-16
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
  api --> neon[(Neon PostgreSQL)]
  api --> clerk[Clerk]
  api --> s3[S3]
  worker[api worker] --> neon
```

The API is the authority for authorization, tenant scope, money, availability, and state
transitions. The browser is a client, never a trust boundary. The [TRD](../../Drezivo-TRD.md)
and [data model](../../Drezivo-Data-Model.md) contain the complete technical contract.
