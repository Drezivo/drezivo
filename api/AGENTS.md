This workspace is part of the Drezivo monorepo. The root Git history, root license, root security baseline, and root agent rules govern changes across workspaces.

# AGENTS.md

Scope: backend code for this repository.

Stack: Node.js 22-24 + Express 5 + Drizzle ORM + PostgreSQL + TypeScript + Zod + Clerk + S3-compatible object storage + Vitest.

The backend powers a multi-tenant clothing rental SaaS. It owns tenant-safe APIs for authentication context, clothing inventory, date-based availability, reservations, customers, fittings, QR/receipt-based payments, storefront data, and business operations.

## Core Rules

* Follow existing project structure. Do not invent a new architecture unless requested.
* Prefer feature-based organization over layer-by-type organization.
* A feature owns its route/controller, service, repository, schemas, DTOs, and tests when those files exist.
* Controllers and routes must stay thin.
* Controllers validate input, call services, and shape HTTP responses.
* Do not put business logic in controllers or routes.
* Do not access Prisma directly from controllers or routes.
* Business logic belongs in services.
* Data access belongs in repositories.
* Services should not return raw Prisma models to clients.
* Map database records to response DTOs before returning them.
* Keep cross-feature imports limited. Use public services or shared modules, not another feature's internals.

## API Responses

* Use one consistent response envelope for every endpoint.
* Never return bare entities or ad-hoc response shapes.
* Successful responses should use the shared success helper.
* Errors should be thrown and handled by the global error handler.
* Do not use repeated try/catch blocks in every controller.
* Error codes must come from shared constants/enums, not inline strings.
* List endpoints must use one fixed pagination meta shape.

## Validation and Types

* Validate request body, params, and query at the route boundary.
* Use shared validation middleware when available.
* Do not call `.parse()` manually inside controllers.
* Services should receive already-validated, typed input.
* Use Zod schemas as the source of truth.
* Derive TypeScript types with `z.infer`.
* Do not create duplicate manual types that can drift from schemas.
* Use strict TypeScript.
* Avoid `any`; use `unknown` with narrowing.
* Do not use non-null assertions just to silence TypeScript.
* Do not use `@ts-ignore` or `@ts-expect-error` without a clear reason.
* Exported functions and service/repository methods should have explicit return types.

## Prisma and Database

* Use a single shared PrismaClient instance.
* Never create `new PrismaClient()` inside a feature.
* Repositories own Prisma calls.
* Use explicit `select` or `include`; fetch only needed fields.
* Do not return raw database rows to API clients.
* Use transactions for multi-write operations.
* Schema changes use the SQL migrations in `src/db/migrations/`, generated/managed with Drizzle tooling.
* Do not hand-edit the database for changes that ship.
* Use proper PostgreSQL native types where important.
* Never use `Float` for money.
* Add indexes for fields commonly filtered or sorted in list endpoints.
* Prefer enums over free-text strings for controlled values.

## Auth and Authorization

* Use Clerk as the authentication provider unless the project explicitly changes auth strategy.
* Authentication belongs in middleware.
* Verify Clerk sessions/tokens at the request boundary.
* Do not scatter token/session parsing across controllers or services.
* Do not call Clerk APIs directly from random feature code; wrap Clerk integration in shared auth middleware/services.
* Persist only the Clerk identifiers and profile fields the application actually needs.
* Treat Clerk's user id as an external auth identity, not as a replacement for tenant membership or authorization checks.
* Services receive a typed authenticated actor/context.
* Middleware answers "who is the user?"
* Services answer "is this user allowed to do this?"
* Authorization rules belong in services unless the project already has a dedicated policy layer.
* Every protected business operation must resolve the actor's organization/tenant access before reading or writing tenant-owned data.
* Public storefront endpoints may be unauthenticated, but they must expose only public, customer-safe data for the selected business.

## File Storage

* Use S3-compatible object storage for uploaded assets.
* Store clothing photos, business logos, storefront cover images, payment QR images, uploaded receipts, and verification documents in object storage, not in the database.
* Store object keys, metadata, ownership, and access state in PostgreSQL.
* Keep bucket names, regions, endpoints, credentials, and public URL settings in centralized validated config.
* Never commit storage credentials or access keys.
* Use tenant-aware object key prefixes so files can be traced to the owning organization.
* Do not expose private bucket keys directly to clients when the asset is not public.
* Use signed upload/read URLs for private files such as payment receipts and verification documents.
* Public assets, such as storefront logos and clothing photos, may use public URLs only when the business has made the asset public.
* Validate file type, file size, and allowed upload purpose before issuing an upload URL or accepting an upload.
* Do not trust client-provided filenames for storage paths.
* Deleting or replacing database records should account for the related object storage lifecycle.

## Config and Logging

* Centralize environment/config access.
* Do not read `process.env` randomly across features.
* Validate required config at startup.
* Never commit secrets, keys, tokens, or connection strings.
* Use the project logger.
* Do not use `console.log` in production code.
* Never log secrets, tokens, passwords, or full request bodies.

## Async and Errors

* Check the installed Express major version before changing async handler behavior.
* In Express 5, async errors are forwarded automatically.
* In Express 4, async controllers must be wrapped so rejected promises reach the global handler.
* Throw typed application errors.
* Do not throw raw strings.
* Do not use generic `Error` when a typed error exists.
* Do not return `null` as an error sentinel; throw a typed error or return an explicit empty result.

## Testing

* Run relevant tests after code changes.
* Run lint, typecheck, and build when available.
* Service tests should cover business logic.
* Route/integration tests should cover request validation, auth behavior, response shape, and error shape.
* Tests must not use development or production databases.
* Tests should create data through helpers/factories when available.
* Keep tests focused on one behavior per case.
* Do not hide test cleanup problems with force-exit flags.

## Comments

* Prefer clear names and small functions over comments.
* Do not add comments that restate obvious code.
* Do not leave commented-out code.
* When touching a file, remove stale or misleading comments.
* Comments should explain why, not what.

## Git and PR Workflow

* Inspect current branch and git status before editing.
* If the current branch is `main`, `master`, `develop`, or unrelated to the task, create a new descriptive branch before changing files.
* Never push directly to `main`, `master`, or `develop`.
* Keep changes focused on the requested task.
* Do not include unrelated formatting or refactors.
* After changes, show the summary, files changed, tests run, and diff.
* Stop before committing unless the user explicitly approves.
* Only after approval: stage approved files, create a conventional commit, push the branch, and open a PR.
* Never force push, merge, or delete branches unless explicitly requested.
* PR summary must include what changed and how it was tested.

Read `.codex/rules/` before edits.

Codex mirror: `.codex/README.md`. Update canonical `.claude` rules, then run the sync utility in `../docs/scripts/`; verify with `--check`.


