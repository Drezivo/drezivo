#!/usr/bin/env bash
# Apply the Drezivo monorepo's fallback branch protection after CI exists.
#   ./branch-protection.sh Drezivo/drezivo "verify"
# Requires: gh auth login, with admin rights on the repo.
set -euo pipefail

REPO="${1:?usage: branch-protection.sh <owner/repo> [required check names, comma separated]}"
CHECKS="${2:?usage: branch-protection.sh <owner/repo> <required check names, comma separated>}"

[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "invalid owner/repo" >&2; exit 2; }

echo "Applying branch protection to ${REPO}:main"

CONTEXTS_JSON=$(CHECKS="$CHECKS" node -e '
const checks = process.env.CHECKS.split(",").map((s) => s.trim()).filter(Boolean);
if (!checks.length) { console.error("required check list is empty"); process.exit(2); }
process.stdout.write(JSON.stringify(checks));
')

gh api -X PUT "repos/${REPO}/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ${CONTEXTS_JSON} },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": true
}
JSON

# Squash-only merges keep one Conventional Commit per change on main.
gh api -X PATCH "repos/${REPO}" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY

echo "Done. main is protected: no direct pushes, no force-pushes, 1 code-owner review, and required checks."
