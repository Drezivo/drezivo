# Rentivo project memory

## Reservations update 2026-10-10 (ADR 0016)

- Multi-item reservations are V1: 1 to 10 items per booking, staff and storefront, any clothing
  category. One `reservation_line` and one allocation per item; delivery fee charged once.
- Staff can edit a reservation before pickup (`PATCH /reservations/:id`), including adding and
  removing items. A higher total after payment becomes a separate balance payment
  (`reservation:<id>:balance:<version>`) that staff collect before pickup.
- Delivery is always offered; unconfigured delivery is recorded as `to_arrange`. Cancelled, expired
  and rejected reservations can be continued as a new booking.
- Never assume one line, one allocation or one payment per reservation. Payment summaries exclude
  balance rows by key; never filter on the initial-payment key.
- Full rules: `docs/decisions/0016-multi-item-reservations-edit-and-balances.md`. Handoff, file map,
  tests and local DB setup: `docs/reservation-checklist.md` section 23.

## Active architecture update 2026-09-16

- The root folder is now the single Drezivo monorepo. `contracts`, `api`, `app`, `web`, and `docs`
  are workspaces under one Git history, root lockfile, root license, CI, and review boundary.
- Former workspace Git metadata is archived in the ignored `.polyrepo-git-archives/` folder for
  reference only. Do not initialize nested repositories or run release commands there.
- Delegated work preference is GPT-5.6 Luna with low reasoning when delegation is explicitly used.
- Root `SECURITY-FOUNDATION.md` is the security baseline. It is a design recommendation until
  implemented controls have tests, provider settings, monitoring, and recovery evidence.

## Confirmed 2026-09-15

- Prices/month PHP: Starter 300; Professional 499; Business 1299. Screenshot 999/1999/3999 outdated.
- Subagents: GPT-5.5, medium reasoning. Applies to future delegated work unless changed.
- Stack: Next.js/TypeScript; Express/TypeScript; Supabase PostgreSQL; Clerk; S3; REST.
- Source: archived original PRD; source images unchanged. Revised PRD/TRD/model authoritative for proposed implementation.
- V1 single branch/single garment UI; default branch + multi-line schema. V1.1 fittings/multi-item; V2 branches/transfers; V3 demand-led governance. (Superseded 2026-10-10 for multi-item: see below.)
- Plan quotas, trial/grace/hold defaults proposed; owner prices confirmed. Research interviews and benchmarks not performed.

## Review lessons 2026-09-15

- Receipt upload is evidence, never settlement. Acquire exclusive expiring hold before displaying payment instructions.
- Actual custody must survive future allocation conflicts. Late return records physical truth, flags affected booking, prevents unsafe handover.
- Default tenant/branch/asset identity avoids later destructive data-model replacement.
- Validate DBML with real parser; table counts and worker summaries cannot prove syntax or complete references.
- Same-tenant FKs do not enforce same-booking financial links or branch authorization. Add explicit invariants and real concurrency tests.
- Security deposit holding, refund payable and rental charges differ. Prevent double counting and concurrent over-refunds.
- Verify accepted S3 object version; reusable upload URL can overwrite evidence unless finalized immutably.
- Pin absolute workspace paths when sources move during a session; recheck before modifying originals.

## Validation boundary

- DBML parse/export passed. No database deployed, migrations applied, runtime tests or restore drills run.
- Graph describes original PRD only; token accounting unknown; seven undirected edge collapses documented.

## Scaffold continuation — 2026-09-15

Preserve five sibling repositories. Shared package is @rentivoo/contracts; local bootstrap tarball uses two final o characters in rentivoo. Mirror .claude into .codex using docs/scripts/sync-agent-config.mjs, retaining shell extensions and treating settings as reference-only. Poll tool sessions to completion before declaring installs blocked. No live migrations, remote settings, commits, pushes or package publication performed.
