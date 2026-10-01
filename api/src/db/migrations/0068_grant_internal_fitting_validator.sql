-- Fitting writes fire invoker-rights constraint triggers that call this validator. Keep it
-- private to the API database role; it is not a Supabase Data API RPC.
REVOKE ALL PRIVILEGES ON FUNCTION public.fitting_assert_current_claims(uuid, uuid)
  FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.fitting_assert_current_claims(uuid, uuid) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.fitting_assert_current_claims(uuid, uuid) TO drezivo_app;
