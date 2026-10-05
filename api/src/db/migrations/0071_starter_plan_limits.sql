-- Lower the current Standard (internal starter v1) plan quotas for the pilot.
-- This changes admission limits only; existing members and clothing are not removed.
-- Idempotent: rerunning leaves both entitlement values at the requested limits.
DO $$
DECLARE
  starter_id uuid;
  updated_count integer;
BEGIN
  SELECT id INTO starter_id
    FROM plan
   WHERE code = 'starter' AND version = 1;

  IF starter_id IS NULL THEN
    RAISE EXCEPTION 'starter v1 plan is missing; cannot apply migration 0071';
  END IF;

  UPDATE plan_entitlement
     SET limit_value = CASE capability
           WHEN 'physical_assets.max' THEN 300
           WHEN 'frontdesk_seats.max' THEN 3
         END,
         enabled = true
   WHERE plan_id = starter_id
     AND capability IN ('physical_assets.max', 'frontdesk_seats.max');

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 2 THEN
    RAISE EXCEPTION 'migration 0071 expected both Starter quota entitlements; updated % rows', updated_count;
  END IF;
END $$;
