---
paths:
  - "**/*"
---

# No tracked env files

- Every `.env*` file is gitignored (`.gitignore`, inherited from the shared Node template
  plus Next.js additions) — including `.env.example`. This repo documents variable **names**
  in prose (`CONTRIBUTING.md` §8 "Required environment variables", and
  `docs/runbooks/environments.md` in the docs repo), never in a committed file, so nobody is
  tempted to paste a working value next to the name.
- `.claude/hooks/protect-files.sh` denies Edit/Write to any `.env*` path as a second layer —
  don't route around it by writing to a differently-cased or nested path.
- If a secret ever does reach a commit: rotate it first, immediately, in whichever provider
  issued it (Clerk, the API's env, S3, etc.). Rewriting git history afterwards reduces
  future exposure but does not un-expose the value — assume it is burned the moment it is
  pushed, and rotation is the only fix that matters.
- CI (`ci.yml`, job `secrets`) fails the build if `git ls-files | grep -E '(^|/)\.env'`
  finds anything tracked — this is a release gate, not a suggestion.
