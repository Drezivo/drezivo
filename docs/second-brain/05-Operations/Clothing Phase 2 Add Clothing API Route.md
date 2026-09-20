---
title: Clothing Phase 2 Add Clothing API Route
type: implementation-evidence
status: verified
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, clothing, catalogue, add-clothing, api, idempotency, evidence]
---

# Clothing Phase 2 Add Clothing API Route

## Scope

This note records implementation evidence for [[Clothing Checklist]] task CLT-021. It covers the authenticated HTTP boundary for the Add Clothing command; transactional graph creation remains documented in [[Clothing Phase 2 Add Clothing Service]], while file upload/attachment behavior is documented separately.

## Route boundary

`POST /api/v1/catalogue/clothing` is the authoritative staff command endpoint. It uses the existing Clerk staff authentication, tenant context, active local membership, tenant lifecycle action policy, active-branch permission resolution, and `assets.manage` authorization before the command service can write catalogue state.

The request contract is strict: browser-supplied tenant IDs, membership IDs, quota counters, derived availability, and other authority fields are rejected rather than trusted.

## Request safety

Add Clothing has a dedicated JSON parser with a **64 KB** request limit. Malformed JSON and oversized bodies are converted to the shared safe validation envelope instead of leaking parser/provider details.

The catalogue write limiter allows **30 requests per tenant per minute**. A valid `Idempotency-Key` is required before a catalogue graph can be created, and same-intent replay returns the stored result without duplicating the product graph.

Foreign tenant references, including foreign categories, are concealed through the normal not-found boundary.

## Evidence

`api/tests/integration/catalogue-add-clothing-route.test.ts` passes **10/10** against disposable PostgreSQL. Coverage includes:

- authenticated Clerk staff requirement;
- active local membership requirement;
- `assets.manage` permission on the resolved active branch;
- tenant lifecycle write gate;
- required idempotency key;
- rejection of browser authority/quota/derived-availability fields;
- dedicated 64 KB metadata body limit;
- successful Front Desk creation and same-intent replay;
- foreign-category concealment;
- 30 requests/minute catalogue write rate limiting.

The route delegates business invariants and atomic graph creation to the CLT-020 service rather than duplicating transactional rules in the controller layer.

## Handoff

CLT-021 is complete. CLT-022 owns the private upload authorization, verified file acceptance, and ordered product-image attachment flow.
