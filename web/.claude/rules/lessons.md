# Lessons

Append-only. Newest entry on top. Each entry is dated and records a durable lesson — a bug,
a gotcha, or a wrong assumption — so it never repeats. Never delete or rewrite an old entry;
if a lesson is later found wrong, add a new dated entry correcting it instead of editing history.

---

## 2026-09-15

A guest capability link/token is a bearer credential (per `Rentivo-TRD.md` §3 "Guest access") —
possessing it is sufficient to act as that guest. It must never be logged, put into an analytics
payload, or allowed to leak via a `Referer` header: guest routes must set
`referrerPolicy: 'no-referrer'` and `Cache-Control: no-store`. A reservation reference number or
an email address is explicitly NOT authentication — either can be guessed, shared, or scraped —
and must never be treated as if it were a valid credential for accessing or mutating a guest's
reservation.

## 2026-09-15 — Scaffold verification

Use the exact packed contracts filename `rentivoo-contracts-0.1.0.tgz`. Poll long-running install/build sessions through completion. Shell hooks retain `.sh`; CommonJS hooks need an explicit module scope. Codex settings mirrors are reference-only, not native hook registration.
