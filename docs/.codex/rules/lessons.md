# Lessons

> AUTO-LOADED. Append-only. Newest entry on top. Each entry is dated. Do not delete or rewrite
> a past entry — if a lesson turns out to be wrong or superseded, add a new entry saying so
> rather than editing history out of this file.

## 2026-09-15 — An unversioned specification is a specification that silently stops being true

The root specification documents for this project (`Rentivo-TRD.md`, `Rentivo-PRD.md`,
`Rentivo-Data-Model.md`, `Rentivo-ERD.dbml`, `Rentivo-Market-Research.md`) were not in version
control until 15 September 2026. Before that date, there was no history of what the
specification said at any given point, no diff showing what changed between two decisions, and
no way to answer "was this always the plan, or did it change last week and nobody updated the
other docs" — because there was no record to check against, only whatever the most recently
edited file happened to say at the moment someone opened it.

This is the same failure mode `docs/AGENTS.md` already warns about in prose ("Do not leave
stale notes that contradict the current product direction without labeling them as historical
or superseded") — but a warning to label stale content only works if there is a mechanism to
tell what is stale in the first place. Version control is that mechanism. A specification that
cannot be diffed against its own past cannot be trusted to describe the present, because nothing
distinguishes "this was decided" from "someone typed this and moved on."

**The lesson, generalized:** any document whose job is to be a source of truth — a spec, a
runbook, a decision record — needs the same discipline code gets: committed, reviewed, dated,
and diffable. Treat an unversioned "living document" sitting outside git as equivalent to an
untested piece of code that happens to run today — it might be right, but nothing is checking,
and nobody can tell you when it last was.

## 2026-09-15 — Scaffold verification

Use the exact packed contracts filename `rentivoo-contracts-0.1.0.tgz`. Poll long-running install/build sessions through completion. Shell hooks retain `.sh`; CommonJS hooks need an explicit module scope. Codex settings mirrors are reference-only, not native hook registration.
