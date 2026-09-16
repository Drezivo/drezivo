Public surface of Drezivo: marketing site + tenant storefront + guest booking flow, at drezivo.com.

## Commands
- `npm run dev` / `npm run build` / `npm run start`
- `npm run typecheck` / `npm run lint` / `npm run lint:fix`
- `npm test` / `npm run test:e2e`
- `npm run prepare` (husky hooks install)

## Key Decisions
- Public surface: only published, customer-safe tenant projections ever render — a foreign or unpublished store 404s, it never reveals existence via an error shape.
- Guests are authenticated by scoped capability link/cookie only — never by reference number or email address (those are not authentication).
- Every mutating control uses `useSubmitGuard` (`src/lib/use-submit-guard.ts`) — no double-submit, ever.
- API types come only from `@drezivo/contracts` — never hand-rolled duplicate types for API shapes.
- Next.js server-renders the public catalogue; it never duplicates business writes that belong to the Express API.

@.claude/rules/idempotency-concurrency.md
@.claude/rules/engineering-standards.md
@.claude/rules/git-workflow.md
@.claude/rules/frontend.md
@.claude/rules/security.md
@.claude/rules/code-quality.md
@.claude/rules/testing.md
@.claude/rules/no-tracked-env.md
@.claude/rules/lessons.md
