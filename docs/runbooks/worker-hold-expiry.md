# Scheduled reservation expiry

This release reduces idle database traffic while retaining the embedded worker. It changes only
hold expiry and system-transaction context setup. Other sweeps, the outbox, emails, image processing,
and request-time capacity reclamation retain their behavior. No API or browser contract changes.

## How it works

- Migration `0098_reservation_expiry_schedule.sql` creates one small schedule row per reservation
  in `held` or `pending_confirmation` with a deadline. A reservation trigger maintains it in the
  same transaction, including deadline extensions and terminal transitions. Deletion cascades.
  Unrelated/no-op reservation updates do not rewrite the schedule. Existing eligible rows,
  including overdue ones, are backfilled while the trigger-installation lock prevents a write gap.
- The worker can read schedule metadata across businesses, but cannot write it directly or invoke
  its private trigger function. Reservation reads/writes still require tenant context and RLS.
  The table stores only tenant ID, reservation ID and expiry time, never customer details.
- With `WORKER_HOLD_EXPIRY_MODE=scheduled`, a pass runs at startup and every
  `WORKER_HOLD_SWEEP_INTERVAL_MS` (default ten seconds). An idle pass is one SELECT and no
  per-business transactions. Discovery returns at most ten due businesses in rotating UUID order.
  The cursor advances on failures and locked batches too, preventing a busy or failing business
  from permanently starving later businesses. Restart resets the cursor, not the durable work.
- Each business transaction processes at most 100 due reservations. It locks reservations with
  `SKIP LOCKED`, checks their current state/deadline using database time, and atomically expires
  them, releases allocations and appends the existing audit/outbox effects. Batch inserts replace
  per-reservation effect queries. Trigger schedule writes follow reservation locks.
- A pass stops starting transactions after five seconds. Each scheduled business transaction uses
  a one-second statement timeout, 500 ms lock timeout, and five-second idle-transaction timeout.
  The active transaction finishes or rolls back; the five-second pass budget is not a hard wall
  clock kill. Failures remain scheduled for the next pass. Shutdown stops starting businesses,
  waits for the active transaction, and retains durable work for restart.
- System transactions now set tenant, principal and system actor in one parameterized statement
  on the same pooled connection. These settings remain transaction-local and reset after commit
  or rollback. Account/operator helpers are unchanged.

Both `drain` scopes (`all` and `fast`) run one bounded hold pass before their existing outbox work.
An overdue backlog can require several passes/drain invocations. Continuous mode processes up to
1,000 reservations across ten businesses per tick when transactions fit the budget. The target
is release within 30 seconds under normal awake/healthy conditions; host sleep, outages, lock
contention or a large backlog can exceed it. A new booking still performs authoritative reclaim.

## Staging rollout and rollback

1. Inventory API replicas and separate worker services. Record commit, expiry mode, interval and
   whether each runs an embedded child. Never print connection strings. `WORKER_ENABLED=false`
   on the parent API does not disable `EMBEDDED_WORKER=true`.
2. Record a full-day baseline of Shared Pooler egress and worker query counts. Use comparable
   traffic, number of awake hours and worker instances. Do not reset shared query statistics.
3. Review pending migration history and apply 0098 to staging through the normal migration runner.
   It is additive and compatible with old workers. Its initial backfill takes a reservation-table
   write lock: measure migration duration against representative staging volume before production.
   The migration fails closed unless its owner can read all tenants despite RLS; use the approved
   migration owner, never the worker or API runtime role. Its trigger runs as that owner.
4. Deploy the code initially with `WORKER_HOLD_EXPIRY_MODE=scan`. Then enable `scheduled` on the
   staging worker/API parent and restart. Keep `EMBEDDED_WORKER=true` and the ten-second interval.
   Confirm `worker process starting` reports `holdExpiryMode: scheduled`. Never run both expiry
   modes inside one process; retire old replicas to obtain the expected traffic reduction.
5. Exercise held and pending-confirmation deadlines, extensions, confirmations, cancellations,
   duplicate delivery, competing bookings, worker restarts and a backlog spanning over ten
   businesses. Measure expiry-to-release latency under normal API traffic; require <=30 seconds
   before reviewing production rollout. Verify unrelated email, invitation and image jobs still run.
6. Compare another complete day of egress and query counts. Production rollout is a separate
   review; tests are not evidence of production egress savings or hosted latency.

Rollback: set `WORKER_HOLD_EXPIRY_MODE=scan` and restart. Leave the new table and triggers in place;
do not drop schedule data or edit migration history. The scan ignores the schedule and still expires
due holds; restoring scan increases database traffic. An absent/invalid schedule in scheduled mode
fails visibly and retries; it does not silently switch into expensive scans.

## Measurement and troubleshooting

`scheduled hold expiry activity` logs five-minute aggregates: `discoveries`, `businesses`, `expired`,
`failures`, `failureKinds`, `maxObservedLagMs`, and `windowMs`. Failure categories distinguish lock/
statement timeouts, permissions, missing schema, connection errors and unexpected failures without
logging their messages. It also flushes at shutdown/drain completion. Lag is
the oldest selected scheduled deadline, not a percentile or a complete backlog maximum. The normal
`worker sweep activity` log adds run/failure/skip/duration counters. No customer data, raw SQL error
details or reservation IDs are logged by this sweep. Nonzero failures or increasing lag need review.

Capture snapshots of these read-only aggregates with an authorized database diagnostic role:

```sql
SELECT count(*) AS due_reservations, count(DISTINCT tenant_id) AS due_businesses,
       extract(epoch FROM (statement_timestamp() - min(expires_at))) AS oldest_due_seconds
FROM reservation_expiry_schedule WHERE expires_at <= statement_timestamp();

SELECT calls, rows, total_exec_time, queryid
FROM pg_stat_statements
WHERE userid = (SELECT oid FROM pg_roles WHERE rolname = 'drezivo_worker')
  AND (query ILIKE '%reservation_expiry_schedule%'
       OR query ILIKE '%set_config%' OR query IN ('BEGIN', 'COMMIT', 'ROLLBACK'));
```

Compare deltas over equal windows, including `stats_reset` from `pg_stat_statements_info`. Query
counts and rows are not byte measurements: use Supabase Shared Pooler egress for the actual result.
For eight idle businesses, the former expiry path did about 49 SQL statements per tick; scheduled
mode does one (8,640/day at ten seconds per continuously awake worker). Other sweeps and connections
still consume egress. This release does not promise a particular percentage or a sub-5-GB month.

Use the disposable-database integration suite `reservation-expiry-schedule.test.ts` for reproducible
RLS, rollback, fairness, concurrency, batch limits and query counts at 1/10/100 idle businesses.
Never point it at a shared, development or production database.
