-- Product sizing modes.
--
-- A product always keeps the product -> product_variant -> physical_asset graph.  A Free size
-- product is represented by one active variant whose size_label is NULL.  Sized products expose
-- only active variants with a non-null size_label.  Archived variants preserve an older mode so a
-- tenant can switch modes without deleting reservation, fitting, or asset history.

ALTER TABLE product
  ADD COLUMN sizing_mode text NOT NULL DEFAULT 'sized',
  ADD CONSTRAINT product_sizing_mode_check
    CHECK (sizing_mode IN ('free_size', 'sized'));

ALTER TABLE product_variant
  ALTER COLUMN size_label DROP NOT NULL;

CREATE INDEX product_tenant_sizing_mode_idx
  ON product (tenant_id, sizing_mode, id);

CREATE UNIQUE INDEX product_variant_one_free_size_key
  ON product_variant (tenant_id, product_id)
  WHERE size_label IS NULL;

CREATE OR REPLACE FUNCTION validate_product_sizing_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_product_id uuid;
  current_mode text;
  product_status text;
  active_variant_count integer;
  active_free_size_count integer;
BEGIN
  IF TG_TABLE_NAME = 'product' THEN
    target_product_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_product_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END;
  END IF;

  SELECT p.sizing_mode, p.status
    INTO current_mode, product_status
    FROM product p
   WHERE p.id = target_product_id;

  IF current_mode IS NULL OR product_status <> 'active' THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*) FILTER (WHERE pv.status = 'active'),
    count(*) FILTER (WHERE pv.status = 'active' AND pv.size_label IS NULL)
    INTO active_variant_count, active_free_size_count
    FROM product_variant pv
   WHERE pv.product_id = target_product_id;

  -- Keep legacy draft/import workflows that temporarily create an active product before its
  -- first variant. Once a product has active variants, the selected mode is strict.
  IF current_mode = 'free_size' AND active_variant_count > 0
     AND (active_variant_count <> 1 OR active_free_size_count <> 1) THEN
    RAISE EXCEPTION 'free_size product must have exactly one active null-size variant'
      USING ERRCODE = '23514';
  END IF;

  IF current_mode = 'sized' AND active_free_size_count <> 0 THEN
    RAISE EXCEPTION 'sized product cannot have an active Free size variant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER product_sizing_mode_integrity
AFTER INSERT OR UPDATE OF sizing_mode, status ON product
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_product_sizing_mode();

CREATE CONSTRAINT TRIGGER product_variant_sizing_mode_integrity
AFTER INSERT OR UPDATE OF product_id, size_label, status OR DELETE ON product_variant
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_product_sizing_mode();

COMMENT ON COLUMN product.sizing_mode IS
  'Current active variant configuration: free_size or sized. Archived variants may preserve a previous mode.';
COMMENT ON COLUMN product_variant.size_label IS
  'Real size label for sized variants; NULL is the canonical Free size representation.';
