---
name: onboard
description: Use /onboard to orient an AI agent to Drezivo's product scope, architecture, folder ownership, and implementation state when switching providers or starting repository work.
---

# Drezivo onboarding

Produce a concise, source-linked orientation in chat. This is a read-only reconnaissance skill: do not create or update project documentation, and do not treat this checkout as necessarily current with the remote repository.

## Establish the checkout

1. Locate the repository root and read its `AGENTS.md`.
2. Inspect the current branch, commit, existing upstream/tracking information, dirty state, and worktree list using read-only Git commands. Do not fetch or update refs. Distinguish the active checkout from other worktrees.
3. State the evidence and limits: the checked-out commit and local changes are knowable; whether a newer remote commit exists is not knowable without fetching.

## Read authoritative project guidance

Read in this order, following links only as they are relevant:

1. Root `AGENTS.md`, `ROOT-REPOSITORY-ARCHITECTURE.md`, and `AI-AGENT-ONBOARDING.md`. These define the repository boundaries and onboarding protocol.
2. Root and workspace-local instructions for the areas being described, including the target workspace's `AGENTS.md` and `.codex/rules/` when applicable.
3. `docs/AGENTS.md` and `docs/README.md`, then the current product PRD, accepted ADRs relevant to the architecture, the TRD/data model, and only the runbooks needed to explain current operations.

Do not read every Markdown file. Use the second-brain/vault content only to find likely source documents; it is navigation and memory, not authority. Treat `docs/archive/`, superseded proposals, and historical PRDs as historical. The root README is an overview; verify implementation claims against current sources.

## Verify the current implementation selectively

Use repository file listings and text search to find the entrypoints, manifests, source modules, tests, and configuration that substantiate the overview. Read only what is needed to trace the core request/data flow and describe workspace responsibilities. Read workspace README and instructions when entering that workspace.

Separate evidence into these states:

- **Specified:** current PRD, accepted ADR, or other authoritative decision says it should behave this way.
- **Implemented in this checkout:** current source and, where useful, tests show the behavior exists here.
- **In progress:** behavior is on a feature branch, locally modified, or otherwise not yet established as integrated; cite the branch/dirty-state evidence.
- **Verified deployed:** only use this label when direct deployment or environment evidence was inspected. A merged-looking branch, passing test, build, or PR is not deployment proof.

When documents disagree with each other or with code, explain the discrepancy and cite both sides. Do not silently choose a stale claim as fact. Tests and builds may be useful evidence if already available, but do not run them by default during onboarding.

## Safety and scope

- Keep the onboarding run read-only. Do not edit files, generate reports, switch branches, commit, push, open PRs, or change external systems.
- Do not fetch the network, query databases, or connect to hosting/auth/storage providers.
- Never read `.env` files, credentials, tokens, or unrelated customer data. Follow root security instructions if later work becomes security-sensitive; onboarding itself does not authorize security changes.
- Do not run migrations, tests, typechecks, or builds by default. Recommend focused checks only when relevant to the user's next task.
- Never claim production readiness or deployment based only on source code or local validation.

## Chat briefing

Keep the result concise and useful for the next task. Include:

1. **Product and scope:** what Drezivo does, intended users, and important product boundaries.
2. **Core architecture/data flow:** the main workspaces and how a representative request/data flow passes between them, based on repository architecture guidance.
3. **Folder responsibilities:** the top-level ownership map from `ROOT-REPOSITORY-ARCHITECTURE.md`, especially `contracts`, `api`, `app`, `web`, and `docs`.
4. **Current checkout:** branch, commit, dirty/worktree state, and what that does or does not establish about current implementation.
5. **Key sources and discrepancies:** a small set of Markdown links to authoritative docs and code inspected, plus meaningful stale/conflicting claims or unknowns.

Use links that work in the current provider when possible (repository-relative Markdown paths are preferred). Keep intended, implemented, in-progress, and deployed claims explicitly distinct. If the provider does not discover `.agents/skills` automatically, tell the user this skill is available by pointing the agent at `.agents/skills/onboard/SKILL.md`; do not create provider-specific copies.
