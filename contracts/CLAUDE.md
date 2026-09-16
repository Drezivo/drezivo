# contracts

`@drezivo/contracts` — the single source of truth for the Drezivo HTTP API contract shared by
`api`, `app`, and `web`. Zod schemas validate at the boundary; TypeScript types are derived
(`z.infer`); OpenAPI 3.1 is generated from the same schemas. See `README.md` and TRD §4.

## Commands

- `npm run build` — dual ESM/CJS build with `.d.ts` (tsup)
- `npm run typecheck` — `tsc --noEmit`, strict mode
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm test` — Vitest
- `npm run openapi:generate` — regenerate `openapi/drezivo.v1.yaml` from `src/`

## Key decisions

- Zod schemas are the source of truth. Types are always `z.infer<typeof schema>` — never a
  hand-written duplicate type that can drift from what actually validates the wire.
- Money crosses the wire as decimal-string integer minor units, never a JS `number` (TRD §4).
- Every enum is `z.enum([...])`, no catch-all — an unrecognized value fails closed.
- Release order is fixed: `contracts` ships first, then `api`, then `app`/`web` (README.md).

@.claude/rules/idempotency-concurrency.md
@.claude/rules/engineering-standards.md
@.claude/rules/git-workflow.md
@.claude/rules/code-quality.md
@.claude/rules/testing.md
@.claude/rules/no-tracked-env.md
@.claude/rules/lessons.md
