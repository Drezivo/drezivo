-- FIT-BE-023 — branch fitting schedule/settings persistence integrity.
--
-- 0041 introduced the fitting settings/hours/closure tables and 0042/0043 hardened core
-- appointment/allocation correctness. This migration owns the schedule-configuration shape:
-- one branch-scoped scalar settings row, ISO weekdays with split local windows, non-overlapping
-- weekly windows, date-specific closures tied to the branch timezone, and safe hidden-slot
-- configuration bounds. Command authorization/versioning and future-appointment change guards are
-- implemented in BE-6; this migration makes malformed stored configuration impossible first.

-- Fitting fee currency is server-owned and follows the tenant's configured currency. A branch has
-- its own timezone, but currency remains tenant-wide in V1/V1.1.
CREATE FUNCTION fitting_settings_currency_guard() RETURNS trigger AS $$
DECLARE
  tenant_currency text;
BEGIN
  SELECT t.currency
    INTO tenant_currency
    FROM tenant t
   WHERE t.id = NEW.tenant_id;

  IF tenant_currency IS NOT NULL AND NEW.currency IS DISTINCT FROM tenant_currency THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_settings_currency_match',
      MESSAGE = 'fitting settings currency must match the tenant currency';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fitting_settings_currency_guard_trigger
  BEFORE INSERT OR UPDATE OF tenant_id, currency ON fitting_settings
  FOR EACH ROW EXECUTE FUNCTION fitting_settings_currency_guard();

-- Weekday storage uses ISO numbering: Monday=1 through Sunday=7. Windows are local wall-clock
-- intervals interpreted in branch.timezone. Multiple windows on one day are allowed; their gaps
-- are the recurring-break model. Seconds are rejected because the public contract is HH:mm.
ALTER TABLE fitting_hours
  ADD CONSTRAINT fitting_hours_weekday_bounds
    CHECK (weekday BETWEEN 1 AND 7) NOT VALID,
  ADD CONSTRAINT fitting_hours_window_order
    CHECK (starts_local < ends_local) NOT VALID,
  ADD CONSTRAINT fitting_hours_minute_precision
    CHECK (
      extract(second FROM starts_local) = 0
      AND extract(second FROM ends_local) = 0
      AND extract(hour FROM starts_local) BETWEEN 0 AND 23
      AND extract(hour FROM ends_local) BETWEEN 0 AND 23
    ) NOT VALID;

ALTER TABLE fitting_hours VALIDATE CONSTRAINT fitting_hours_weekday_bounds;
ALTER TABLE fitting_hours VALIDATE CONSTRAINT fitting_hours_window_order;
ALTER TABLE fitting_hours VALIDATE CONSTRAINT fitting_hours_minute_precision;

-- btree_gist is installed by the base extensions migration. Convert each local window to a
-- minute-of-day int4range solely for exclusion purposes. Half-open [) semantics allow adjacent
-- windows such as 09:00-12:00 and 12:00-13:00 while rejecting true overlap.
ALTER TABLE fitting_hours
  ADD CONSTRAINT fitting_hours_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    branch_id WITH =,
    weekday WITH =,
    (
      int4range(
        (extract(hour FROM starts_local)::integer * 60) + extract(minute FROM starts_local)::integer,
        (extract(hour FROM ends_local)::integer * 60) + extract(minute FROM ends_local)::integer,
        '[)'
      )
    ) WITH &&
  );

-- Keep the persisted safety bound aligned with the BE-1 contract. The mutation service performs a
-- full seven-day replacement; days with no rows are unavailable days. This trigger prevents direct
-- SQL from exceeding the technical eight-window/day bound, including concurrent writers.
CREATE FUNCTION fitting_hours_window_count_guard() RETURNS trigger AS $$
DECLARE
  target_tenant uuid;
  target_branch uuid;
  target_weekday integer;
  window_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_branch := OLD.branch_id;
    target_weekday := OLD.weekday;
  ELSE
    target_tenant := NEW.tenant_id;
    target_branch := NEW.branch_id;
    target_weekday := NEW.weekday;
  END IF;

  -- Serialize schedule-configuration writers on the branch fitting settings row.
  PERFORM 1
    FROM fitting_settings fs
   WHERE fs.tenant_id = target_tenant AND fs.branch_id = target_branch
   FOR UPDATE;

  SELECT count(*)::integer
    INTO window_count
    FROM fitting_hours fh
   WHERE fh.tenant_id = target_tenant
     AND fh.branch_id = target_branch
     AND fh.weekday = target_weekday;

  IF window_count > 8 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_hours_windows_per_day_max',
      MESSAGE = 'a fitting schedule may contain at most eight windows per weekday';
  END IF;

  -- If an UPDATE moved a row between groups, also validate the old group. This branch is mostly
  -- defensive because BE-6 replaces windows instead of re-parenting them.
  IF TG_OP = 'UPDATE'
     AND (OLD.tenant_id, OLD.branch_id, OLD.weekday)
         IS DISTINCT FROM (NEW.tenant_id, NEW.branch_id, NEW.weekday)
  THEN
    PERFORM 1
      FROM fitting_settings fs
     WHERE fs.tenant_id = OLD.tenant_id AND fs.branch_id = OLD.branch_id
     FOR UPDATE;

    SELECT count(*)::integer
      INTO window_count
      FROM fitting_hours fh
     WHERE fh.tenant_id = OLD.tenant_id
       AND fh.branch_id = OLD.branch_id
       AND fh.weekday = OLD.weekday;

    IF window_count > 8 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'fitting_hours_windows_per_day_max',
        MESSAGE = 'a fitting schedule may contain at most eight windows per weekday';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_hours_window_count_guard_trigger
  AFTER INSERT OR UPDATE OR DELETE ON fitting_hours
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_hours_window_count_guard();

-- Date-specific closures store real instants plus the timezone used to interpret the operator's
-- local date/time input. New/edited closure snapshots must equal the current branch timezone.
ALTER TABLE fitting_closure
  ADD CONSTRAINT fitting_closure_timezone_not_blank
    CHECK (length(btrim(timezone_snapshot)) BETWEEN 1 AND 64) NOT VALID;
ALTER TABLE fitting_closure VALIDATE CONSTRAINT fitting_closure_timezone_not_blank;

CREATE FUNCTION fitting_closure_timezone_guard() RETURNS trigger AS $$
DECLARE
  branch_timezone text;
BEGIN
  SELECT b.timezone
    INTO branch_timezone
    FROM branch b
   WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.branch_id;

  IF branch_timezone IS NOT NULL AND NEW.timezone_snapshot IS DISTINCT FROM branch_timezone THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_closure_timezone_match',
      MESSAGE = 'fitting closure timezone snapshot must match the branch timezone';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fitting_closure_timezone_guard_trigger
  BEFORE INSERT OR UPDATE OF tenant_id, branch_id, period, timezone_snapshot ON fitting_closure
  FOR EACH ROW EXECUTE FUNCTION fitting_closure_timezone_guard();

-- Hidden slots are numbered implementation capacity. Direct SQL must never make more active slots
-- usable than the branch setting permits, and an active slot number cannot exceed configured N.
-- Under-capacity intermediate states remain possible so BE-6 can expand a setting and materialize
-- new slots in the same or a following transaction without a fragile count-before-insert rule.
CREATE FUNCTION fitting_capacity_configuration_guard() RETURNS trigger AS $$
DECLARE
  target_tenant uuid;
  target_branch uuid;
  configured_capacity integer;
  active_count integer;
  max_active_slot integer;
BEGIN
  IF TG_TABLE_NAME = 'fitting_settings' THEN
    target_tenant := NEW.tenant_id;
    target_branch := NEW.branch_id;
    configured_capacity := NEW.capacity;
  ELSE
    IF TG_OP = 'DELETE' THEN
      target_tenant := OLD.tenant_id;
      target_branch := OLD.branch_id;
    ELSE
      target_tenant := NEW.tenant_id;
      target_branch := NEW.branch_id;
    END IF;

    SELECT fs.capacity
      INTO configured_capacity
      FROM fitting_settings fs
     WHERE fs.tenant_id = target_tenant AND fs.branch_id = target_branch
     FOR UPDATE;
  END IF;

  IF configured_capacity IS NULL THEN
    -- fitting_capacity_slot has a branch FK, but a branch without fitting_settings is not a valid
    -- active fitting-capacity source.
    IF TG_TABLE_NAME = 'fitting_capacity_slot'
       AND TG_OP <> 'DELETE'
       AND NEW.active
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'fitting_capacity_slot_requires_settings',
        MESSAGE = 'an active fitting capacity slot requires branch fitting settings';
    END IF;
    RETURN NULL;
  END IF;

  SELECT count(*)::integer, max(slot_number)
    INTO active_count, max_active_slot
    FROM fitting_capacity_slot fcs
   WHERE fcs.tenant_id = target_tenant
     AND fcs.branch_id = target_branch
     AND fcs.active;

  IF active_count > configured_capacity
     OR COALESCE(max_active_slot, 0) > configured_capacity
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'fitting_capacity_slots_within_setting',
      MESSAGE = 'active fitting capacity slots cannot exceed configured branch capacity';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fitting_capacity_settings_guard_trigger
  AFTER INSERT OR UPDATE OF tenant_id, branch_id, capacity ON fitting_settings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_capacity_configuration_guard();

CREATE CONSTRAINT TRIGGER fitting_capacity_slot_settings_guard_trigger
  AFTER INSERT OR UPDATE OR DELETE ON fitting_capacity_slot
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitting_capacity_configuration_guard();
