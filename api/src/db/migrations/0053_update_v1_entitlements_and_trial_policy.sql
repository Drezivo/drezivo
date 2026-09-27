-- Update the pre-production v1 commercial policy without rewriting applied migrations.
-- Prices remain migration-owned and unchanged. Existing catalogue/account data is unrelated.

DO $$
DECLARE
  expected record;
  actual record;
  seeded_plan_id uuid;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('starter'::text, 30000::integer, 125::integer, 0::integer),
      ('professional'::text, 49900::integer, 300::integer, 2::integer),
      ('business'::text, 129900::integer, 1000::integer, 10::integer)
    ) AS values_table(code, monthly_minor, assets, seats)
  LOOP
    SELECT id, monthly_minor, currency, active
      INTO actual
      FROM plan
     WHERE plan.code = expected.code AND plan.version = 1;
    IF actual.id IS NULL
       OR actual.monthly_minor <> expected.monthly_minor
       OR actual.currency <> 'PHP'
       OR actual.active IS NOT TRUE THEN
      RAISE EXCEPTION 'v1 plan seed conflict for %', expected.code;
    END IF;

    seeded_plan_id := actual.id;
    UPDATE plan_entitlement AS pe
       SET limit_value = expected.assets, enabled = true
     WHERE pe.plan_id = seeded_plan_id AND pe.capability = 'physical_assets.max';
    UPDATE plan_entitlement AS pe
       SET limit_value = expected.seats, enabled = true
     WHERE pe.plan_id = seeded_plan_id AND pe.capability = 'frontdesk_seats.max';

    IF NOT EXISTS (
      SELECT 1 FROM plan_entitlement AS pe
       WHERE pe.plan_id = seeded_plan_id
         AND pe.capability = 'physical_assets.max'
         AND pe.limit_value = expected.assets AND pe.enabled IS TRUE
    ) OR NOT EXISTS (
      SELECT 1 FROM plan_entitlement AS pe
       WHERE pe.plan_id = seeded_plan_id
         AND pe.capability = 'frontdesk_seats.max'
         AND pe.limit_value = expected.seats AND pe.enabled IS TRUE
    ) THEN
      RAISE EXCEPTION 'v1 entitlement seed conflict for %', expected.code;
    END IF;
  END LOOP;
END $$;
