-- Shared renter-facing payment guide. Individual payment methods keep account details, QR images,
-- and optional complete instructions files; the common steps live once at tenant level.

ALTER TABLE tenant_settings
  ADD COLUMN renter_steps_text text,
  ADD COLUMN renter_steps_file_id uuid,
  ADD COLUMN renter_steps_version integer NOT NULL DEFAULT 1;

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_renter_steps_version_positive CHECK (renter_steps_version > 0),
  ADD CONSTRAINT tenant_settings_renter_steps_text_length
    CHECK (renter_steps_text IS NULL OR char_length(btrim(renter_steps_text)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT tenant_settings_renter_steps_one_format
    CHECK (renter_steps_text IS NULL OR renter_steps_file_id IS NULL),
  ADD CONSTRAINT tenant_settings_renter_steps_file_same_tenant_fk
    FOREIGN KEY (tenant_id, renter_steps_file_id)
    REFERENCES file_object (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE reservation
  ADD COLUMN renter_steps_text_snapshot text,
  ADD COLUMN renter_steps_file_id_snapshot uuid,
  ADD COLUMN renter_steps_version_snapshot integer;

ALTER TABLE reservation
  ADD CONSTRAINT reservation_renter_steps_text_length
    CHECK (renter_steps_text_snapshot IS NULL OR char_length(btrim(renter_steps_text_snapshot)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT reservation_renter_steps_one_format
    CHECK (renter_steps_text_snapshot IS NULL OR renter_steps_file_id_snapshot IS NULL),
  ADD CONSTRAINT reservation_renter_steps_version_snapshot_positive
    CHECK (renter_steps_version_snapshot IS NULL OR renter_steps_version_snapshot > 0),
  ADD CONSTRAINT reservation_renter_steps_file_same_tenant_fk
    FOREIGN KEY (tenant_id, renter_steps_file_id_snapshot)
    REFERENCES file_object (tenant_id, id) ON DELETE RESTRICT;

INSERT INTO tenant_settings (tenant_id)
SELECT DISTINCT tenant_id
  FROM payment_method
ON CONFLICT (tenant_id) DO NOTHING;

-- Preserve what existing renters were shown by freezing the selected method's detail-mode steps
-- onto each historical reservation before future storefront reads switch to shared snapshots.
UPDATE reservation r
   SET renter_steps_text_snapshot = NULLIF(btrim(pm.destination_snapshot ->> 'instructions'), ''),
       renter_steps_file_id_snapshot = CASE
         WHEN pm.presentation = 'details'
          AND legacy_image.id IS NOT NULL
         THEN legacy_image.id
         ELSE NULL
       END
  FROM payment_method pm
  LEFT JOIN file_object legacy_image
    ON legacy_image.tenant_id = pm.tenant_id
   AND legacy_image.id = pm.material_file_id
   AND legacy_image.purpose = 'payment_method_material'
   AND legacy_image.lifecycle_status = 'accepted'
   AND legacy_image.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
   AND legacy_image.byte_size BETWEEN 1 AND 10485760
 WHERE r.tenant_id = pm.tenant_id
   AND r.payment_method_id = pm.id
   AND pm.presentation = 'details'
   AND r.status IN ('held', 'pending_confirmation')
   AND (NULLIF(btrim(pm.destination_snapshot ->> 'instructions'), '') IS NULL OR legacy_image.id IS NULL)
   AND (
     NULLIF(btrim(pm.destination_snapshot ->> 'instructions'), '') IS NOT NULL
     OR legacy_image.id IS NOT NULL
   );

-- Consolidate only when every non-empty, valid legacy value agrees in both content and format.
-- Different text/image values remain on their original methods for the read-only conflict review.
WITH legacy_values AS (
  SELECT pm.tenant_id,
         'text'::text AS value_kind,
         NULLIF(btrim(pm.destination_snapshot ->> 'instructions'), '') AS text_value,
         NULL::uuid AS file_id,
         'text:' || NULLIF(btrim(pm.destination_snapshot ->> 'instructions'), '') AS fingerprint
    FROM payment_method pm
   WHERE pm.presentation = 'details'
     AND NULLIF(btrim(pm.destination_snapshot ->> 'instructions'), '') IS NOT NULL
  UNION ALL
  SELECT pm.tenant_id,
         'image'::text,
         NULL::text,
         fo.id,
         'image:' || COALESCE(fo.sha256, 'file:' || fo.id::text)
    FROM payment_method pm
    JOIN file_object fo
      ON fo.tenant_id = pm.tenant_id AND fo.id = pm.material_file_id
   WHERE pm.presentation = 'details'
     AND fo.purpose = 'payment_method_material'
     AND fo.lifecycle_status = 'accepted'
     AND fo.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
     AND fo.byte_size BETWEEN 1 AND 10485760
),
tenant_values AS (
  SELECT tenant_id,
         count(DISTINCT fingerprint) AS distinct_values,
         (array_agg(text_value ORDER BY text_value) FILTER (WHERE value_kind = 'text'))[1] AS text_value,
         (array_agg(file_id ORDER BY file_id) FILTER (WHERE value_kind = 'image'))[1] AS file_id
    FROM legacy_values
   GROUP BY tenant_id
  HAVING count(DISTINCT fingerprint) = 1
)
UPDATE tenant_settings ts
   SET renter_steps_text = tv.text_value,
       renter_steps_file_id = tv.file_id,
       renter_steps_version = renter_steps_version + 1,
       updated_at = statement_timestamp()
  FROM tenant_values tv
 WHERE ts.tenant_id = tv.tenant_id
   AND (tv.text_value IS NOT NULL OR tv.file_id IS NOT NULL);

-- Keep this worker-only security-definer reference check aware of both the shared live setting
-- and immutable reservation snapshots, so cleanup cannot remove a file still in use.
CREATE OR REPLACE FUNCTION public.file_object_has_references(p_tenant_id uuid, p_file_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'File reference check tenant context mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.file_object
     WHERE tenant_id = p_tenant_id AND id = p_file_id
  ) THEN
    RAISE EXCEPTION 'File reference check target is unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN
    EXISTS (SELECT 1 FROM public.product_image WHERE file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.measurement_guide WHERE file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.payment_method WHERE qr_file_id = p_file_id OR material_file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.tenant_settings WHERE tenant_id = p_tenant_id AND renter_steps_file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.reservation WHERE tenant_id = p_tenant_id AND renter_steps_file_id_snapshot = p_file_id)
    OR EXISTS (SELECT 1 FROM public.payment_receipt WHERE file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.subscription_payment WHERE proof_file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.import_job WHERE file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.export_job WHERE result_file_id = p_file_id)
    OR EXISTS (
      SELECT 1 FROM public.storefront
       WHERE branding ->> 'logo_file_id' = p_file_id::text
          OR branding ->> 'cover_file_id' = p_file_id::text
          OR content -> 'hero' ->> 'image_file_id' = p_file_id::text
          OR content -> 'about' ->> 'image_file_id' = p_file_id::text
    )
    OR EXISTS (
      SELECT 1 FROM public.policy_snapshot
       WHERE COALESCE(rental_rules -> 'image_file_ids', '[]'::jsonb) ? p_file_id::text
    );
END;
$$;

REVOKE ALL ON FUNCTION public.file_object_has_references(uuid, uuid) FROM PUBLIC, drezivo_app;
GRANT EXECUTE ON FUNCTION public.file_object_has_references(uuid, uuid) TO drezivo_worker;
