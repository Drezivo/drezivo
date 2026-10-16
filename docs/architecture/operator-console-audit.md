# Operator console audit projection

Status: implemented and tested locally on 2026-10-15; no hosted migration or release.
Owner instruction: two individual Superadmins (the founder and Ryanny) with equal permissions.

The operator console reads platform billing and operator accountability, and excludes merchant
activity. Merchant audit storage and its business invariants remain unchanged. No customer,
reservation, clothing or front-desk activity browser is exposed by the operator API.

Migration `0085_operator_console_projection.sql` adds fixed business-owned projection and command
functions. It follows migration 0069: pinned search path, explicit operator/principal context,
no tenant context, no dynamic caller SQL, bounded pages and execute granted only to `drezivo_app`.
Runtime adapters separately reject superuser/BYPASSRLS credentials. These context settings prevent
accidental tenant-code use; they do not defend against a compromised process holding runtime secrets.

Audit combines operator audit rows, exact allowlisted subscription actions, subscription history,
platform payment-method changes, verified operator sessions and permission decisions. Historical
subscription events with no recorded actor are marked unrecorded. Summaries are allowlisted and
exclude bodies, notes, payment references, proof files, provider messages and customer details.
Payment review snapshots record the opaque payer membership, amount, currency, verification time,
reviewer and resulting due date when available. Missing attribution is never guessed.

Existing append-only global audit storage records session events and operator command replay
results. Partial unique indexes enforce one event per operator/session/action and one global
command result per operator/intent hash. Tenant commands gain a nullable request fingerprint so a
changed request cannot silently replay another intent. Existing readers and business writes remain
compatible. New operator code requires this migration before rollout.

Support grants are read-only, reason-coded, self-attributed, revocable and limited to eight hours.
Job retries accept only terminal dead jobs. Notification retry rejects ambiguous provider acceptance
and queues only a known failed delivery. State changes and audit records share the winning
transaction. The existing durable outbox remains the only delivery path.

Local verification uses the operator repository's Docker stack and a separate temporary test
PostgreSQL service with the full business migrations. It sends no hosted email, reads no hosted
database and changes no Clerk organization. Release and hosted-provider configuration require a
separate authorized task.
