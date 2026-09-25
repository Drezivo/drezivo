This workspace is part of the Drezivo monorepo. The root Git history, root license, root security baseline, and root agent rules govern changes across workspaces.

# Codex project guidance

The canonical project rules live in [`.codex/rules/`](.codex/rules/). Read the rules relevant to any change and preserve the existing scaffold architecture.

## Secret Scanning and Test Fixtures

* CI runs Gitleaks against a fresh repository checkout. Treat every key-, token-, password-, secret-, or credential-like literal as scan-sensitive, including values used only by tests.
* Prefer clearly synthetic, short, human-readable test fixtures instead of random or production-shaped token strings.
* If Gitleaks flags a literal that has been verified to be non-secret test data, first prefer rewriting the fixture so it no longer resembles a credential.
* If the scanner still flags the known-safe fixture because of its surrounding key/token label, add `// gitleaks:allow` only to the exact test line that triggered the finding.
* Never add `gitleaks:allow` to real credentials, environment/config values, private keys, provider tokens, connection strings, or any value whose origin is uncertain.
* Never suppress an entire file, directory, rule, or secret category merely to make CI pass. Do not weaken the repository Gitleaks configuration for a local false positive.
* Before finishing a change that introduces credential-like fixtures, run the same Gitleaks repository scan used by CI when Docker is available and review every finding rather than assuming it is a false positive.

Codex mirror: `.codex/README.md`. Update canonical `.claude` rules, then run the sync utility in `../docs/scripts/`; verify with `--check`.


