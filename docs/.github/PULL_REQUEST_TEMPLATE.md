<!--
PR title must be a valid Conventional Commit line — it becomes the squash commit on main.
  docs(runbooks): correct the api rollback procedure for worker deploys
-->

## What changed

<!-- One paragraph. The effect, not the file list. -->

## Why

<!-- The reason, the alternative you rejected, anything non-obvious. -->

Refs: <!-- TRD §_, Data-Model §_, PRD §_, or issue # -->

## Which documents this supersedes

<!-- Name the file(s) this PR makes outdated or historical, if any — e.g. a superseded ADR,
     a runbook section replaced by a new procedure, or a product doc a decision changed.
     "None" is a valid answer. Per docs/AGENTS.md, do not leave a stale note contradicting the
     current direction without labeling it as historical or superseded. -->

## How it was checked

<!-- Commands you actually ran and what they printed. "Should work" is not checking. -->

- [ ] `npx markdownlint-cli2 "**/*.md"`
- [ ] Relative links in changed files resolve
