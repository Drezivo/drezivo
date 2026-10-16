-- Repair Free-to-paid upgrades that operators approved while activation was broken.
--
-- The business worker activates an approved Free upgrade (subscription.payment_reviewed handler).
-- Until this release its UPDATE also set `subscription.updated_at`, a column the table never had,
-- so every activation failed and its outbox row eventually went dead. Two states can exist:
--
-- A. Approved by the operator API before Drezivo/drezivo-operator 4e875e9. That release extended
--    the period on approval without reading target_plan_id, so the workspace is still on Free but
--    has a paid end date, which derives to "locked". Its payment paid for a month: put it on the
--    plan it paid for and keep that period.
-- B. Approved since 4e875e9. The operator leaves the Free subscription untouched and queues the
--    worker, whose job died on the bad column. Re-queue it so the fixed worker activates the plan
--    and emails the owner through the normal path. Deploy the API and worker with this migration.

-- A. Free with a paid end date: switch to the plan of the latest verified upgrade payment.
WITH stuck AS (
  SELECT DISTINCT ON (s.id)
         s.tenant_id, s.id AS subscription_id, s.plan_id AS prior_plan_id,
         sp.target_plan_id, sp.id AS payment_id
    FROM subscription s
    JOIN plan current_plan ON current_plan.id = s.plan_id AND current_plan.code = 'free'
    JOIN subscription_payment sp ON sp.tenant_id = s.tenant_id AND sp.subscription_id = s.id
    JOIN plan target_plan ON target_plan.id = sp.target_plan_id
                         AND target_plan.code <> 'free' AND target_plan.active
   WHERE s.current_period_end IS NOT NULL
     AND sp.status = 'verified'
   ORDER BY s.id, sp.reviewed_at DESC NULLS LAST, sp.created_at DESC
), repaired AS (
  UPDATE subscription s
     SET plan_id = stuck.target_plan_id
    FROM stuck
   WHERE s.id = stuck.subscription_id AND s.plan_id = stuck.prior_plan_id
  RETURNING stuck.*
)
INSERT INTO subscription_event
  (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
SELECT tenant_id, subscription_id, prior_plan_id, target_plan_id, 'plan_changed',
       statement_timestamp(), 'subscription-payment-approved:' || payment_id
  FROM repaired
ON CONFLICT (tenant_id, business_key) DO NOTHING;

-- B. Dead approval jobs for a verified upgrade whose workspace is still open-ended Free.
UPDATE outbox_event o
   SET status = 'pending', attempts = 0, available_at = statement_timestamp(),
       lease_token = NULL, lease_until = NULL, completed_at = NULL, safe_last_error = NULL
  FROM subscription_payment sp
  JOIN subscription s ON s.tenant_id = sp.tenant_id AND s.id = sp.subscription_id
  JOIN plan current_plan ON current_plan.id = s.plan_id AND current_plan.code = 'free'
 WHERE o.status = 'dead'
   AND o.event_type = 'subscription.payment_reviewed'
   AND o.tenant_id = sp.tenant_id
   AND o.payload ->> 'outcome' = 'approved'
   AND o.payload ->> 'payment_id' = sp.id::text
   AND sp.status = 'verified'
   AND sp.target_plan_id IS NOT NULL
   AND s.status = 'active'
   AND s.current_period_end IS NULL;
