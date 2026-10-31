-- Add app-selectable Growth and Scale tiers without changing Standard or public-site pricing.
-- The app catalog is server-owned; web/src/lib/plans.ts remains the three-tier marketing snapshot.
INSERT INTO public.plan (code, version, monthly_minor, currency, active)
VALUES
  ('growth', 1, 49900, 'PHP', true),
  ('scale', 1, 99900, 'PHP', true)
ON CONFLICT (code, version) DO UPDATE
  SET monthly_minor = EXCLUDED.monthly_minor,
      currency = EXCLUDED.currency,
      active = EXCLUDED.active;

DO $$
DECLARE
  standard_id uuid;
  growth_id uuid;
  scale_id uuid;
  standard_feature_count integer;
BEGIN
  SELECT id INTO standard_id FROM public.plan WHERE code = 'standard' AND version = 1 AND active IS TRUE;
  SELECT id INTO growth_id FROM public.plan WHERE code = 'growth' AND version = 1 AND active IS TRUE;
  SELECT id INTO scale_id FROM public.plan WHERE code = 'scale' AND version = 1 AND active IS TRUE;

  IF standard_id IS NULL OR growth_id IS NULL OR scale_id IS NULL THEN
    RAISE EXCEPTION 'migration 0092 requires active Standard, Growth, and Scale v1 plans';
  END IF;

  SELECT count(*) INTO standard_feature_count
    FROM public.plan_entitlement
   WHERE plan_id = standard_id
     AND capability IN (
       'fittings.enabled',
       'storefront_reservations.enabled',
       'storefront_payments.enabled',
       'storefront_theme.ivory',
       'storefront_theme.sage',
       'storefront_theme.blush',
       'storefront_theme.noir'
     )
     AND enabled IS TRUE
     AND limit_value = 1;

  IF standard_feature_count <> 7 THEN
    RAISE EXCEPTION 'migration 0092 expected all seven enabled Standard feature entitlements; found %', standard_feature_count;
  END IF;

  INSERT INTO public.plan_entitlement (plan_id, capability, limit_value, enabled)
  SELECT targets.plan_id, e.capability, e.limit_value, e.enabled
    FROM (VALUES (growth_id), (scale_id)) AS targets(plan_id)
    CROSS JOIN public.plan_entitlement e
   WHERE e.plan_id = standard_id
     AND e.capability IN (
       'fittings.enabled',
       'storefront_reservations.enabled',
       'storefront_payments.enabled',
       'storefront_theme.ivory',
       'storefront_theme.sage',
       'storefront_theme.blush',
       'storefront_theme.noir'
     )
  ON CONFLICT (plan_id, capability) DO UPDATE
    SET limit_value = EXCLUDED.limit_value, enabled = EXCLUDED.enabled;

  INSERT INTO public.plan_entitlement (plan_id, capability, limit_value, enabled)
  VALUES
    (growth_id, 'physical_assets.max', 500, true),
    (growth_id, 'frontdesk_seats.max', 5, true),
    (scale_id, 'physical_assets.max', 1000, true),
    (scale_id, 'frontdesk_seats.max', 8, true)
  ON CONFLICT (plan_id, capability) DO UPDATE
    SET limit_value = EXCLUDED.limit_value, enabled = EXCLUDED.enabled;
END $$;

ALTER TABLE public.organization_onboarding
  DROP CONSTRAINT IF EXISTS organization_onboarding_selected_plan_code_check;
ALTER TABLE public.organization_onboarding
  ADD CONSTRAINT organization_onboarding_selected_plan_code_check
  CHECK (selected_plan_code IS NULL OR selected_plan_code IN ('free', 'starter', 'standard', 'growth', 'scale'));

COMMENT ON TABLE public.plan IS
  'Server-authoritative catalog for Free, Starter, Standard, Growth, and Scale. Growth and Scale are app-only offers; web marketing uses a separate three-plan snapshot.';
