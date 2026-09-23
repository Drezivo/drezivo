# Drezivo documentation

Start with the [current PRD](product/Drezivo-PRD.md), [TRD](architecture/Drezivo-TRD.md),
[logical data model](architecture/Drezivo-Data-Model.md), and [ERD input](architecture/Drezivo-ERD.dbml).
Historical product documents remain available with precedence banners.

## Second Brain

Open [`second-brain/`](second-brain/) as the project-only Obsidian vault and begin at
[`00-Home/Drezivo Home.md`](second-brain/00-Home/Drezivo%20Home.md). It is a linked memory and
navigation layer; the current specifications and accepted decisions in this workspace remain
authoritative.

## Legal drafts

The Philippines-first [Terms of Service](product/legal/Drezivo-Terms-of-Service.md) and
[Privacy Policy](product/legal/Drezivo-Privacy-Policy.md) are counsel-review drafts. They are
canonical copy for the public web pages, but placeholders must be completed and a Philippine lawyer
and appointed Data Protection Officer must approve publication.

The companion [legal and trust documentation index](product/legal/README.md) includes the
acceptable-use, processor, retention, cookie, security-overview, and vulnerability-reporting
drafts. These documents describe proposed controls and approval gates; they do not certify a
production deployment.

## Development

Use Node 22 or 24. Run `npm ci`, `npm run lint:md`, and `npm run lint:links`.
Read [contribution rules](CONTRIBUTING.md), [architecture decisions](decisions/0006-monorepo.md), and [runbooks](runbooks/).
Agent instructions live in `CLAUDE.md` / `.claude` and `AGENTS.md` / `.codex`.
See [agent mirror utilities](scripts/README.md) for synchronization.

## License

This repository contains proprietary Drezivo documentation. Use is limited to the permission in [LICENSE.md](LICENSE.md); quoted or linked third-party material keeps its original rights.
