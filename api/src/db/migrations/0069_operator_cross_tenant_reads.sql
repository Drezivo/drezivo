-- Operator client administration reads (Operator API, ADR 0025).
--
-- The operator console lists every client business, every staff membership, and the
-- subscription-payment review queue. Under tenant RLS the Operator API could only read those one
-- tenant at a time: a transaction per tenant with about nine round trips each, so the Clients page
-- cost ~1,800 sequential round trips at 200 businesses and grew linearly from there.
--
-- These three read-only SECURITY DEFINER functions return each list in ONE set-based, index-backed
-- query, following the resolve_actor_workspaces pattern (0017): a narrow projection, no caller-
-- supplied tenant id, and a guard that refuses to answer outside an explicit operator transaction
-- context (app.actor_kind = 'operator' with no app.tenant_id). Like every operator-only RLS policy
-- (0011, 0012), that guard prevents accidental use from tenant code paths; it is not a boundary
-- against a compromised API process (TRD §3). Writes are unchanged and still run per tenant
-- under RLS.

-- Listing order for the business list (newest first) and the "recent payments" queue.
CREATE INDEX IF NOT EXISTS tenant_created_at_id_idx ON tenant (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS subscription_payment_created_at_id_idx
  ON subscription_payment (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION operator_tenant_summaries(p_limit integer DEFAULT 200)
RETURNS TABLE (
  tenant_id uuid,
  name text,
  slug text,
  status text,
  timezone text,
  created_at timestamptz,
  subscription_status text,
  plan_code text,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  current_period_end timestamptz,
  members_active integer,
  members_suspended integer,
  members_removed integer,
  pending_payment boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    t.id, t.name, t.slug, t.status, t.timezone, t.created_at,
    s.status, p.code, s.trial_ends_at, s.grace_ends_at, s.current_period_end,
    COALESCE(mc.active, 0), COALESCE(mc.suspended, 0), COALESCE(mc.removed, 0),
    EXISTS (
      SELECT 1 FROM subscription_payment sp WHERE sp.tenant_id = t.id AND sp.status = 'pending'
    )
  FROM (
    SELECT * FROM tenant
     WHERE NULLIF(current_setting('app.actor_kind', true), '') = 'operator'
       AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  ) t
  LEFT JOIN subscription s ON s.tenant_id = t.id
  LEFT JOIN plan p ON p.id = s.plan_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE m.status = 'active')::int AS active,
      count(*) FILTER (WHERE m.status = 'suspended')::int AS suspended,
      count(*) FILTER (WHERE m.status = 'removed')::int AS removed
    FROM membership m
    WHERE m.tenant_id = t.id
  ) mc ON true
  ORDER BY t.created_at DESC, t.id DESC;
$$;

CREATE OR REPLACE FUNCTION operator_people(p_limit integer DEFAULT 2000)
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  tenant_status text,
  membership_id uuid,
  clerk_user_id text,
  role text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.name, t.status, m.id, m.clerk_user_id, m.role, m.status, m.created_at
    FROM tenant t
    JOIN membership m ON m.tenant_id = t.id
   WHERE NULLIF(current_setting('app.actor_kind', true), '') = 'operator'
     AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
   ORDER BY t.created_at DESC, t.id DESC, m.role, m.created_at
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 2000), 5000));
$$;

-- p_status: 'pending' (oldest first, so nobody waits longest) or 'recent' (every status, newest first).
CREATE OR REPLACE FUNCTION operator_subscription_payment_queue(p_status text, p_limit integer DEFAULT 200)
RETURNS TABLE (
  payment_id uuid,
  tenant_id uuid,
  tenant_name text,
  status text,
  amount_minor integer,
  currency text,
  reference text,
  method_label text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  has_proof boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  bounded integer := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
BEGIN
  IF NULLIF(current_setting('app.actor_kind', true), '') IS DISTINCT FROM 'operator'
     OR NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
    RETURN;
  END IF;
  -- Fail closed on an unknown queue name rather than defaulting to one of them.
  IF p_status = 'pending' THEN
    RETURN QUERY
      SELECT sp.id, sp.tenant_id, t.name, sp.status, sp.amount_minor, sp.currency, sp.reference,
             ppm.label, sp.created_at, sp.reviewed_at, sp.reviewed_by, sp.review_note,
             sp.proof_file_id IS NOT NULL
        FROM subscription_payment sp
        JOIN tenant t ON t.id = sp.tenant_id
        LEFT JOIN platform_payment_method ppm ON ppm.id = sp.payment_method_id
       WHERE sp.status = 'pending'
       ORDER BY sp.created_at ASC, sp.id ASC
       LIMIT bounded;
  ELSIF p_status = 'recent' THEN
    RETURN QUERY
      SELECT sp.id, sp.tenant_id, t.name, sp.status, sp.amount_minor, sp.currency, sp.reference,
             ppm.label, sp.created_at, sp.reviewed_at, sp.reviewed_by, sp.review_note,
             sp.proof_file_id IS NOT NULL
        FROM subscription_payment sp
        JOIN tenant t ON t.id = sp.tenant_id
        LEFT JOIN platform_payment_method ppm ON ppm.id = sp.payment_method_id
       ORDER BY sp.created_at DESC, sp.id DESC
       LIMIT bounded;
  ELSE
    RAISE EXCEPTION 'unknown payment queue %', p_status USING ERRCODE = '22023';
  END IF;
END;
$$;

DO $$
DECLARE
  fn text;
  role_name text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.operator_tenant_summaries(integer)',
    'public.operator_people(integer)',
    'public.operator_subscription_payment_queue(text, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', fn);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', fn, role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO drezivo_app', fn);
  END LOOP;
END $$;
