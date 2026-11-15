-- Coalesce repeated edits by tenant/minute. The cache's 60-second lifetime and live visibility
-- checks bound stale content even when a later edit shares an already-processed purge event.
CREATE OR REPLACE FUNCTION enqueue_storefront_media_cache_invalidation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_tenant_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN affected_tenant_id := OLD.tenant_id;
  ELSE affected_tenant_id := NEW.tenant_id;
  END IF;

  INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
  VALUES (
    affected_tenant_id,
    'storefront-cache-minute:' || floor(extract(epoch FROM statement_timestamp()) / 60)::bigint::text,
    'media.cache.invalidate_requested',
    '{}'::jsonb
  )
  ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_public_content_cache_invalidation
  AFTER UPDATE OF name, description, subcategory ON product
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER category_public_content_cache_invalidation
  AFTER UPDATE OF name, display_order ON category
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER variant_public_content_cache_invalidation
  AFTER UPDATE OF size_label, color_label, measurements, fit_range, measurement_unit, measurement_mode,
    rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes, extra_day_price_minor
  ON product_variant FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER product_image_order_cache_invalidation
  AFTER UPDATE OF display_order ON product_image
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER storefront_public_content_cache_invalidation
  AFTER UPDATE OF contact, checkout ON storefront
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
CREATE TRIGGER policy_public_content_cache_invalidation
  AFTER UPDATE OF deposit_rules, cancellation_rules, delivery_rules, privacy_notice ON policy_snapshot
  FOR EACH ROW EXECUTE FUNCTION enqueue_storefront_media_cache_invalidation();
