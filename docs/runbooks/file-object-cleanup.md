# R2 cleanup after file replacement

Use this procedure to roll out or operate asynchronous deletion of an R2 source object after an
owner replaces a clothing image, storefront image, payment QR, or payment instruction file. The
worker may delete only after the replacement commits, no current or historical reference remains,
and no legal hold or retention period protects the file.

This runbook does not authorize testing against production objects. Start in staging with synthetic
tenants and a non-production bucket. Never paste object keys, signed URLs, credentials, or file
contents into tickets, chat, or logs.

## Roll out to staging

The producer gate prevents a replacement from committing without its cleanup event. If the gate is
off and a replacement would displace an accepted object, the API returns a retryable `503` and
rolls back the business transaction, including its idempotency claim, so the attempt can be retried
after readiness checks. This may temporarily prevent affected replacements; it does not silently
leak an untracked object. Local development/test defaults on. Staging and production default off
and must be explicitly enabled after readiness checks.

1. **Confirm the release and target.** The release commit must include migration
   `0075_file_object_cleanup.sql`, the file cleanup worker handler, and producer gate
   `FILE_OBJECT_CLEANUP_ENABLED`. Confirm the target is staging and that its R2 credentials point
   only to the non-production private bucket. Do not use real customer files.
2. **Deploy compatible worker code while producers are off.** Set
   `FILE_OBJECT_CLEANUP_ENABLED=false` on the API. Deploy the handler-capable worker/API release and
   wait until every old worker instance has stopped. The pilot runs the worker as a supervised API
   child (`EMBEDDED_WORKER=true`), so every API replica must reach the compatible release before
   producers are enabled. If the worker is separate, deploy and verify the compatible worker first,
   then deploy the API release with producers still off. The handler remains active while the
   producer gate is off.
3. **Apply the migration only through the protected workflow.** Merge/push the reviewed release to
   `staging` and confirm the staging migration job applied `0075_file_object_cleanup.sql` and its
   final migration-status check is clean. Follow [`migrations.md`](migrations.md); do not mark the
   file applied manually, edit the ledger, or run schema changes from application startup. The new
   code is safe before the migration only while producers remain off and no cleanup event is
   delivered to an incompatible worker.
4. **Verify database and worker readiness.** Using an approved read-only/admin database session,
   verify the column, function, and worker grant exist, without reading file keys:

   ```sql
   SELECT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_object'
        AND column_name = 'lifecycle_status'
   ) AS has_lifecycle_column,
   to_regprocedure('public.file_object_has_references(uuid,uuid)') IS NOT NULL AS has_reference_check,
   has_function_privilege(
     'drezivo_worker', 'public.file_object_has_references(uuid,uuid)', 'EXECUTE'
   ) AS worker_can_check_references;
   ```

   All three values must be `true`. Also verify every worker reports the release containing the
   cleanup handler and can connect with the restricted worker role. If a check fails, leave the
   gate off and resolve it before proceeding.

5. **Enable producers.** Set `FILE_OBJECT_CLEANUP_ENABLED=true` on every API instance and restart or
   redeploy so the validated runtime config is loaded. Do not enable it on a partial rollout where
   any worker still runs code that does not register `file.object_cleanup.requested`.
6. **Run the staging smoke tests below.** Keep the gate off again if a test fails. A gate change
   takes effect only after the API process restarts.

The migration is additive and forward-only. Do not roll it back or delete the lifecycle function to
undo an application release.

## Staging smoke tests

Use a distinct, disposable accepted file for each replacement and keep a record of the opaque file
IDs and request IDs in the restricted test record. Do not record storage keys or signed URLs.

1. Exercise all three routes independently: replace a clothing image set; replace storefront logo,
   cover, hero, and about images; and replace a payment QR and instruction file. Confirm the new
   references commit, only displaced IDs get cleanup events, and retained/shared IDs do not.
2. Verify the worker processes cleanup after commit. Confirm a unique unreferenced source object is
   absent from the staging bucket, and that the file row becomes `deleted` only after storage
   deletion succeeds. Check the provider's configured versioning and public/custom-domain cache
   behavior separately. The adapter deletes the recorded source key; do not assume this removes
   every provider version, derivative, or already-cached copy. If the staging bucket keeps object
   versions or the result is ambiguous, stop and leave the production gate off until that behavior
   is designed and verified.
3. Confirm shared references, cross-tenant references, policy snapshots, measurement-guide images,
   financial evidence, legal holds, and future retention prevent deletion. Clear-only edits do not
   enqueue cleanup in this release; do not treat them as a passing replacement test.
4. Inject a storage delete failure only for a disposable staging object. Confirm the object remains
   untombstoned and the outbox retries with bounded backoff. Restore the test permission, confirm
   retry success, and verify safe diagnostics contain no key or URL. Exercise a terminal
   dead-letter in staging and confirm the Operations alert actually reaches its configured
   destination. Structured logging alone does not prove an alert is routed.
5. Verify the producer gate: with it off, a request that replaces an existing file receives a
   retryable `503`, its database changes roll back, and no cleanup event is committed. Re-enable it
   only after restoring a compatible worker and schema.

Record the release ID, migration job, worker/API release IDs, test request IDs, event IDs/statuses,
and alert receipt in the restricted staging evidence record. Never include object keys, signed
URLs, credentials, or image contents.

## Inspect, retry, or hold a cleanup

There is currently no dedicated Drezivo UI/API for file-cleanup operations. Use the approved,
access-controlled database operator path; do not use the `drezivo_app` runtime role. A migration
credential is not a routine on-call credential. Production operations require the normal DBA
authorization and change record.

To inspect due or failed cleanup work, select only operational metadata. Do **not** select `payload`
or join `file_object.storage_key`:

```sql
SELECT id, tenant_id, event_type, status, attempts, max_attempts,
       available_at, safe_last_error
  FROM public.outbox_event
 WHERE event_type = 'file.object_cleanup.requested'
   AND status IN ('pending', 'leased', 'dead')
 ORDER BY available_at;
```

- A `pending` event is retried by the worker at `available_at`; reference/hold/retention deferrals
  remain pending and do not consume a failure attempt. Do not manually change a live lease.
- A `leased` event may still be executing. Check worker health and allow its lease to finish or
  expire; do not clear its lease token by hand.
- For a `dead` event, fix the underlying storage/permission/configuration problem first. Then, with
  DBA approval, requeue only the reviewed event UUID using an exact type-and-status guard. This
  resets the bounded retry count and clears only the sanitized diagnostic:

  ```sql
  BEGIN;
  UPDATE public.outbox_event
     SET status = 'pending', attempts = 0, safe_last_error = NULL,
         available_at = now(), lease_token = NULL, lease_until = NULL,
         completed_at = NULL, updated_at = now()
   WHERE id = '<reviewed-outbox-uuid>'::uuid
     AND event_type = 'file.object_cleanup.requested'
     AND status = 'dead'
  RETURNING id, event_type, status, attempts, available_at;
  COMMIT;
  ```

  Exactly one row must be returned. If zero rows are returned, stop and re-inspect; do not broaden
  the predicate. Verify worker completion afterward using the metadata query. Escalate if the
  worker dead-letters the retry again.

- There is no product-level legal-hold control yet. A DBA-authorized hold may be placed only while
  the file remains `accepted`; row locking serializes it with the worker's deletion barrier. Do
  not try to change protection after cleanup has entered `deletion_pending` or `deleted`:

  ```sql
  BEGIN;
  UPDATE public.file_object
     SET legal_hold = true
   WHERE tenant_id = '<reviewed-tenant-uuid>'::uuid
     AND id = '<reviewed-file-uuid>'::uuid
     AND lifecycle_status = 'accepted'
  RETURNING id, lifecycle_status, legal_hold;
  COMMIT;
  ```

  One row must return with `lifecycle_status='accepted'` and `legal_hold=true`. If no row returns,
  stop and escalate; the deletion barrier may already have won. Release the hold only through an
  equally reviewed transaction after the retention/legal basis ends. The worker will re-evaluate a
  held or retained candidate on a later retry.

- `safe_last_error` is sanitized diagnostic text, but still treat logs and query output as
  restricted operational data. The worker log message `outbox event moved to dead-letter` includes
  event metadata, not storage keys. The actual notification route must be confirmed in the
  environment; if no alert arrives, open/raise the Operations incident manually.

## If rollout or cleanup fails

1. Set `FILE_OBJECT_CLEANUP_ENABLED=false` and restart every API instance. Replacement writes that
   would enqueue cleanup now fail transactionally; this prevents new unsupported cleanup events.
2. Keep a handler-capable worker running to drain already-queued cleanup events if it is healthy.
   If the worker is unsafe, stop worker consumption (for the embedded pilot, set
   `EMBEDDED_WORKER=false` and restart; for a separate worker, pause that service). Do not start an
   older worker that lacks the cleanup handler while any cleanup event remains unresolved.
3. Do not roll back migration `0075` or manually delete/tombstone a file. Keep the compatible code
   and schema in place, investigate the sanitized error and staging reproduction, then fix forward.
4. Before any rollback to code without the handler, prove there are no `pending`, `leased`, or
   `dead` cleanup events. If unresolved events exist, keep the compatible worker available or keep
   worker consumption stopped until a compatible release is restored. Pause affected replacement
   operations during that interval.

## Production gate

Production stays disabled until the staging smoke suite and all checklist items required for
production are evidenced, including reference/retention safety, object-version/cache behavior,
and a confirmed dead-letter alert destination. The protected migration workflow must apply and
verify the migration under the production environment's approval gate. Then repeat the compatible
worker-first, migration-verified, producer-enable sequence against production with a reviewed
change window. Do not use a staging object or test credential against production, and do not enable
producers merely because the code build passed.
