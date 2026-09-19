---
title: Monorepo Workspace Map
type: architecture
status: current
updated: 2026-09-16
tags: [drezivo, monorepo, workspaces]
---

# Monorepo Workspace Map

The root directory is the only Git repository. These folders are workspace boundaries with clear
ownership, not nested repositories. Root `package.json`, `package-lock.json`, `.github`, `LICENSE.md`,
and agent rules govern all of them.

## contracts

Owns versioned Zod request/response schemas, enums, money serialization, and generated OpenAPI.
It has no database, UI, provider credentials, or authorization authority.

## api

Owns Express REST routes, Clerk verification, local tenant and branch authorization, Drizzle
queries, reviewed SQL migrations, transaction rules, and the durable worker.

## app and web

`app` is the staff dashboard. `web` is marketing, public storefront, and guest booking. Both use
the exact contracts package and API; neither owns authoritative business state.

## docs

Owns PRD, research, TRD, data model, ADRs, and runbooks. Decisions ship alongside implementation.

## Release direction

`contracts` -> `api` -> `app` / `web`; documentation and tests move with the same root pull request.
