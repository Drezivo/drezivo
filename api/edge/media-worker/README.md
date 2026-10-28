# Cloudflare media Worker

This Worker moves catalogue and storefront image bytes from Vercel to Cloudflare. It uses the
existing short-lived R2 grants, keeps R2 URLs server-only, and checks staff and preview access on
every request. Staff and preview responses are never cached. Published storefront images are
cached for at most 45 seconds and tagged by tenant for global invalidation.

## Deploy the Worker

From the `api/` directory, deploy the staging Worker with `npx wrangler deploy --config wrangler.jsonc`.
The config points at `edge/media-worker/worker.mjs` and keeps `workers.dev` disabled. Deployment
does not attach any routes. Add the environment variables and secrets in Cloudflare, then attach
the staging routes only after the staging app and API deployments are ready. Verify the complete
staging flow before configuring a production Worker.

## Configuration and rollout

Use a Cloudflare zone that owns and proxies the app and web hostnames. Configure Worker routes for
`<staff-host>/api/media/staff/*`, `<web-host>/api/media/public/*`, and `<web-host>/s/*`.
Cloudflare permits path wildcards only at the end, so the last route includes all storefront
requests. The Worker passes non-preview requests through to the original web origin unchanged.
Those requests also count toward the free Worker quota; with fail-closed routing, exceeding the
quota can temporarily affect storefront pages as well as images. Verify this tradeoff with actual
request counts before enabling the route. Restrict routes to the intended hostnames. Do not
use the Worker before its environment and routes are ready. Keep `workers_dev` disabled.

Set `STAFF_ORIGIN`, `WEB_ORIGIN`, and `API_ORIGIN` to their exact HTTPS origins. Configure the
Worker secret `MEDIA_READ_GRANT_SECRET` to match the API. Set an independent, random secret of at
least 32 characters as `MEDIA_EDGE_AUTH_SECRET` on the Worker and both Next.js applications. Keep
both secrets in the providers' secret managers, never in repository files. The internal grant
bridges require both the edge secret and the original staff session or preview cookie.

Before enabling Worker routes, deploy the application and API changes, configure the web app with
`CLOUDFLARE_MEDIA_PURGE_ENABLED=true`, the zone ID in `CLOUDFLARE_MEDIA_ZONE_ID`, and a scoped
`CLOUDFLARE_MEDIA_PURGE_TOKEN` with zone Cache Purge permission. The existing invalidation endpoint
continues to purge Vercel and then purges Cloudflare; failures return a retryable error to the
outbox worker. Public edge entries expire after 45 seconds if a purge is delayed. Validate purge
and cache behavior across regions before enabling routes. A cache fill racing a purge can remain
until the 45-second expiry; do not rely on purge as an instantaneous security boundary.

The Worker Cache API keeps entries in the data center that filled them; entries do not replicate
between regions. A first request from a new region can miss, obtain a small authorization grant,
and fetch image bytes directly from R2 before filling that region's cache. Staff and preview images
always reauthorize and fetch from R2 because they are never shared-cache hits. The `/s/*` route also
passes ordinary storefront requests through the Worker, so those requests consume Worker requests
too. Track the account-wide Worker request quota before enabling that route.

Activate routes only after staging checks. Disable the Worker routes to roll back to the existing
Next.js image proxies. New preview URLs continue to work through their Next.js fallback route.
Do not expose a public R2 bucket or use a fail-open route for private media. Missing secrets,
authorization failures, or upstream failures return errors rather than revealing grants.

Cloudflare Workers Free has an account-wide daily request limit; cached requests handled through
this Worker still count. R2 Standard has monthly storage and operation allowances. Check current
provider pricing and account usage before rollout. Measure cache hit ratio, Worker request counts,
R2 reads, Vercel origin transfer, and cold/warm image latency. Private requests still make small
authorization calls to the app/API; only their image bytes bypass those services.
