# On-call checklist

The signals TRD §12 names as required tracking: "Track latency, transaction conflicts, database
pool wait, expired holds, outbox lag, failed scans, email bounces and unreconciled money without
logging personal content." Each one below: what it means, and the first thing to check.

**None of these signals may include personal content** — a dashboard, alert payload, or log line
for any of the below references tenant/reservation/payment IDs, never a customer's name, email
body, phone number, or evidence image (TRD §12).

## Latency

**What it means:** TRD §11's targets are p95 availability reads ≤500 ms, p95 ordinary mutations
≤1 s, excluding binary upload/provider email time (measured separately). A sustained breach
means either the database is slow (query plan regression, missing index, lock contention) or a
downstream dependency (Clerk, R2, email provider) is slow and the request path isn't timing out
around it.

**First thing to check:** is the elevated latency isolated to one endpoint/one tenant, or
system-wide? Isolated → likely a query plan or missing index for a specific access pattern.
System-wide → likely database pool exhaustion (see below) or a downstream dependency outage.

## Transaction conflicts

**What it means:** concurrent writes hitting the same row/constraint — expected background rate
from legitimate contention (two staff confirming near-simultaneously, the `EXCLUDE USING gist`
constraint doing its job per `docs/decisions/0002-drizzle-and-node-postgres.md`). An elevated *rate*
suggests either a hot row (one tenant, one asset, dominating contention) or application code
retrying without backoff and amplifying the conflict rate itself.

**First thing to check:** is the conflict concentrated on one tenant/asset (expected, possibly a
popular item needing a UX nudge) or is retry logic somewhere looping without backoff and
generating its own load? Grep application logs for the specific constraint/table name in the
conflict.

## Database pool wait

**What it means:** requests are queuing for a connection from the pool before they can even
start their query — a leading indicator of overload, distinct from query latency itself. TRD §9:
"Use bounded application pools and short interactive transactions." A rising pool-wait time
usually means either the pool is undersized for current load, or something is holding
connections open longer than it should (a long-running transaction, a connection leak).

**First thing to check:** is there a long-running or stuck transaction holding a connection?
(`pg_stat_activity` filtered to long `state = 'active'` or `idle in transaction` sessions.) A
connection leak in application code looks like pool wait rising over time with no corresponding
rise in request volume.

## Expired holds

**What it means:** TRD §11's target is p95 expired-hold release ≤60 s, and "correctness must not
depend on [the scheduled expiry worker] running on time" (TRD §5) — the database-level check at
hold-creation time is the actual correctness guarantee, the worker is cleanup. A rising count of
holds past their expiry and not yet released is a worker-health signal, not a correctness risk
by itself, but it degrades availability accuracy shown to guests.

**First thing to check:** is the expiry worker running at all (last successful run timestamp)?
If the worker is healthy but the count is still rising, check whether hold creation volume
itself has spiked beyond what the worker's batch size/frequency can keep up with.

## Outbox lag

**What it means:** the gap between when an event was written to the outbox (TRD §8: "Write
outbox events in the same transaction as the business event") and when a worker actually claimed
and processed it. Rising lag delays notifications, reminders, and any other durable side effect
— it does not by itself indicate lost work, because outbox rows persist until processed.

**First thing to check:** is the worker process actually running and claiming rows (`SKIP
LOCKED` claims visible in recent activity)? If the worker is running but lag is still rising,
check whether attempts are failing and retrying with backoff (TRD §8: exponential backoff with a
proposed maximum of eight attempts) — a spike in failures inflates effective lag even with a
healthy worker process.

## Failed scans

**What it means:** uploaded evidence/catalogue files that failed the required scanning step
before being marked available (TRD §7: "scan quarantined objects. Never execute uploaded
content."). A failed scan blocks that specific object from being finalized — it is a per-upload
failure, not a system health signal by default, but a sudden spike suggests either an attack
pattern (repeated malicious uploads) or a scanning service outage.

**First thing to check:** is the failure rate concentrated on one tenant/source (possible abuse —
see TRD §7's oversized/deceptive-content concern) or system-wide (the scanning dependency itself
is likely down or misconfigured)?

## Email bounces

**What it means:** the email provider reported a bounce for a sent notification (TRD §8: "UI
states distinguish queued, provider-accepted, delivered where known, bounced and failed").
Individual bounces are normal (typo'd addresses, full mailboxes). A rising bounce *rate* against
a stable send volume threatens sender reputation and future deliverability for every tenant, not
just the one whose email bounced.

**First thing to check:** is this concentrated on one template/one trigger (a bug producing a
malformed address or a broken personalization) or spread evenly (likely just organic bounce
rate — compare against the provider's own reputation dashboard once TRD §12's "email sender"
selection is finalized).

## Unreconciled money

**What it means:** verified payments, refunds, or deposit releases that have not been matched
to their expected posting/allocation — the practical, ongoing check behind TRD §11's "zero
duplicate postings" integrity target and TRD §6's allocation/refund-cap invariants. This is the
single most serious operational signal on this list: it is the direct, measurable proxy for a
money-correctness defect.

**First thing to check:** treat any nonzero unreconciled-money signal as SEV1 until proven
otherwise (`docs/runbooks/incident.md`) — do not wait for a threshold. Identify the specific
posting/reservation/payment IDs involved before taking any corrective action, so the evidence
survives whatever fix follows.

## Starting a shift

- [ ] Confirm you know the current incident owner and backup (`docs/runbooks/incident.md`) —
      or that you are it.
- [ ] Confirm you have access to whatever dashboard/alerting surface currently exists.
      DECISION NEEDED: TRD §12 lists "observability service" as a remaining selection — until an
      actual dashboard exists, this checklist is manual: check structured logs directly for the
      signals above.
- [ ] Confirm you know the current deployed version of `api`/`app`/`web` in production
      (`docs/runbooks/release.md`) — the fastest root-cause lead during an incident is usually
      "what deployed right before this started."
