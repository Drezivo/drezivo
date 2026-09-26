# Monorepo scaffold setup

## Local setup

Run all commands from the Drezivo root. Use Node 22 or 24 and the root lockfile:

```bash
npm ci
npm run check:docs
npm run typecheck
npm run lint
npm run test
```

The five workspace directories keep their existing names:

- `contracts` is the `@drezivo/contracts` workspace package.
- `api` is the Express API and worker service.
- `app` is the authenticated staff application.
- `web` is the marketing, storefront, and guest application.
- `docs` is the specifications and operations workspace.

Target one workspace with `npm run <script> --workspace <package-name>`. The root install links
`@drezivo/contracts` from the workspace, so no tarball bootstrap or sibling repository is required.
Do not create a nested Git repository and do not use the archived former checkout metadata.

Each application exposes `typecheck`, `lint`, `test`, and `build`. The docs workspace exposes
`lint:md` and `lint:links`. Environment variable names and runtime requirements belong in the
workspace README or `docs/runbooks/environments.md`; values belong in a deployment secret manager.

## GitHub and CI administration

Create the new Drezivo organization and one repository for this root. Copy the approved root
`.github/` workflows, CODEOWNERS, security settings, and templates after reviewing their identities.
Protect `main` with pull requests, required checks, and reviewed merges. The root `LICENSE.md` and
`LICENSE-POLICY.md` are authoritative. The organization profile template lives in
`github-organization-profile/README.md`.

Configure production, staging, and development secrets separately. Never put values in GitHub
variables that should be secret, the repository, issues, pull requests, build logs, or Obsidian.
See the private local `SECURITY-FOUNDATION.md` for session, risk, bot, audit, and incident controls.
If it is absent, read the root `SECURITY-FOUNDATION.template.md` and obtain the private guide.

## Agent configuration

Root `.claude` is editable and `.codex` mirrors it. Workspace-local rule folders remain for context
and must contain the human-writing and security rules. Run the sync utility after rule changes, then
run its `--check` mode. Reference settings describe compatibility only; they do not grant native
Codex capabilities.

## Scope and release gate

This is a development scaffold. Unimplemented business endpoints must return explicit errors. SQL
migrations require an isolated Supabase staging rehearsal, row-level security and concurrency tests, and review.
Worker delivery, session lifecycle controls, Clerk, Supabase PostgreSQL, S3, monitoring, and recovery need dedicated
implementation and integration evidence before serving business traffic. A green build is not a
production-readiness claim.
