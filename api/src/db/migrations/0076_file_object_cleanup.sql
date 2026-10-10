-- File replacement cleanup is asynchronous, so the database needs a barrier between a
-- committed replacement and physical object deletion. Attach paths lock accepted file rows;
-- the worker transitions the last-reference-free row to deletion_pending before deleting R2.

ALTER TABLE file_object
  DROP CONSTRAINT IF EXISTS file_object_lifecycle_status_check;

ALTER TABLE file_object
  ADD CONSTRAINT file_object_lifecycle_status_check
  CHECK (lifecycle_status IN (
    'pending_upload', 'uploaded', 'scanning', 'accepted', 'rejected',
    'deletion_pending', 'deleted'
  ));

CREATE OR REPLACE FUNCTION public.prevent_file_protection_mutation_during_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.lifecycle_status IN ('deletion_pending', 'deleted') THEN
    IF NEW.legal_hold THEN
      RAISE EXCEPTION 'A file under legal hold cannot enter cleanup.';
    END IF;
    IF NEW.retention_until > clock_timestamp() THEN
      RAISE EXCEPTION 'A retained file cannot enter cleanup before its retention period ends.';
    END IF;
  END IF;

  IF OLD.lifecycle_status IN ('deletion_pending', 'deleted')
     AND (NEW.legal_hold IS DISTINCT FROM OLD.legal_hold
       OR NEW.retention_until IS DISTINCT FROM OLD.retention_until) THEN
    RAISE EXCEPTION 'File protection settings cannot change after cleanup begins.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER file_object_protection_cleanup_guard
  BEFORE UPDATE OF lifecycle_status, legal_hold, retention_until ON file_object
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_file_protection_mutation_during_cleanup();

-- This narrowly scoped security-definer check is needed because legacy relational references
-- do not all have composite tenant/file foreign keys and JSON references have no FK at all.
-- It returns only a boolean, requires the active worker tenant to match the requested owner,
-- and fails closed if its owner cannot bypass forced RLS. RLS still protects every other worker
-- query. The function is owned by the migration role and executable only by drezivo_worker.
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
