---
title: GitHub Rename Checklist
type: operations
status: planned
updated: 2026-09-16
tags: [drezivo, operations, github]
---

# GitHub Rename Checklist

The code now uses the Drezivo product name and `@drezivo` package scope. Complete these external
steps when the new Drezivo GitHub organization and monorepo are ready:

1. Create the new organization and one private repository for the root monorepo.
2. Push the root `main` branch and verify the root `LICENSE.md`, `.github`, and CODEOWNERS.
3. Configure Actions secrets, environments, branch protection, and deploy hooks once at root scope.
4. Update Clerk, S3, Neon, DNS, webhook, and monitoring allowlists that contain repository URLs.
5. Run root CI and a staging smoke test for each deployable workspace before production release.
6. Record the completed date and URLs in this note; preserve the old URL only in change history.

Do not put tokens or private URLs in this vault.
