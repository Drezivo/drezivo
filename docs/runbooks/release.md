# Release

This runbook moves a change from the root monorepo to a live environment. Read
`docs/decisions/0006-monorepo.md` and `docs/architecture/Drezivo-TRD.md` first.

## Release sequence

1. Update the contract workspace when a request, response, enum, error, money, or idempotency shape
   changes. Keep old and new shapes valid during an expand, migrate, contract window.
2. Implement the API transaction, authorization, migration, idempotency, and durable side effects.
3. Update `app` and/or `web` consumers in the same pull request where compatibility permits.
4. Update tests, PRD/TRD/data model/ADR/runbook, legal copy, and the Obsidian decision note.
5. Run root checks, review the diff and dependency changes, deploy to staging, run smoke and recovery
   checks, then promote to production through the protected environment.

Root CI may filter unaffected workspaces for speed, but release candidates run the complete gate:

```text
npm ci
npm run check:docs
npm run typecheck
npm run lint
npm run test
npm run build
```

The API and its worker remain separate process artifacts from the same workspace. Deploy both with
compatible configuration and verify readiness, queue lag, database connectivity, and rollback.
`contracts` is not published separately for this monorepo; package exports are versioned with the
root release and can be published only if a future integration requires it.

## Breaking contract changes

Use three stages, never a silent replacement:

1. **Expand:** accept and emit old and new shapes where required, with contract tests.
2. **Migrate:** update every workspace consumer, database backfill, and documentation.
3. **Contract:** remove old shapes only after CI and deployed-version evidence show no remaining
   consumer.

## What release does not mean

A merge or tag does not prove that a service is deployed, isolated, recoverable, or legally ready.
A production promotion needs an approved migration plan, rollback, monitoring, on-call owner, and
security and privacy launch gates.
