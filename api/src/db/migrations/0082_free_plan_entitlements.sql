-- Add the perpetual Free plan and server-authoritative feature entitlements.
-- Existing Starter and Standard subscriptions are unchanged.

ALTER TABLE organization_onboarding
  DROP CONSTRAINT IF EXISTS organization_onboarding_selected_plan_code_check;

INSERT INTO plan (code, version, monthly_minor, currency, active)
VALUES ('free', 1, 0, 'PHP', true)
ON CONFLICT (code, version) DO UPDATE
  SET monthly_minor = 0, currency = 'PHP', active = true;

DO $$
DECLARE
  free_id uuid;
  starter_id uuid;
  standard_id uuid;
BEGIN
  SELECT id INTO free_id FROM plan WHERE code = 'free' AND version = 1 AND active;
  SELECT id INTO starter_id FROM plan WHERE code = 'starter' AND version = 1 AND active;
  SELECT id INTO standard_id FROM plan WHERE code = 'standard' AND version = 1 AND active;
  IF free_id IS NULL OR starter_id IS NULL OR standard_id IS NULL THEN
    RAISE EXCEPTION 'migration 0081 requires active Free, Starter, and Standard plans';
  END IF;

  INSERT INTO plan_entitlement (plan_id, capability, limit_value, enabled)
  VALUES
    (free_id, 'physical_assets.max', 20, true),
    (free_id, 'frontdesk_seats.max', 0, true),
    (free_id, 'fittings.enabled', 0, true),
    (free_id, 'storefront_reservations.enabled', 0, true),
    (free_id, 'storefront_payments.enabled', 0, true),
    (free_id, 'storefront_theme.ivory', 1, true),
    (free_id, 'storefront_theme.sage', 1, true),
    (free_id, 'storefront_theme.blush', 0, true),
    (free_id, 'storefront_theme.noir', 0, true),
    (starter_id, 'fittings.enabled', 1, true),
    (starter_id, 'storefront_reservations.enabled', 1, true),
    (starter_id, 'storefront_payments.enabled', 1, true),
    (starter_id, 'storefront_theme.ivory', 1, true),
    (starter_id, 'storefront_theme.sage', 1, true),
    (starter_id, 'storefront_theme.blush', 1, true),
    (starter_id, 'storefront_theme.noir', 1, true),
    (standard_id, 'fittings.enabled', 1, true),
    (standard_id, 'storefront_reservations.enabled', 1, true),
    (standard_id, 'storefront_payments.enabled', 1, true),
    (standard_id, 'storefront_theme.ivory', 1, true),
    (standard_id, 'storefront_theme.sage', 1, true),
    (standard_id, 'storefront_theme.blush', 1, true),
    (standard_id, 'storefront_theme.noir', 1, true)
  ON CONFLICT (plan_id, capability) DO UPDATE
    SET limit_value = EXCLUDED.limit_value, enabled = EXCLUDED.enabled;
END $$;

ALTER TABLE organization_onboarding
  ADD CONSTRAINT organization_onboarding_selected_plan_code_check
  CHECK (selected_plan_code IS NULL OR selected_plan_code IN ('free', 'starter', 'standard'));

-- An open-ended active subscription represents Free. Paid plans continue to carry an end date.
ALTER TABLE subscription ALTER COLUMN current_period_end DROP NOT NULL;

ALTER TABLE subscription_event
  DROP CONSTRAINT IF EXISTS subscription_event_event_type_check;
ALTER TABLE subscription_event
  ADD CONSTRAINT subscription_event_event_type_check
  CHECK (event_type IN ('free_started', 'trial_started', 'converted', 'renewed', 'plan_changed', 'past_due', 'restricted', 'cancelled'));

ALTER TABLE subscription_payment
  ADD COLUMN IF NOT EXISTS target_plan_id uuid REFERENCES plan (id);

COMMENT ON COLUMN subscription.current_period_end IS
  'Null only for a perpetual Free subscription; trial and paid subscriptions require an end date.';
COMMENT ON COLUMN subscription_payment.target_plan_id IS
  'Plan the owner intends to activate after manual upgrade payment approval; null on legacy payment rows.';
COMMENT ON TABLE plan IS
  'Server-authoritative catalog. Free is perpetual with 20 active garments and no Front Desk seats; Starter and Standard retain paid trial access.';
