# Drezivo App

Staff authentication and owner dashboard shell (app.drezivo.com) for Drezivo. Next.js 15 App
Router, TypeScript strict, Tailwind v4, shadcn-style Radix primitives, and Clerk. The operational
dashboard data pages and API client are still being rebuilt.

## Commands

`dev` · `build` / `start` · `typecheck` (tsc --noEmit) · `lint` / `lint:fix` · `test`
(Vitest) · `test:e2e` (Playwright, builds and boots the app first)

## Key decisions

- `src/app/api/**` is readiness-only; business routes are not present in this workspace.
- Clerk owns sign-in, sign-up, email verification, and Google SSO.
- The protected dashboard route currently renders the navigation shell and an empty workspace until
  the operational dashboard data flows are rebuilt.

@.claude/rules/idempotency-concurrency.md
@.claude/rules/engineering-standards.md
@.claude/rules/git-workflow.md
@.claude/rules/frontend.md
@.claude/rules/code-quality.md
@.claude/rules/testing.md
@.claude/rules/security.md
@.claude/rules/no-tracked-env.md
@.claude/rules/lessons.md
