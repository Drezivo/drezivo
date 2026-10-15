-- Accepted source images already in private R2 also need background derivatives. The original
-- remains authoritative; these durable jobs only write deterministic private WebP copies.
DO $$
DECLARE
  target_tenant_id uuid;
BEGIN
  -- file_object and outbox_event use FORCE ROW LEVEL SECURITY. Set tenant context for every
  -- iteration so the migration's all-tenant backfill still exercises the same tenant policy.
  FOR target_tenant_id IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.tenant_id', target_tenant_id::text, true);
    INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
    SELECT f.tenant_id,
           'file-image-variants:' || f.id::text,
           'file.image_variants.generate_requested',
           jsonb_build_object('file_id', f.id)
      FROM file_object f
     WHERE f.tenant_id = target_tenant_id
       AND f.lifecycle_status = 'accepted'
       AND f.frozen_at IS NOT NULL
       AND f.purpose IN (
         'catalogue_image', 'measurement_guide', 'storefront_asset', 'payment_method_material'
       )
       AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$$;
