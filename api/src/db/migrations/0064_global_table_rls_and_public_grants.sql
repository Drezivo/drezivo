-- DEF-001: close the Supabase Data API and SQL row-security gaps on Drezivo's global tables.
--
-- Two independent layers protect Drezivo's public-schema data:
--   1. anon/authenticated/service_role have no grants on Drezivo-owned public objects.
--   2. RLS is enabled and forced on every formerly-unprotected global table, with policies
--      only for the API/worker database roles and only for the operations they require.
--
-- Supabase's project-level default grants are revoked for objects created by the migration
-- role. Keep migrations on the existing Drezivo object owner (`postgres` on Supabase) and
-- explicitly GRANT new runtime access in the same migration that creates an object. Do not
-- create Drezivo tables as `supabase_admin`.

DO $$
DECLARE
  role_name text;
BEGIN
  -- The Supabase API-role grants observed on this project are scoped to public. Keep this change
  -- there rather than changing defaults for Supabase-managed schemas such as storage. Use
  -- current_user because CI and Supabase both apply migrations as the Drezivo object owner
  -- (`postgres`).
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    current_user
  );

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        current_user, role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        current_user, role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
        current_user, role_name
      );
    END IF;
  END LOOP;
END $$;

-- Remove existing Supabase API-role grants from Drezivo-owned objects only. This intentionally
-- leaves Supabase-managed extension objects (owned by supabase_admin) unchanged.
DO $$
DECLARE
  object_record record;
  role_name text;
BEGIN
  FOR object_record IN
    SELECT c.oid::regclass AS object_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC', object_record.object_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE %s FROM %I', object_record.object_name, role_name
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR object_record IN
    SELECT c.oid::regclass AS object_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC', object_record.object_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM %I', object_record.object_name, role_name
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR object_record IN
    SELECT p.oid::regprocedure AS function_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'w')
       AND p.prosecdef
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', object_record.function_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', object_record.function_name, role_name
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- The migration ledger is administrative metadata. Keep it out of the Data API and hidden from
-- both runtime roles. The migration connection is the `postgres` role and has BYPASSRLS.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations
  FROM PUBLIC, drezivo_app, drezivo_worker;

-- Global tenant metadata is visible to the API only after it enters the tenant context, except
-- the current account's still-unprovisioned onboarding row needed for bootstrap RETURNING. The
-- worker can enumerate tenant IDs for its cross-tenant sweeps, then must set the tenant context
-- before it touches tenant-owned rows or updates tenant lifecycle fields.
ALTER TABLE public.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_app_scoped_read ON public.tenant;
CREATE POLICY tenant_app_scoped_read ON public.tenant
  FOR SELECT TO drezivo_app
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.clerk_org_id = tenant.clerk_org_id
         AND o.status IN ('incomplete', 'payment_pending')
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND a.current_owned_tenant_id IS NULL
    )
  );
DROP POLICY IF EXISTS tenant_worker_read ON public.tenant;
CREATE POLICY tenant_worker_read ON public.tenant
  FOR SELECT TO drezivo_worker
  USING (true);
DROP POLICY IF EXISTS tenant_runtime_update ON public.tenant;
CREATE POLICY tenant_runtime_update ON public.tenant
  FOR UPDATE TO drezivo_app, drezivo_worker
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS tenant_bootstrap_insert ON public.tenant;
CREATE POLICY tenant_bootstrap_insert ON public.tenant
  FOR INSERT TO drezivo_app
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'account'
    AND EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.clerk_org_id = tenant.clerk_org_id
         AND o.status IN ('incomplete', 'payment_pending')
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND a.trial_consumed_at IS NULL
         AND a.current_owned_tenant_id IS NULL
    )
  );
REVOKE ALL PRIVILEGES ON TABLE public.tenant FROM drezivo_app, drezivo_worker;
GRANT SELECT ON TABLE public.tenant TO drezivo_app, drezivo_worker;
GRANT INSERT (id, clerk_org_id, name, slug, status, currency, timezone)
  ON TABLE public.tenant TO drezivo_app;
GRANT UPDATE (name, status, updated_at) ON TABLE public.tenant TO drezivo_app, drezivo_worker;

-- Plan data is global reference data: runtime roles may read it, but only migrations may write.
ALTER TABLE public.plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_runtime_read ON public.plan;
CREATE POLICY plan_runtime_read ON public.plan
  FOR SELECT TO drezivo_app, drezivo_worker USING (true);
REVOKE ALL PRIVILEGES ON TABLE public.plan FROM drezivo_app, drezivo_worker;
GRANT SELECT ON TABLE public.plan TO drezivo_app, drezivo_worker;

ALTER TABLE public.plan_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_entitlement FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_entitlement_runtime_read ON public.plan_entitlement;
CREATE POLICY plan_entitlement_runtime_read ON public.plan_entitlement
  FOR SELECT TO drezivo_app, drezivo_worker USING (true);
REVOKE ALL PRIVILEGES ON TABLE public.plan_entitlement FROM drezivo_app, drezivo_worker;
GRANT SELECT ON TABLE public.plan_entitlement TO drezivo_app, drezivo_worker;

-- Clerk's inbox is global because event deduplication precedes tenant resolution. The API can
-- ingest only through the signed SECURITY DEFINER function; the worker alone can read and move
-- inbox rows through its narrow status columns.
ALTER TABLE public.webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_inbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_inbox_worker_read ON public.webhook_inbox;
CREATE POLICY webhook_inbox_worker_read ON public.webhook_inbox
  FOR SELECT TO drezivo_worker USING (true);
DROP POLICY IF EXISTS webhook_inbox_worker_update ON public.webhook_inbox;
CREATE POLICY webhook_inbox_worker_update ON public.webhook_inbox
  FOR UPDATE TO drezivo_worker USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS webhook_inbox_definer_insert ON public.webhook_inbox;
CREATE POLICY webhook_inbox_definer_insert ON public.webhook_inbox
  FOR INSERT TO postgres
  WITH CHECK (provider = 'clerk' AND status = 'received');
REVOKE ALL PRIVILEGES ON TABLE public.webhook_inbox FROM drezivo_app, drezivo_worker;
GRANT SELECT ON TABLE public.webhook_inbox TO drezivo_worker;
GRANT UPDATE (status, processed_at) ON TABLE public.webhook_inbox TO drezivo_worker;

CREATE OR REPLACE FUNCTION public.ingest_clerk_webhook_inbox(
  p_provider_event_id text,
  p_event_type text,
  p_payload_digest text,
  p_safe_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  inserted_count integer;
BEGIN
  INSERT INTO public.webhook_inbox
    (provider, provider_event_id, event_type, payload_digest, safe_payload, status)
  VALUES ('clerk', p_provider_event_id, p_event_type, p_payload_digest, p_safe_payload, 'received')
  ON CONFLICT (provider, provider_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_clerk_webhook_inbox(text, text, text, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_clerk_webhook_inbox(text, text, text, jsonb)
  TO drezivo_app;

-- Business billing may see active Drezivo payment destinations. Only an already-authorized
-- operator context may read inactive entries or create/update one. DELETE is never available.
ALTER TABLE public.platform_payment_method ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_payment_method FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_payment_method_read ON public.platform_payment_method;
CREATE POLICY platform_payment_method_read ON public.platform_payment_method
  FOR SELECT TO drezivo_app
  USING (active OR current_setting('app.actor_kind', true) = 'operator');
DROP POLICY IF EXISTS platform_payment_method_operator_insert ON public.platform_payment_method;
CREATE POLICY platform_payment_method_operator_insert ON public.platform_payment_method
  FOR INSERT TO drezivo_app
  WITH CHECK (current_setting('app.actor_kind', true) = 'operator');
DROP POLICY IF EXISTS platform_payment_method_operator_update ON public.platform_payment_method;
CREATE POLICY platform_payment_method_operator_update ON public.platform_payment_method
  FOR UPDATE TO drezivo_app
  USING (current_setting('app.actor_kind', true) = 'operator')
  WITH CHECK (current_setting('app.actor_kind', true) = 'operator');
REVOKE ALL PRIVILEGES ON TABLE public.platform_payment_method FROM drezivo_app, drezivo_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.platform_payment_method TO drezivo_app;

ALTER TABLE public.platform_payment_method_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_payment_method_change FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_payment_method_change_operator_read ON public.platform_payment_method_change;
CREATE POLICY platform_payment_method_change_operator_read ON public.platform_payment_method_change
  FOR SELECT TO drezivo_app
  USING (current_setting('app.actor_kind', true) = 'operator');
DROP POLICY IF EXISTS platform_payment_method_change_operator_insert ON public.platform_payment_method_change;
CREATE POLICY platform_payment_method_change_operator_insert ON public.platform_payment_method_change
  FOR INSERT TO drezivo_app
  WITH CHECK (current_setting('app.actor_kind', true) = 'operator');
REVOKE ALL PRIVILEGES ON TABLE public.platform_payment_method_change FROM drezivo_app, drezivo_worker;
GRANT SELECT, INSERT ON TABLE public.platform_payment_method_change TO drezivo_app;

-- Revoke the old broad function grants that the project default ACL attached to all API roles.
-- Keep the application-owned SECURITY DEFINER entry points callable only by the API role.
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
       AND p.prosecdef
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
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

-- These SECURITY DEFINER helpers are internal API paths, not public Supabase RPC endpoints.
GRANT EXECUTE ON FUNCTION public.bootstrap_slug_available(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_actor_workspaces(timestamptz, uuid, integer) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_guest_access_tenant(text, uuid) TO drezivo_app;

CREATE OR REPLACE FUNCTION public.bootstrap_slug_available(candidate_slug text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    current_setting('app.actor_kind', true) = 'account'
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.status = 'incomplete'
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND a.trial_consumed_at IS NULL
         AND a.current_owned_tenant_id IS NULL
    )
    AND NOT EXISTS (SELECT 1 FROM public.tenant WHERE slug = candidate_slug)
    AND NOT EXISTS (SELECT 1 FROM public.storefront WHERE slug = candidate_slug)
$$;

CREATE OR REPLACE FUNCTION public.resolve_actor_workspaces(
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
)
RETURNS TABLE (
  tenant_id uuid,
  clerk_org_id text,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  tenant_currency text,
  tenant_timezone text,
  tenant_created_at timestamptz,
  tenant_updated_at timestamptz,
  membership_role text,
  membership_updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT t.id, t.clerk_org_id, t.name, t.slug, t.status, t.currency, t.timezone,
         t.created_at, t.updated_at, m.role, m.updated_at
    FROM public.tenant t
    JOIN public.membership m ON m.tenant_id = t.id
   WHERE NULLIF(current_setting('app.actor_kind', true), '') = 'account'
     AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
     AND m.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
     AND m.status = 'active'
     AND (
       p_cursor_created_at IS NULL
       OR (t.created_at, t.id) > (p_cursor_created_at, p_cursor_tenant_id)
     )
   ORDER BY t.created_at ASC, t.id ASC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 51), 101));
$$;

CREATE OR REPLACE FUNCTION public.resolve_guest_access_tenant(p_token_hash text, p_reservation_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT tenant_id
    FROM public.guest_access_token
   WHERE token_hash = p_token_hash
     AND reservation_id = p_reservation_id
     AND revoked_at IS NULL
     AND expires_at > statement_timestamp()
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.resolve_actor_tenant(p_clerk_org_id text)
RETURNS TABLE (
  id uuid,
  clerk_org_id text,
  name text,
  slug text,
  status text,
  currency text,
  timezone text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT t.id, t.clerk_org_id, t.name, t.slug, t.status, t.currency, t.timezone, t.created_at, t.updated_at
    FROM public.tenant t
   WHERE t.clerk_org_id = p_clerk_org_id
     AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
     AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
     AND NULLIF(current_setting('app.principal_id', true), '') IS NOT NULL
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_clerk_org_available(candidate_clerk_org_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    current_setting('app.actor_kind', true) = 'account'
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.clerk_org_id = candidate_clerk_org_id
         AND o.status IN ('incomplete', 'payment_pending')
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND a.trial_consumed_at IS NULL
         AND a.current_owned_tenant_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant WHERE clerk_org_id = candidate_clerk_org_id
    )
$$;

CREATE OR REPLACE FUNCTION public.resolve_membership_invitation_tenant(
  p_clerk_org_id text,
  p_invitation_id uuid
)
RETURNS TABLE (id uuid, clerk_org_id text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT t.id, t.clerk_org_id, t.status
    FROM public.tenant t
    JOIN public.membership_invitation i ON i.tenant_id = t.id
   WHERE t.clerk_org_id = p_clerk_org_id
     AND i.id = p_invitation_id
     AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
     AND (
       (
         current_setting('app.actor_kind', true) = 'account'
         AND NULLIF(current_setting('app.principal_id', true), '') IS NOT NULL
       )
       OR (
         current_setting('app.actor_kind', true) = 'system'
         AND current_setting('app.principal_id', true) IN (
           'clerk:invitation-claim',
           'clerk:webhook-reconcile'
         )
       )
     )
   LIMIT 1
$$;

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
       AND p.prosecdef
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
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

REVOKE ALL PRIVILEGES ON FUNCTION public.bootstrap_slug_available(text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_actor_workspaces(timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_guest_access_tenant(text, uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.bootstrap_clerk_org_available(text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_actor_tenant(text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_membership_invitation_tenant(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_slug_available(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_actor_workspaces(timestamptz, uuid, integer) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_guest_access_tenant(text, uuid) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.bootstrap_clerk_org_available(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_actor_tenant(text) TO drezivo_app;
GRANT EXECUTE ON FUNCTION public.resolve_membership_invitation_tenant(text, uuid)
  TO drezivo_app, drezivo_worker;

COMMENT ON TABLE public.tenant IS
  'Global tenant identity; forced RLS limits app access to the current tenant/onboarding and grants global enumeration only to the worker role.';
COMMENT ON TABLE public.webhook_inbox IS
  'Global Clerk event deduplication inbox; forced RLS allows worker status processing and API insertion only through a constrained definer function.';
