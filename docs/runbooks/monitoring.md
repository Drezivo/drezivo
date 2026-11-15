# Production monitoring

This guide covers the repository instrumentation and the provider settings an operator must
configure. Code alone does not create monitors, alerts, a Sentry project, or a deployed release.
Use separate staging and production projects or environment filters. Do not paste secrets or
production customer data into this document, test scripts, chat, or command output.

## What each tool does

| Tool | What to look for | Where to start |
| --- | --- | --- |
| HetrixTools | Whether your website and API respond, and outage alerts | Uptime Monitors in your existing account |
| Sentry | API errors and sampled endpoint response times | Create a Node.js project and configure the API's DSN |
| Vercel | Website visitors and page views | Web Analytics in each project |
| Render | API request volume, service resources, and logs | Your API service's Metrics and Logs pages |
| Supabase | Database connections, slow queries, storage, and egress | The production project's Observability and Advisors pages |
| k6 | A repeatable performance test before and after a change | Install k6 locally and run the staging test below |

The DSN is an address that tells Sentry where to receive API monitoring data. No Sentry data is
sent until it is configured and the API runs this code. k6 runs locally without a Grafana Cloud
account. HetrixTools checks availability from outside the application. None of these tools on its
own proves that a booking is correct or that the worker is processing jobs.

The code changes must pass review and be released through the normal process before they affect
production. Check plan limits and costs before enabling paid features. For a first setup, start
with HetrixTools and Sentry, then run k6 when ready.

## Sentry: API performance and errors

1. Create a Node.js project in Sentry. In Render, open the API service, choose **Environment**,
   and add its Sentry DSN as `SENTRY_DSN`. If the worker is a separate service, add the DSN
   there too; an embedded worker inherits the API service's settings. Store the value in the
   provider's secret manager, not in Git or chat. In Render, **Save only** does not deploy or
   activate the variable; use the normal authorized release process to apply it. Optionally set
   `SENTRY_RELEASE` to the deployed commit identifier. `SENTRY_TRACES_SAMPLE_RATE` accepts values
   between 0 and 1 and defaults to 0.1, or 10% of traces. Apply the settings via the normal
   release process.
2. In Sentry, filter by `production` and release. Add request count, failure rate, and p50,
   p95, and p99 duration views for `GET /api/v1/reservations/availability-check`,
   `GET /api/v1/public/stores/:slug/availability`, `POST /api/v1/reservations`, and
   `GET /api/v1/dashboard/overview`. Other routes are grouped as `other`; `/health` is excluded.
3. Use an error event's `request_id` to search Render logs. Inspect a sampled trace for the
   tenant database-work and connection-pool-wait spans. These do not time every query or
   external dependency, and database-work time includes application work inside the transaction.
   Investigate expensive queries in Supabase rather than assuming the entire span is query time.
4. The SDK sends only manually instrumented spans and captured server errors. Error messages,
   request fields, user details, source context, and stack variables are removed. Unknown routes
   have no dynamic path; UUID request IDs are retained for correlation. The API accepts incoming
   UUID request IDs and generates a new one for all other incoming values.

The default sampling rate means Sentry data is a sample, not an authoritative total. Check
sample counts and retention before comparing changes; low-traffic p99 is unstable. Use Render
request counts and status codes as an additional source. Sentry is disabled until a DSN is set.
For example, p95 of 500 ms means that 95% of the sampled requests finished in 500 ms or less.
When comparing changes, use the same route, environment, and comparable time periods, and check
the request count and error rate as well as p50, p95, and p99.

## Vercel and Render

- In Vercel, use Web Analytics to review visitors and page views. It does not report API
  response time; use Sentry and Render for endpoint latency.
- In Render, use the API service's Metrics and Logs views for request volume, response codes,
  CPU, memory, and response latency when available on the workspace plan. The Render latency
  view has p50 and p99; its eligible metrics stream includes p95. Its HTTP metrics cover public
  internet traffic, not private-network requests. Verify retention and cost on the current plan.
- Configure an error-rate alert where supported: 5xx responses above 5% over five minutes,
  with at least 10 requests in the window. If the provider cannot apply both conditions, use
  an equivalent alerting rule in the selected monitoring product and verify it with test data.
  Do not treat sampled Sentry counts as a complete denominator.
- Set sustained p95 investigation thresholds of 500 ms for availability reads and 1 second for
  ordinary mutations, excluding uploads and provider email. Evaluate over enough samples and
  tune the window to the traffic. These are initial targets from the on-call checklist.

## HetrixTools: availability

In your existing HetrixTools account, check or create HTTP monitors for `https://drezivo.shop`,
`https://partners.drezivo.shop`, and `https://api.drezivo.shop/health` after verifying the
production domains. Assign a contact list and test both failure and recovery notifications.
Use repeated failures before alerting where your plan and monitor settings allow.
The API `/health` result proves only that the process responds, not that the database, worker,
authentication, or booking flow works. A protected, non-mutating end-to-end check can be added
after a synthetic staging/production test account and its access controls are established.

The website and API monitors do not check the worker. Review the age of the oldest *due* pending
job, expired leases, failed jobs, and the last successful sweep separately. Automated outbox-lag
collection is not implemented yet; use the existing restricted operator checks in the
[on-call checklist](oncall-checklist.md) until a tenant-safe aggregate is available. Investigate
any unreconciled-money signal immediately.

## Supabase

Select the confirmed production project. Review Observability for database connections, storage,
egress, and resource pressure; review Query Performance and Performance Advisor for expensive
queries and blocking. Record the interval and reset time when comparing cumulative query stats.
Use access-controlled aggregate diagnostics and do not export customer rows or SQL parameters.
Availability of charts and alert settings varies by plan.

## Repeatable staging baseline

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) separately. Use an isolated
staging or preview environment and synthetic fixtures only. The script rejects hosts without a
`staging` or `preview` label except loopback, and requires an explicit staging confirmation.
That guard does not prove the chosen host is safe; verify its DNS and database before testing.
Never use a production token or production customer data.

In PowerShell, start with the non-mutating process check:

```powershell
$env:STAGING_API_ORIGIN = 'https://api-preview.drezivo.shop'
$env:CONFIRM_STAGING = 'true'
k6 run api/load-tests/baseline.js
```

For `SCENARIO=dashboard` or `availability`, set `STAGING_BEARER_TOKEN` to a short-lived
staging-only staff token with an active organization and authorized branch. Optionally set
`STAGING_BRANCH_ID`. For availability, set `AVAILABILITY_QUERY` to URL-encoded synthetic
`variant_id`, `pickup_at`, and `due_at` values. For `SCENARIO=reservation`, set
`RESERVATION_BODY` to a valid synthetic staff reservation JSON body: every iteration creates a
new reservation with a fresh idempotency key. Provide sufficient synthetic inventory and a cleanup
plan; do not run the write scenario against real data. Do not save tokens or the body in Git.

Defaults are one virtual user, one-minute duration, and three-second pauses. Override `VUS`,
`DURATION`, and `PAUSE_SECONDS` conservatively while respecting route rate limits. The script
checks HTTP success and the response success envelope, and reports p50 (median), p95, p99,
count, and failure rate. k6 `http_req_duration` excludes initial connection and DNS time.
Save the release, endpoint, fixture, load, time window, counts, and results in a private baseline
record. Repeat with matching conditions after the change, then compare a similar production
traffic window. Do not claim an improvement from a handful of observations.
