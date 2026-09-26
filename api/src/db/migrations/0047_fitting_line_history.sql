-- FIT-BE-044 — preserve fitting garment-plan history without exposing retired lines as current plan.
--
-- Garment-plan replacement must claim replacement guarantees before releasing the old plan, while
-- released allocations remain historical facts. A fitting line therefore needs a lightweight
-- retirement marker instead of hard deletion. Current read/claim invariants consider only rows
-- with removed_at IS NULL; historical lines retain their original variant/asset identity.

ALTER TABLE fitting_line
  ADD COLUMN removed_at timestamptz;

CREATE INDEX fitting_line_tenant_fitting_active_idx
  ON fitting_line (tenant_id, fitting_id, id)
  WHERE removed_at IS NULL;

-- Replace the BE-022 final-state validator so retired lines are excluded from the CURRENT garment
-- plan, but are forbidden from retaining a live physical-asset claim.
CREATE OR REPLACE FUNCTION fitting_assert_current_claims(p_tenant_id uuid, p_fitting_id uuid) RETURNS void AS $$
DECLARE
  appointment_row fitting_appointment%ROWTYPE;
  scheduled boolean;
  line_count integer;
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

  SELECT count(*)::integer
    INTO line_count
    FROM fitting_line
   WHERE tenant_id = p_tenant_id
     AND fitting_id = p_fitting_id
     AND removed_at IS NULL;

  IF line_count < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_claim_requires_line',
      MESSAGE = 'a fitting appointment must retain at least one active garment line';
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

-- Retired guaranteed lines are history only and must not prevent a later physical-asset move.
CREATE OR REPLACE FUNCTION fitting_active_asset_move_guard() RETURNS trigger AS $$
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
       AND fl.removed_at IS NULL
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
