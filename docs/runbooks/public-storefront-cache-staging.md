For **staging**, you need to deploy the code in PR #377 first, then configure the staging Cloudflare Worker and cache rules. The new cache is disabled by default, so merging the PR alone will not turn it on.

**One ordering issue first:** PR #377 adds migration `0097`; the worker PR [#381](https://github.com/Drezivo/drezivo/pull/381) adds `0098`. The last fetched staging branch has neither. Merge and apply **0097 before 0098**, or coordinate the migration order before applying either. The migration runner rejects unexpected gaps.

### 1. Prepare the staging API and web app

After [PR #377](https://github.com/Drezivo/drezivo/pull/377) is merged into `staging`:

1. Confirm the staging migration workflow applied `0097_public_storefront_cache_invalidation.sql`.
2. Deploy the staging API with this setting initially:

   ```text
   GUEST_QUOTE_CONFIRMATION_REQUIRED=false
   ```

3. Deploy the updated staging web app and verify that checkout fetches and shows a current quote.
4. Only after that checkout works, set `GUEST_QUOTE_CONFIRMATION_REQUIRED=true` on the **staging API** and redeploy it. Older checkout versions will be instructed to refresh.

In the staging API environment, also verify these existing values are configured:

```text
MEDIA_PUBLIC_ORIGIN=https://api-preview.drezivo.shop
MEDIA_READ_GRANT_SECRET=<staging secret>
CLOUDFLARE_MEDIA_ZONE_ID=<drezivo.shop zone ID>
CLOUDFLARE_MEDIA_PURGE_TOKEN=<zone-scoped cache purge token>
```

The API’s outbox worker needs the same environment-specific configuration to process purge requests. Don’t paste secret values into chat.

### 2. Deploy the updated staging Worker

In **Cloudflare → Workers & Pages → `drezivo-media-staging` → Settings → Variables and Secrets**, verify:

```text
API_ORIGIN=https://api-preview.drezivo.shop
MEDIA_READ_GRANT_SECRET=<same secret as the staging API>
PUBLIC_STOREFRONT_CACHE_ENABLED=false
```

I verified that `API_ORIGIN` and the **presence** of `MEDIA_READ_GRANT_SECRET` are already configured. I could not verify that the Worker and API secret values match.

Deploy the Worker **from the merged PR #377 version of `staging`**, initially with the cache flag set to `false`. The current `D:/drezivo` checkout is on the hold-expiry branch, so its current Worker files are not the ones to deploy.

From a checkout containing merged PR #377, the documented dry run is:

```powershell
npx wrangler deploy --cwd D:/drezivo/api --config D:/drezivo/api/wrangler.jsonc --dry-run
```

Check that the output names `drezivo-media-staging`, the staging API origin, and both routes below. Then deploy using the same command **without** `--dry-run` through your normal Worker release process.

### 3. Configure Worker routes

In **Workers & Pages → `drezivo-media-staging` → Settings → Domains & Routes**, confirm these two routes:

```text
api-preview.drezivo.shop/api/media/public/*
api-preview.drezivo.shop/api/v1/public/stores/*
```

The first already exists. The second is currently missing; the PR’s Wrangler configuration declares it and may create it during deployment. If it does not appear, add it in the dashboard.

For each route, set the **request-limit failure mode** to **Fail Open / Proceed**, then save. The current image route is set to fail closed. With fail open, Cloudflare bypasses the Worker if its Free-plan daily request limit is reached; the updated API must therefore be deployed first so it can perform the visibility checks itself. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### 4. Change the staging cache rules

In **Cloudflare → Websites → `drezivo.shop` → Rules → Cache Rules**:

1. Find **Drezivo public media — staging**.
2. Edit it and set **Cache eligibility → Bypass cache**.
3. Add a separate staging rule that bypasses the storefront API path, using this custom expression:

   ```text
   http.host eq "api-preview.drezivo.shop" and starts_with(http.request.uri.path, "/api/v1/public/stores/")
   ```

4. Set **Cache eligibility → Bypass cache**, then deploy the rule.
5. Do not set an Edge TTL override for either path. Remove or purge old direct-origin cache entries before testing the new release.

These rules prevent a downstream CDN response from bypassing the live check. The Worker can still use its own internal Cache API for approved content. Avoid **Purge Everything** unless you intend to clear production cache for the whole zone too.

### 5. Enable the staging storefront cache

Once the API, web app, Worker, routes, and bypass rules are ready:

1. Open **Workers & Pages → `drezivo-media-staging` → Settings → Variables and Secrets**.
2. Edit the plain-text variable:

   ```text
   PUBLIC_STOREFRONT_CACHE_ENABLED=true
   ```

3. Select **Deploy** to apply the change.

**Important:** PR #377’s `api/wrangler.jsonc` declares this value as `false`. A later Wrangler deployment can overwrite the dashboard value and turn the cache off again. Keep the staging Wrangler configuration and dashboard in sync for future deployments. [Cloudflare environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

### 6. Test that it works

Use a published **staging** store in a private browser window:

1. Open DevTools → **Network** and reload the storefront.
2. Select a request to an eligible store, `catalogue`, or product endpoint under:

   ```text
   https://api-preview.drezivo.shop/api/v1/public/stores/
   ```

3. Check **Response Headers** for `X-Public-Cache`. Repeat the same request: you should see a `MISS` followed by a `HIT` when it reaches the same Cloudflare location. Requests with cookies, authorization, or preview headers intentionally bypass this shared cache.
4. Archive a test product, unpublish a test store, and remove a test photo. Verify each is unavailable on the next network request, including when opening a copied photo URL.
5. Test booking availability and a price change before checkout. Confirm the customer is asked to confirm the current price.
6. Monitor Worker requests and `public_storefront_cache` logs, then compare a full day of Supabase Shared Pooler egress against your baseline.

To disable the storefront cache, set `PUBLIC_STOREFRONT_CACHE_ENABLED=false` and deploy the setting. The API remains the authoritative fallback.