-- A verified subscription payment puts the subscription on the plan it paid for.
--
-- Payments are approved by the operator API (a separate repository). Its approval runs, in one
-- transaction: mark the payment verified, then extend the subscription by one month and make it
-- active. It never reads subscription_payment.target_plan_id, so a Free workspace that paid for
-- Starter or Standard was extended while staying on Free, and Free with an end date derives to
-- "locked" (see api/src/modules/billing/access.ts). The business worker's later attempt to switch
-- the plan required a Free row without an end date and so always failed.
--
-- This trigger makes "verified payment => target plan" a database invariant, whichever service
-- approves. It runs inside the approving transaction, before the operator's period update, so the
-- plan switch and the paid month commit together. It changes only plan_id: the paid period stays
-- the approver's responsibility, so no month is ever granted twice.

CREATE OR REPLACE FUNCTION public.subscription_payment_activate_target_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior_plan_id uuid;
  target_code text;
  target_active boolean;
BEGIN
  SELECT code, active INTO target_code, target_active FROM public.plan WHERE id = NEW.target_plan_id;
  -- Fail closed: approving must not move a workspace onto a plan it cannot resolve entitlements for.
  IF target_code IS NULL OR target_code = 'free' OR target_active IS NOT TRUE THEN
    RAISE EXCEPTION 'subscription payment % pays for a plan that is not offered', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT plan_id INTO prior_plan_id
    FROM public.subscription
   WHERE tenant_id = NEW.tenant_id AND id = NEW.subscription_id
   FOR UPDATE;
  IF prior_plan_id IS NULL OR prior_plan_id = NEW.target_plan_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.subscription
     SET plan_id = NEW.target_plan_id
   WHERE tenant_id = NEW.tenant_id AND id = NEW.subscription_id;

  -- The business key is the one the worker's email path recognises as this payment's activation.
  INSERT INTO public.subscription_event
    (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
  VALUES
    (NEW.tenant_id, NEW.subscription_id, prior_plan_id, NEW.target_plan_id, 'plan_changed',
     statement_timestamp(), 'subscription-payment-approved:' || NEW.id)
  ON CONFLICT (tenant_id, business_key) DO NOTHING;

  RETURN NEW;
END $$;

CREATE TRIGGER subscription_payment_activate_target_plan
  AFTER UPDATE OF status ON subscription_payment
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status = 'verified' AND NEW.target_plan_id IS NOT NULL)
  EXECUTE FUNCTION public.subscription_payment_activate_target_plan();

-- Repair workspaces already approved before this trigger existed: still on Free, but given a paid
-- end date by the approval. Their latest verified upgrade payment names the plan they paid for.
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

COMMENT ON FUNCTION public.subscription_payment_activate_target_plan() IS
  'Moves a subscription onto subscription_payment.target_plan_id when that payment is verified; the approver still owns the paid period.';
