-- TBF-032 — plan and entitlement rows are migration-owned reference data.
-- Runtime roles may resolve them, but may not rewrite prices, versions, limits, or release flags.

DO $$
DECLARE
  starter_id uuid;
  professional_id uuid;
  business_id uuid;
BEGIN
  SELECT id INTO starter_id
    FROM plan
   WHERE code = 'starter' AND version = 1
     AND monthly_minor = 30000 AND currency = 'PHP' AND active IS TRUE;
  SELECT id INTO professional_id
    FROM plan
   WHERE code = 'professional' AND version = 1
     AND monthly_minor = 49900 AND currency = 'PHP' AND active IS TRUE;
  SELECT id INTO business_id
    FROM plan
   WHERE code = 'business' AND version = 1
     AND monthly_minor = 129900 AND currency = 'PHP' AND active IS TRUE;

  IF starter_id IS NULL OR professional_id IS NULL OR business_id IS NULL THEN
    RAISE EXCEPTION 'TBF-032 plan seed conflict: expected active PHP v1 plans are missing or changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = starter_id AND capability = 'physical_assets.max'
       AND limit_value = 75 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = starter_id AND capability = 'frontdesk_seats.max'
       AND limit_value = 1 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = professional_id AND capability = 'physical_assets.max'
       AND limit_value = 250 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = professional_id AND capability = 'frontdesk_seats.max'
       AND limit_value = 3 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = business_id AND capability = 'physical_assets.max'
       AND limit_value = 1000 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = business_id AND capability = 'frontdesk_seats.max'
       AND limit_value = 10 AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'TBF-032 entitlement seed conflict: expected v1 limits are missing or changed';
  END IF;
END $$;

GRANT SELECT ON plan, plan_entitlement TO drezivo_app, drezivo_worker;
REVOKE INSERT, UPDATE, DELETE ON plan, plan_entitlement FROM drezivo_app, drezivo_worker;
