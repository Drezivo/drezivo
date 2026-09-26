-- FIT-BE-073 — explicit fitting-fee refund/correction integrity.
--
-- Refunds stay in the shared finance domain. This migration aligns the persisted refund-purpose
-- vocabulary with the published contract, adds fitting-fee refunds explicitly, and closes the
-- same-tenant/currency relationship that a bare payment_id foreign key cannot prove.

ALTER TABLE refund
  DROP CONSTRAINT IF EXISTS refund_purpose_check,
  ADD CONSTRAINT refund_purpose_check
    CHECK (
      purpose IN (
        'rental',
        'security_deposit',
        'rental_refund',
        'security_deposit_release',
        'goodwill_adjustment',
        'fitting_fee_refund'
      )
    ) NOT VALID;
ALTER TABLE refund VALIDATE CONSTRAINT refund_purpose_check;

ALTER TABLE payment
  ADD CONSTRAINT payment_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE refund
  ADD CONSTRAINT refund_payment_same_tenant_fk
    FOREIGN KEY (tenant_id, payment_id)
    REFERENCES payment (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;
ALTER TABLE refund VALIDATE CONSTRAINT refund_payment_same_tenant_fk;

CREATE FUNCTION refund_payment_relationship_guard() RETURNS trigger AS $$
DECLARE
  payment_currency text;
BEGIN
  SELECT p.currency
    INTO payment_currency
    FROM payment p
   WHERE p.tenant_id = NEW.tenant_id
     AND p.id = NEW.payment_id;

  IF payment_currency IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'refund_payment_tenant_match',
      MESSAGE = 'refund payment must belong to the same tenant';
  END IF;

  IF NEW.currency IS DISTINCT FROM payment_currency THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'refund_payment_currency_match',
      MESSAGE = 'refund currency must match payment currency';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER refund_payment_relationship_guard_trigger
  AFTER INSERT OR UPDATE OF tenant_id, payment_id, currency ON refund
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION refund_payment_relationship_guard();

-- Aggregate financial caps need serialization; row CHECK constraints cannot safely sum siblings.
CREATE FUNCTION refund_active_balance_guard() RETURNS trigger AS $$
DECLARE
  payment_amount bigint;
  active_refunds bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':refund:' || NEW.payment_id::text, 0));

  SELECT p.amount_minor::bigint
    INTO payment_amount
    FROM payment p
   WHERE p.tenant_id = NEW.tenant_id
     AND p.id = NEW.payment_id;

  SELECT COALESCE(sum(r.amount_minor::bigint), 0)
    INTO active_refunds
    FROM refund r
   WHERE r.tenant_id = NEW.tenant_id
     AND r.payment_id = NEW.payment_id
     AND r.status IN ('requested', 'processing', 'completed');

  IF active_refunds > payment_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'refund_active_balance_cap',
      MESSAGE = 'active refunds cannot exceed the payment amount';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER refund_active_balance_guard_trigger
  AFTER INSERT OR UPDATE OF tenant_id, payment_id, amount_minor, status ON refund
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION refund_active_balance_guard();

CREATE FUNCTION payment_allocation_reverse_amount_guard() RETURNS trigger AS $$
DECLARE
  target_amount bigint;
  reversed_amount bigint;
BEGIN
  IF NEW.direction <> 'reverse' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':allocation:' || NEW.reverses_id::text, 0));

  SELECT pa.amount_minor::bigint
    INTO target_amount
    FROM payment_allocation pa
   WHERE pa.tenant_id = NEW.tenant_id
     AND pa.id = NEW.reverses_id
     AND pa.direction = 'apply';

  SELECT COALESCE(sum(pa.amount_minor::bigint), 0)
    INTO reversed_amount
    FROM payment_allocation pa
   WHERE pa.tenant_id = NEW.tenant_id
     AND pa.reverses_id = NEW.reverses_id
     AND pa.direction = 'reverse';

  IF target_amount IS NULL OR reversed_amount > target_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'payment_allocation_reverse_amount_cap',
      MESSAGE = 'allocation reversals cannot exceed the apply posting they reverse';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER payment_allocation_reverse_amount_guard_trigger
  AFTER INSERT OR UPDATE OF tenant_id, direction, reverses_id, amount_minor ON payment_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payment_allocation_reverse_amount_guard();
