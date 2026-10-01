-- Make the migration ledger's second security layer explicit. The runtime roles have no table
-- grants from 0064, and this deny-all policy protects it even if a future grant is introduced.
DROP POLICY IF EXISTS schema_migrations_runtime_deny ON public.schema_migrations;
CREATE POLICY schema_migrations_runtime_deny ON public.schema_migrations
  FOR ALL TO drezivo_app, drezivo_worker
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.schema_migrations IS
  'Administrative migration ledger; runtime database roles have no grants and are explicitly denied by forced RLS.';
