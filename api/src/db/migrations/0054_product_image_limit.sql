-- Keep the catalogue photo set bounded at five images per product.
-- Existing oversized sets are intentionally preserved. Owners can replace them with five or fewer,
-- but direct inserts cannot grow an already oversized set.

CREATE FUNCTION product_image_max_five_guard() RETURNS trigger AS $$
DECLARE
  current_count integer;
BEGIN
  -- Lock the parent product so concurrent inserts for the same product serialize before counting.
  PERFORM 1
    FROM product
   WHERE id = NEW.product_id
     AND tenant_id = NEW.tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer
    INTO current_count
    FROM product_image
   WHERE product_id = NEW.product_id;

  IF current_count >= 5 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      CONSTRAINT = 'product_image_max_five_per_product',
      MESSAGE = 'A product cannot have more than five catalogue photos.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_image_max_five_guard_trigger
  BEFORE INSERT ON product_image
  FOR EACH ROW
  EXECUTE FUNCTION product_image_max_five_guard();
