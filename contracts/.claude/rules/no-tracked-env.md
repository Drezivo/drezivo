# No tracked env files

Every `.env*` file is gitignored (see `.gitignore`'s `.env*` line) — including `.env.example`.
This repo currently defines no environment variables of its own (it is a schema/types package,
not a running service), so there is nothing to document yet. If one is ever introduced, its name
and meaning go in prose in `CONTRIBUTING.md` §7, in the same PR that introduces it — never as a
committed `.env` file, example or otherwise.

If a secret or `.env` file is ever committed to this repo despite the above: rotate the value
first, immediately, before doing anything else. Rewriting git history afterwards reduces future
exposure but does not un-publish it — clones, forks, and provider caches already have it. The
credential is burned the moment it is pushed, rotation is the only real fix.
