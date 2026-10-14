-- All public-media cache entries include a tenant tag. These triggers enqueue one purge per
-- tenant/transaction whenever published visibility, file acceptance, or online storefront access
-- can change. The database change and purge request commit atomically.
CREATE FUNCTION enqueue_storefront_media_cache_invalidation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_tenant_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_tenant_id := OLD.tenant_id;
  ELSE
    affected_tenant_id := NEW.tenant_id;
  END IF;

  INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
  VALUES (
    affected_tenant_id,
    'storefront-media-cache:' || txid_current()::text,
    'media.cache.invalidate_requested',
    '{}'::jsonb
  )
  ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_storefront_media_cache_invalidation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER storefront_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF status, branch_id, slug, branding, content ON storefront
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER policy_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF storefront_id, version, rental_rules, effective_at ON policy_snapshot
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER product_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF category_id, status ON product
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER category_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF status ON category
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER variant_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF product_id, measurement_guide_id, status ON product_variant
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER product_image_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF product_id, file_id ON product_image
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER guide_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF file_id, status ON measurement_guide
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER payment_method_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF active, storefront_enabled, rail, presentation, qr_file_id, material_file_id, destination_snapshot ON payment_method
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER file_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF purpose, storage_key, version_id, sha256, mime_type, byte_size, lifecycle_status, frozen_at ON file_object
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER subscription_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF status, trial_ends_at, current_period_start, current_period_end, grace_ends_at ON subscription
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER subscription_payment_media_cache_invalidation
  AFTER INSERT OR DELETE OR UPDATE OF status ON subscription_payment
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
