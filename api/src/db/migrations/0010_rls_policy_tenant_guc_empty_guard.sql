-- Corrective migration for 0008's `tenant_isolation` policy (fix-forward, never edit 0008).
--
-- Defect: Postgres leaves a custom placeholder GUC as an EMPTY STRING — not undefined — on a
-- session where `set_config('app.tenant_id', ..., true)` (SET LOCAL) has run and committed.
-- `current_setting('app.tenant_id', true)` therefore returns `''` on every pooled connection
-- that has EVER served a tenant-scoped transaction, and the policy's `''::uuid` cast raises
-- "invalid input syntax for type uuid" instead of evaluating to no-match. That converts 0008's
-- documented fail-closed behavior ("a request that never established tenant context reads zero
-- rows everywhere") into an error deep in a query plan — surfacing as a 500 with a raw driver
-- message and hiding the real bug (an unscoped query) from the zero-row signal reviewers are
-- told to expect.
--
-- Fix: NULLIF maps the post-transaction empty string back to NULL, so an unset OR
-- reset-to-empty tenant context compares against NULL and matches zero rows, exactly as
-- 0008's header documents. A properly set tenant id is unaffected. This strictly denies the
-- same access 0008 intended to deny; it widens nothing (an empty string can never equal a
-- real tenant_id).
--
-- Discovered by TBF-010's integration harness (tests/integration/accounts.test.ts, the
-- pre-tenant fail-closed probe), which runs the real roles and pooled connections rather
-- than assuming the documented invariant.

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
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
