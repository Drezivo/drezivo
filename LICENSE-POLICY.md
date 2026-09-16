# Drezivo Organization and Monorepo License Policy

**Status:** draft for legal and founder approval
**Owner:** [INSERT LEGAL ENTITY NAME]
**Last reviewed:** [INSERT DATE]

## Policy

Drezivo is a private commercial monorepo. The root `LICENSE.md` reserves all rights and grants
only the limited internal-use permission stated there. GitHub has no organization-wide license
setting, so the root license, this policy, and the organization profile template must be maintained
together.

The organization may later open source a self-contained component under Apache-2.0, MIT, or another
approved license. That requires a written decision, dependency-license review, removal of secrets
and customer data, a separate license file, and an update to this policy. Do not add an open-source
license through GitHub's license picker without that approval.

## Required GitHub configuration

1. Create or rename the GitHub organization, then update this policy's owner and contact.
2. Create the special `.github` repository and copy `github-organization-profile/README.md` to
   `.github/profile/README.md` for the public organization profile, if a public profile is desired.
3. Keep the monorepo private unless the owner approves public release.
4. Set the organization base permission to the minimum required, use teams, and reserve Admin for
   owners. GitHub recommends Read for viewers, Write for active contributors, Maintain for project
   managers, and Admin only for sensitive settings.
5. Protect `main`: require pull requests, at least one review, passing root status checks, and no
   direct pushes. Require signed commits where the selected plan and team workflow support them.
6. Enable secret scanning, push protection, Dependabot alerts, and dependency review where the plan
   supports them. Add a root CODEOWNERS file for security, database, contracts, legal, and release
   paths.
7. Store deployment credentials as organization or environment secrets. Never place them in the
   repository, issues, pull requests, build logs, or the Obsidian vault.
8. Keep the root `LICENSE.md` authoritative. Workspace `LICENSE.md` files are transition notices;
   update or remove them only in a reviewed monorepo migration commit.

## Review checklist

- [ ] Legal entity name, copyright year, address, and contact are complete.
- [ ] Counsel reviewed proprietary rights, employee/contractor access, liability language, and
  third-party notices.
- [ ] Organization visibility, teams, permissions, and branch protection match this policy.
- [ ] Root license is visible at the repository root and the organization profile uses the approved
  wording.
- [ ] Public-facing Terms and Privacy Policy match actual product and data flows.
- [ ] Every open-source exception has an owner, scope, expiry, and written approval.

## Reference

GitHub's license guidance explains that a license file belongs at the repository root. Its
organization role guidance describes the Read, Write, Maintain, and Admin permission levels. The
root `github-organization-profile/README.md` is a copy-ready profile template, not a license grant.
