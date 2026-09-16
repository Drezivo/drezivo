This workspace is part of the Drezivo monorepo. The root Git history, root license, root security baseline, and root agent rules govern changes across workspaces.

# Drezivo docs

Scope: specs, architecture, decisions and runbooks only.
Read `.codex/rules/documentation-conventions.md` and `.codex/rules/idempotency-concurrency.md` before edits.
Read `.codex/rules/git-workflow.md` and `.codex/rules/no-tracked-env.md` before Git operations.
Record durable corrections in `.codex/rules/lessons.md`, then synchronize the `.codex` mirror.
Use GPT-5.6 Luna with low reasoning for delegated work.

## Sources and commands

Current owner instructions > `product/Drezivo-PRD.md` > accepted ADRs and `architecture/Drezivo-TRD.md` > legacy notes/screens.
`npm ci`; `npm run lint:md`; `npm run lint:links`.
No runtime build/deploy here. Preserve legacy docs with superseded notices.
No commit, push, remote creation or branch protection changes without explicit authorization.
See `CONTRIBUTING.md` for branches, commit format and PR gates.

Codex mirror: `.codex/README.md`. Update canonical `.claude` rules, then run the sync utility in `../docs/scripts/`; verify with `--check`.
