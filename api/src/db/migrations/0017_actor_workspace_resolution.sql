-- TBF-031 — actor/workspace resolution.
--
-- Workspace discovery is the one pre-tenant read that must span every tenant where the
-- authenticated Clerk subject has an active local membership. Normal tenant RLS intentionally
-- prevents that query, so expose only a narrow SECURITY DEFINER resolver. It derives the
-- principal from the transaction-local GUC set by withGlobalTransaction; callers cannot supply
-- an arbitrary user id or tenant id.

CREATE INDEX IF NOT EXISTS membership_clerk_user_id_idx ON membership (clerk_user_id);

CREATE OR REPLACE FUNCTION resolve_actor_workspaces(
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
SET search_path = pg_catalog, public
AS $$
  SELECT
    t.id,
    t.clerk_org_id,
    t.name,
    t.slug,
    t.status,
    t.currency,
    t.timezone,
    t.created_at,
    t.updated_at,
    m.role,
    m.updated_at
  FROM tenant t
  JOIN membership m ON m.tenant_id = t.id
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

REVOKE ALL ON FUNCTION resolve_actor_workspaces(timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_actor_workspaces(timestamptz, uuid, integer) TO drezivo_app;
