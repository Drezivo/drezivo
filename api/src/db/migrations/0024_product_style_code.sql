-- Clothing/style codes belong to the product identity, distinct from variant SKU and asset code.
-- Owners may supply a code during Add Clothing; the API generates one when omitted.
-- Existing rows are backfilled before the column becomes required.

ALTER TABLE product
  ADD COLUMN code text;

UPDATE product
   SET code = 'CG-' || upper(substr(replace(id::text, '-', ''), 1, 8))
 WHERE code IS NULL;

ALTER TABLE product
  ADD CONSTRAINT product_code_shape_check
  CHECK (
    code IS NULL OR (
      length(btrim(code)) BETWEEN 1 AND 80
      AND code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    )
  ) NOT VALID;

ALTER TABLE product VALIDATE CONSTRAINT product_code_shape_check;
ALTER TABLE product ALTER COLUMN code SET NOT NULL;

-- Codes are tenant-local and case-insensitively unique so GWN-01 and gwn-01
-- cannot refer to two different styles in the same workspace.
CREATE UNIQUE INDEX product_tenant_code_ci_key
  ON product (tenant_id, lower(code));
