---
title: Hosting the Drezivo Second Brain
type: operations
status: current
updated: 2026-09-16
tags: [drezivo, operations, security]
---

# Hosting the Drezivo Second Brain

## Recommended shared setup

Use **Obsidian Sync** with a private vault for the product team. Create one shared vault from
the `docs/second-brain` folder, enable end-to-end encryption, and invite only named team
members. Sync is the simplest way to keep graph, Canvas, and Bases views consistent across devices.

### Owner setup

1. Install Obsidian and choose **Open folder as vault** for `docs/second-brain/`.
2. Confirm `00-Home/Drezivo Home.md`, the Canvas, and `Drezivo Knowledge Base.base` open.
3. Subscribe to Obsidian Sync, create a private remote vault named `Drezivo Second Brain`, and
   enable end-to-end encryption. Store the recovery password in the team password manager.
4. Select this local vault for synchronization. Do not sync the parent workspace folder.
5. Enable core features **Backlinks**, **Canvas**, **Properties**, **Bookmarks**, and **Bases**.
   The supplied vault does not require a community plugin.
6. Invite collaborators by named account. Each person installs Obsidian, accepts the invite, and
   opens the synced vault on their own device.
7. Test with a harmless temporary note in `08-Daily`, confirm it syncs, then delete it.

Do not use Obsidian Sync and Git synchronization on the same working vault. Pick one owner for
vault settings and one backup/restore procedure.

## Engineering alternative

Use a private Git repository when reviewable history and pull requests matter more than a simple
nontechnical workflow. Commit Markdown, Canvas, Base, and configuration files; exclude credentials,
customer data, exports, and local workspace state. Contributors pull before editing and use one
small commit per decision or topic.

### Private Git setup

1. Create a private `drezivo-second-brain` repository in the renamed GitHub organization.
2. Copy only the contents of `docs/second-brain/` into that repository; keep the vault as its
   repository root.
3. Enable secret scanning and review the first commit for credentials, customer data, and local
   absolute paths.
4. Contributors clone the repository, open the clone as an Obsidian vault, pull before editing,
   and commit small note or decision changes.
5. Review and merge changes like code; resolve Markdown conflicts before reopening Obsidian.
6. Document backup and restore ownership. Do not add an Obsidian Git plugin without reviewing its
   permissions and update policy.

## Deferred alternative

2026-09-16: self-hosting the sync backend on the existing Hostinger VPS was researched as a way to
avoid the Obsidian Sync subscription, then deferred by the owner. The recommendation above is
unchanged. Do not start that work without reading
[[06-Research/Self-Hosted Vault Sync]] first; it records the constraints, the operational cost, and
the conditions that should trigger a revisit.

## Sharing rules

- Never place API keys, Clerk tokens, database URLs, payment data, or customer PII in the vault.
- Link to source code and external research; copy only durable conclusions and cite the source/date.
- Treat `docs/product/Drezivo-PRD.md`, `docs/architecture/Drezivo-TRD.md`, and the root architecture guide as authoritative.
- Move superseded notes to `99-Archive` and set `status: archived`; do not delete decision history.

## Update loop

1. Capture a daily note in `08-Daily`.
2. Promote stable facts to Product, Architecture, Operations, or Glossary notes.
3. Record material choices in `04-Decisions/Decision Register.md`.
4. Refresh the Canvas only when relationships change; keep node IDs stable.
5. Review the Base view before releases to find stale or missing metadata.
