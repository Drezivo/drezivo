-- The Clerk accepted-invitation webhook carries a provider ID (orginv_...), while the
-- authenticated claim callback carries the local invitation UUID. Resolve the provider
-- ID only for the worker's signed-webhook reconciliation context.
CREATE FUNCTION public.resolve_membership_invitation_webhook(
  p_clerk_org_id text,
  p_clerk_invitation_id text
)
RETURNS TABLE (id uuid, clerk_org_id text, status text, invitation_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT t.id, t.clerk_org_id, t.status, i.id
    FROM public.membership_invitation i
    JOIN public.tenant t ON t.id = i.tenant_id
   WHERE i.clerk_invitation_id = p_clerk_invitation_id
     AND t.clerk_org_id = p_clerk_org_id
     AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
     AND current_setting('app.actor_kind', true) = 'system'
     AND current_setting('app.principal_id', true) = 'clerk:webhook-reconcile'
   LIMIT 1
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_membership_invitation_webhook(text, text)
  FROM PUBLIC, drezivo_app;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_membership_invitation_webhook(text, text) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_membership_invitation_webhook(text, text)
  TO drezivo_worker;
