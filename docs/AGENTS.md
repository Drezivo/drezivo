This workspace is part of the Drezivo monorepo. The root Git history, root license, root security baseline, and root agent rules govern changes across workspaces.

# Drezivo docs

Scope: specs, architecture, decisions and runbooks. The project-only `second-brain/` vault
contains canonical specifications and decision records as well as linked navigation notes.
Read `.codex/rules/documentation-conventions.md` and `.codex/rules/idempotency-concurrency.md` before edits.
Read `.codex/rules/git-workflow.md` and `.codex/rules/no-tracked-env.md` before Git operations.
Record durable corrections in `.codex/rules/lessons.md`, then synchronize the `.codex` mirror.
Use GPT-5.6 Luna with low reasoning for delegated work.

## Sources and commands

Current owner instructions > `second-brain/01-Product/Drezivo-PRD.md` > accepted ADRs in `second-brain/04-Decisions/ADRs/` and `second-brain/02-Architecture/Drezivo-TRD.md` > legacy notes/screens. Code and migrations show implementation, not product approval.
`npm ci`; `npm run lint:md`; `npm run lint:links`.
No runtime build/deploy here. Preserve legacy docs with superseded notices.
No commit, push, remote creation or branch protection changes without explicit authorization.
See `CONTRIBUTING.md` for branches, commit format and PR gates.

Codex mirror: `.codex/README.md`. Update canonical `.claude` rules, then run the sync utility in `../docs/scripts/`; verify with `--check`.

# Browser testing

When making changes to the application:

1. Start or use the existing development server.
2. Use the Playwright MCP server to verify UI changes in a real browser.
3. After modifying frontend/UI behavior, navigate to the affected page with Playwright.
4. Exercise the changed functionality.
5. If the browser test reveals a problem, fix the code and test again.
6. Do not consider a UI change complete until it has been verified with Playwright.
