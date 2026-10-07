-- Split the existing Standard offer into explicit Starter and Standard plans.
--
-- The current Standard plan was historically stored as `starter` (29900 PHP minor units,
-- 300 garments, 3 Front Desk seats). Rename that row in place so subscriptions, plan events,
-- and payment history keep their existing plan UUID and references. Create a new Starter row
-- with its own limits. No subscription, trial, or payment records are rewritten.
--
-- Idempotent: a rerun recognizes the renamed Standard row and upserts Starter's catalog data.

ALTER TABLE organization_onboarding
  DROP CONSTRAINT IF EXISTS organization_onboarding_selected_plan_code_check;

DO $$
DECLARE
  standard_id uuid;
  legacy_standard_id uuid;
  starter_id uuid;
BEGIN
  SELECT id INTO standard_id
    FROM plan
   WHERE code = 'standard' AND version = 1;

  SELECT id INTO legacy_standard_id
    FROM plan
   WHERE code = 'starter' AND version = 1 AND monthly_minor = 29900 AND currency = 'PHP';

  IF standard_id IS NULL THEN
    IF legacy_standard_id IS NULL THEN
      RAISE EXCEPTION 'migration 0075 cannot identify the existing Standard plan row';
    END IF;
    UPDATE plan SET code = 'standard' WHERE id = legacy_standard_id;
    standard_id := legacy_standard_id;
  ELSIF legacy_standard_id IS NOT NULL AND legacy_standard_id <> standard_id THEN
    RAISE EXCEPTION 'migration 0075 found conflicting Standard plan identities';
  END IF;

  UPDATE plan
     SET monthly_minor = 29900, currency = 'PHP', active = true
   WHERE id = standard_id;

  INSERT INTO plan (code, version, monthly_minor, currency, active)
  VALUES ('starter', 1, 14900, 'PHP', true)
  ON CONFLICT (code, version) DO UPDATE
    SET monthly_minor = EXCLUDED.monthly_minor,
        currency = EXCLUDED.currency,
        active = true;

  SELECT id INTO starter_id FROM plan WHERE code = 'starter' AND version = 1;

  INSERT INTO plan_entitlement (plan_id, capability, limit_value, enabled)
  VALUES
    (starter_id, 'physical_assets.max', 125, true),
    (starter_id, 'frontdesk_seats.max', 0, true),
    (standard_id, 'physical_assets.max', 300, true),
    (standard_id, 'frontdesk_seats.max', 3, true)
  ON CONFLICT (plan_id, capability) DO UPDATE
    SET limit_value = EXCLUDED.limit_value,
        enabled = EXCLUDED.enabled;

  -- All previously selectable legacy codes represented the one Standard subscription offer.
  -- Keep onboarding history but normalize the key to the new explicit identity.
  UPDATE organization_onboarding
     SET selected_plan_code = 'standard', updated_at = now()
   WHERE selected_plan_code IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = starter_id AND capability = 'physical_assets.max'
       AND limit_value = 125 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = starter_id AND capability = 'frontdesk_seats.max'
       AND limit_value = 0 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = standard_id AND capability = 'physical_assets.max'
       AND limit_value = 300 AND enabled IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM plan_entitlement
     WHERE plan_id = standard_id AND capability = 'frontdesk_seats.max'
       AND limit_value = 3 AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'migration 0075 failed to establish the expected plan entitlements';
  END IF;
END $$;

ALTER TABLE organization_onboarding
  ADD CONSTRAINT organization_onboarding_selected_plan_code_check
  CHECK (selected_plan_code IS NULL OR selected_plan_code IN ('starter', 'standard'));

COMMENT ON TABLE plan IS
  'Server-authoritative monthly plans. Starter is PHP 149 with 125 active garments and no Front Desk seats; Standard is PHP 299 with 300 active garments and 3 Front Desk seats.';
