-- Catalogue backup ZIPs are private files. Import jobs must remember the branch of the
-- uploaded bundle, and expired/finished jobs must stop pinning their archive forever.
ALTER TABLE file_object DROP CONSTRAINT IF EXISTS file_object_purpose_check;
ALTER TABLE file_object
  ADD CONSTRAINT file_object_purpose_check
  CHECK (purpose IN (
    'catalogue_image',
    'measurement_guide',
    'payment_receipt',
    'verification_document',
    'storefront_asset',
    'export_result',
    'subscription_payment_proof',
    'payment_method_material',
    'catalogue_backup'
  ));

ALTER TABLE import_job ADD COLUMN branch_id uuid;
ALTER TABLE import_job ADD COLUMN updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE export_job ADD COLUMN updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE import_job
  ADD CONSTRAINT import_job_branch_same_tenant_fk
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branch (tenant_id, id);
CREATE INDEX import_job_tenant_branch_status_created_idx
  ON import_job (tenant_id, branch_id, status, created_at);
CREATE INDEX export_job_branch_completed_idx
  ON export_job (tenant_id, (scope_snapshot ->> 'branch_id'), completed_at DESC)
  WHERE status = 'completed';
ALTER TABLE export_job DROP CONSTRAINT IF EXISTS export_job_status_check;
ALTER TABLE export_job
  ADD CONSTRAINT export_job_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'));

-- Active import previews pin their uploaded archive for 24 hours. Export files are pinned only
-- until expires_at. All durable business references above remain unchanged.
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
    OR EXISTS (SELECT 1 FROM public.payment_receipt WHERE tenant_id = p_tenant_id AND file_id = p_file_id)
    OR EXISTS (SELECT 1 FROM public.subscription_payment WHERE tenant_id = p_tenant_id AND proof_file_id = p_file_id)
    OR EXISTS (
      SELECT 1 FROM public.import_job
       WHERE tenant_id = p_tenant_id AND file_id = p_file_id AND status = 'previewed'
         AND created_at > statement_timestamp() - interval '24 hours'
    )
    OR EXISTS (
      SELECT 1 FROM public.export_job
       WHERE tenant_id = p_tenant_id AND result_file_id = p_file_id AND status = 'completed'
         AND expires_at > statement_timestamp()
    )
    OR EXISTS (
      SELECT 1 FROM public.storefront
       WHERE tenant_id = p_tenant_id AND (
         branding ->> 'logo_file_id' = p_file_id::text
         OR branding ->> 'cover_file_id' = p_file_id::text
         OR content -> 'hero' ->> 'image_file_id' = p_file_id::text
         OR content -> 'about' ->> 'image_file_id' = p_file_id::text
       )
    )
    OR EXISTS (
      SELECT 1 FROM public.policy_snapshot
       WHERE tenant_id = p_tenant_id
         AND COALESCE(rental_rules -> 'image_file_ids', '[]'::jsonb) ? p_file_id::text
    );
END;
$$;

REVOKE ALL ON FUNCTION public.file_object_has_references(uuid, uuid) FROM PUBLIC, drezivo_app;
GRANT EXECUTE ON FUNCTION public.file_object_has_references(uuid, uuid) TO drezivo_worker;
