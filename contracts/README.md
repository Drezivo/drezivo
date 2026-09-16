# @drezivo/contracts

The single source of truth for the Drezivo HTTP API contract. Zod schemas define every request
and response shape once; TypeScript types are derived from them (`z.infer`), and an OpenAPI 3.1
document is generated from the same schemas — so the three things that must agree (runtime
validation, compile-time types, published API docs) are never allowed to drift apart, because
there is only one place any of them could be edited.

Implements TRD §4 (API contract), §5 (booking/availability transaction contract), and §3 (auth)
against Data-Model §6 (reservation states) and §7 (operational finance).

## Consumers

This workspace package is imported by every Drezivo consumer:

| Workspace | What it does with this package |
|---|---|
| `api` | Validates every request/response against these schemas at the HTTP boundary. |
| `app` | The business dashboard — staff-facing reservation, finance, and tenancy flows. |
| `web` | The public marketing site and tenant storefront — storefront, catalogue, availability, guest checkout. |

None of the three hand-writes a duplicate type for anything this package already defines. If a
shape this package doesn't cover is needed, it is added here first.

## Installing from GitHub Packages

GitHub Packages requires the `@drezivo` scope to be pointed at its registry. Add an `.npmrc` in
the consuming workspace (or `~/.npmrc` for local dev) with:

```
@drezivo:registry=https://npm.pkg.github.com
```

Authentication is a `GITHUB_TOKEN` (CI) or a personal access token with `read:packages` (local
dev), supplied via the standard npm `//npm.pkg.github.com/:_authToken=` line or the
`NODE_AUTH_TOKEN` environment variable — never written as a literal value into a committed
`.npmrc`. See `docs/runbooks/environments.md` in each consuming repo for the exact variable name
it expects.

Then install and pin an exact version — nothing here auto-upgrades a consumer:

```bash
npm install @drezivo/contracts@0.1.0

For local development, run `npm ci` from the monorepo root. npm links this workspace package into
the API and both Next.js applications. A tarball is only for an explicitly approved external
integration and must never replace the root workspace dependency during normal development.
```

`zod` is a peer dependency (see `package.json`), not bundled, so a consumer's own `zod` install is
the one actually used at runtime — this package never ships a second copy that a branded type
from one won't structurally match against the other.

## Usage

```ts
import { holdIntentRequest, reservationState, errorEnvelope, contractVersion } from '@drezivo/contracts';

const parsed = holdIntentRequest.parse(requestBody); // throws on invalid input — validate at the boundary
console.log(`built against @drezivo/contracts@${contractVersion}`);
```

## Package layout

- `src/common/` — wire primitives every module builds on: money (decimal-string minor units),
  opaque branded IDs, ISO time/intervals, the one pagination shape, the error envelope, the
  idempotency header contract, the success envelope.
- `src/storefront/`, `src/availability/`, `src/reservations/`, `src/finance/`, `src/files/`,
  `src/tenancy/`, `src/guest/` — one module per TRD §2 domain boundary this contract covers.
- `openapi/generate.ts` — builds `openapi/drezivo.v1.yaml` from the registered schemas.
  `openapi/drezivo.v1.yaml` is **generated, never hand-edited** — CI fails a release if
  regenerating it produces a diff against the committed file.

## Regenerating the OpenAPI document

```bash
npm install
npm run openapi:generate
```

For local consumer bootstrap, run `npm ci && npm run build`. In the monorepo, `api`, `app`,
and `web` consume this workspace through the root workspace link. Do not create or install a
tarball during normal development. A published package is a separate release decision and must
use the release runbook.

Commit the resulting `openapi/drezivo.v1.yaml`. Never edit that file directly — the next
regeneration would silently discard the edit, and in the meantime the document would describe an
API that doesn't match the schemas.

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` | Dual ESM/CJS build with `.d.ts`, via tsup. |
| `npm run dev` | `build` in watch mode. |
| `npm run typecheck` | `tsc --noEmit`, strict mode. |
| `npm run lint` / `lint:fix` | ESLint. |
| `npm test` | Vitest. |
| `npm run openapi:generate` | Regenerate `openapi/drezivo.v1.yaml` from `src/`. |

## The release rule for a breaking change

A breaking contract change **never** ships in one step. It ships in three, each a separate
release:

1. **Publish a version where the old and new shapes are BOTH valid.** A field being renamed
   exists under both names; a field being removed is still accepted (and still emitted) as
   optional. Nothing in `api`, `app`, or `web` needs to change yet.
2. **Migrate every consumer** to the new shape, at their own pace, each in its own PR. `api`
   migrates first (it's upstream of `app`/`web` for behavior, even though `contracts` is upstream
   of all three for the contract itself), then `app` and `web`.
3. **Remove the old shape**, in a later release, once no consumer reads or writes it anymore.

This is the same expand/backfill/validate/switch/contract discipline TRD §9 requires for database
migrations, applied to the API contract instead of a schema. Mark the commit that starts step 1
with `!` and a `BREAKING CHANGE:` footer (see `CONTRIBUTING.md`) so the version bump and the
downstream migration obligation are both unambiguous from the commit alone.

## Workspace release order

```
contracts  ──▶  api  ──▶  app / web
   (1)          (2)         (3)
```

`contracts` changes are reviewed first within the root pull request, then the API and client
workspaces are updated. See the root release runbook for the complete gate. The package can be
published for external integrations only through an approved release decision.

## License

This repository is proprietary Drezivo software. Use is limited to the permission in [LICENSE.md](LICENSE.md); third-party dependencies retain their own licenses.


