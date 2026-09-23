-- CLT-061: keyset-sort indexes for bounded staff catalogue reads at the V1 scale ceiling.
--
-- The Clothing list performs per-row lateral projections for variants, serialized assets, and
-- availability. Supplying the requested keyset order directly from an index lets PostgreSQL apply
-- LIMIT before doing that per-row work for the rest of the tenant catalogue.
--
-- ASC indexes also support the matching DESC order through a backward B-tree scan.

CREATE INDEX product_tenant_name_sort_idx
  ON product (tenant_id, lower(name), id);

CREATE INDEX product_tenant_code_sort_idx
  ON product (tenant_id, lower(code), id);

CREATE INDEX product_tenant_created_sort_idx
  ON product (tenant_id, created_at, id);
