---
title: "Operator workspace repair"
type: architecture
status: reference
owner: Drezivo team
source: "Original document and references within; moved into the vault on 2026-11-15"
updated: 2026-11-15
tags: [drezivo, architecture]
---

# Operator workspace repair

Migration `0086_operator_workspace_repair.sql` adds scoped operator support alongside the
platform audit projection in migration 0085.

The business database owns scoped operator support through `operator_workspace`. Its fixed
resource registry exposes redacted operational projections across 22 modules. Each call requires
the verified operator context and revalidates a tenant-bound, operator-bound support grant.
Read-only and repair modes expire within two hours and can be revoked. Superadmins can access
locked workspaces for support without impersonating a merchant or changing subscription access.

Encoding corrections are limited to named catalogue, stock, category and branch fields. They
compare a server-generated record fingerprint and record the command, reason and actual operator.
Booking and financial state changes continue to require their existing business workflows.

Clothing deletion is a physical deletion for unused catalogue entries, with a preview and an
explicit name/ID confirmation. It removes product images, physical stock, variants and the
product in one transaction, cleans storefront featured references, advances storefront versions,
and queues the existing file-cleanup outbox event. Retention, legal holds and shared references
remain owned by the existing cleanup worker. Referential constraints, dependency checks and
row locks preserve reservations, fitting history, custody and financial records.

The operator repository is maintained separately and was not available in this checkout. Its
previously cited ADR path cannot be verified here; consult that repository for the supported
operator HTTP/UI behavior. The business database functions are defined in
[`0086_operator_workspace_repair.sql`](../../../api/src/db/migrations/0086_operator_workspace_repair.sql).
No new operator-owned tables or general SQL execution surface are introduced.
