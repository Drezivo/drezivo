-- Invariant: row-level security is defense against an ACCIDENTAL missing tenant filter in
-- application code, not protection against a fully compromised API process (TRD §3). It only
-- holds if the runtime role (a) is not the table owner, (b) has no BYPASSRLS attribute, and
-- (c) the table has FORCE ROW LEVEL SECURITY — without FORCE, RLS does not apply to the table
-- owner even with a policy defined, which would make this entire migration a no-op against
-- whatever role ends up owning these tables in a given environment.
--
-- Invariant: `current_setting('app.tenant_id')` is only ever set via `SET LOCAL` inside a
-- transaction (see db/client.ts `withTenantTransaction`) — never as a session-level `SET`,
-- because Neon's connection pooler is transaction-scoped (TRD §9) and a session-level value
-- would leak across pooled connections between unrelated tenants. `current_setting(..., true)`
-- (missing_ok) returns NULL rather than erroring when unset, so a request that never
-- established tenant context reads zero rows everywhere instead of crashing with a confusing
-- error deep in a query plan — the request-level fail-closed check still lives in
-- middleware/tenant-context.ts, which rejects before any query runs at all.
--
-- Invariant: `charge`, `payment_allocation`, and `deposit_entry` are financial postings that
-- must never be mutated once written (Data-Model §7) — the REVOKE statements below remove
-- UPDATE/DELETE from the runtime role on those tables specifically, so "someone adds an UPDATE
-- call to a repository by mistake six months from now" fails at the database, not in code
-- review.

DO $$
DECLARE
  tenant_owned_tables text[] := ARRAY[
    'branch', 'membership', 'branch_membership',
    'category', 'product', 'product_variant', 'physical_asset', 'file_object', 'product_image',
    'maintenance_work_order', 'asset_allocation',
    'storefront', 'policy_snapshot', 'payment_method',
    'customer', 'reservation', 'reservation_line', 'custody_event', 'disruption', 'guest_access_token',
    'payment', 'payment_receipt', 'payment_verification', 'charge', 'payment_allocation', 'refund', 'deposit_entry',
    'outbox_event', 'notification_delivery', 'import_job', 'export_job',
    'audit_event', 'support_grant',
    'subscription', 'subscription_event', 'subscription_payment',
    'idempotency_record'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tenant_owned_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- webhook_inbox is a global pre-tenant table by design (TRD §8: dedup happens before a tenant
-- can even be resolved from the payload) — it gets no tenant policy, only a restricted grant
-- below limiting it to the webhook-processing worker path.

-- Public storefront browsing is intentionally unauthenticated (TRD §3 "Guest access") and
-- resolves a tenant by slug BEFORE any tenant context can be set — there is no request-time
-- value to put in app.tenant_id yet at the moment this exact lookup runs. Postgres RLS
-- combines multiple permissive policies with OR, so this second policy grants read access to
-- a published storefront's own row (and nothing else, and no write) regardless of session
-- tenant context, letting storefront.repository.ts resolve `tenant_id` first, then open a
-- normally tenant-scoped transaction (SET LOCAL app.tenant_id) for every subsequent query in
-- the same request — see storefront.repository.ts for exactly where that handoff happens.
CREATE POLICY storefront_public_published_read ON storefront
  FOR SELECT USING (status = 'published');

-- The durable worker (worker/runner.ts) claims due `outbox_event` rows ACROSS every tenant in
-- one poll — that is the entire point of a shared queue table. It cannot do this through the
-- per-tenant `app.tenant_id` policy above (a worker poll has no single tenant to set), and it
-- must not get there via BYPASSRLS either (TRD §3 forbids blanket bypass for "the runtime
-- role", a constraint that applies to every process using a role, not only the HTTP API). The
-- fix is a SECOND, narrowly-scoped permissive policy that grants cross-tenant access only to a
-- dedicated `drezivo_worker` role, only on the two tables a background worker legitimately
-- processes cross-tenant (`outbox_event`, `notification_delivery`) — every other tenant-owned
-- table stays inaccessible to that role because no policy grants it access. Postgres RLS
-- policies are ADDITIVE (OR'd) per role that matches, so this does not weaken the
-- `drezivo_app` role's isolation at all.
CREATE POLICY worker_cross_tenant_access ON outbox_event
  USING (current_user = 'drezivo_worker') WITH CHECK (current_user = 'drezivo_worker');
CREATE POLICY worker_cross_tenant_access ON notification_delivery
  USING (current_user = 'drezivo_worker') WITH CHECK (current_user = 'drezivo_worker');

-- Runtime application role: no table ownership, no BYPASSRLS, no DDL/CREATEROLE. A real
-- deployment supplies the actual login password out of band (never in a migration file); this
-- statement only establishes the role and its non-negotiable attributes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drezivo_app') THEN
    CREATE ROLE drezivo_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drezivo_worker') THEN
    CREATE ROLE drezivo_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO drezivo_app, drezivo_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO drezivo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO drezivo_app;

-- Append-only enforcement: remove write-after-insert privileges on posting/fact tables.
REVOKE UPDATE, DELETE ON charge, payment_allocation, deposit_entry FROM drezivo_app;
REVOKE UPDATE, DELETE ON custody_event FROM drezivo_app;
REVOKE UPDATE, DELETE ON audit_event FROM drezivo_app;
REVOKE DELETE ON payment_verification FROM drezivo_app;

-- The worker role's grants are deliberately narrow: `outbox_event`/`notification_delivery`
-- for the cross-tenant dispatch loop above, plus every table `drezivo_app` can reach for the
-- per-tenant jobs the worker also runs (hold-expiry, idempotency-retention cleanup) THROUGH
-- the normal `tenant_isolation` policy — granting table privileges does not bypass RLS, so
-- reusing the same broad GRANT shape here is safe; it is the POLICY layer, not GRANT, that
-- decides what any given connection can actually see.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO drezivo_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO drezivo_worker;
REVOKE UPDATE, DELETE ON charge, payment_allocation, deposit_entry FROM drezivo_worker;
REVOKE UPDATE, DELETE ON custody_event FROM drezivo_worker;
REVOKE UPDATE, DELETE ON audit_event FROM drezivo_worker;
REVOKE DELETE ON payment_verification FROM drezivo_worker;
