---
title: Drezivo Second Brain
type: system
status: active
owner: Drezivo team
updated: 2026-09-16
tags: [drezivo, system, second-brain]
---

# Drezivo Second Brain

This is the project-only Obsidian vault for Drezivo product, architecture, research, decisions,
operations, and engineering memory. It links the five code repositories without copying secrets,
customer records, or production data.

Start at [[00-Home/Drezivo Home]]. Use `[[wikilinks]]` between vault notes and normal Markdown
links to source repositories or external research. The vault is a thinking and navigation layer;
the API/database, current PRD, and accepted ADRs remain authoritative.

## Sharing safely

Use Obsidian Sync with an access-controlled vault, or a private Git repository containing only
redacted notes. Invite only project collaborators. Do not sync `.env` files, credentials, customer
PII, private payment evidence, or unredacted incident details. If publishing selected notes, export
only a reviewed copy. Obsidian Sync and Git solve synchronization; they do not provide authorization
for Drezivo business data.

## Maintenance

Create durable notes in the numbered folders, add frontmatter and links, and promote conclusions
from [[08-Daily/2026-09-16]] into the appropriate permanent note. Update
[[02-Architecture/Drezivo System Canvas]] when boundaries change and validate its JSON before sync.
