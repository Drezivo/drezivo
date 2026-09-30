# Worker on Cloud Run Jobs (Stage 1, no monthly fee)

How to run the Drezivo worker as two scheduled Google Cloud Run Jobs. The worker is the process
that sends email, expires unpaid holds, reconciles Clerk and subscriptions, and clears the outbox.
The API (on Render) and the database (Supabase) are assumed to exist already.

At Stage 2, when paying for an always-on worker, run the same image with `WORKER_MODE=continuous`
instead and delete these jobs. See `Drezivo-Worker-Hosting-Guide.docx`, section 6.

## What runs

| Job | Schedule | Settings | What it does |
| --- | --- | --- | --- |
| `drezivo-worker` | every 15 minutes | `WORKER_MODE=drain`, `WORKER_DRAIN_SCOPE=all` | Runs every sweep once (hold expiry, subscriptions, Clerk reconciliation and cleanup, garment recovery readiness), then works through the whole outbox and exits. |
| `drezivo-worker-fast` | every 2 minutes | `WORKER_MODE=drain`, `WORKER_DRAIN_SCOPE=fast` | Releases expired holds and sends queued emails, then exits. An expired hold keeps its garment unbookable until it is released, and verification codes are valid for only 10 minutes, so neither can wait 15. |

Both jobs run the same container image as the API, with the command `node dist/worker.js`.

Running the two jobs at the same time is safe. The worker claims outbox rows with
`FOR UPDATE SKIP LOCKED`, so two runs never take the same row. A run that is killed releases its
rows when their lease expires (`WORKER_LEASE_SECONDS`, 60 seconds by default). Tested in
`api/tests/integration/worker-drain.test.ts`.

## What it costs

These figures were checked in September 2026. Re-check them before relying on them.

- **Cloud Run Jobs:** the first 240,000 vCPU-seconds and 450,000 GiB-seconds each month are free,
  per billing account.
  - A run takes about 3 to 5 seconds, mostly Node starting up.
  - The 2-minute job is about 21,600 runs, or roughly 110,000 vCPU-seconds, a month.
  - The 15-minute job adds about 2,900 runs.
  - Singapore is a higher-priced region and the free allowance is applied at lower-tier prices,
    so leave headroom. Do not schedule the fast job every minute: that is roughly
    216,000 vCPU-seconds, at the edge of the allowance.
- **Cloud Scheduler:** 3 jobs per billing account are free, and this setup uses 2.
- **Secret Manager:** all secrets live in one secret, read once per run. That is about 24,500
  reads a month against 10,000 free, which works out to roughly US$0.05 a month.
- **Artifact Registry:** 0.5 GB of storage is free. Keep only the last few images; step 5 sets a
  cleanup policy.

Set the US$1 budget alert in step 1 so any surprise shows up in your email, not on your bill.

## Before you start

1. **Supabase has every migration applied**, through `0060_storefront_cms_settings.sql`. Apply
   them from the release commit: in `api/`, set `DATABASE_URL_DIRECT` and run `npm run db:migrate`.
   See `docs/runbooks/migrations.md`.
2. **The `drezivo_worker` role has a password.**
   - Generate a long random password, for example 32 characters from a password manager, and use
     only letters and digits so it needs no URL escaping.
   - In the Supabase SQL editor, run `ALTER ROLE drezivo_worker WITH LOGIN PASSWORD '<password>';`.
   - Never reuse the `drezivo_app` password.
3. **Get the worker's connection string** from Supabase → Connect → **Session pooler**, not
   Direct.
   - Cloud Run cannot reach Supabase's IPv6-only direct endpoint; the session pooler is IPv4.
   - The username is `drezivo_worker.<project-ref>`. Copy it from the dialog rather than typing it.
   - Append `?sslmode=require`.
4. **Collect the values the worker shares with the API on Render.** They must be identical.
   - `INVITATION_EMAIL_ENCRYPTION_KEY` and `INVITATION_EMAIL_DIGEST_KEY` must match exactly. The
     API seals every queued email with them, and a worker with different keys cannot open them.
   - Also: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`,
     `CORS_ALLOWED_ORIGINS`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`,
     `OBJECT_STORAGE_BUCKET_PRIVATE`, `OBJECT_STORAGE_ACCESS_KEY_ID`,
     `OBJECT_STORAGE_SECRET_ACCESS_KEY`, and `OBJECT_STORAGE_FORCE_PATH_STYLE`.
5. **Resend is ready.** You need your API key and a sender address.
   - `onboarding@resend.dev` only delivers to your own Resend account address.
   - To email renters, verify your own domain in Resend and send from an address on it.

## Step 1 — Google Cloud project (once, in the browser)

1. Sign in at <https://console.cloud.google.com>. Create a project, for example
   `drezivo-prod`, and note its **project ID**.
2. Link a billing account. It is required even for free-tier use.
3. Go to Billing → **Budgets & alerts**. Create a budget of US$1 for this project with email
   alerts at 50%, 90%, and 100%.

## Step 2 — Install and sign in to `gcloud` (once, on your PC)

Install the Google Cloud CLI from <https://cloud.google.com/sdk/docs/install> (the Windows
installer). Then, in PowerShell:

```powershell
gcloud auth login
$PROJECT = "drezivo-prod"          # your project ID
$REGION  = "asia-southeast1"       # Singapore; use the region closest to your Supabase project
gcloud config set project $PROJECT
gcloud config set run/region $REGION
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com cloudbuild.googleapis.com
```

## Step 3 — Service accounts (once)

One account runs the jobs and may read only the worker secret. A second account may only start
the jobs, for Cloud Scheduler.

```powershell
gcloud iam service-accounts create drezivo-worker-runtime --display-name "Drezivo worker runtime"
gcloud iam service-accounts create drezivo-worker-scheduler --display-name "Drezivo worker scheduler"
$RUNTIME_SA   = "drezivo-worker-runtime@$PROJECT.iam.gserviceaccount.com"
$SCHEDULER_SA = "drezivo-worker-scheduler@$PROJECT.iam.gserviceaccount.com"
```

## Step 4 — The one secret (once, and again whenever a value changes)

Create a local file **outside the repository**, for example `C:\secure\drezivo-worker.env`. Fill
in the real values, then upload it:

```dotenv
DATABASE_URL=postgresql://drezivo_worker.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require
CLERK_SECRET_KEY=...
CLERK_PUBLISHABLE_KEY=...
CLERK_WEBHOOK_SIGNING_SECRET=...
CORS_ALLOWED_ORIGINS=https://your-app-domain
INVITATION_EMAIL_ENCRYPTION_KEY=...
INVITATION_EMAIL_DIGEST_KEY=...
OBJECT_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET_PRIVATE=...
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_FORCE_PATH_STYLE=false
EMAIL_PROVIDER=resend
EMAIL_FROM=Drezivo <bookings@your-domain>
RESEND_API_KEY=re_...
STOREFRONT_PUBLIC_ORIGIN=https://your-storefront-domain
```

```powershell
gcloud secrets create drezivo-worker-env --replication-policy=automatic --data-file="C:\secure\drezivo-worker.env"
gcloud secrets add-iam-policy-binding drezivo-worker-env --member="serviceAccount:$RUNTIME_SA" --role="roles/secretmanager.secretAccessor"
```

To change a value later, edit the file and run
`gcloud secrets versions add drezivo-worker-env --data-file="C:\secure\drezivo-worker.env"`. Then
disable the old version in the console, because only 6 active versions are free. The next run
picks up `latest` automatically.

Never commit this file, never paste it into chat, and delete it once it is uploaded if you do not
need a local copy.

## Step 5 — Build and push the image (every release)

The image is built in Google Cloud Build, so Docker does not need to run on your PC. Cloud Build
is free for the first 2,500 build-minutes a month, and one build takes about 5 to 10 minutes.

Run this from the repository root, on the commit you are releasing:

```powershell
gcloud artifacts repositories create drezivo --repository-format=docker --location=$REGION
$TAG   = git rev-parse --short HEAD
$IMAGE = "$REGION-docker.pkg.dev/$PROJECT/drezivo/api:$TAG"
gcloud builds submit --config=api/cloudbuild.yaml --substitutions="_IMAGE=$IMAGE" .
```

Run the `repositories create` line only the first time.

- **What gets uploaded:** the root `.gcloudignore` controls the upload and excludes every `.env*`
  file, `node_modules`, and build output. The image cannot contain an `.env` file either, because
  `.dockerignore` excludes `**/.env*`.
- **If the build fails with a permission error** on pushing the image, grant the build account
  write access to the repository, then re-run the build:
  `gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role="roles/artifactregistry.writer"`.
- **Building locally instead:** if Docker Desktop works on your PC, you can run
  `gcloud auth configure-docker "$REGION-docker.pkg.dev"`, then `docker build -f api/Dockerfile -t $IMAGE .`
  and `docker push $IMAGE`.

To stay inside the free 0.5 GB, keep only the three newest images. Create a file
`C:\secure\ar-cleanup.json`:

```json
[
  { "name": "keep-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 3 } },
  { "name": "delete-rest", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
```

Then apply it:

```powershell
gcloud artifacts repositories set-cleanup-policies drezivo --location=$REGION --policy="C:\secure\ar-cleanup.json" --no-dry-run
```

## Step 6 — Create the two jobs (once; step 8 covers updates)

```powershell
$COMMON = "NODE_ENV=production,WORKER_ENABLED=true,WORKER_MODE=drain,DATABASE_POOL_MAX=3,DREZIVO_ENV_FILE=/secrets/worker.env"

gcloud run jobs create drezivo-worker `
  --image=$IMAGE --command=node --args=dist/worker.js `
  --service-account=$RUNTIME_SA --cpu=1 --memory=512Mi `
  --tasks=1 --max-retries=0 --task-timeout=840s `
  --set-env-vars="$COMMON,WORKER_DRAIN_SCOPE=all,WORKER_DRAIN_BUDGET_MS=600000" `
  --set-secrets="/secrets/worker.env=drezivo-worker-env:latest"

gcloud run jobs create drezivo-worker-fast `
  --image=$IMAGE --command=node --args=dist/worker.js `
  --service-account=$RUNTIME_SA --cpu=1 --memory=512Mi `
  --tasks=1 --max-retries=0 --task-timeout=110s `
  --set-env-vars="$COMMON,WORKER_DRAIN_SCOPE=fast,WORKER_DRAIN_BUDGET_MS=60000" `
  --set-secrets="/secrets/worker.env=drezivo-worker-env:latest"
```

Why these values:

- `--max-retries=0`: the next scheduled run is the retry. A failed email inside a run is retried
  by the outbox's own backoff, up to its attempt limit.
- The budget is shorter than the task timeout, so a run stops claiming new work and finishes the
  batch in hand before Cloud Run's deadline. If the timeout is hit anyway, Cloud Run sends
  `SIGTERM`, and the worker finishes its current batch and exits.
- `DREZIVO_ENV_FILE` points at the mounted secret. Variables set with `--set-env-vars` take
  precedence over the file. If the file is missing, the worker refuses to start.

Run each job once by hand and read the result:

```powershell
gcloud run jobs execute drezivo-worker --wait
gcloud run jobs execute drezivo-worker-fast --wait
gcloud logging read 'resource.type="cloud_run_job" AND jsonPayload.msg="worker drain finished"' --limit=5 --format="value(resource.labels.job_name,jsonPayload.scope,jsonPayload.processed,jsonPayload.stoppedBy,jsonPayload.sweepFailures)"
```

A healthy run logs `worker drain finished` with `stoppedBy` set to `empty` and no
`sweepFailures`. If the execution failed, open the job in the console → Executions → Logs. The
first error names the missing or invalid variable. The worker never logs secret values.

## Step 7 — Schedules (once)

```powershell
gcloud run jobs add-iam-policy-binding drezivo-worker --member="serviceAccount:$SCHEDULER_SA" --role="roles/run.invoker"
gcloud run jobs add-iam-policy-binding drezivo-worker-fast --member="serviceAccount:$SCHEDULER_SA" --role="roles/run.invoker"

gcloud scheduler jobs create http drezivo-worker-every-15m --location=$REGION `
  --schedule="*/15 * * * *" --time-zone="Asia/Manila" --http-method=POST `
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/drezivo-worker:run" `
  --oauth-service-account-email=$SCHEDULER_SA

gcloud scheduler jobs create http drezivo-worker-fast-every-2m --location=$REGION `
  --schedule="*/2 * * * *" --time-zone="Asia/Manila" --http-method=POST `
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/drezivo-worker-fast:run" `
  --oauth-service-account-email=$SCHEDULER_SA
```

To check that it works end to end, request a verification code on the live storefront. It should
arrive within about 2 minutes.

## Step 8 — Releasing a new version

Build and push a new image (step 5), then point both jobs at it:

```powershell
gcloud run jobs update drezivo-worker --image=$IMAGE
gcloud run jobs update drezivo-worker-fast --image=$IMAGE
```

Apply database migrations before the new image runs, following the expand-first rules in
`docs/runbooks/migrations.md`.

## Pause, resume, or roll back

- **Pause everything:** run `gcloud scheduler jobs pause drezivo-worker-every-15m --location=$REGION`
  and the same for `drezivo-worker-fast-every-2m`. Use `resume` to restart. Queued work waits
  safely in the outbox while paused.
- **Roll back:** run `gcloud run jobs update <job> --image=<previous image tag>` for both jobs.
- **Something is stuck in the dead-letter state:** it shows in the outbox with `status = 'dead'`
  and a `safe_last_error`. Fix the cause before re-queuing it. Unknown event types dead-letter on
  purpose.

## Known limits

- An expired, unpaid hold keeps its garment unavailable until the fast job releases it, up to
  about 2 minutes. The project target is 60 seconds (TRD §11). Only an always-on worker (Stage 2,
  `WORKER_MODE=continuous`) meets that.
- Double-booking can never happen either way: the database constraint enforces capacity, and the
  sweep only decides how soon a released garment becomes bookable again.
- Subscription, Clerk, and garment-readiness sweeps run every 15 minutes.
- Owner and renter notification emails can take up to 2 minutes to arrive.
- The Supabase free plan pauses a project after 7 days without queries. The 15-minute job keeps
  it active.
