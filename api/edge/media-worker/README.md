# Cloudflare media Worker

The Worker handles only public R2-backed images on the API host. Vercel continues to host the
web and staff app pages; public image bytes use Cloudflare and R2. Staff images, private previews,
and renter payment-step images stream directly from the API and never use a Vercel image route.
Private PDF documents retain their existing app delivery path.

## Public image request

The browser receives an API URL such as
`https://api.drezivo.shop/api/media/public/stores/{slug}/files/{fileId}?w=960`.

1. The Worker checks its local Cloudflare Cache API entry, keyed by the API URL and image width.
   Entries live for 45 seconds and carry `tenant-{tenantId}` and `media-{fileId}` cache tags.
2. On a miss, the Worker calls the API's internal grant endpoint with
   `X-Drezivo-Media-Grant`. The API rechecks publication, tenant, file state, image purpose, and
   the current storefront reference, then issues a 60-second server-to-server R2 read grant.
3. The Worker fetches the private R2 object, validates its image type and size, returns the bytes,
   and fills its local cache. R2 URLs and signatures are never forwarded to the browser.
4. On a transient API grant or R2 failure, the Worker requests the same API-host URL directly.
   The API stream rechecks publication and file reference and returns a response eligible for the
   Cloudflare Cache Rule. Authentication/publication failures from the grant endpoint are preserved
   and do not fall back.

The API's direct stream at `/api/media/public/stores/{slug}/files/{fileId}` is also the origin
response when Cloudflare bypasses the Worker. It applies the same database publication checks,
returns `Cache-Control: public, max-age=0, s-maxage=45`, and attaches Cloudflare tenant/file cache
tags. A Cache Rule marks the direct response eligible and honors this origin TTL when the Worker
route is bypassed. Do not override Edge TTL: the Free-plan minimum override is two hours and would
also risk caching responses marked `no-store`.

## Routes and secrets

The Wrangler configs declare one route per environment:

- Staging: `api-preview.drezivo.shop/api/media/public/*`
- Production: `api.drezivo.shop/api/media/public/*`

The Cloudflare dashboard route must use **Fail Open**. This lets requests go straight to the API
origin if Worker execution fails or the Workers Free daily request budget is reached. Configure a
Cache Rule matching the same host and `/api/media/public/*` path: eligible for cache, with Edge TTL
set to use the response's cache-control header and bypass when it is absent. Keep the default cache
key's query string so widths stay distinct. Keep staff, preview, guest, and PDF paths outside this
rule.

Set `API_ORIGIN` in each Wrangler config. Set `MEDIA_READ_GRANT_SECRET` as a Worker secret matching
the API's environment-specific value. It is only used for the server-to-server R2 grant. The API
also needs `MEDIA_PUBLIC_ORIGIN`, `CLOUDFLARE_MEDIA_ZONE_ID`, and
`CLOUDFLARE_MEDIA_PURGE_TOKEN`; the latter token is scoped to Cache Purge for the relevant zone.
Neither secret belongs in the web/app environment or browser bundle.

## Cache invalidation

When media visibility or references change, the API outbox worker calls Cloudflare's cache purge
API directly with the `tenant-{tenantId}` tag. A rejected purge is retried by the outbox. This
purges Worker Cache API responses and direct API-origin CDN entries; the 45-second TTL bounds stale
content if a purge is delayed.

## Deploy and verify

From `api/`, validate the selected config with `npx wrangler deploy --dry-run --config
wrangler.jsonc` for staging or `wrangler.production.jsonc` for production. Deploy only through the
approved release workflow. Configure Fail Open and the Cache Rule in Cloudflare separately.

For staging, verify a Worker `MISS`, a following `HIT`, expiry after 45 seconds, each `w` variant,
and a cold-region miss. Simulate transient grant and R2 failures and confirm `API-FALLBACK`; verify
401/403/404/409/429 are preserved. Disable/bypass the Worker and confirm the API stream fills the
native CDN cache. Confirm no image request reaches a Vercel media route and no response exposes an
R2 hostname, object key, or signature. See
[`cloudflare-media-worker-setup.md`](../../../docs/runbooks/cloudflare-media-worker-setup.md) for
the full rollout checklist.
