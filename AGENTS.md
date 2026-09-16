# Drezivo root agent instructions

Read [ROOT-REPOSITORY-ARCHITECTURE.md](ROOT-REPOSITORY-ARCHITECTURE.md) before touching any
workspace. It is the root source of truth for ownership, folder boundaries, setup, and release
order. Then read the target workspace's `AGENTS.md` and `.codex/rules/`.

For a complete first-turn protocol, read [AI-AGENT-ONBOARDING.md](AI-AGENT-ONBOARDING.md). It
summarizes how to establish context, trace a feature across workspaces, use the shared Obsidian
vault, validate changes, and leave durable handoff information.

The [human DOCX architecture guide](Drezivo-Human-Repository-Architecture-Guide.docx) is for human onboarding only. It explains the same system in expanded
visual form, but agents must follow the Markdown instructions and workspace-local rules above.

Preserve the monorepo topology: `contracts -> api -> app/web`, with `docs` as the canonical
specification workspace. Plan first, make narrow changes in the owning workspace, validate at the
boundary, keep mutations idempotent, fail closed, and never log secrets or commit environment files.
Unfinished behavior returns an explicit error; a passing build is not production certification.

The editable root agent guidance is `.claude/`; `.codex/` mirrors it. Keep matching root rule files
in sync when editing them. For workspace-local mirrors, run `node docs/scripts/sync-agent-config.mjs`
from the root and then its `--check` mode. Do not create
remotes, publish, modify GitHub settings, or deploy without explicit authorization.

Before security-sensitive design or implementation, read the private local `SECURITY-FOUNDATION.md` when it is available. It is intentionally ignored by Git. If it is absent, read `SECURITY-FOUNDATION.template.md` and obtain the private guide before changing authentication, authorization, tenant isolation, storage, logging, deployment, or incident-response behavior.
