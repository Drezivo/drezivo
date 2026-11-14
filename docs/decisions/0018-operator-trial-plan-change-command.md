# 0018. Narrow operator trial plan changes

**Status:** Accepted
**Date:** 31 October 2026
**Owners:** Product and API owners

## Amendment: 9 November 2026

An authorized operator may also change an active business with a current paid period among the four paid plans. The selected plan and its entitlements take effect immediately. The existing paid period is unchanged and the next renewal uses the new catalog price; no additional charge or plan-change email is created. Pending payments and target-plan capacity still block the change. An active tenant with a non-Free subscription may also change plans after expiry, without altering its status, access, or billing dates; recording payment remains separate. Operator capacity checks count active garments and active Front Desk members, excluding owners, inactive members, and pending invitations. Invitations remain pending and their normal reservation and acceptance checks remain in force. Free upgrades remain in the owner payment workflow; manually restricted and cancelled tenants remain ineligible. An open business dashboard refreshes its actor context every 30 seconds while visible and when its tab regains focus; backend entitlements change immediately.

## Context

The operator console needs a way to correct a business's selected paid tier during an active
trial. The Business API is the owner of plan catalog, entitlement, payment, and tenant state. An
operator capability must not grant workspace browsing or general tenant impersonation.

## Decision

1. Add one signed internal command, `POST /internal/operator/v1/tenants/:tenantId/plan`, for
   changing an active, unexpired trial among Starter, Standard, Growth, and Scale.
2. Require the operator API's service credential and a short-lived HMAC assertion bound to the
   platform-owner identity, `tenant.admin.manage`, tenant, request ID, idempotency key, path, and
   normalized request body. The Business API verifies the assertion before opening tenant scope.
3. Keep the command in the Business API. It locks the tenant and subscription, rejects pending
   payments and ineligible subscription states, resolves the active v1 catalog, checks current
   capacity, and writes the plan event, operator command, and tenant audit event atomically.
4. Free is not a direct plan-change target. Free upgrades and paid activation continue through
   the existing payment workflow. A trial plan change does not activate paid access.
5. The reason is optional and stored as SQL `NULL` when omitted. The command record and audit
   event remain present. The existing payment rejection reason remains required because it is
   shown to the business owner.
6. This command is a narrow billing exception to support-grant workspace access. It does not
   expose tenant reads, general workspace mutation, or impersonation. Support grants remain the
   only path for operator workspace access.
7. Migration 0093 only relaxes `operator_command.reason`; migration 0085 already added
   `request_fingerprint`. Apply the additive migration through the normal reviewed migration
   process before enabling the command.

## Consequences

- Operator API and web validation expose the four paid tiers while keeping Free payment-gated.
- Both APIs require matching `INTERNAL_SERVICE_AUTH` and
  `INTERNAL_OPERATOR_ASSERTION_SECRET` values for the command to be available; absent configuration
  leaves the route unavailable.
- Idempotency, plan capacity, subscription history, and audit are enforced by the Business API,
  not duplicated in the Operator repository.
- A later migration must restore `reason NOT NULL` only if no stored rows depend on omission and
  the feature contract changes; applied migrations are never edited or removed.

## References

- [Operator console audit projection](../architecture/operator-console-audit.md)
- [ADR 0016: App-only Growth and Scale plans](0016-app-only-growth-scale-plans.md)
