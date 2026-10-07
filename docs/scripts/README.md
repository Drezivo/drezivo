# Agent configuration sync

From the Drezivo parent folder, run `node docs/scripts/sync-agent-config.mjs`.
Then run `node docs/scripts/sync-agent-config.mjs --check` to detect drift.
An optional target limits scope, for example `node docs/scripts/sync-agent-config.mjs app` for a
workspace or `node docs/scripts/sync-agent-config.mjs root` for the root agent configuration.
The utility runs from the monorepo root and updates the matching `.codex` mirror from `.claude`.

`.claude` is the editable source; `.codex` is generated guidance. Root `AGENTS.md` points
to the Codex mirror. Native Codex settings are not changed; `settings.reference.json`
is documentation, and these hooks do not run automatically in Codex.

Shell hooks retain `.sh` and require Bash plus their original tooling/environment.
CommonJS hooks use `.cjs`. From a repository root, the lesson check can be run manually
with `node .codex/hooks/lesson-guard.cjs`. Update lessons in `.claude/rules/lessons.md`,
then synchronize. Do not put credentials or local settings into either shared configuration.
