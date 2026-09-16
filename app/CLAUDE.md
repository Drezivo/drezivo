# Drezivo App

Business dashboard (app.drezivo.com) for Drezivo, a Philippines-first multi-tenant clothing
rental SaaS. Next.js 15 App Router, TypeScript strict, Tailwind v4, Clerk, TanStack Query.
Staff-only: Owner and Front desk roles sign in with an active organization.

## Commands

`dev` · `build` / `start` · `typecheck` (tsc --noEmit) · `lint` / `lint:fix` · `test`
(Vitest) · `test:e2e` (Playwright, builds and boots the app first)

## Key decisions

- Business writes live in the Express API, never in a Next.js route handler
  (`src/app/api/**` is readiness-only — TRD §1).
- Every mutating control goes through `lib/use-submit-guard.ts` — a shared hook, never
  per-screen code (`.claude/rules/lessons.md`).
- API types come only from `@drezivo/contracts`, pinned exact — no hand-written API type.
- `lib/permissions.ts` gates UX only, never authorization; the API re-checks every route.

@.claude/rules/idempotency-concurrency.md
@.claude/rules/engineering-standards.md
@.claude/rules/git-workflow.md
@.claude/rules/frontend.md
@.claude/rules/code-quality.md
@.claude/rules/testing.md
@.claude/rules/security.md
@.claude/rules/no-tracked-env.md
@.claude/rules/lessons.md
