-- A single platform aggregate for the operator console. This schema is not exposed to the Data API.
CREATE SCHEMA IF NOT EXISTS operator_private;
REVOKE ALL ON SCHEMA operator_private FROM PUBLIC;
GRANT USAGE ON SCHEMA operator_private TO drezivo_app;

CREATE FUNCTION operator_private.paid_business_count()
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE result integer;
BEGIN
  IF nullif(current_setting('app.actor_kind', true), '') IS DISTINCT FROM 'operator'
     OR nullif(current_setting('app.principal_id', true), '') IS NULL
     OR nullif(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'operator context required' USING ERRCODE = '42501';
  END IF;
  SELECT count(DISTINCT s.tenant_id)::integer INTO result
    FROM public.subscription s JOIN public.plan p ON p.id = s.plan_id
   WHERE s.status = 'active' AND p.code <> 'free'
     AND s.current_period_start <= statement_timestamp()
     AND s.current_period_end > statement_timestamp();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION operator_private.paid_business_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_private.paid_business_count() TO drezivo_app;
