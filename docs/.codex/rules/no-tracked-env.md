# No tracked `.env` files — EVER

> AUTO-LOADED. Standing rule, identical in every Drezivo repository.

No file whose name starts with `.env` is ever committed to this repository. That includes
`.env.example`. This rule applies here even though `docs` has no runtime configuration of its
own — the CI job that checks for a tracked `.env` file runs identically in every repository
(`docs/runbooks/environments.md`).

## Why `.env.example` is included in the ban, not just real `.env` files

An `.env.example` invites someone to copy it to `.env` and fill in a real value "just for now,"
and it invites a real value getting pasted into it by mistake during a copy-paste of a working
config. The failure mode this rule prevents has already happened elsewhere: a real credential
committed under a filename that looked like a template. The fix is structural, not
vigilance-based — the file type itself is never committed, so there is no file for a real value
to accidentally land in.

## Where environment variable names actually live instead

`docs/runbooks/environments.md` — variable **names**, in prose, with what each one is for. Never
a working value next to the name. Add the name there in the same PR that introduces it
elsewhere in the system (per `CONTRIBUTING.md` §7 in every repository).

## If a secret does reach a commit anyway

Rotate it immediately — before investigating how it got there. See
`docs/runbooks/security-incident.md` for the full procedure. A git history rewrite reduces
future exposure; it does not un-publish what already leaked. The credential is burned the
moment it is pushed, full stop.

## Enforcement in this repository

- `.gitignore` excludes every `.env*` pattern.
- The `secrets` job in `.github/workflows/ci.yml` fails the build if any tracked file matches
  `(^|/)\.env` and runs gitleaks against the diff.
- The `protect-files.sh` and `scan-secrets.sh` hooks in `.codex/hooks/` block a local Edit/Write
  from creating or modifying a `.env`-named file, or from writing content that looks like a
  credential, before it ever reaches a commit.
