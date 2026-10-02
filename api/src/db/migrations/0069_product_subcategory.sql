ALTER TABLE product
  ADD COLUMN subcategory text;

ALTER TABLE product
  ADD CONSTRAINT product_subcategory_length_check
  CHECK (subcategory IS NULL OR length(btrim(subcategory)) BETWEEN 1 AND 120);

CREATE INDEX product_tenant_public_subcategory_idx
  ON product (tenant_id, lower(btrim(subcategory)))
  WHERE status = 'active' AND subcategory IS NOT NULL;
