# Security incident: leaked credential

What to do when a secret — an API key, a database connection string, a Clerk secret key, an R2
credential, a signing secret — reaches somewhere it should not have: a commit, a log line, a
chat message, a public gist, a screenshot. This is a distinct procedure from
`docs/runbooks/incident.md`'s general severity levels because the correct first action is
different: for a leaked credential, the fix has to happen **before** investigation, not after.

## The order: rotate, then contain, then assess exposure

This order is deliberate and not interchangeable.

### 1. Rotate first

The moment a credential's exposure is suspected — not confirmed, *suspected* — rotate it.
Generate a new credential, update it in every environment that uses it
(`docs/runbooks/environments.md`), and confirm the new value is live before doing anything else.
Every minute a leaked credential remains valid is a minute someone else could be using it.
Do not wait to finish investigating how it leaked before rotating — investigation time is
exposure time.

For each credential type, rotating means:

- **Clerk secret key** — regenerate in the Clerk dashboard, redeploy `api` with the new value.
- **Supabase PostgreSQL credential** — rotate the role's password (or create a new role and cut over,
  if the current tooling supports it more safely), redeploy `api` with the new
  `DATABASE_URL`/`DATABASE_URL_DIRECT`.
- **Cloudflare R2 runtime credential** — revoke the exposed R2 S3 API token/access key in
  Cloudflare, issue a replacement scoped to the same environment and required bucket only, update
  the deployment secret manager, and redeploy `api`. Do not paste replacement credentials into
  incident notes. Treat already-issued presigned URLs as bearer capabilities until their expiry;
  individual URLs are not tracked as revocable application sessions, so contain upload exposure
  by stopping new authorization and following the storage incident procedure.
- **Webhook signing secret** (Clerk, payment/provider webhooks) — rotate at the provider,
  update `api`'s configured value. Note: rotating a webhook signing secret briefly risks
  rejecting legitimate in-flight webhook deliveries signed with the old secret — accept that
  cost; it is smaller than continued exposure.
- **`@drezivo/contracts` publish token** — rotate in GitHub, update whatever CI secret store
  holds it.

### 2. Contain

Once the credential itself is no longer valid, contain the blast radius of what may have already
happened while it was:

- Check access/audit logs for the exposed credential's actual usage during the exposure window,
  if the credential type provides one (Cloudflare R2 audit/observability available for the
  configured account, Clerk's own audit log, Supabase's Postgres and pooler logs). Look specifically for activity that does not match Drezivo's own
  known traffic pattern (unfamiliar IP ranges, unusual query patterns, access at unusual hours).
- If the credential could have been used to read or write tenant data, treat this as a potential
  tenant-isolation incident as well — escalate to SEV1 per `docs/runbooks/incident.md` regardless
  of whether misuse is yet confirmed. Suspected exposure of a credential capable of cross-tenant
  access is not something to wait-and-see on.
- Revoke any session, token, or capability that the leaked credential could have issued while
  valid, where that is feasible (e.g., force-expire active sessions if an auth-adjacent secret
  leaked).

### 3. Assess exposure

Only after rotation and containment, determine the actual scope:

- Where did it leak — a public commit, a private commit visible to a limited group, a log
  aggregator, a chat message? Each has a different realistic exposure window and audience.
- How long was it live and exposed — from first commit/log to the rotation completed in step 1?
- What could it have accessed — cross-reference the credential's actual scope (which bucket,
  which database role's grants, which Clerk permissions) against what a worst-case use of it
  during the exposure window could have touched.
- Document the finding — what leaked, when, how long it was live, what (if anything) the
  containment step found, and the rotation confirmation — as the incident record, following
  `docs/runbooks/incident.md`'s evidence-capture guidance (reference IDs, not personal content).

## A git history rewrite un-publishes nothing

If the leaked credential reached a commit, rewriting history (`git filter-repo`, BFG, a
force-push after removing it) **reduces future exposure to new clones going forward — it does
not undo exposure that already happened.** Every clone, fork, local checkout, and CI cache that
already pulled the commit still has the old value in its history, and any provider that cached
or indexed the commit (GitHub's own search indexing, third-party mirrors, security scanners that
archive found secrets) may still have a copy regardless of what `main` looks like afterward.
`CONTRIBUTING.md` §5 states this plainly: "Rewriting history afterwards reduces future exposure
but un-publishes nothing — clones, forks and provider caches keep it. The credential is burned
the moment it is pushed." Treat "burned" as permanent — the credential must be rotated, full
stop, regardless of whether history gets rewritten.

Rewriting history is still worth doing (it stops the *next* clone from picking up the value, and
it removes the specific string from search results in the repository going forward) — just never
as a substitute for rotation, and never communicated as having "removed" the exposure.

## After

- Confirm the new credential works in every environment that needs it before closing the
  incident.
- Record a lesson (`.claude/rules/lessons.md` in this repository, or the equivalent in whichever
  repository the leak occurred in) — specifically what let the credential reach a committed file
  or a log line, since that gap is the actual thing to fix, not just this one instance of it.
- If the exposure reached a public surface (public repo, public gist, public log), treat it as
  confirmed-compromised regardless of whether misuse was found in step 2 — absence of evidence
  in an audit log is not evidence of absence, especially for credential types with limited or no
  logging.
