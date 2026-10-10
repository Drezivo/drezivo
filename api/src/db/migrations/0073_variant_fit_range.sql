-- Keep sizing details on the variant as well as the reservation line snapshot.
-- Existing measurement JSON (including legacy Hips keys) is deliberately unchanged.
ALTER TABLE product_variant
  ADD COLUMN fit_range text,
  ADD CONSTRAINT product_variant_fit_range_check
    CHECK (fit_range IS NULL OR (size_label IS NULL AND length(btrim(fit_range)) BETWEEN 1 AND 120));

-- Preserve historical Hips values even if a variant switches from custom measurements to a
-- reusable guide or no-measurements mode. New API writes still require empty maps for those modes.
CREATE FUNCTION public.is_legacy_hips_only_measurement_map(measurements jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(measurements) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(measurements) AS entry(key)
      WHERE lower(regexp_replace(btrim(key), '[_[:space:]]+', ' ', 'g')) <> 'hips'
    )
  END
$$;

ALTER TABLE product_variant
  DROP CONSTRAINT product_variant_measurement_source_check,
  ADD CONSTRAINT product_variant_measurement_source_check CHECK (
    (
      measurement_mode = 'default_guide'
      AND measurement_guide_id IS NOT NULL
      AND (measurements = '{}'::jsonb OR public.is_legacy_hips_only_measurement_map(measurements))
    )
    OR (measurement_mode = 'custom' AND measurement_guide_id IS NULL)
    OR (
      measurement_mode = 'none'
      AND measurement_guide_id IS NULL
      AND (measurements = '{}'::jsonb OR public.is_legacy_hips_only_measurement_map(measurements))
    )
  );

ALTER TABLE reservation_line
  ADD COLUMN fit_range_snapshot text,
  ADD COLUMN measurement_unit_snapshot text,
  ADD CONSTRAINT reservation_line_fit_range_snapshot_check
    CHECK (fit_range_snapshot IS NULL OR length(btrim(fit_range_snapshot)) BETWEEN 1 AND 120),
  ADD CONSTRAINT reservation_line_measurement_unit_snapshot_check
    CHECK (measurement_unit_snapshot IS NULL OR measurement_unit_snapshot IN ('cm', 'in'));
