# Cloudflare media Worker setup

Use this guide to configure and verify image delivery in staging, then repeat it for production
with a separate Worker and separate values. The Worker code is in the
[media Worker README](../../api/edge/media-worker/README.md). See also
[environment configuration](environments.md) and [private media delivery](private-media-delivery.md).

## How image delivery works

Cloudflare routes image requests to the Worker. For published storefront images, the Worker
checks its local Cloudflare cache first. On a miss, it requests a short-lived read grant from the
API and fetches the image directly from private R2 storage. It caches eligible public images for
up to 45 seconds in the data center that served the request. A request from another data center can
have its own miss. Visibility changes trigger a tenant-tagged purge; a delayed purge or a fill
racing a purge can leave an entry available until its 45-second expiry.

Staff and preview images are authorized on every request and use `private, no-store`. Image bytes
travel from R2 through the Worker to the browser. Signed R2 grants stay on the server side. Other
private documents continue to use their existing delivery path.

## Progress recorded on 29 October 2026

This is a snapshot of the owner's reported setup, not a live audit. Check the remaining items only
after verifying them in the relevant dashboard.

- [x] Cloudflare reported the `drezivo.shop` zone as active.
- [x] The staging Worker dry-run completed.
- [x] `drezivo-media-staging` was uploaded with version ID
  `eddd3262-4619-4da1-8a73-5c006338f8de`.
- [x] DNS records and the proxy settings needed for staging have been verified.
- [ ] Staging application deployments, Worker configuration, routes, and verification are complete.

## 1. Confirm the code and staging environment

- [ ] Review the media Worker change and confirm the matching API, API worker, staff app, and web
  code is available for deployment to staging. A Worker upload alone does not deploy these services.
- [ ] Identify the persistent staging deployment for each service in the provider dashboards.
  Copy the exact public HTTPS origin for the staff app, public web, and API. An origin has the form
  `https://host.example`, with no path, query, or trailing slash. Do not guess the hostnames.
- [ ] Confirm the staging API and API worker use the intended staging database and private R2
  bucket. Follow the existing [private media rollout](private-media-delivery.md#verification-and-rollout)
  for its migrations and image processing prerequisites.

## 2. Check Cloudflare DNS

- [x] Add `drezivo.shop` to Cloudflare and confirm the zone shows active. Domain registration
  remains with Namecheap; manage this zone's DNS records in Cloudflare.
- [ ] In Cloudflare, open **drezivo.shop → DNS → Records**. Compare all required records with the
  provider settings and the records previously held at Namecheap. An automatic scan can miss records.
- [ ] Confirm the staging staff and web hostnames exist and point to their correct origins. Their
  DNS records must be **Proxied** before Worker routes can handle their traffic.
- [ ] Keep mail and verification records, including MX, SPF, DKIM, and DMARC, as required by their
  providers. Mail-related CNAMEs should be **DNS only**; follow Clerk and other providers' proxy
  requirements for their records.
- [ ] Check that the existing website, staff app, sign-in, and email work after the DNS cutover.
  Review Cloudflare SSL/TLS settings and certificates if a proxied hostname fails.

## 3. Find the staging Worker

- [x] Upload `drezivo-media-staging`. Cloudflare reported a successful upload and version ID.
- [ ] Open **Cloudflare account home → Workers & Pages → drezivo-media-staging**. The zone's
  **Workers Routes** screen is for attaching routes; it is not the Worker's settings page.
- [ ] Confirm the Worker and its version appear in the dashboard. `No targets deployed` is
  expected for this initial upload: `workers.dev` is disabled and no routes were included in the
  upload. `No bindings found` is also expected: this Worker uses short-lived R2 grants and does not
  require an R2 binding.

To repeat the dry-run or deploy a later staging version from Windows Git Bash, use:

```bash
npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.jsonc --dry-run
npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.jsonc
```

The second command uploads the Worker. Review the output and configuration after subsequent
deployments; dashboard-defined plain-text variables can be affected by Wrangler deployments.
See [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## 4. Configure Worker variables and secrets

- [ ] On the Worker, open **Settings → Variables and Secrets** and add these plain-text variables
  using the exact staging origins identified in step 1:

  | Name | Value |
  | --- | --- |
  | `STAFF_ORIGIN` | Staging staff-app HTTPS origin |
  | `WEB_ORIGIN` | Staging public-web HTTPS origin |
  | `API_ORIGIN` | Staging API HTTPS origin |

- [x] Add `MEDIA_READ_GRANT_SECRET` as a **secret**, matching the staging API, API worker, app,
  and web value. It must be at least 32 characters.
- [x] Add `MEDIA_EDGE_AUTH_SECRET` as a **secret**. Use a separate random value of at least 32
  characters, shared only with the staging app and web deployments.
- [x] Save and deploy the configuration when prompted. Confirm the variables and secret names are
  present; secret values are hidden after saving. Keep values in provider secret managers, not in
  this document, Git, screenshots, or chat. See [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 5. Configure staging services and cache purge

- [ ] In the staging API and API worker deployment settings, set `MEDIA_READ_GRANT_SECRET` to
  the matching staging value and `STOREFRONT_WEB_URL` to the exact staging web HTTPS origin. If
  the API worker runs separately, configure and restart or redeploy it separately.
- [ ] In the staging staff app and web deployment settings, set `MEDIA_READ_GRANT_SECRET` and
  `MEDIA_EDGE_AUTH_SECRET` to their respective matching staging values. Keep both server-side;
  do not use a `NEXT_PUBLIC_` prefix.
- [ ] In the Cloudflare zone overview, copy the **Zone ID**. In the account's **API Tokens** area,
  create a custom token with **Zone → Cache Purge** permission restricted to the `drezivo.shop`
  zone. Save the token in the staging web deployment's secret manager.
- [ ] On the staging web deployment, set `CLOUDFLARE_MEDIA_PURGE_ENABLED=true`,
  `CLOUDFLARE_MEDIA_ZONE_ID` to the zone ID, and `CLOUDFLARE_MEDIA_PURGE_TOKEN` to that token.
  The web service retains the existing Vercel purge and requests Cloudflare tag purges as well.
- [ ] Deploy or restart the matching API and API worker, then the app and web, with their staging
  settings. Confirm the API worker is processing media invalidation events. Secret mismatches fail
  closed; coordinate changes across services and never paste secret values into logs.

## 6. Attach staging routes

- [ ] Confirm step 5 is complete and all three Worker origins and both Worker secrets are set.
- [ ] In **Workers & Pages → drezivo-media-staging → Settings → Domains & Routes**, add a
  **Route** for each pattern below, substituting the verified staging hostnames without `https://`:

  ```text
  <staging-staff-host>/api/media/staff/*
  <staging-web-host>/api/media/public/*
  <staging-web-host>/s/*
  ```

- [ ] Confirm each hostname has a proxied Cloudflare DNS record and each route points to the
  staging Worker. Keep `workers.dev` disabled. See [Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).
- [ ] Account for the broad `/s/*` route: ordinary storefront requests also invoke the Worker
  and are passed through to the web origin. Worker requests count toward the account's free quota.

## 7. Verify staging

Use staging test accounts, test images, and a test storefront. Do not record cookies, grants,
signed URLs, or credentials in screenshots or logs.

- [ ] Open a published storefront image in the browser and confirm it loads through the staging
  web hostname. Repeat the request from the same region and observe Worker/API and R2 activity to
  assess caching. Cache entries are local to a data center; a different region can miss.
- [ ] Replace an image or change its visibility. Confirm the API worker processes the invalidation,
  the web service accepts the purge, and subsequent requests reflect the change. Check again after
  45 seconds if a purge is delayed or a fill races it. A purge API success alone does not prove an
  entry existed or was removed.
- [ ] Open a staff image as an authorized user and confirm its response has `Cache-Control: private,
  no-store`. Confirm a signed-out user, a different tenant, and a user without the relevant branch
  access cannot retrieve it.
- [ ] Open a draft preview with a valid preview session and confirm its image URL uses
  `/s/<store>/media/preview/`. Confirm the image is `private, no-store` and fails with a missing,
  expired, or wrong-store preview cookie. Check the supported responsive image sizes.
- [ ] Inspect browser requests and responses for the image paths: R2 addresses, signed grants, and
  storage keys must not be exposed. Confirm ordinary `/s/` storefront pages still load.
- [ ] Compare cold and repeated image load times and monitor Worker requests, R2 reads, cache
  behavior, and Vercel origin transfer. The [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  and [Cache API documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/)
  describe current limits and cache behavior.

## 8. Production and rollback

- [ ] After staging passes, create a separate production Worker deployment with production origins
  and independently managed production secrets. Repeat the configuration and verification steps;
  never attach production routes to a Worker configured with staging origins.
- [ ] Before attaching production routes, check the account-wide Worker request allowance and the
  traffic matched by `/s/*`. On a fail-closed route, exceeding the allowance can interrupt
  storefront pages as well as images. Review current Cloudflare and R2 limits and pricing.
- [ ] If the Worker causes problems, remove or disable its routes in Cloudflare to return traffic
  to the existing application image routes. Verify public images, staff images, previews, and
  storefront pages after rollback. Investigate before reattaching routes.

## Troubleshooting

- **Missing entry point or config:** use the absolute config and `--cwd` command in step 3. The
  config's `main` should point to `edge/media-worker/worker.mjs` relative to the `api` directory.
- **Image returns 503:** check the three exact HTTPS origins, both secrets and their matching
  values, and the availability of the API and app/web grant endpoints. Missing configuration or
  failed upstream requests can fail closed.
- **Staff or preview image is denied:** check the signed-in user's tenant and branch access or the
  preview session and store-scoped cookie. Do not bypass authorization or cache private responses.
- **Image remains stale:** check API worker invalidation events, web purge configuration, token
  scope, and Cloudflare errors. A delayed purge or a racing fill is bounded by the 45-second
  public cache lifetime.
