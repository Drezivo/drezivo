-- FIT-BE-022 — fitting concurrency/exclusion constraints.
--
-- Capacity and guaranteed garments are claims, not advisory availability checks. PostgreSQL is the
-- final concurrency arbiter: hidden fitting slots get their own GiST overlap exclusion, while
-- guaranteed garments reuse the canonical asset_allocation exclusion introduced in 0003.

-- 0041 initially used a full unique constraint while the persistence shape was being established.
-- Reschedule history must retain released slot rows, so only the CURRENT blocking claim is unique.
ALTER TABLE fitting_slot_allocation
  DROP CONSTRAINT fitting_slot_allocation_tenant_fitting_key;

CREATE UNIQUE INDEX fitting_slot_allocation_one_blocking_per_fitting
  ON fitting_slot_allocation (tenant_id, fitting_id)
  WHERE is_blocking;

-- Adjacent [) periods do not overlap; true overlap on the same hidden slot cannot commit.
ALTER TABLE fitting_slot_allocation
  ADD CONSTRAINT fitting_slot_allocation_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    slot_id WITH =,
    period WITH &&
  )
  WHERE (is_blocking);

-- Canonical asset_allocation already has the cross-kind asset overlap exclusion. Add the fitting
-- line cardinality that mirrors the reservation-line rule: one current blocking physical asset per
-- guaranteed fitting line, while released historical substitutions/reschedules remain retained.
CREATE UNIQUE INDEX asset_allocation_one_blocking_per_fitting_line
  ON asset_allocation (tenant_id, fitting_line_id)
  WHERE is_blocking AND fitting_line_id IS NOT NULL;

ALTER TABLE asset_allocation
  ADD CONSTRAINT asset_allocation_fitting_release_state
    CHECK (
      fitting_line_id IS NULL
      OR (is_blocking AND released_at IS NULL)
      OR (NOT is_blocking AND released_at IS NOT NULL)
    ) NOT VALID;
ALTER TABLE asset_allocation VALIDATE CONSTRAINT asset_allocation_fitting_release_state;

-- Validate the final transactional claim set. These checks are DEFERRABLE so creation,
-- rescheduling, lifecycle release, and garment replacement may perform several writes in one
-- transaction without exposing an invalid committed state. A failed transaction rolls back to the
-- original claims, which is what preserves the old fitting when a replacement cannot be acquired.
CREATE FUNCTION fitting_assert_current_claims(p_tenant_id uuid, p_fitting_id uuid) RETURNS void AS $$
DECLARE
  appointment_row fitting_appointment%ROWTYPE;
  scheduled boolean;
  line_count integer;
  slot_count integer;
  invalid_slot_count integer;
  line_row record;
  asset_claim_count integer;
  invalid_asset_claim_count integer;
BEGIN
  SELECT *
    INTO appointment_row
    FROM fitting_appointment
   WHERE tenant_id = p_tenant_id AND id = p_fitting_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  scheduled := appointment_row.status IN ('pending', 'confirmed');

  SELECT count(*)::integer
    INTO line_count
    FROM fitting_line
   WHERE tenant_id = p_tenant_id AND fitting_id = p_fitting_id;

  IF line_count < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_claim_requires_line',
      MESSAGE = 'a fitting appointment must retain at least one garment line';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE fcs.branch_id IS DISTINCT FROM appointment_row.branch_id
         OR NOT fcs.active
         OR fsa.period IS DISTINCT FROM appointment_row.period
    )::integer
    INTO slot_count, invalid_slot_count
    FROM fitting_slot_allocation fsa
    JOIN fitting_capacity_slot fcs
      ON fcs.tenant_id = fsa.tenant_id AND fcs.id = fsa.slot_id
   WHERE fsa.tenant_id = p_tenant_id
     AND fsa.fitting_id = p_fitting_id
     AND fsa.is_blocking;

  IF scheduled AND slot_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_claim_requires_one_capacity_slot',
      MESSAGE = 'pending/confirmed fitting must own exactly one blocking capacity slot';
  END IF;

  IF NOT scheduled AND slot_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_terminal_has_no_capacity_claim',
      MESSAGE = 'terminal fitting cannot retain a blocking capacity slot';
  END IF;

  IF invalid_slot_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_capacity_claim_matches_appointment',
      MESSAGE = 'blocking capacity claim must use an active slot in the appointment branch and exact period';
  END IF;

  FOR line_row IN
    SELECT fl.id, fl.variant_id, fl.asset_id, fl.garment_guaranteed
      FROM fitting_line fl
     WHERE fl.tenant_id = p_tenant_id AND fl.fitting_id = p_fitting_id
  LOOP
    SELECT
      count(*)::integer,
      count(*) FILTER (
        WHERE aa.kind <> 'fitting'
           OR aa.asset_id IS DISTINCT FROM line_row.asset_id
           OR aa.branch_id IS DISTINCT FROM appointment_row.branch_id
           OR aa.period IS DISTINCT FROM appointment_row.period
      )::integer
      INTO asset_claim_count, invalid_asset_claim_count
      FROM asset_allocation aa
     WHERE aa.tenant_id = p_tenant_id
       AND aa.fitting_line_id = line_row.id
       AND aa.is_blocking;

    IF scheduled AND line_row.garment_guaranteed AND asset_claim_count <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'fitting_guarantee_requires_one_asset_claim',
        MESSAGE = 'scheduled guaranteed fitting line must own exactly one blocking asset allocation';
    END IF;

    IF (NOT scheduled OR NOT line_row.garment_guaranteed) AND asset_claim_count <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'fitting_line_must_not_have_asset_claim',
        MESSAGE = 'preference or terminal fitting line cannot retain a blocking asset allocation';
    END IF;

    IF invalid_asset_claim_count <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'fitting_asset_claim_matches_appointment',
        MESSAGE = 'blocking fitting asset allocation must match the assigned asset, branch, and exact appointment period';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION fitting_claims_from_appointment_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM fitting_assert_current_claims(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_claims_appointment_constraint
  AFTER INSERT OR UPDATE ON fitting_appointment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_claims_from_appointment_trigger();

CREATE FUNCTION fitting_claims_from_line_trigger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fitting_assert_current_claims(OLD.tenant_id, OLD.fitting_id);
    RETURN OLD;
  END IF;

  PERFORM fitting_assert_current_claims(NEW.tenant_id, NEW.fitting_id);
  IF TG_OP = 'UPDATE'
     AND (OLD.tenant_id, OLD.fitting_id) IS DISTINCT FROM (NEW.tenant_id, NEW.fitting_id)
  THEN
    PERFORM fitting_assert_current_claims(OLD.tenant_id, OLD.fitting_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_claims_line_constraint
  AFTER INSERT OR UPDATE OR DELETE ON fitting_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_claims_from_line_trigger();

CREATE FUNCTION fitting_claims_from_slot_allocation_trigger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fitting_assert_current_claims(OLD.tenant_id, OLD.fitting_id);
    RETURN OLD;
  END IF;

  PERFORM fitting_assert_current_claims(NEW.tenant_id, NEW.fitting_id);
  IF TG_OP = 'UPDATE'
     AND (OLD.tenant_id, OLD.fitting_id) IS DISTINCT FROM (NEW.tenant_id, NEW.fitting_id)
  THEN
    PERFORM fitting_assert_current_claims(OLD.tenant_id, OLD.fitting_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_claims_slot_allocation_constraint
  AFTER INSERT OR UPDATE OR DELETE ON fitting_slot_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_claims_from_slot_allocation_trigger();

CREATE FUNCTION fitting_claims_from_asset_allocation_trigger() RETURNS trigger AS $$
DECLARE
  target_fitting_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.fitting_line_id IS NOT NULL THEN
    SELECT fitting_id INTO target_fitting_id
      FROM fitting_line
     WHERE tenant_id = OLD.tenant_id AND id = OLD.fitting_line_id;
    IF target_fitting_id IS NOT NULL THEN
      PERFORM fitting_assert_current_claims(OLD.tenant_id, target_fitting_id);
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.fitting_line_id IS NOT NULL THEN
    SELECT fitting_id INTO target_fitting_id
      FROM fitting_line
     WHERE tenant_id = NEW.tenant_id AND id = NEW.fitting_line_id;
    IF target_fitting_id IS NOT NULL THEN
      PERFORM fitting_assert_current_claims(NEW.tenant_id, target_fitting_id);
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_claims_asset_allocation_constraint
  AFTER INSERT OR UPDATE OR DELETE ON asset_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_claims_from_asset_allocation_trigger();

-- An active slot cannot be deactivated or moved to another branch while it backs a current claim.
CREATE FUNCTION fitting_capacity_slot_active_claim_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW.active IS DISTINCT FROM OLD.active OR NEW.branch_id IS DISTINCT FROM OLD.branch_id)
     AND EXISTS (
       SELECT 1
         FROM fitting_slot_allocation fsa
        WHERE fsa.tenant_id = OLD.tenant_id
          AND fsa.slot_id = OLD.id
          AND fsa.is_blocking
     )
     AND (NOT NEW.active OR NEW.branch_id IS DISTINCT FROM OLD.branch_id)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_capacity_slot_active_claim_guard',
      MESSAGE = 'cannot deactivate or move a capacity slot while it has a blocking fitting claim';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fitting_capacity_slot_active_claim_guard_trigger
  BEFORE UPDATE ON fitting_capacity_slot
  FOR EACH ROW EXECUTE FUNCTION fitting_capacity_slot_active_claim_guard();
