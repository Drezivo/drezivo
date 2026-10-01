-- The application talks to Postgres through its own API and dedicated database roles; no
-- Drezivo RPC is intended to be callable through Supabase's Data API. The earlier grants on
-- SECURITY INVOKER trigger helpers do not expose their underlying rows, but are unnecessary RPC
-- surface. Revoke access to all migration-owner functions in public, then grant only the
-- SECURITY DEFINER helpers the API/worker call directly. Extension-owned functions are untouched.
DO $$
DECLARE
  function_record record;
  role_name text;
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure AS function_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'w')
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND NOT EXISTS (
         SELECT 1
           FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', function_record.function_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', function_record.function_name, role_name
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.bootstrap_slug_available(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_actor_workspaces(timestamptz, uuid, integer) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_guest_access_tenant(text, uuid) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.ingest_clerk_webhook_inbox(text, text, text, jsonb) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.bootstrap_clerk_org_available(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_actor_tenant(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_membership_invitation_tenant(text, uuid)
  TO drezivo_app, drezivo_worker;
