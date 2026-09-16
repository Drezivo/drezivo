# Drezivo root guidance

Read [ROOT-REPOSITORY-ARCHITECTURE.md](ROOT-REPOSITORY-ARCHITECTURE.md) first. It explains the
one monorepo, workspace ownership, folder purposes, architecture, release order, glossary,
and scaffold limitations. Before editing a workspace, read its `AGENTS.md` and the relevant
`.claude/rules/` files. Keep `.claude/` as the editable root source and keep matching `.codex/`
files synchronized.

The product uses Next.js and TypeScript for `app` and `web`, Express and TypeScript for `api`,
Neon PostgreSQL with Drizzle, Clerk identity, S3 storage, REST, and a versioned `contracts` package.

Read [SECURITY-FOUNDATION.md](SECURITY-FOUNDATION.md) before security-sensitive work. Treat its
configuration values as review starting points, never as secrets or production certification.
