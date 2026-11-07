# Platform payment QR storage

Platform payment QR images use the Business API's private object storage bucket under
`platform-files/payment-methods/`. The database stores the object key, MIME type, byte length,
and SHA-256 digest. Operator and business clients receive image bytes through authenticated API
routes; object keys and storage credentials are not returned to browsers.

## Rollout

1. Apply the numbered schema migration using the approved migration workflow. Deploy the Business
   API and worker with the existing `OBJECT_STORAGE_*` values and matching internal-service
   authentication. Set `OBJECT_STORAGE_UPLOADS_ENABLED=true` when the environment is approved for
   R2 writes; production defaults to disabled. The Business reader supports legacy database bytes
   and verified R2 objects.
2. Deploy the updated Operator API. Ensure every Operator and Business API instance has updated
   before removing any legacy bytes. New QR writes go through the Business API and R2.
3. From the Business API workspace, run `npm run platform-qr:migrate -- --copy`. The command is
   restartable. It leaves legacy bytes in place and verifies each R2 copy before recording it.
4. Rerun the copy command after concurrent edits have settled. Confirm the copy succeeds, both
   clients can display the QR images, and all readers are upgraded. Then run
   `npm run platform-qr:migrate -- --finalize --confirmed-readers-upgraded`. Finalization verifies
   each object and clears database bytes only when its legacy image and version are unchanged.
   If a row changes or an object is unavailable, retry the copy and finalize commands.

The worker retries abandoned uploads and replaced or removed objects from the durable cleanup
queue with backoff. Cleanup locks each queue item and checks for an active database reference before
deletion. After ten failures an item enters `failed`; inspect worker logs for `platform QR cleanup`
failures and repair storage connectivity. Then run `npm run platform-qr:migrate -- --retry-cleanup`
to requeue failed items. The worker rechecks references before every deletion, including retries.
An unavailable worker delays cleanup; it does not invalidate a successfully saved QR.
Use the continuous worker or a full scheduled drain; the fast drain scope does not run this sweep.
Do not apply migrations or run backfills against an environment without its approved rollout.
