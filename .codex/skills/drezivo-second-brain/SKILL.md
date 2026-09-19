---
name: drezivo-second-brain
description: Maintain the project-only Drezivo Obsidian vault as a linked, source-backed knowledge graph.
---

# Drezivo Second Brain

The vault is `docs/second-brain/`. It is a project knowledge base, not an application database
and never a place for credentials or customer PII. Read the root `ROOT-REPOSITORY-ARCHITECTURE.md`
before creating notes.

## Note rules

1. Use YAML properties: `title`, `type`, `status`, `owner`, `source`, `updated`, and `tags`.
2. Use `[[wikilinks]]` for notes inside the vault; use normal Markdown links for external sources.
3. Add a source and date to research or external claims. Mark uncertain statements as assumptions.
4. Link each new note to the home map and at least one related note. Avoid orphan notes.
5. Preserve history: revise a note with a dated decision entry instead of erasing the reasoning.
6. Never write secrets, tokens, production credentials, customer records, or unredacted incident data.

## Graph rules

- `00-Home` is the navigation hub.
- `01-Product`, `02-Architecture`, `03-Repositories`, `04-Decisions`, `05-Operations`,
  `06-Research`, and `07-Glossary` are durable knowledge.
- `08-Daily` is dated working memory; promote durable conclusions into permanent notes.
- `99-Archive` is read-only historical material.
- Update `02-Architecture/Drezivo-System.canvas` when boundaries or flows change.
- Validate Canvas JSON: unique IDs and no dangling edge references.
- Use Bases only for note metadata views; never treat a Base as authoritative business data.

## Safe update loop

Read relevant notes, create or edit a small linked change, validate frontmatter, links, and Canvas
JSON, then update the daily note with what changed and why. If Obsidian CLI is available, use it
against the explicitly named vault; otherwise edit the open Markdown, JSON Canvas, and YAML files.
The current PRD/TRD and API/database remain authoritative over graph edges.
