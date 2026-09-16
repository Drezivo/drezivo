---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/lib/**"
  - "tests/**"
---

# Code Quality

## Anti-defaults (counter common Claude tendencies)

- No premature abstractions. Three similar list/detail pages beat a generic
  `<EntityListPage>` used once.
- Don't add features beyond what was asked — this repo already has enough surface area
  across nine route groups.
- Don't refactor adjacent code while fixing a bug.
- No dead code or commented-out blocks. Git has history.
- WHY comments, never WHAT. If code needs a "what" comment, rename instead.

## Naming

- Files: PascalCase is not used for components in this repo — everything is kebab-case
  (`reservation-status-badge.tsx`, `use-submit-guard.ts`), matching the existing tree.
  Follow that, not a generic React convention.
- Booleans: `is` / `has` / `should` / `can` prefix (`isPending`, `canConfirm`). Handlers:
  `handle*` internal, `on*` as props (`onConfirmed`, `onClose`).
- Hooks: `use*`, always client-side (`"use client"` at the top of the file).
- Abbreviations only when universally known (`id`, `url`, `api`). Acronyms as words:
  `organizationId`, not `organizationID`.

## Code Markers

`TODO(author): desc (#issue)` for planned work. `FIXME(author): desc (#issue)` for known
bugs. `NOTE: desc` for non-obvious context — this repo uses `NOTE`-style comments heavily to
cite the PRD/TRD section a business rule comes from; keep that pattern. Never `XXX`, `TEMP`.

## File Organization

- Imports: builtins, external (`react`, `@clerk/nextjs`, `@tanstack/react-query`), internal
  `@/lib` / `@/components`, relative, then `type` imports from `@drezivo/contracts` last.
- Exports: named over default, except Next.js route files (`page.tsx`, `layout.tsx`) which
  Next.js requires as default exports.
- One component per file. Colocate a domain component's small helper components in the same
  `src/components/<domain>/` directory, not in the page file.
