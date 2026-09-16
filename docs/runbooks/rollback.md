# Rollback

How to undo a bad release on each surface, and — just as important — an honest statement of
what rollback cannot undo. Reach for this runbook after `docs/runbooks/incident.md`'s severity
assessment says rollback is the right response, not before evidence has been captured.

## The one thing to internalize before anything else

**Rollback reverses code. It does not reverse data.** Rolling `api` back to the previous
container image does not undo a migration that already ran, does not un-send an email, and does
not un-publish a file that a customer or another tenant already downloaded. TRD §9 says this
plainly: "do not assume an application rollback reverses a data migration safely." Treat every
rollback decision as two separate questions — "do I need to roll back the code?" and
"do I need to roll forward a data fix?" — because the answer is frequently "both, and in that
order."

## Rolling back `api` (server + worker)

1. Redeploy the previous known-good container image (the one before the current release), using
   the same rolling-deploy readiness checks as a forward deploy (`docs/runbooks/deploy.md`) —
   a rollback is a deploy, not a special-cased shortcut that skips readiness checks.
2. **Before rolling back, confirm the previous code version is actually compatible with the
   current database schema.** If the release you are rolling back from included a migration
   that the old code cannot tolerate (e.g., a `NOT NULL` constraint the old code's `INSERT`
   statements do not populate), rolling the code back will produce a new, different set of
   failures — not a fix. This is precisely why `docs/runbooks/migrations.md`'s
   expand/backfill/validate/switch/contract procedure keeps old and new code compatible with the
   schema during the deploy window: it is what makes a code rollback safe to do independently of
   a schema rollback.
3. If the schema is not backward-compatible with the previous code version, the correct action
   is a **forward** migration that restores compatibility (e.g., temporarily relaxing a
   constraint just enforced), not a rollback of the migration itself.
4. Roll back the worker artifact alongside the server artifact — they come from the same image
   (`docs/decisions/0004-worker-in-api-repository.md`), so rolling back one without the other
   reintroduces the exact version-mismatch problem the shared-image design avoids.
5. Confirm via the version/health signal (`docs/runbooks/release.md`) that the rollback actually
   took effect on every instance, not just the first one to redeploy.

## Rolling back `app` / `web`

1. Most managed Next.js hosts support an atomic "promote previous deployment" action — prefer
   that over a fresh redeploy from a reverted commit, because it is faster and does not depend
   on CI succeeding again under incident pressure.
2. Confirm the previous `app`/`web` version is compatible with the currently-deployed `api`
   contract version (`docs/runbooks/release.md`) — rolling `app` back past a point where it
   still expected the *old* API contract shape, while `api` has already moved past the
   both-shapes-valid window, reintroduces a real contract mismatch.

## Rolling back `contracts`

There is no meaningful "rollback" of a published package version — published versions are
immutable on the registry once published. Instead:

1. Publish a new version that reverts the schema/type change, following the same expand-style
   discipline as a forward release (`docs/runbooks/release.md`).
2. Every consumer that already adopted the bad version has to explicitly move to the new
   (reverted) version — it does not happen automatically, the same way a forward contract change
   requires each consumer to adopt it explicitly.

## What rollback cannot undo — stated plainly

- **An applied migration.** Data already backfilled, converted, or deleted by a migration stays
  that way when the application code is rolled back. Only a forward data-fix migration changes
  it back (`docs/runbooks/migrations.md`).
- **A sent email.** TRD §8: "exactly-once email delivery cannot be promised with an external
  provider," and there is no "unsend" regardless. If a release sent an incorrect notification
  (e.g., wrong pickup deadline after a reschedule bug), the fix is a correction communication
  and, if needed, a code fix to prevent recurrence — not a rollback pretending the email was
  never sent.
- **A published file.** TRD §7's evidence/upload model treats an accepted object as effectively
  immutable once approved; a public catalogue derivative that was live, even briefly, may already
  be cached or downloaded elsewhere. Removing it going forward is possible; guaranteeing it was
  never seen is not.
- **A completed external payment or provider webhook effect.** TRD §9 adversarial test 10
  covers exactly this: "Restore to a point before a completed external payment; reconcile
  references and disable automatic outbound side effects until duplicates are ruled out." A
  rollback does not reach into a payment provider's own ledger.

## After any rollback

- Capture what triggered it, per `docs/runbooks/incident.md`'s evidence requirements, before the
  state that prompted the rollback disappears.
- If the rollback was due to a migration incompatibility, the underlying fix is almost always a
  process gap in following `docs/runbooks/migrations.md`'s expand/backfill/validate/switch/
  contract discipline — record that as a lesson, not just a one-off incident.
