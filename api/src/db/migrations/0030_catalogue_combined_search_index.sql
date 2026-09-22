-- CLT-061: use one tenant-aware normalized contains-search expression for Clothing name/code.
-- A single composite GIN lets PostgreSQL combine tenant isolation and trigram selectivity without
-- paying for a BitmapOr across separate name/code indexes.
DROP INDEX IF EXISTS product_tenant_name_trgm_idx;
DROP INDEX IF EXISTS product_tenant_code_trgm_idx;

CREATE INDEX product_tenant_search_trgm_idx
  ON product USING gin (tenant_id, lower(name || ' ' || code) gin_trgm_ops);
