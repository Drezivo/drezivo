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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
