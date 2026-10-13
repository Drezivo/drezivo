-- QA 10 Oct (Fittings 1a) — a fitting may be booked before the customer chooses what to try on.
--
-- Customers often book a fitting from Facebook or Instagram and pick garments at the shop, so a
-- pending or confirmed fitting may now have no garment lines. This re-creates the 0047 validator
-- unchanged except that the "at least one active garment line" rule is removed. Every other
-- invariant stays: exactly one blocking capacity slot while scheduled, none once terminal, and
-- the asset-claim rules for each current line. The garment-plan replacement API still requires at
-- least one line, so a plan is only ever replaced with real garments.
--
-- Relaxing a check is compatible with the application version already deployed, so this needs no
-- expand/contract sequence. CREATE OR REPLACE keeps the grants from 0068.

CREATE OR REPLACE FUNCTION fitting_assert_current_claims(p_tenant_id uuid, p_fitting_id uuid) RETURNS void AS $$
DECLARE
  appointment_row fitting_appointment%ROWTYPE;
  scheduled boolean;
  slot_count integer;
  invalid_slot_count integer;
  retired_blocking_count integer;
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

  SELECT count(*)::integer
    INTO retired_blocking_count
    FROM fitting_line fl
    JOIN asset_allocation aa
      ON aa.tenant_id = fl.tenant_id
     AND aa.fitting_line_id = fl.id
   WHERE fl.tenant_id = p_tenant_id
     AND fl.fitting_id = p_fitting_id
     AND fl.removed_at IS NOT NULL
     AND aa.is_blocking;

  IF retired_blocking_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_retired_line_has_no_asset_claim',
      MESSAGE = 'retired fitting line cannot retain a blocking asset allocation';
  END IF;

  FOR line_row IN
    SELECT fl.id, fl.variant_id, fl.asset_id, fl.garment_guaranteed
      FROM fitting_line fl
     WHERE fl.tenant_id = p_tenant_id
       AND fl.fitting_id = p_fitting_id
       AND fl.removed_at IS NULL
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
