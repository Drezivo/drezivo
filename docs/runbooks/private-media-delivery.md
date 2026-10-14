# Private media delivery

The source bucket remains private. Uploads still use a short-lived, single-object presigned PUT;
downloads use application routes so browser clients never receive an R2 hostname, object key, or
signed GET URL.

## Request flow

- Public storefront URLs are stable `/api/media/public/{slug}/{fileId}` URLs on `web`. A CDN miss
  calls the API's internal grant route. The API checks the published store, accepted/frozen file,
  tenant, purpose, and current public reference before signing one R2 GET for 60 seconds. `web`
  fetches the object server-to-server and streams the bytes.
- Public image responses carry a 45-second Vercel CDN lifetime and tenant cache tag. The browser
  must revalidate its stable URL, so it does not need a page reload after the internal R2 grant
  expires. The API worker deletes tenant-tagged cache entries when relevant published content,
  access state, or file references change. Deletion prevents stale-while-revalidate from returning
  bytes after a visibility revocation. The 45-second lifetime is the fallback if invalidation is
  delayed.
- Draft previews use `/api/media/preview/{slug}/{fileId}`. That route forwards the HttpOnly preview
  token to the API and never caches the image.
- Staff files use `/api/media/staff/{fileId}` on `app`. The app server sends the Clerk token and
  selected branch to the API, which checks tenant membership, branch, purpose, permissions, and the
  live business-record reference before issuing a grant. Staff responses are always `private,
  no-store`.
- R2 signed URLs exist only between trusted servers. Their 60-second expiration does not expire a
  public application URL, and clients do not need to refresh a page because the grant changed.

## Environment configuration

Set a different random `MEDIA_READ_GRANT_SECRET` per environment on the API, API worker, `web`, and
`app`. It must be at least 32 characters and must never be exposed as `NEXT_PUBLIC_*`. Set
`STOREFRONT_WEB_URL` on the API and worker to that environment's exact HTTPS `web` origin. The web
deployment needs its server-side `API_ORIGIN`; the app deployment needs `API_BASE_URL`. See
[`environments.md`](environments.md) for the full environment inventory.

The secret rotation procedure is coordinated: set the same new value on API/worker/web/app, then
restart or redeploy each service. During a mismatched rollout, media grants fail closed with a
service error. Do not log or paste secret values, R2 URLs, or object keys into incident reports.

## Private derivatives and cleanup

The worker generates WebP variants at 320, 960, and 1600 pixels after accepting eligible image
files. Migration `0080_file_image_variants_backfill.sql` queues existing accepted images; new
acceptances enqueue jobs transactionally. Until the worker writes a variant, reads fall back to the
accepted source image. PNG source images use lossless WebP encoding to preserve QR and document
edges. Migration `0081_storefront_media_cache_invalidation.sql` adds tenant-scoped outbox
invalidation triggers. Both migrations must be applied before enabling this flow in a deployed
environment. File cleanup removes source and variant keys before marking the database row deleted.

## Verification and rollout

- Keep `r2.dev` and public bucket domains disabled. Verify the R2 token is scoped to this private
  bucket and required object operations.
- Set the environment variables above before deploying API and web/app code.
- Apply migrations `0080` and `0081` through the protected migration workflow; do not run them
  against production from a developer workstation.
- Deploy API and worker, then `web` and `app` to the matching environment. Confirm the worker has
  processed derivative and invalidation outbox events.
- In browser network tools, confirm image requests use the application origin, a public image has a
  Vercel cache lifetime no longer than 45 seconds, and preview/staff responses say `private,
  no-store`. Confirm response headers and bodies contain no R2 URL, key, or signature.
- Use only a confirmed test bucket for anonymous-read-denial checks. Do not run a live-storage test
  against production as part of routine rollout.
