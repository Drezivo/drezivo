-- Clothing color is optional metadata. Existing values are preserved; new variants may store NULL.
-- Keep the bounded/non-blank invariant whenever a color is present.

ALTER TABLE product_variant
  ALTER COLUMN color_label DROP NOT NULL;

ALTER TABLE product_variant
  DROP CONSTRAINT IF EXISTS product_variant_color_not_blank;

ALTER TABLE product_variant
  ADD CONSTRAINT product_variant_color_valid
    CHECK (color_label IS NULL OR length(btrim(color_label)) BETWEEN 1 AND 80) NOT VALID;

ALTER TABLE product_variant
  VALIDATE CONSTRAINT product_variant_color_valid;
