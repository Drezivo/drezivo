# Cloudflare media Worker setup

This runbook configures the API-host image Worker and native Cloudflare cache fallback. Repository code and configuration are prepared, but each environment still needs its dashboard settings and a reviewed deployment. Do not treat a code change or dry-run as production certification.

See the [Worker README](../../api/edge/media-worker/README.md), [environment inventory](environments.md), and [private media delivery](private-media-delivery.md).

## Target configuration

| Environment | Worker route | API origin |
| --- | --- | --- |
| Staging | `api-preview.drezivo.shop/api/media/public/*` | `https://api-preview.drezivo.shop` |
| Production | `api.drezivo.shop/api/media/public/*` | `https://api.drezivo.shop` |

Each route must use **Fail Open (proceed)**. If the Worker fails or reaches its request limit, Cloudflare bypasses the Worker and continues to the API origin. The API direct stream repeats publication and file-reference checks.

Add a Cloudflare Cache Rule for the matching API hostname and `/api/media/public/*` path. Set **Cache eligibility** to **Eligible for cache** and, under **Edge TTL**, choose **Use cache-control header if present, bypass cache if not**. The API returns `Cache-Control: public, max-age=0, s-maxage=45` for successful public images and `no-store` for private/error responses, so the rule must respect those headers. Do not use an Edge TTL override: Cloudflare Free's minimum override is two hours and it can override `no-store`. The default cache key includes the full URL query string, so keep query strings enabled to separate the `w=320`, `w=960`, and `w=1600` variants. Do not apply the rule to staff, preview, guest, PDF, or other API paths. Confirm the rule can cache the direct API response when the Worker route is bypassed.

## Secrets and variables

Configure staging and production independently:

- API and its outbox worker: `MEDIA_PUBLIC_ORIGIN`, `MEDIA_READ_GRANT_SECRET`, `CLOUDFLARE_MEDIA_ZONE_ID`, and `CLOUDFLARE_MEDIA_PURGE_TOKEN`. The purge token needs Cache Purge permission restricted to the `drezivo.shop` zone.
- Cloudflare Worker: `API_ORIGIN` from the table above and the same environment-specific `MEDIA_READ_GRANT_SECRET` as the API.
- Web: `API_ORIGIN` and `NEXT_PUBLIC_API_ORIGIN` for the matching API environment.
- App: `API_BASE_URL` and `NEXT_PUBLIC_API_ORIGIN` for the matching API environment; keep existing Clerk settings.

The web and app no longer need `MEDIA_READ_GRANT_SECRET`, `MEDIA_EDGE_AUTH_SECRET`, or Cloudflare purge credentials. Do not put any secret in a `NEXT_PUBLIC_` variable. Keep the R2 bucket private.

## Staging rollout checklist

1. [x] **Confirm the code and prerequisites.** Deploy API routes and the outbox invalidation handler first. Confirm migrations `0080_file_image_variants_backfill.sql` and `0081_storefront_media_cache_invalidation.sql` are applied through the protected workflow, variants are processing, and the API points to the staging database and private R2 bucket.
2. [x] **Set staging variables.** Set the API and Worker values above. Set `MEDIA_PUBLIC_ORIGIN=https://api-preview.drezivo.shop`. Check that the Worker and API grant secrets match without copying their values into logs or chat.
3. [ ] **Update app/web.** Deploy the browser image components and API-host URL changes. Verify the app/web point to the staging API and that ordinary site pages still use their existing Vercel deployments.
4. [ ] **Review and deploy the staging Worker.** From the repository root, run `npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.jsonc --dry-run`. Confirm `API_ORIGIN` is `https://api-preview.drezivo.shop` and the only route is the staging API public media path. Confirm the Worker secret matches the staging API secret. Deploy with the same command without `--dry-run` through the approved release workflow; the config attaches its route.
5. [ ] **Proxy staging API DNS.** In Cloudflare, open **drezivo.shop → DNS → Records**. Find `api-preview.drezivo.shop`, verify its target is the staging API origin, and set **Proxy status** to **Proxied** (orange cloud). Worker routes and Cache Rules require a proxied hostname.
6. [ ] **Create the staging Cache Rule.** In **Rules → Cache Rules → Create rule**:
   - Name it `Drezivo public media — staging`.
   - Select **Custom filter expression**, click **Edit expression**, and enter:

     ```text
     http.host eq "api-preview.drezivo.shop" and starts_with(http.request.uri.path, "/api/media/public/")
     ```

   - Set **Cache eligibility** to **Eligible for cache**.
   - Under **Edge TTL**, select **Use cache-control header if present, bypass cache if not**.
   - Leave **Cache key** and other optional settings unchanged, then deploy the rule. Do not use an Edge TTL override.
7. [ ] **Configure the staging Worker route.** In **Workers & Pages → drezivo-media-staging → Settings → Domains & Routes**, confirm that `api-preview.drezivo.shop/api/media/public/*` is the only staging route. The Wrangler config may have added it during deployment; add it here only if it is missing. Set **Failure mode** to **Fail Open (proceed)** and save. Remove the old staging routes `app-preview.drezivo.shop/api/media/staff/*`, `preview.drezivo.shop/api/media/public/*`, and `preview.drezivo.shop/s/*` after the new API-host route is ready. Do not attach staff, web, storefront-page, or broad `/s/*` paths.
8. [ ] **Verify staging.** Use a staging store and test accounts. Check a public image `MISS`, repeat `HIT`, expiry, three widths, and a cold-region miss. Temporarily bypass the Worker and check the direct API response and native CDN cache. Simulate transient grant/R2 failures and verify the Worker falls back to API. Confirm 401/403/404/409/429 publication/access failures are preserved. Confirm staff tenant/branch denial, preview and guest file scope, grant refresh, no-store headers, CORS preflights, and useful image placeholders after bounded retries.
9. [ ] **Check routing and observability.** Confirm public images never request a Vercel media route; R2 URLs and keys never appear in browser URLs or logs. Review Cloudflare cache, API/R2 fallback, purge, media-error, and Vercel Fast Origin Transfer metrics.

## Production rollout

Start only after staging passes. Follow these steps in order:

1. [ ] **Deploy the production API first.** Apply migrations `0080_file_image_variants_backfill.sql` and `0081_storefront_media_cache_invalidation.sql` through the protected workflow. Confirm production image variants are ready and the API uses the production database and private R2 bucket.
2. [ ] **Set production API variables.** Configure `MEDIA_PUBLIC_ORIGIN=https://api.drezivo.shop`, a production-only `MEDIA_READ_GRANT_SECRET`, `CLOUDFLARE_MEDIA_ZONE_ID`, and the zone-restricted `CLOUDFLARE_MEDIA_PURGE_TOKEN` in the production API environment.
3. [ ] **Deploy production web and app.** Set `NEXT_PUBLIC_API_ORIGIN=https://api.drezivo.shop` for both. Keep page hosting on the existing Vercel deployments.
4. [ ] **Review and deploy the production Worker.** In **Workers & Pages → drezivo-media-prod → Settings → Variables and Secrets**, set `MEDIA_READ_GRANT_SECRET` to the matching production API secret. From the repository root, run `npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.production.jsonc --dry-run`. Confirm `API_ORIGIN` is `https://api.drezivo.shop` and the only route is the production API public media path. Deploy with the same command without `--dry-run` through the approved release workflow; the config attaches its route.
5. [ ] **Proxy production API DNS.** In **drezivo.shop → DNS → Records**, find `api.drezivo.shop`, verify its target is the production API origin, and set **Proxy status** to **Proxied** (orange cloud).
6. [ ] **Create the production Cache Rule.** In **Rules → Cache Rules → Create rule**:
   - Name it `Drezivo public media — production`.
   - Select **Custom filter expression**, click **Edit expression**, and enter:

     ```text
     http.host eq "api.drezivo.shop" and starts_with(http.request.uri.path, "/api/media/public/")
     ```

   - Set **Cache eligibility** to **Eligible for cache**.
   - Under **Edge TTL**, select **Use cache-control header if present, bypass cache if not**.
   - Leave **Cache key** and other optional settings unchanged, then deploy the rule. Do not use an Edge TTL override.
7. [ ] **Configure the production Worker route.** In **Workers & Pages → drezivo-media-prod → Settings → Domains & Routes**, confirm that `api.drezivo.shop/api/media/public/*` is the only production route. The Wrangler config may have added it during deployment; add it here only if it is missing. Set **Failure mode** to **Fail Open (proceed)** and save. Remove the old production routes `partners.drezivo.shop/api/media/staff/*`, `drezivo.shop/api/media/public/*`, and `drezivo.shop/s/*` after the API-host route is ready.
8. [ ] **Verify production.** Use a published production image. Confirm a cold Worker `MISS`, a repeat `HIT`, the three width variants, and that image requests use `api.drezivo.shop` rather than a Vercel media path. Check the fail-open setting and ensure staff, preview, and guest images retain their scoped authorization and `private, no-store` behavior.
9. [ ] **Monitor after release.** Review Worker requests and errors, cache hits, API/R2 fallback and purge volume, media errors, and Vercel Fast Origin Transfer. Existing Vercel page hosting and bundled static assets remain in place.

## Rollback

Disable or remove only the affected API-host Worker route. The API direct stream and Cloudflare Cache Rule remain as the fallback path. If the API itself is unhealthy, cached public responses can remain available only until they expire; after that, image requests can fail while pages still render placeholders. To roll back code, restore the previous application release through the normal protected release workflow. Do not make an unreviewed route broadening change.

## Troubleshooting

- **Worker request fails:** confirm route is set to Fail Open, the API origin is correct, the Worker and API grant secrets match, and API/R2 are reachable. A cold miss still depends on the API and R2.
- **Wrong or stale image variant:** confirm the default cache key still includes the query string, purge tag delivery is healthy, and a 45-second expiry has elapsed.
- **Preview, staff, or guest image is denied:** verify the user/branch or session/reservation context and the file's live business reference. Do not cache or weaken authorization for these paths.
- **Image placeholder appears:** inspect API, Worker and R2 errors, route configuration, CORS, and grant expiry. A bounded retry prevents a broken image from replacing the page; it cannot recreate bytes during an API/R2 outage.
- **Vercel Fast Origin Transfer remains high:** check that the request's host is the API host and its path is `/api/media/public/...`; page, JS, CSS, fonts, and bundled assets remain served by Vercel.

## Historical setup checklist, superseded

> **Historical record only.** The following original checklist and its checked boxes describe the
> previous Worker and Vercel media flow. Its old routes, secret locations, deployment instructions,
> verification steps, and rollback instructions are superseded by the current checklists above.
> Do not follow them for the API-host migration or treat their checked boxes as proof of its rollout.
Use this guide to configure and verify image delivery in staging, then repeat it for production
with a separate Worker and separate values. The Worker code is in the
[media Worker README](../../api/edge/media-worker/README.md). See also
[environment configuration](environments.md) and [private media delivery](private-media-delivery.md).

### How image delivery works

Cloudflare routes image requests to the Worker. For published storefront images, the Worker
checks its local Cloudflare cache first. On a miss, it requests a short-lived read grant from the
API and fetches the image directly from private R2 storage. It caches eligible public images for
up to 45 seconds in the data center that served the request. A request from another data center can
have its own miss. Visibility changes trigger a tenant-tagged purge; a delayed purge or a fill
racing a purge can leave an entry available until its 45-second expiry.

Staff and preview images are authorized on every request and use `private, no-store`. Image bytes
travel from R2 through the Worker to the browser. Signed R2 grants stay on the server side. Other
private documents continue to use their existing delivery path.

### Progress recorded on 29 October 2026

This is a snapshot of the owner's reported setup, not a live audit. Check the remaining items only
after verifying them in the relevant dashboard.

- [x] Cloudflare reported the `drezivo.shop` zone as active.
- [x] The staging Worker dry-run completed.
- [x] `drezivo-media-staging` was uploaded with version ID
  `eddd3262-4619-4da1-8a73-5c006338f8de`.
- [x] DNS records and the proxy settings needed for staging have been verified.
- [x] Staging application deployments, Worker configuration, routes, and verification are complete.

### 1. Confirm the code and staging environment

- [x] Review the media Worker change and confirm the matching API, API worker, staff app, and web
  code is available for deployment to staging. A Worker upload alone does not deploy these services.
- [x] Identify the persistent staging deployment for each service in the provider dashboards.
  Copy the exact public HTTPS origin for the staff app, public web, and API. An origin has the form
  `https://host.example`, with no path, query, or trailing slash. Do not guess the hostnames.
- [x] Confirm the staging API and API worker use the intended staging database and private R2
  bucket. Follow the existing [private media rollout](private-media-delivery.md#verification-and-rollout)
  for its migrations and image processing prerequisites.

### 2. Check Cloudflare DNS

- [x] Add `drezivo.shop` to Cloudflare and confirm the zone shows active. Domain registration
  remains with Namecheap; manage this zone's DNS records in Cloudflare.
- [x] In Cloudflare, open **drezivo.shop → DNS → Records**. Compare all required records with the
  provider settings and the records previously held at Namecheap. An automatic scan can miss records.
- [x] Confirm the staging staff and web hostnames exist and point to their correct origins. Their
  DNS records must be **Proxied** before Worker routes can handle their traffic.
- [x] Keep mail and verification records, including MX, SPF, DKIM, and DMARC, as required by their
  providers. Mail-related CNAMEs should be **DNS only**; follow Clerk and other providers' proxy
  requirements for their records.
- [x] Check that the existing website, staff app, sign-in, and email work after the DNS cutover.
  Review Cloudflare SSL/TLS settings and certificates if a proxied hostname fails.

### 3. Configure the staging application and API

Complete these settings before deploying the route-enabled staging config. It includes all three
staging routes, so a successful deployment can immediately send matching requests to the Worker.

- [x] In the staging API and API worker deployment settings, set `MEDIA_READ_GRANT_SECRET` to the
  staging value and `STOREFRONT_WEB_URL` to `https://preview.drezivo.shop`. If the API worker runs
  separately, configure and restart or redeploy it separately.
- [x] In the staging staff app and web deployment settings, set `MEDIA_READ_GRANT_SECRET` and
  `MEDIA_EDGE_AUTH_SECRET` to the matching staging values. Keep both server-side; do not use a
  `NEXT_PUBLIC_` prefix.
- [x] In the Cloudflare zone overview, copy the **Zone ID**. Create a custom API token with
  **Zone → Cache Purge** permission restricted to the `drezivo.shop` zone, then store it as a
  secret in the staging web deployment.
- [x] On the staging web deployment, set `CLOUDFLARE_MEDIA_PURGE_ENABLED=true`,
  `CLOUDFLARE_MEDIA_ZONE_ID`, and `CLOUDFLARE_MEDIA_PURGE_TOKEN`. The web service retains the
  existing Vercel purge and requests Cloudflare tag purges as well.
- [ ] Redeploy or restart the staging API and API worker, then the staff app and web. Confirm the
  API worker is processing media invalidation events and all services are healthy before enabling
  the Worker routes. Secret mismatches fail closed; never paste secret values into logs.

### 4. Configure the staging Worker

- [x] Check `api/wrangler.jsonc` against the exact staging deployment origins from step 1. The
  current expected values are:

  | Config variable | Expected staging origin |
  | --- | --- |
  | `STAFF_ORIGIN` | `https://app-preview.drezivo.shop` |
  | `WEB_ORIGIN` | `https://preview.drezivo.shop` |
  | `API_ORIGIN` | `https://api-preview.drezivo.shop` |

  Wrangler's config is the source of truth for these plain-text variables; a later deploy can
  replace dashboard values. Stop and update the config if the live staging origins differ.
- [x] Open **Cloudflare → Workers & Pages → drezivo-media-staging → Settings → Variables and
  Secrets**. Select **Production** for this separately named staging Worker, not **Previews Base**.
- [x] Add `MEDIA_READ_GRANT_SECRET` as a secret matching the staging API, API worker, app, and web.
  It must be at least 32 characters. Add `MEDIA_EDGE_AUTH_SECRET` as a separate random secret of
  at least 32 characters, shared with the staging app and web.
- [x] Confirm both secret names are present in the Worker's **Production** environment. Keep values
  in provider secret managers, not in this document, Git, screenshots, or chat. See
  [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
- [x] If `drezivo-media-staging` does not exist yet, create it in **Workers & Pages** without
  custom routes, add the secrets above, and continue with the deploy below. Do not attach routes
  manually; the staging Wrangler config declares them.

### 5. Deploy the staging Worker

Run these commands from Windows Git Bash at the repository root (`D:/drezivo`). The dry-run checks
the Worker bundle and staging variables without publishing. Review the config's route patterns as
part of the check; the actual deploy attaches those routes.

- [x] Run the staging dry-run:

  ```bash
  npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.jsonc --dry-run
  ```

- [x] Confirm the dry-run succeeds and lists only the staging origins from step 4. Verify the
  config contains these three routes and no production hostname:

  ```text
  app-preview.drezivo.shop/api/media/staff/*
  preview.drezivo.shop/api/media/public/*
  preview.drezivo.shop/s/*
  ```

- [x] Deploy the staging Worker and its configured routes:

  ```bash
  npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.jsonc
  ```

- [x] Review the output. Expect an upload for `drezivo-media-staging`, then a deployed-triggers
  list containing the three staging routes and a version ID. Stop if the output shows production
  hostnames or unexpected route changes. `No bindings found` is expected because this Worker uses
  short-lived R2 grants and needs no R2 binding. With the current config, `No targets deployed` is
  not expected; check that the staging config and route list were used.

The route patterns live in `api/wrangler.jsonc`; do not add them separately in the dashboard.
Keep using that config for later staging deploys so Wrangler does not replace the dashboard route
state with a different configuration. See [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

### 6. Confirm the staging Worker and routes

- [x] Open **Cloudflare account home → Workers & Pages → drezivo-media-staging**. The zone's
  **Workers Routes** page is separate from the Worker's settings page.
- [x] Confirm the deployed version appears and **Settings → Domains & Routes** lists exactly the
  three staging routes from step 5. Confirm each staging hostname has a proxied DNS record and
  `workers.dev` remains disabled.
- [x] Confirm the Worker shows all three origin variables and both secret names under its
  **Production** environment. Values for secrets should remain hidden.
- [x] Account for the broad `/s/*` route: ordinary storefront requests also invoke the Worker and
  are passed through to the web origin. These requests count toward the account's Workers quota.

### 7. Verify staging

Use staging test accounts, test images, and a test storefront. Do not record cookies, grants,
signed URLs, or credentials in screenshots or logs.

- [x] Open a published storefront image in browser DevTools → **Network**, select its image
  request, and inspect **Response Headers** for `X-Media-Cache`. An eligible image should report
  `MISS` on its first request and `HIT` when the same URL is requested again within 45 seconds
  from the same Cloudflare data center. The header is set by this Worker; it is not
  `cf-cache-status`. A new region can have its own miss because Worker cache entries are local to
  the data center that filled them. Confirm the Worker URL is serving the image rather than the
  Vercel fallback.
- [x] Replace an image or change its visibility. Confirm the API worker processes the invalidation,
  the web service accepts the purge, and subsequent requests reflect the change. Check again after
  45 seconds if a purge is delayed or a fill races it. A purge API success alone does not prove an
  entry existed or was removed.
- [x] Open a staff image as an authorized user and confirm its response has `Cache-Control: private,
  no-store`. Confirm a signed-out user, a different tenant, and a user without the relevant branch
  access cannot retrieve it.
- [x] Open a draft preview with a valid preview session and confirm its image URL uses
  `/s/<store>/media/preview/`. Confirm the image is `private, no-store` and fails with a missing,
  expired, or wrong-store preview cookie. Check the supported responsive image sizes.
- [x] Inspect browser requests and responses for the image paths: R2 addresses, signed grants, and
  storage keys must not be exposed. Confirm ordinary `/s/` storefront pages still load.
- [x] Compare cold and repeated image load times and monitor Worker requests, R2 reads, cache
  behavior, and Vercel origin transfer. The [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  and [Cache API documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/)
  describe current limits and cache behavior.

### 8. Prepare the production environment

Do not start production setup until the full staging verification in step 7 passes. Production is a
separate Worker with separate secrets and production-only routes.

- [x] Confirm the matching API, API worker, staff app, and web changes have been deployed to
  production. Verify each service is healthy before routing image traffic through the Worker.
- [x] Copy the exact production origins from the live deployment settings. The expected values are
  shown below; if a provider reports a different hostname, stop and correct the config before
  deployment. Origins have no path or trailing slash.

  | Worker variable | Expected production origin |
  | --- | --- |
  | `STAFF_ORIGIN` | `https://partners.drezivo.shop` |
  | `WEB_ORIGIN` | `https://drezivo.shop` |
  | `API_ORIGIN` | `https://api.drezivo.shop` |

- [x] In Cloudflare **drezivo.shop → DNS → Records**, confirm `partners.drezivo.shop` and
  `drezivo.shop` point to the correct production providers and are **Proxied**. Confirm the
  `drezivo.shop` zone is active and TLS works for both hosts.
- [x] In production Render settings, configure `MEDIA_READ_GRANT_SECRET` and
  `STOREFRONT_WEB_URL=https://drezivo.shop` for the API and its separate worker service, if one is
  used. Keep the grant secret identical across the production API, app, web, and media Worker.
- [x] In production Vercel settings, configure `MEDIA_READ_GRANT_SECRET` and
  `MEDIA_EDGE_AUTH_SECRET` for both the staff app and web. The edge secret must be the same random
  value on the app, web, and Worker, and at least 32 characters. Do not use `NEXT_PUBLIC_` names.
- [x] On the production web deployment, configure `CLOUDFLARE_MEDIA_PURGE_ENABLED=true`,
  `CLOUDFLARE_MEDIA_ZONE_ID`, and a production `CLOUDFLARE_MEDIA_PURGE_TOKEN` restricted to the
  `drezivo.shop` zone with **Cache → Purge** permission. Store the token only as a Vercel secret.
- [ ] Redeploy or restart the production API, API worker, app, and web after changing their
  settings. Confirm their production health checks pass and their secret names are present without
  exposing secret values.

### 9. Create and configure the production Worker

The production Wrangler config contains production origins and routes. Secrets are added separately
in Cloudflare. Create the Worker without routes first so requests cannot reach it before the
production secrets and upstream services are ready.

- [x] In **Cloudflare → Workers & Pages**, create a Worker named `drezivo-media-prod` if it does not
  already exist. A temporary Hello World deployment is sufficient. Do not add a custom domain or
  route during this step.
- [x] Open **drezivo-media-prod → Settings → Domains & Routes**. Confirm there are no custom routes
  and disable the `workers.dev` and Preview URL endpoints. Do not send production traffic to the
  temporary deployment.
- [x] Open **Settings → Variables and Secrets**, select **Production** (not **Previews Base**),
  and add these as secrets:

  | Secret name | Production value |
  | --- | --- |
  | `MEDIA_READ_GRANT_SECRET` | Same production value as the API, app, and web |
  | `MEDIA_EDGE_AUTH_SECRET` | Same independent random production value as the app and web; at least 32 characters |

- [x] Confirm both secret names appear in the **Production** environment. Do not put secret values
  in Wrangler config, Git, this runbook, screenshots, or chat.

### 10. Review and deploy the production Worker

The staging config `api/wrangler.jsonc` contains preview origins and routes. Passing
`--name drezivo-media-prod` only changes the Worker name; it does not convert those staging values
to production. That is why the earlier production-named dry-run still displayed `*-preview` hosts.
Always pass the production config below for production.

- [ ] From Windows Git Bash, run the production dry-run:

  ```bash
  npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.production.jsonc --dry-run
  ```

- [x] Verify the dry-run shows only `https://api.drezivo.shop`,
  `https://partners.drezivo.shop`, and `https://drezivo.shop`. Also inspect
  `api/wrangler.production.jsonc` and confirm its routes are exactly:
  `partners.drezivo.shop/api/media/staff/*`,
  `drezivo.shop/api/media/public/*`, and `drezivo.shop/s/*`. If any preview hostname appears,
  stop; do not deploy.
- [x] Confirm `preview_urls` and `workers_dev` are both `false`, the production secrets are already
  configured in the Worker's **Production** environment, and the app/API production settings from
  step 8 are live.
- [x] Deploy the production config:

  ```bash
  npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.production.jsonc
  ```

- [x] Review the deploy output. Confirm it names `drezivo-media-prod` and lists only the three
  production routes. If the upload succeeds but no production triggers are deployed, stop and
  inspect the config and Cloudflare route settings before testing.
- [x] In the Cloudflare dashboard, confirm the production Worker has the three production routes,
  no preview or `workers.dev` URL, and both production secrets. Keep future production code
  deployments on `wrangler.production.jsonc`; deploying with the staging config can replace the
  production origins and routes.

### 11. Verify production and monitor usage

- [ ] Load a published production storefront image. In browser DevTools → **Network** → image
  request → **Response Headers**, confirm `X-Media-Cache: MISS` first and `X-Media-Cache: HIT`
  on a repeated same-URL request within 45 seconds from the same region. This Worker header
  reports its Cache API result; it is not `cf-cache-status`. Confirm the request uses the
  production web hostname, then monitor Worker metrics and API/R2 activity. A different Cloudflare
  data center may have its own miss.
- [ ] Confirm a signed-out user cannot load staff images, while an authorized user can. Confirm
  staff and preview responses remain `private, no-store` and cross-tenant or unauthorized branch
  access is denied.
- [ ] Open a production preview image with a valid store-scoped preview session. Confirm missing,
  expired, or wrong-store cookies fail closed and ordinary `/s/` storefront pages still load.
- [ ] Replace an image or change its visibility. Confirm Cloudflare purge processing and subsequent
  image responses reflect the change; check again after 45 seconds if a purge is delayed.
- [ ] Monitor Worker requests, errors, R2 reads, image latency, and Vercel origin transfer. Check
  the account-wide Worker request allowance before and after rollout. The broad `drezivo.shop/s/*`
  route also invokes the Worker for ordinary storefront pages, so quota exhaustion can affect
  storefront pages as well as images. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  and [Cache API behavior](https://developers.cloudflare.com/workers/runtime-apis/cache/).

### 12. Roll back production routes

- [ ] If production requests fail or access checks behave unexpectedly, remove or disable all three
  routes from **drezivo-media-prod → Settings → Domains & Routes**. This returns requests to the
  existing application image paths without changing DNS or deleting the Worker.
- [ ] Verify public images, staff images, preview images, and ordinary storefront pages after route
  removal. Keep the production Worker and config for diagnosis; fix the issue and repeat the
  dry-run and smoke checks before reattaching routes.

### Troubleshooting

- **Missing entry point or config:** use the absolute config and `--cwd` command in step 3. The
  config's `main` should point to `edge/media-worker/worker.mjs` relative to the `api` directory.
- **Production dry-run shows preview origins:** the command used `api/wrangler.jsonc` or otherwise
  deployed the staging config. `--name` does not change origins or routes. Use
  `api/wrangler.production.jsonc` and check all three origins and route patterns before deploying.
- **Image returns 503:** check the three exact HTTPS origins, both secrets and their matching
  values, and the availability of the API and app/web grant endpoints. Missing configuration or
  failed upstream requests can fail closed.
- **Staff or preview image is denied:** check the signed-in user's tenant and branch access or the
  preview session and store-scoped cookie. Do not bypass authorization or cache private responses.
- **Image remains stale:** check API worker invalidation events, web purge configuration, token
  scope, and Cloudflare errors. A delayed purge or a racing fill is bounded by the 45-second
  public cache lifetime.
