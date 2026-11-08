-- Return Standard v1 to its published 300 active garments (owner decision, 2026-11-01).
--
-- 0090 temporarily raised Standard to 400 while Growth (₱499, 500 garments) did not exist yet. Now
-- that it does, Gigi's Rental (storefront slug `gigis-rental`) moves from Standard to Growth first,
-- keeping its current period; it pays the Growth price from its next payment. Elsewhere the slug
-- does not exist and that step changes nothing.
--
-- Lowering a quota never removes garments, but a Standard shop already above 300 could add none
-- until it archives some. The migration therefore stops if any other Standard shop is above 300,
-- so that shop is moved deliberately instead of being capped by surprise.

DO $$
DECLARE
  standard_id uuid;
  growth_id uuid;
  moved record;
  over_limit integer;
  updated_count integer;
BEGIN
  SELECT id INTO standard_id FROM public.plan WHERE code = 'standard' AND version = 1 AND active IS TRUE;
  SELECT id INTO growth_id FROM public.plan WHERE code = 'growth' AND version = 1 AND active IS TRUE;
  IF standard_id IS NULL OR growth_id IS NULL THEN
    RAISE EXCEPTION 'migration 0093 requires active Standard and Growth v1 plans';
  END IF;

  FOR moved IN
    UPDATE public.subscription s
       SET plan_id = growth_id
      FROM public.storefront sf
     WHERE sf.tenant_id = s.tenant_id
       AND sf.slug = 'gigis-rental'
       AND s.plan_id = standard_id
    RETURNING s.tenant_id, s.id
  LOOP
    INSERT INTO public.subscription_event
      (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
    VALUES
      (moved.tenant_id, moved.id, standard_id, growth_id, 'plan_changed', statement_timestamp(),
       'migration-0093:standard-to-growth')
    ON CONFLICT (tenant_id, business_key) DO NOTHING;
  END LOOP;

  SELECT count(*) INTO over_limit
    FROM public.subscription s
   WHERE s.plan_id = standard_id
     AND (SELECT count(*) FROM public.physical_asset a
           WHERE a.tenant_id = s.tenant_id AND a.lifecycle_status = 'active') > 300;
  IF over_limit > 0 THEN
    RAISE EXCEPTION 'migration 0093: % Standard shop(s) hold more than 300 active garments; move them to Growth first', over_limit;
  END IF;

  UPDATE public.plan_entitlement
     SET limit_value = 300
   WHERE plan_id = standard_id
     AND capability = 'physical_assets.max';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'migration 0093 expected one Standard garment quota entitlement; updated % rows', updated_count;
  END IF;
END $$;
