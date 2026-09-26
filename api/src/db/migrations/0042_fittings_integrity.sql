-- FIT-BE-021 — fitting tenant/branch/FK/state integrity.
--
-- 0041 intentionally created the persistence graph first. This migration turns the approved
-- fitting model into database-enforced invariants before any fitting route is enabled. RLS is
-- still owned by FIT-BE-024; the constraints below protect correctness even for privileged
-- migration/admin paths that do not pass through application authorization.

-- Scalar settings invariants mirror the approved BE-1 contracts. These are technical safety
-- bounds, not plan-entitlement gates.
ALTER TABLE fitting_settings
  ADD CONSTRAINT fitting_settings_capacity_bounds
    CHECK (capacity BETWEEN 1 AND 100) NOT VALID,
  ADD CONSTRAINT fitting_settings_duration_bounds
    CHECK (duration_minutes BETWEEN 30 AND 1440 AND duration_minutes % 30 = 0) NOT VALID,
  ADD CONSTRAINT fitting_settings_fee_nonnegative
    CHECK (fee_minor >= 0) NOT VALID,
  ADD CONSTRAINT fitting_settings_currency_shape
    CHECK (currency ~ '^[A-Z]{3}$') NOT VALID,
  ADD CONSTRAINT fitting_settings_version_positive
    CHECK (version > 0) NOT VALID;

ALTER TABLE fitting_settings VALIDATE CONSTRAINT fitting_settings_capacity_bounds;
ALTER TABLE fitting_settings VALIDATE CONSTRAINT fitting_settings_duration_bounds;
ALTER TABLE fitting_settings VALIDATE CONSTRAINT fitting_settings_fee_nonnegative;
ALTER TABLE fitting_settings VALIDATE CONSTRAINT fitting_settings_currency_shape;
ALTER TABLE fitting_settings VALIDATE CONSTRAINT fitting_settings_version_positive;

-- Appointment rows carry immutable snapshots plus one canonical bounded half-open period.
ALTER TABLE fitting_appointment
  ADD CONSTRAINT fitting_appointment_booking_channel_check
    CHECK (booking_channel = 'staff') NOT VALID,
  ADD CONSTRAINT fitting_appointment_status_check
    CHECK (status IN ('pending', 'confirmed', 'completed', 'rejected', 'cancelled', 'no_show')) NOT VALID,
  ADD CONSTRAINT fitting_appointment_period_bounded
    CHECK (
      NOT isempty(period)
      AND lower_inc(period)
      AND NOT upper_inc(period)
      AND lower(period) IS NOT NULL
      AND upper(period) IS NOT NULL
      AND lower(period) < upper(period)
    ) NOT VALID,
  ADD CONSTRAINT fitting_appointment_currency_shape
    CHECK (currency ~ '^[A-Z]{3}$') NOT VALID,
  ADD CONSTRAINT fitting_appointment_fee_nonnegative
    CHECK (fee_minor >= 0) NOT VALID,
  ADD CONSTRAINT fitting_appointment_version_positive
    CHECK (version > 0) NOT VALID,
  ADD CONSTRAINT fitting_appointment_business_key_not_blank
    CHECK (length(btrim(business_key)) BETWEEN 1 AND 160) NOT VALID,
  ADD CONSTRAINT fitting_appointment_timezone_not_blank
    CHECK (length(btrim(timezone_snapshot)) BETWEEN 1 AND 64) NOT VALID,
  ADD CONSTRAINT fitting_appointment_internal_note_bounded
    CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000) NOT VALID,
  ADD CONSTRAINT fitting_appointment_terminal_reason_state
    CHECK (
      (
        status IN ('rejected', 'cancelled')
        AND terminal_reason IS NOT NULL
        AND length(btrim(terminal_reason)) BETWEEN 1 AND 500
      )
      OR (
        status NOT IN ('rejected', 'cancelled')
        AND terminal_reason IS NULL
      )
    ) NOT VALID;

ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_booking_channel_check;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_status_check;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_period_bounded;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_currency_shape;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_fee_nonnegative;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_version_positive;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_business_key_not_blank;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_timezone_not_blank;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_internal_note_bounded;
ALTER TABLE fitting_appointment VALIDATE CONSTRAINT fitting_appointment_terminal_reason_state;

-- Preference lines never carry a physical promise; guaranteed lines always identify the concrete
-- physical asset that the canonical asset_allocation row will block.
ALTER TABLE fitting_line
  ADD CONSTRAINT fitting_line_guarantee_asset_check
    CHECK (
      (garment_guaranteed AND asset_id IS NOT NULL)
      OR (NOT garment_guaranteed AND asset_id IS NULL)
    ) NOT VALID;
ALTER TABLE fitting_line VALIDATE CONSTRAINT fitting_line_guarantee_asset_check;

ALTER TABLE fitting_capacity_slot
  ADD CONSTRAINT fitting_capacity_slot_number_bounds
    CHECK (slot_number BETWEEN 1 AND 100) NOT VALID;
ALTER TABLE fitting_capacity_slot VALIDATE CONSTRAINT fitting_capacity_slot_number_bounds;

ALTER TABLE fitting_slot_allocation
  ADD CONSTRAINT fitting_slot_allocation_period_bounded
    CHECK (
      NOT isempty(period)
      AND lower_inc(period)
      AND NOT upper_inc(period)
      AND lower(period) IS NOT NULL
      AND upper(period) IS NOT NULL
      AND lower(period) < upper(period)
    ) NOT VALID,
  ADD CONSTRAINT fitting_slot_allocation_release_state
    CHECK (
      (is_blocking AND released_at IS NULL)
      OR (NOT is_blocking AND released_at IS NOT NULL)
    ) NOT VALID;
ALTER TABLE fitting_slot_allocation VALIDATE CONSTRAINT fitting_slot_allocation_period_bounded;
ALTER TABLE fitting_slot_allocation VALIDATE CONSTRAINT fitting_slot_allocation_release_state;

-- A closure is also a canonical finite half-open interval. Schedule/overlap semantics are added in
-- FIT-BE-023; this check only prevents malformed stored ranges.
ALTER TABLE fitting_closure
  ADD CONSTRAINT fitting_closure_period_bounded
    CHECK (
      NOT isempty(period)
      AND lower_inc(period)
      AND NOT upper_inc(period)
      AND lower(period) IS NOT NULL
      AND upper(period) IS NOT NULL
      AND lower(period) < upper(period)
    ) NOT VALID,
  ADD CONSTRAINT fitting_closure_reason_bounded
    CHECK (length(btrim(reason)) BETWEEN 1 AND 240) NOT VALID;
ALTER TABLE fitting_closure VALIDATE CONSTRAINT fitting_closure_period_bounded;
ALTER TABLE fitting_closure VALIDATE CONSTRAINT fitting_closure_reason_bounded;

-- Finance extensions now have two possible booking sources. Exactly one source must be present;
-- fitting_fee can only belong to a fitting, and fitting-linked charges are limited to the fitting
-- fee itself or an explicit credit/reversal entry from the existing finance domain.
-- Existing V1 finance also permits an intentionally unlinked payment intent/evidence record, so
-- adding fitting_id must preserve that behavior while still forbidding one payment from claiming
-- both a reservation and a fitting at once.
ALTER TABLE payment
  ADD CONSTRAINT payment_booking_source_at_most_one
    CHECK (num_nonnulls(reservation_id, fitting_id) <= 1) NOT VALID;
ALTER TABLE payment VALIDATE CONSTRAINT payment_booking_source_at_most_one;

ALTER TABLE charge
  ADD CONSTRAINT charge_booking_source_exactly_one
    CHECK (num_nonnulls(reservation_id, fitting_id) = 1) NOT VALID,
  ADD CONSTRAINT charge_fitting_kind_source_check
    CHECK (
      (kind <> 'fitting_fee' OR fitting_id IS NOT NULL)
      AND (fitting_id IS NULL OR kind IN ('fitting_fee', 'credit'))
    ) NOT VALID;
ALTER TABLE charge VALIDATE CONSTRAINT charge_booking_source_exactly_one;
ALTER TABLE charge VALIDATE CONSTRAINT charge_fitting_kind_source_check;

-- New appointments always begin pending. Lifecycle updates are explicit commands and only the
-- canonical edges are legal; terminal states never reopen. Timing guards still belong to the
-- lifecycle service because they depend on database time and the command being performed.
CREATE FUNCTION fitting_appointment_state_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'fitting_appointment_initial_state',
        MESSAGE = 'new fitting appointments must start pending';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'rejected', 'cancelled'))
    OR (OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled', 'no_show'))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_appointment_state_transition',
      MESSAGE = format('illegal fitting state transition: %s -> %s', OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fitting_appointment_state_guard_trigger
  BEFORE INSERT OR UPDATE OF status ON fitting_appointment
  FOR EACH ROW EXECUTE FUNCTION fitting_appointment_state_guard();

-- These values identify the booking and its financial snapshot. The approved API has no generic
-- mutation for them; reschedule changes period/version, while notes/garments/lifecycle use their
-- own commands.
CREATE FUNCTION fitting_appointment_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.booking_channel IS DISTINCT FROM OLD.booking_channel
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.fee_minor IS DISTINCT FROM OLD.fee_minor
     OR NEW.business_key IS DISTINCT FROM OLD.business_key
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_appointment_snapshot_immutable',
      MESSAGE = 'fitting identity and fee snapshot fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fitting_appointment_snapshot_guard_trigger
  BEFORE UPDATE ON fitting_appointment
  FOR EACH ROW EXECUTE FUNCTION fitting_appointment_snapshot_guard();

-- A guaranteed asset must be the requested variant. While the fitting is scheduled it must also
-- belong to the appointment branch. Historical terminal fittings may retain their original asset
-- link even if the asset is moved to another branch later.
CREATE FUNCTION fitting_line_asset_relationship_guard() RETURNS trigger AS $$
DECLARE
  appointment_branch uuid;
  appointment_status text;
  asset_branch uuid;
  asset_variant uuid;
BEGIN
  IF NOT NEW.garment_guaranteed THEN
    RETURN NEW;
  END IF;

  SELECT fa.branch_id, fa.status
    INTO appointment_branch, appointment_status
    FROM fitting_appointment fa
   WHERE fa.tenant_id = NEW.tenant_id AND fa.id = NEW.fitting_id;

  SELECT pa.branch_id, pa.variant_id
    INTO asset_branch, asset_variant
    FROM physical_asset pa
   WHERE pa.tenant_id = NEW.tenant_id AND pa.id = NEW.asset_id;

  IF asset_variant IS DISTINCT FROM NEW.variant_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_line_asset_variant_match',
      MESSAGE = 'guaranteed fitting asset must belong to the requested variant';
  END IF;

  IF appointment_status IN ('pending', 'confirmed')
     AND asset_branch IS DISTINCT FROM appointment_branch
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_line_asset_branch_match',
      MESSAGE = 'scheduled guaranteed fitting asset must belong to the appointment branch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_line_asset_relationship_guard_trigger
  AFTER INSERT OR UPDATE ON fitting_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_line_asset_relationship_guard();

-- Do not allow an asset move/variant rewrite to invalidate a still-scheduled guarantee.
CREATE FUNCTION fitting_active_asset_move_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
     AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM fitting_line fl
      JOIN fitting_appointment fa
        ON fa.tenant_id = fl.tenant_id AND fa.id = fl.fitting_id
     WHERE fl.tenant_id = NEW.tenant_id
       AND fl.asset_id = NEW.id
       AND fl.garment_guaranteed
       AND fa.status IN ('pending', 'confirmed')
       AND (
         NEW.variant_id IS DISTINCT FROM fl.variant_id
         OR NEW.branch_id IS DISTINCT FROM fa.branch_id
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'physical_asset_active_fitting_relationship',
      MESSAGE = 'asset branch/variant change would invalidate an active fitting guarantee';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fitting_active_asset_move_guard_trigger
  BEFORE UPDATE ON physical_asset
  FOR EACH ROW EXECUTE FUNCTION fitting_active_asset_move_guard();

-- Capacity-slot identity is hidden, but it still belongs to exactly the same branch as the
-- appointment it services.
CREATE FUNCTION fitting_slot_branch_guard() RETURNS trigger AS $$
DECLARE
  slot_branch uuid;
  appointment_branch uuid;
BEGIN
  SELECT branch_id INTO slot_branch
    FROM fitting_capacity_slot
   WHERE tenant_id = NEW.tenant_id AND id = NEW.slot_id;

  SELECT branch_id INTO appointment_branch
    FROM fitting_appointment
   WHERE tenant_id = NEW.tenant_id AND id = NEW.fitting_id;

  IF slot_branch IS DISTINCT FROM appointment_branch THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_slot_allocation_branch_match',
      MESSAGE = 'fitting capacity slot must belong to the appointment branch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_slot_branch_guard_trigger
  AFTER INSERT OR UPDATE ON fitting_slot_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_slot_branch_guard();

-- Canonical garment allocations for fittings snapshot the appointment branch. The stronger
-- blocking-claim/period/asset cardinality checks are added in FIT-BE-022.
CREATE FUNCTION fitting_asset_allocation_branch_guard() RETURNS trigger AS $$
DECLARE
  appointment_branch uuid;
BEGIN
  IF NEW.fitting_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT fa.branch_id
    INTO appointment_branch
    FROM fitting_line fl
    JOIN fitting_appointment fa
      ON fa.tenant_id = fl.tenant_id AND fa.id = fl.fitting_id
   WHERE fl.tenant_id = NEW.tenant_id AND fl.id = NEW.fitting_line_id;

  IF NEW.branch_id IS DISTINCT FROM appointment_branch THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'asset_allocation_fitting_branch_match',
      MESSAGE = 'fitting asset allocation must use the appointment branch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_asset_allocation_branch_guard_trigger
  AFTER INSERT OR UPDATE ON asset_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_asset_allocation_branch_guard();

-- Fitting-linked finance rows reuse the existing finance domain. Currency must match the immutable
-- appointment snapshot; the original fitting_fee charge must exactly equal that positive snapshot.
CREATE FUNCTION fitting_payment_currency_guard() RETURNS trigger AS $$
DECLARE
  appointment_currency text;
BEGIN
  IF NEW.fitting_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT currency INTO appointment_currency
    FROM fitting_appointment
   WHERE tenant_id = NEW.tenant_id AND id = NEW.fitting_id;

  IF NEW.currency IS DISTINCT FROM appointment_currency THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'payment_fitting_currency_match',
      MESSAGE = 'fitting payment currency must match appointment currency';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_payment_currency_guard_trigger
  AFTER INSERT OR UPDATE ON payment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_payment_currency_guard();

CREATE FUNCTION fitting_charge_snapshot_guard() RETURNS trigger AS $$
DECLARE
  appointment_currency text;
  appointment_fee bigint;
BEGIN
  IF NEW.fitting_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT currency, fee_minor
    INTO appointment_currency, appointment_fee
    FROM fitting_appointment
   WHERE tenant_id = NEW.tenant_id AND id = NEW.fitting_id;

  IF NEW.currency IS DISTINCT FROM appointment_currency THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'charge_fitting_currency_match',
      MESSAGE = 'fitting charge currency must match appointment currency';
  END IF;

  IF NEW.kind = 'fitting_fee'
     AND (appointment_fee <= 0 OR NEW.amount_minor::bigint <> appointment_fee)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'charge_fitting_fee_snapshot_match',
      MESSAGE = 'fitting_fee charge must equal the positive appointment fee snapshot';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_charge_snapshot_guard_trigger
  AFTER INSERT OR UPDATE ON charge
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_charge_snapshot_guard();
