-- Reusable measurement guides and explicit variant measurement source.
--
-- A shop may use one size/measurement chart across most of its catalogue. The guide image is a
-- tenant-owned reusable resource; variants reference the exact guide they were created with instead
-- of duplicating one image per size/product. Structured per-variant measurements remain available
-- for exceptions. Existing variants are backfilled conservatively: nonempty JSON becomes `custom`,
-- empty JSON becomes `none`.

ALTER TABLE file_object DROP CONSTRAINT IF EXISTS file_object_purpose_check;
ALTER TABLE file_object
  ADD CONSTRAINT file_object_purpose_check
  CHECK (purpose IN (
    'catalogue_image',
    'measurement_guide',
    'payment_receipt',
    'verification_document',
    'storefront_asset',
    'export_result'
  ));

ALTER TABLE file_object
  ADD CONSTRAINT file_object_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE measurement_guide (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  file_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT measurement_guide_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT measurement_guide_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT measurement_guide_file_fk
    FOREIGN KEY (tenant_id, file_id)
    REFERENCES file_object (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX measurement_guide_one_active_default_idx
  ON measurement_guide (tenant_id)
  WHERE is_default AND status = 'active';
CREATE INDEX measurement_guide_tenant_status_idx
  ON measurement_guide (tenant_id, status, created_at DESC);

ALTER TABLE product_variant
  ADD COLUMN measurement_mode text,
  ADD COLUMN measurement_guide_id uuid;

UPDATE product_variant
SET measurement_mode = CASE
  WHEN measurements = '{}'::jsonb THEN 'none'
  ELSE 'custom'
END
WHERE measurement_mode IS NULL;

ALTER TABLE product_variant
  ALTER COLUMN measurement_mode SET DEFAULT 'none',
  ALTER COLUMN measurement_mode SET NOT NULL,
  ADD CONSTRAINT product_variant_measurement_mode_check
    CHECK (measurement_mode IN ('default_guide', 'custom', 'none')),
  ADD CONSTRAINT product_variant_measurement_source_check CHECK (
    (measurement_mode = 'default_guide' AND measurement_guide_id IS NOT NULL AND measurements = '{}'::jsonb)
    OR (measurement_mode = 'custom' AND measurement_guide_id IS NULL)
    OR (measurement_mode = 'none' AND measurement_guide_id IS NULL AND measurements = '{}'::jsonb)
  ),
  ADD CONSTRAINT product_variant_measurement_guide_fk
    FOREIGN KEY (tenant_id, measurement_guide_id)
    REFERENCES measurement_guide (tenant_id, id)
    ON DELETE RESTRICT;

CREATE INDEX product_variant_measurement_guide_idx
  ON product_variant (tenant_id, measurement_guide_id)
  WHERE measurement_guide_id IS NOT NULL;

-- This table is created after the original RLS migration, so it must receive the same fail-closed
-- tenant policy and runtime grants explicitly here.
ALTER TABLE measurement_guide ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_guide FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON measurement_guide
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON measurement_guide TO drezivo_app, drezivo_worker;
