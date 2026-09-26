-- FIT-BE-070 — canonical fitting finance relationship integrity.
--
-- Fittings already reuse the V1 payment/charge/allocation tables. This migration closes the
-- cross-row link invariant that a row CHECK cannot express: a payment allocation may only connect
-- money and a charge from the same tenant, same booking source, and same currency. The guard is
-- intentionally booking-agnostic so reservation and fitting finance share one rule instead of
-- growing parallel posting semantics.

CREATE FUNCTION finance_payment_allocation_relationship_guard() RETURNS trigger AS $$
DECLARE
  payment_tenant uuid;
  payment_reservation uuid;
  payment_fitting uuid;
  payment_currency text;
  charge_tenant uuid;
  charge_reservation uuid;
  charge_fitting uuid;
  charge_currency text;
  target_tenant uuid;
  target_payment uuid;
  target_charge uuid;
  target_direction text;
BEGIN
  SELECT p.tenant_id, p.reservation_id, p.fitting_id, p.currency
    INTO payment_tenant, payment_reservation, payment_fitting, payment_currency
    FROM payment p
   WHERE p.id = NEW.payment_id;

  SELECT c.tenant_id, c.reservation_id, c.fitting_id, c.currency
    INTO charge_tenant, charge_reservation, charge_fitting, charge_currency
    FROM charge c
   WHERE c.id = NEW.charge_id;

  IF payment_tenant IS DISTINCT FROM NEW.tenant_id
     OR charge_tenant IS DISTINCT FROM NEW.tenant_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'payment_allocation_tenant_match',
      MESSAGE = 'payment allocation tenant must match payment and charge';
  END IF;

  IF payment_currency IS DISTINCT FROM charge_currency THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'payment_allocation_currency_match',
      MESSAGE = 'payment allocation currency must match payment and charge currency';
  END IF;

  IF NOT (
    (
      payment_reservation IS NOT NULL
      AND charge_reservation IS NOT NULL
      AND payment_reservation = charge_reservation
      AND payment_fitting IS NULL
      AND charge_fitting IS NULL
    )
    OR (
      payment_fitting IS NOT NULL
      AND charge_fitting IS NOT NULL
      AND payment_fitting = charge_fitting
      AND payment_reservation IS NULL
      AND charge_reservation IS NULL
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'payment_allocation_booking_source_match',
      MESSAGE = 'payment allocation payment and charge must belong to the same booking source';
  END IF;

  IF NEW.direction = 'reverse' THEN
    SELECT pa.tenant_id, pa.payment_id, pa.charge_id, pa.direction
      INTO target_tenant, target_payment, target_charge, target_direction
      FROM payment_allocation pa
     WHERE pa.id = NEW.reverses_id;

    IF target_tenant IS DISTINCT FROM NEW.tenant_id
       OR target_payment IS DISTINCT FROM NEW.payment_id
       OR target_charge IS DISTINCT FROM NEW.charge_id
       OR target_direction IS DISTINCT FROM 'apply'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'payment_allocation_reverse_target_match',
        MESSAGE = 'payment allocation reversal must target an apply posting for the same payment and charge';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER finance_payment_allocation_relationship_guard_trigger
  AFTER INSERT OR UPDATE ON payment_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_payment_allocation_relationship_guard();
