<!--
PR title must be a valid Conventional Commit line — it becomes the squash commit on main.
  feat(reservations): add exclusive expiring hold before payment instructions
-->

## What changed

<!-- One paragraph. The effect, not the file list. -->

## Why

<!-- The reason, the alternative you rejected, anything non-obvious. -->

Refs: <!-- TRD §_, Data-Model §_, PRD §_, or issue # -->

## How it was tested

<!-- Commands you actually ran and what they printed. "Should work" is not testing. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

## Non-negotiables

<!-- Delete the whole block ONLY if this PR touches no mutating endpoint and no mutating UI control. -->

- [ ] Mutating control: disabled + pending state + handler early-return guard while in flight
- [ ] Idempotency key generated once per user intent, reused across retries
- [ ] Endpoint is duplicate-safe (idempotency store / conditional UPDATE / unique constraint + recovery)
- [ ] Double-fire test added — sequential **and** concurrent
- [ ] Unknown enum / state / route values are rejected, not passed through
- [ ] Server recomputes money and quantities; nothing trusts a client-sent price, role or scope
- [ ] No secret, token or PII in logs or responses

## Tenant isolation

<!-- Delete ONLY if this PR touches no tenant-owned data. -->

- [ ] Every query filters by the resolved tenant; no path relies on a client-supplied tenant id
- [ ] A foreign-tenant object returns 404, never 403 with details
- [ ] RLS still applies — no new connection path bypasses it

## Contract impact

- [ ] No change to the API contract
- [ ] Contract changed — `@drezivo/contracts` PR: #___ (merge and publish that first)
- [ ] BREAKING — old and new shapes both accepted during the migration window

## Rollback

<!-- How to undo this if it misbehaves in production. "Revert the PR" is only true when
     no migration ran and no data shape changed — say so explicitly if that is the case. -->
