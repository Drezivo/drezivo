---
title: API Module Boundaries and Layering
type: architecture
status: accepted-for-implementation
owner: Drezivo platform team
source: "API AGENTS.md; backend module-boundary cleanup plan; [[02-Architecture/Drezivo Architecture]]"
updated: 2026-09-17
tags: [drezivo, architecture, api, backend, layering]
---

# API Module Boundaries and Layering

## Purpose

The API is a feature-based Express modular monolith. Each HTTP-facing feature separates
transport concerns from business workflows and persistence so a developer can debug one layer
without reading an entire route file.

This note is an implementation guide for the backend cleanup. It does not change endpoint paths,
contracts, status codes, authorization rules, idempotency semantics, or database invariants.

## Standard feature shape

```text
api/src/modules/<feature>/
  <feature>.routes.ts
  <feature>.controller.ts
  <feature>.service.ts
  <feature>.repository.ts
  <feature>.dto.ts
  <feature>.schemas.ts
  <feature>.middleware.ts       # only when the feature needs boundary middleware
  __tests__/
```

### Routes

Routes declare the URL, HTTP method, middleware order, parser/size boundary, authentication,
rate limits, and validation middleware. They do not query the database, call Clerk, evaluate
business rules, construct audit events, or branch on domain outcomes.

### Controllers

Controllers extract the validated request values and authenticated actor context, invoke a service,
and write the shared success/error envelope. Controllers do not import Drizzle, `pg`, database
clients, provider SDKs, or repositories.

### Services

Services own business workflows, authorization decisions, provider orchestration, idempotency and
audit coordination, and typed domain outcomes. They receive transport-neutral typed inputs and do
not depend on Express request/response objects.

### Repositories

Repositories own SQL/Drizzle queries, row mapping, locks, RLS-sensitive transaction boundaries,
and database result unions. Cross-repository atomic work uses a repository-level transaction
coordinator so services never issue SQL directly.

### DTOs and schemas

Schemas validate request boundaries and remain the source of truth for inferred input types. DTOs
map persistence/domain records to public contract projections and prevent raw rows from reaching
controllers or clients.

## Module policy

HTTP-facing modules receive the full route/controller/service/repository separation:

- onboarding
- storefront
- reservations
- Clerk webhooks

Infrastructure-only modules remain focused repository modules because they expose no HTTP surface:

- accounts
- audit
- bootstrap idempotency
- webhook inbox persistence

The reconciliation worker contract is a service boundary without an HTTP route or controller.

## Refactor order and compatibility

1. Onboarding is split first because it currently combines request parsing, Clerk calls,
   idempotency, account/attempt locking, audit writes, and response envelopes.
2. Webhook intake and reconciliation are split while preserving exact raw-byte verification,
   duplicate-safe `204` responses, generic rejection envelopes, and worker repair behavior.
3. Storefront and reservation scaffold routes gain controller/service seams without activating
   their current `501 NOT_IMPLEMENTED` endpoints.
4. Existing router exports and repository APIs remain compatible while consumers move to public
   module barrels.

## Decision log

### 2026-09-17 — Layer boundaries accepted

- Structural cleanup is behavior-preserving; endpoint redesign is a separate task.
- HTTP modules use explicit routes, controllers, services, repositories, DTOs, and schemas.
- Accounts, audit, bootstrap, and webhook inbox remain repository-only infrastructure modules.
- Database transactions remain inside repository-level persistence coordinators, while services
  own the business workflow and provider sequencing.

Related: [[02-Architecture/Drezivo Architecture]], [[02-Architecture/Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation]], [[00-Home/Drezivo Home]]
