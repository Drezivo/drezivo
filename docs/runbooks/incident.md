# Incident response

What to do when something is actively broken in production. Read this before touching anything
if you are not already mid-response.

## Severity levels

- **SEV1 — active money or data-integrity defect, or full outage.** Duplicate financial
  postings, overlapping blocking allocations (double-booked garment), cross-tenant data
  exposure, or the API/storefront is down for all or most tenants. TRD §11's integrity target
  is explicit: "no percentage allowance for financial duplication" — any confirmed duplicate
  posting is SEV1 regardless of dollar amount. Page immediately.
- **SEV2 — a significant feature is broken for a meaningful subset of tenants, no data
  corruption.** Checkout failing for one payment method, exports failing, notification delivery
  stalled outbox-wide. Respond within the on-call response window.
  DECISION NEEDED: confirm the actual SEV1/SEV2 response-time SLA once support hours are
  established (TRD §12 lists "support hours" as a remaining selection).
- **SEV3 — a minor or cosmetic defect with a known workaround, affecting a small number of
  tenants or none.** A display glitch, a non-blocking validation message, a slow but succeeding
  report. Triage and fix during business hours the following day; no page.

## The incident-owner role

One person is the **incident owner** for the duration of the incident. They do not necessarily
fix it themselves — they own the decision-making: what gets tried, when to escalate, when to
communicate, when to declare it resolved. Anyone can be the incident owner; the first person to
notice a SEV1/SEV2 and start responding claims the role explicitly ("I'm incident owner on
this") so a second and third responder do not both assume someone else is coordinating.

DECISION NEEDED: name the incident owner and a backup by role or person, per TRD §12's
"Before paid launch: name an incident owner and backup." Until named, the first responder to a
page is the de facto owner for that incident and says so out loud/in the incident channel.

## Communication path

DECISION NEEDED: TRD §12 lists "alert routing" and "support hours" as remaining selections —
the actual paging tool, incident channel, and tenant-communication channel are not yet chosen.
Until they are, this section records the shape the decision needs to fill:

- An internal incident channel/thread, created per incident, where the incident owner posts
  status updates at a fixed cadence (not "whenever something changes" — a fixed cadence, e.g.
  every 15 minutes for SEV1, sets the expectation for people waiting on an update).
- A tenant-facing communication channel for incidents affecting customer-visible behavior —
  whether that is a status page, direct email, or an in-app banner is undecided; whichever it
  is, it must never include another tenant's data or an internal evidence detail (TRD §3: no
  default impersonation or unrestricted customer-record browsing applies equally to how an
  incident is described externally).

## Evidence to capture before restarting anything

**Restarting a process, rolling back a deploy, or clearing a queue can destroy the evidence you
need to find the actual cause.** Before taking any corrective action beyond stopping active harm
(e.g., disabling new checkout intake to stop a duplicate-posting bug from creating more
duplicates), capture:

- The exact error messages and `request_id` values involved (TRD §4's error envelope carries a
  `request_id` specifically so this is possible) — copy them out of logs before log retention
  rotates them away.
- The affected tenant/reservation/payment IDs, if the incident is scoped to specific records —
  needed both for the fix and for the eventual reconciliation TRD §11 requires ("unreconciled
  money" is a tracked signal, `docs/runbooks/oncall-checklist.md`).
- A timestamp of when the behavior started, cross-referenced against the deploy history
  (`docs/runbooks/release.md`) — "what changed right before this started" is usually the fastest
  path to a cause.
- Current state of any in-flight database transaction, outbox row, or worker lease relevant to
  the incident, if inspectable safely — this is what tells you whether a partial effect already
  landed (relevant to TRD §11 adversarial test 3's worker-outage scenario).
- **Never capture customer personal data, payment details, or identity evidence into an
  incident channel, ticket, or external report.** TRD §12: track signals "without logging
  personal content." Reference by opaque ID, not by name/email/document image.

Only after this evidence is captured (or a deliberate, stated decision that active harm
outweighs evidence preservation — e.g., a live duplicate-booking bug that must be stopped
immediately) should you restart, roll back, or otherwise change system state. See
`docs/runbooks/rollback.md` for what a rollback specifically can and cannot undo, and
`docs/runbooks/migrations.md` for why a rollback is not automatically the safe first move when a
migration is involved.

## Declaring resolution

An incident is resolved when the causing condition is confirmed fixed (not just "symptoms
stopped"), any data-integrity effect has a forward-fix plan (`docs/runbooks/rollback.md`: roll
forward, don't rely on rollback to undo data), and the incident owner posts a closing summary
including root cause (or "root cause not yet confirmed, monitoring" if genuinely unresolved —
never a false "resolved" to close the channel).

## Related runbooks

- `docs/runbooks/oncall-checklist.md` — the signals that typically trigger an incident and what
  each one means.
- `docs/runbooks/rollback.md` — undoing a bad release.
- `docs/runbooks/migrations.md` — why data fixes roll forward, not back.
- `docs/runbooks/security-incident.md` — use this instead when the incident is specifically a
  leaked credential.
