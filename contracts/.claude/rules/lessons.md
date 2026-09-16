# Lessons

Append-only, newest entry on top, dated. This is where durable learnings — bugs found, gotchas
hit, wrong assumptions corrected — get recorded so they never repeat. Do NOT put learnings in
`CLAUDE.md`; that file is a lean index and has a hard line-count cap. This file has no cap.

## 2026-09-15 — why this package exists

`contracts` is the only thing standing between three independently-deployed repos (`api`, `app`,
`web`) silently disagreeing about a wire shape. There is no compiler shared across repos — a
TypeScript type defined inside `api` and hand-copied into `app` can drift the moment either side
changes without the other noticing, and nothing red appears in either repo's CI. It shows up
first in a browser: a field `app` expects is missing, or a money field `web` parsed as a number
lost precision, and the failure is a production support ticket, not a build error. Every request/
response shape the three consumers share belongs here, validated with Zod (so it fails at the
HTTP boundary, not three components downstream) and typed via `z.infer` (so `api`, `app`, and
`web` cannot each hand-write a slightly different duplicate that quietly diverges from the
schema that actually validates the wire).

## 2026-09-15 — Scaffold verification

Use the exact packed contracts filename `rentivoo-contracts-0.1.0.tgz`. Poll long-running install/build sessions through completion. Shell hooks retain `.sh`; CommonJS hooks need an explicit module scope. Codex settings mirrors are reference-only, not native hook registration.
