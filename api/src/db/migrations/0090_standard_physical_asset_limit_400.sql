-- Temporarily raise the shared Standard v1 garment quota for all current and future subscribers.
DO $$
DECLARE
  standard_id uuid;
  updated_count integer;
BEGIN
  SELECT id INTO standard_id
    FROM public.plan
   WHERE code = 'standard' AND version = 1 AND active IS TRUE;

  IF standard_id IS NULL THEN
    RAISE EXCEPTION 'active Standard v1 plan is missing; cannot apply migration 0090';
  END IF;

  UPDATE public.plan_entitlement
     SET limit_value = 400
   WHERE plan_id = standard_id
     AND capability = 'physical_assets.max';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'migration 0090 expected one Standard garment quota entitlement; updated % rows', updated_count;
  END IF;
END $$;
