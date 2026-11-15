# Cloudflare media Worker

The Worker handles public R2-backed images and, when explicitly enabled, anonymous storefront
reads on the API host. Vercel continues to host the
web and staff app pages; public image bytes use Cloudflare and R2. Staff images, private previews,
and renter payment-step images stream directly from the API and never use a Vercel image route.
Private PDF documents retain their existing app delivery path.

## Public image request

The browser receives an API URL such as
`https://api.drezivo.shop/api/media/public/stores/{slug}/files/{fileId}?w=960`.

1. On every image request, including a cache hit, the Worker calls the API's internal grant endpoint with
   `X-Drezivo-Media-Grant`. The API rechecks publication, tenant, file state, image purpose, and
   the current storefront reference, then issues a 60-second server-to-server R2 read grant.
2. The Worker checks its local Cloudflare Cache API entry, keyed by the API URL and image width.
   Entries live for 45 seconds and carry `tenant-{tenantId}` and `media-{fileId}` cache tags.
3. On a miss, the Worker fetches the private R2 object, validates its image type and size, returns the bytes,
   and fills its local cache. R2 URLs and signatures are never forwarded to the browser.
4. On a transient API grant or R2 failure, the Worker requests the same API-host URL directly.
   The API stream rechecks publication and file reference and sends `private, no-store`.
   Authentication/publication failures from the grant endpoint are preserved
   and do not fall back.

The API's direct stream at `/api/media/public/stores/{slug}/files/{fileId}` is also the origin
response when Cloudflare bypasses the Worker. It applies the same database publication checks,
returns `Cache-Control: private, no-store`. Do not override this header with a Cache Rule: doing so
would let an edge cache serve withdrawn images without a visibility check. Remove any earlier
direct-origin cache entries during rollout.

## Routes and secrets

The Wrangler configs declare two routes per environment:

- Staging: `api-preview.drezivo.shop/api/media/public/*`
- Staging: `api-preview.drezivo.shop/api/v1/public/stores/*`
- Production: `api.drezivo.shop/api/media/public/*`
- Production: `api.drezivo.shop/api/v1/public/stores/*`

The storefront route invokes the Worker for all matching requests, including requests it bypasses.
Only anonymous shop, catalogue, and product GETs are eligible. The feature flag
`PUBLIC_STOREFRONT_CACHE_ENABLED` defaults to `false` in both configs. When enabled, entries have
at most 60 seconds of lifetime from the start of the origin read; every hit checks current public
visibility with the API, and shop booking and payment state is refreshed. Browser responses are
`private, no-store`. Previews, credentials, availability, holds, quotes, and payments bypass the
shared cache. A failed cache can be bypassed; a failed visibility check must not serve cached data.

The Cloudflare dashboard route must use **Fail Open**. This lets requests go straight to the API
origin if Worker execution fails or the Workers Free daily request budget is reached. The origin
must remain uncached so it can repeat the live visibility check. Keep staff, preview, guest, and
PDF paths outside shared caches.

Set `API_ORIGIN` in each Wrangler config. Set `MEDIA_READ_GRANT_SECRET` as a Worker secret matching
the API's environment-specific value. It authenticates server-to-server media grants and visibility
checks. The API
also needs `MEDIA_PUBLIC_ORIGIN`, `CLOUDFLARE_MEDIA_ZONE_ID`, and
`CLOUDFLARE_MEDIA_PURGE_TOKEN`; the latter token is scoped to Cache Purge for the relevant zone.
Neither secret belongs in the web/app environment or browser bundle.

## Cache invalidation

When media visibility or references change, the API outbox worker calls Cloudflare's cache purge
API directly with the `tenant-{tenantId}` tag. A rejected purge is retried by the outbox. Events
are coalesced per tenant and minute, so a later edit in the same minute can rely on expiry instead
of a second purge. Live checks enforce withdrawal; the content TTL limits other stale changes to
60 seconds even if a purge is delayed.

## Deploy and verify

From `api/`, validate the selected config with `npx wrangler deploy --dry-run --config
wrangler.jsonc` for staging or `wrangler.production.jsonc` for production. Deploy only through the
approved release workflow. Configure Fail Open and bypass downstream shared caching in Cloudflare.

For staging, verify a Worker `MISS`, a following `HIT`, expiry after 45 seconds, each `w` variant,
and a cold-region miss. Simulate transient grant and R2 failures and confirm `API-FALLBACK`; verify
401/403/404/409/429 are preserved. Disable/bypass the Worker and confirm the API stream remains
uncached. Confirm no image request reaches a Vercel media route and no response exposes an
R2 hostname, object key, or signature. See
[`cloudflare-media-worker-setup.md`](../../../docs/runbooks/cloudflare-media-worker-setup.md) for
the full rollout checklist.
