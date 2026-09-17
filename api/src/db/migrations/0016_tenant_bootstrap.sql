-- TBF-030 — immutable version-1 plan rows required by the first tenant bootstrap.
-- TBF-032 owns plan-management behavior; this migration only guarantees that an eligible
-- onboarding can resolve its selected plan on a fresh database.

INSERT INTO plan (code, version, monthly_minor, currency, active)
VALUES
  ('starter', 1, 30000, 'PHP', true),
  ('professional', 1, 49900, 'PHP', true),
  ('business', 1, 129900, 'PHP', true)
ON CONFLICT (code, version) DO NOTHING;

DO $$
DECLARE
  expected record;
  actual record;
  seed_plan_id uuid;
  physical_asset_limit integer;
  frontdesk_seat_limit integer;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('starter'::text, 30000::integer),
      ('professional'::text, 49900::integer),
      ('business'::text, 129900::integer)
    ) AS values_table(code, monthly_minor)
  LOOP
    SELECT id, monthly_minor, currency, active
      INTO actual
      FROM plan
     WHERE code = expected.code AND version = 1;
    IF actual.id IS NULL
       OR actual.monthly_minor <> expected.monthly_minor
       OR actual.currency <> 'PHP'
       OR actual.active IS NOT TRUE THEN
      RAISE EXCEPTION 'TBF-030 plan seed conflict for % v1', expected.code;
    END IF;

    seed_plan_id := actual.id;
    physical_asset_limit := CASE expected.code
      WHEN 'starter' THEN 75
      WHEN 'professional' THEN 250
      ELSE 1000 END;
    frontdesk_seat_limit := CASE expected.code
      WHEN 'starter' THEN 1
      WHEN 'professional' THEN 3
      ELSE 10 END;
    INSERT INTO plan_entitlement (plan_id, capability, limit_value, enabled)
    VALUES
      (seed_plan_id, 'physical_assets.max', physical_asset_limit, true),
      (seed_plan_id, 'frontdesk_seats.max', frontdesk_seat_limit, true)
    ON CONFLICT (plan_id, capability) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM plan_entitlement
       WHERE plan_id = seed_plan_id
         AND capability = 'physical_assets.max'
         AND limit_value = physical_asset_limit
         AND enabled IS TRUE
    ) OR NOT EXISTS (
      SELECT 1 FROM plan_entitlement
       WHERE plan_id = seed_plan_id
         AND capability = 'frontdesk_seats.max'
         AND limit_value = frontdesk_seat_limit
         AND enabled IS TRUE
    ) THEN
      RAISE EXCEPTION 'TBF-030 entitlement seed conflict for % v1', expected.code;
    END IF;
  END LOOP;
END $$;

-- The API role is intentionally unable to read draft storefront rows through normal RLS while
-- it is still in the pre-tenant namespace. This narrowly scoped definer function lets bootstrap
-- check the globally unique tenant/storefront slug namespace without granting table-wide reads.
CREATE OR REPLACE FUNCTION bootstrap_slug_available(candidate_slug text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM tenant WHERE slug = candidate_slug)
     AND NOT EXISTS (SELECT 1 FROM storefront WHERE slug = candidate_slug)
$$;

REVOKE ALL ON FUNCTION bootstrap_slug_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bootstrap_slug_available(text) TO drezivo_app;

-- A subscription event is an immutable commercial fact. The runtime may append a later event,
-- but it must never rewrite or remove the trial-start record created by bootstrap.
REVOKE UPDATE, DELETE ON subscription_event FROM drezivo_app, drezivo_worker;
