-- Supabase's "enable RLS on new tables" event trigger invokes this helper internally. It is not
-- an application RPC. Keep the trigger installed while removing grants to Data API and Drezivo
-- runtime roles.
DO $$
DECLARE
  function_name regprocedure := to_regprocedure('public.rls_auto_enable()');
  role_name text;
BEGIN
  IF function_name IS NOT NULL THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', function_name);

    FOREACH role_name IN ARRAY ARRAY[
      'anon',
      'authenticated',
      'service_role',
      'drezivo_app',
      'drezivo_worker'
    ] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', function_name, role_name
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;
