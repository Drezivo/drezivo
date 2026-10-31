# Private media delivery

The source R2 bucket stays private. Browsers never receive R2 object URLs, keys, or signatures. Uploads still use short-lived, single-object presigned `PUT` URLs; this guide covers image reads.

## Current request paths

### Public storefront images

Storefront data contains an absolute API-host URL such as `https://api.drezivo.shop/api/media/public/stores/{slug}/files/{fileId}?w=960`.

1. The API-host Cloudflare Worker looks up the URL plus width in its local cache. A fresh entry is served for up to 45 seconds.
2. On a miss, the Worker requests a private, server-to-server grant from the API. The API rechecks publication, tenant, file state, image purpose, current storefront reference, and the selected 320/960/1600 variant before issuing a 60-second R2 read grant.
3. The Worker fetches the private object, validates its response, returns the image and caches it. R2 URLs and signatures stay between the Worker and R2.
4. If grant/R2 delivery fails transiently, the Worker asks the API's direct public stream for the same URL. That stream performs the publication checks again and returns a 45-second edge-cacheable response.
5. If Worker execution fails or its request quota is reached, the Cloudflare route must be configured **Fail Open**. The request proceeds to the API origin, where an eligible-for-cache rule honors the direct stream's `s-maxage=45` response header. Keep the default query-string cache key so widths stay distinct, and do not override Edge TTL.

The Worker route and Cache Rule cover only `/api/media/public/*` on the staging and production API hosts. When both delivery layers and the API/R2 are unavailable and no fresh edge copy exists, the image cannot load; web/app pages should keep their layout usable with an image placeholder and bounded retry.

### Staff images

The app browser fetches image bytes directly from the API with a Clerk bearer token and the selected branch ID in a header. The API rechecks tenant, branch, purpose, permissions, and the live business-record reference. These responses are `private, no-store`. The app no longer proxies image bytes or image grants through a Vercel route.

### Store previews

The API includes a short-lived preview media session in preview storefront data. For each lazy-loaded preview image, the browser requests a file-scoped grant and fetches the bytes with the grant in a header. The API checks that the file is still referenced by that store. Grants are limited to five minutes and preview responses are `private, no-store`; a delayed image can request a fresh grant. Neither the session nor media grant is put in a URL.

### Renter payment-step images

A guest with the reservation's HttpOnly API cookie requests a five-minute grant scoped to that reservation and file, then sends it in a header to the API image stream. The API rechecks the reservation snapshot and file reference. These responses are `private, no-store`; the browser refreshes an expired grant once. The page uses a placeholder with bounded retry if delivery remains unavailable.

Private PDF document delivery is unchanged. Staff PDFs continue through the existing app document route, which forwards authorized requests to the API. This exception is for documents only; R2-backed image bytes do not pass through Vercel media routes.

## Environment configuration

- API: `MEDIA_PUBLIC_ORIGIN` is the exact API HTTPS origin for the environment. `MEDIA_READ_GRANT_SECRET` authenticates Worker-to-API public grants and signs API media sessions/grants. `CLOUDFLARE_MEDIA_ZONE_ID` and `CLOUDFLARE_MEDIA_PURGE_TOKEN` let the API outbox worker purge cache tags directly from Cloudflare.
- Cloudflare Worker: `API_ORIGIN` and the matching environment's `MEDIA_READ_GRANT_SECRET`.
- App: browser-safe `NEXT_PUBLIC_API_ORIGIN`, Clerk configuration, and existing `API_BASE_URL`. Staff image reads use the Clerk token in the browser.
- Web: browser-safe `NEXT_PUBLIC_API_ORIGIN` and existing server-side `API_ORIGIN` used for storefront data.

Do not configure `MEDIA_READ_GRANT_SECRET` in app/web or expose it with a `NEXT_PUBLIC_` prefix. Do not put secrets, grants, R2 URLs, or object keys into logs. The API, API worker, and Cloudflare Worker must use matching grant secrets for each environment. See [`environments.md`](environments.md).

## Private derivatives and cleanup

Eligible accepted images receive private WebP variants at widths 320, 960, and 1600. Until a variant exists, reads fall back to the accepted source image. Migration `0080_file_image_variants_backfill.sql` queues existing accepted images; new acceptances enqueue jobs transactionally. Migration `0081_storefront_media_cache_invalidation.sql` adds tenant-scoped invalidation events. Apply both through the protected migration workflow before enabling this delivery flow. Cleanup removes source and variant keys before marking a file deleted.

## Verification and rollout

- Keep `r2.dev` and public bucket domains disabled; scope the R2 token to the private bucket and required object operations.
- Set the API and Worker environment variables above. Configure the two API-host Worker routes as **Fail Open**, and create the matching Cloudflare Cache Rule with cache eligibility enabled and origin cache-control honored. The API sets the 45-second edge TTL; keep the default cache key's query string so the `w` variants stay distinct.
- Roll out API routes and configuration first, then app/web URL and image-fetch changes, then Cloudflare routes and cache rules. Do not enable routes before matching code and secrets are live.
- On staging, verify Worker `MISS`, `HIT`, 45-second expiry, all three widths, and an independent cold-region miss. Bypass the Worker and verify the API response fills the native CDN cache.
- Force transient grant/R2 errors and verify the API fallback; confirm authorization/publication errors remain errors. Check staff tenant/branch denial, preview store/file scope and grant refresh, guest reservation/file scope and grant refresh, and `private, no-store` headers.
- Verify CORS preflights for the authorization and media-grant headers. Inspect requests and logs to confirm no R2 URL, object key, signature, or credential appears in a browser URL or application log.
- Confirm image requests do not reach a Vercel media endpoint. On API/R2 failure with no cache copy, confirm pages remain usable and image components show a placeholder with bounded retry.
- Monitor Worker requests/cache hits, API/R2 fallback volume, media failures, Cloudflare purge errors, and Vercel Fast Origin Transfer. R2 image transfer should leave Vercel; page and bundled static asset traffic remain on Vercel.

See [`cloudflare-media-worker-setup.md`](cloudflare-media-worker-setup.md) and the [delivery evolution guide](../architecture/object-storage-image-delivery-evolution.md) for the operational checklist and design history.
