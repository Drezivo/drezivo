-- Set the current Standard offer (internal starter v1) to PHP 299 per month.
-- Existing subscription-payment rows retain their recorded amount.
-- Idempotent: rerunning keeps the current plan price at 29,900 PHP minor units.
DO $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE plan
     SET monthly_minor = 29900
   WHERE code = 'starter'
     AND version = 1;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'migration 0072 expected one Starter v1 plan; updated % rows', updated_count;
  END IF;
END $$;
