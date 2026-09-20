-- CLT-002 — catalogue integrity and inventory read-path indexes.
--
-- This is intentionally forward-only. The original catalogue tables were introduced in 0002,
-- reusable measurement guides in 0023, and style codes in 0024. Do not rewrite those migrations:
-- this file tightens the live shape while preserving every existing identity and historical FK.
--
-- The composite (tenant_id, id) keys below let child rows prove that their referenced parent
-- belongs to the same tenant. RLS protects reads/writes by current tenant, but a same-tenant FK is
-- still required so an application bug cannot persist a child with tenant A and a parent from
-- tenant B while both UUIDs happen to be known inside a privileged migration/admin path.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE branch
  ADD CONSTRAINT branch_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE category
  ADD CONSTRAINT category_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE product
  ADD CONSTRAINT product_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE product_variant
  ADD CONSTRAINT product_variant_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE physical_asset
  ADD CONSTRAINT physical_asset_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE category
  ADD CONSTRAINT category_name_not_blank
    CHECK (length(btrim(name)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT category_display_order_nonnegative
    CHECK (display_order >= 0) NOT VALID;

ALTER TABLE product
  ADD CONSTRAINT product_name_not_blank
    CHECK (length(btrim(name)) BETWEEN 1 AND 200) NOT VALID;

ALTER TABLE product_variant
  ADD CONSTRAINT product_variant_sku_not_blank
    CHECK (length(btrim(sku)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT product_variant_size_not_blank
    CHECK (length(btrim(size_label)) BETWEEN 1 AND 40) NOT VALID,
  ADD CONSTRAINT product_variant_color_not_blank
    CHECK (length(btrim(color_label)) BETWEEN 1 AND 80) NOT VALID;

ALTER TABLE physical_asset
  ADD CONSTRAINT physical_asset_code_not_blank
    CHECK (length(btrim(asset_code)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT physical_asset_version_positive
    CHECK (version > 0) NOT VALID;

ALTER TABLE category VALIDATE CONSTRAINT category_name_not_blank;
ALTER TABLE category VALIDATE CONSTRAINT category_display_order_nonnegative;
ALTER TABLE product VALIDATE CONSTRAINT product_name_not_blank;
ALTER TABLE product_variant VALIDATE CONSTRAINT product_variant_sku_not_blank;
ALTER TABLE product_variant VALIDATE CONSTRAINT product_variant_size_not_blank;
ALTER TABLE product_variant VALIDATE CONSTRAINT product_variant_color_not_blank;
ALTER TABLE physical_asset VALIDATE CONSTRAINT physical_asset_code_not_blank;
ALTER TABLE physical_asset VALIDATE CONSTRAINT physical_asset_version_positive;

-- Tenant-local category naming is case-insensitive. btrim prevents visually duplicate names that
-- differ only by leading/trailing spaces from becoming separate filter values.
CREATE UNIQUE INDEX category_tenant_name_ci_key
  ON category (tenant_id, lower(btrim(name)));

-- Serialized identifiers are operational identifiers just like product codes. Avoid two garments
-- or SKUs that differ only by letter case inside the same tenant.
CREATE UNIQUE INDEX product_variant_tenant_sku_ci_key
  ON product_variant (tenant_id, lower(btrim(sku)));
CREATE UNIQUE INDEX physical_asset_tenant_code_ci_key
  ON physical_asset (tenant_id, lower(btrim(asset_code)));

-- Inventory list/search/filter paths used by the staff Clothing page. Product name/code search uses
-- trigram indexes so contains-search does not degrade to a full tenant catalogue scan as shops grow.
CREATE INDEX product_tenant_name_trgm_idx
  ON product USING gin (lower(name) gin_trgm_ops);
CREATE INDEX product_tenant_code_trgm_idx
  ON product USING gin (lower(code) gin_trgm_ops);
CREATE INDEX product_tenant_category_status_created_idx
  ON product (tenant_id, category_id, status, created_at DESC, id);
CREATE INDEX category_tenant_visible_order_idx
  ON category (tenant_id, visible, display_order, id);
CREATE INDEX product_variant_tenant_product_size_idx
  ON product_variant (tenant_id, product_id, lower(size_label), status, id);
CREATE INDEX physical_asset_tenant_variant_state_idx
  ON physical_asset (tenant_id, variant_id, lifecycle_status, readiness, id);

-- Same-tenant parent/child relationships. Existing simple UUID FKs remain valid and are retained;
-- these additional composite FKs close the tenant-consistency gap without destructive rewrites.
ALTER TABLE product
  ADD CONSTRAINT product_category_same_tenant_fk
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES category (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE product_variant
  ADD CONSTRAINT product_variant_product_same_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES product (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE physical_asset
  ADD CONSTRAINT physical_asset_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT physical_asset_variant_same_tenant_fk
    FOREIGN KEY (tenant_id, variant_id)
    REFERENCES product_variant (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE product_image
  ADD CONSTRAINT product_image_product_same_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES product (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT product_image_file_same_tenant_fk
    FOREIGN KEY (tenant_id, file_id)
    REFERENCES file_object (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE product VALIDATE CONSTRAINT product_category_same_tenant_fk;
ALTER TABLE product_variant VALIDATE CONSTRAINT product_variant_product_same_tenant_fk;
ALTER TABLE physical_asset VALIDATE CONSTRAINT physical_asset_branch_same_tenant_fk;
ALTER TABLE physical_asset VALIDATE CONSTRAINT physical_asset_variant_same_tenant_fk;
ALTER TABLE product_image VALIDATE CONSTRAINT product_image_product_same_tenant_fk;
ALTER TABLE product_image VALIDATE CONSTRAINT product_image_file_same_tenant_fk;

-- RLS was already enabled+forced for the original catalogue tables in 0008/0010 and for
-- measurement_guide in 0023. Reasserting these flags here is idempotent and protects this migration
-- from being applied to an environment whose earlier policy repair was interrupted.
ALTER TABLE category ENABLE ROW LEVEL SECURITY;
ALTER TABLE category FORCE ROW LEVEL SECURITY;
ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product FORCE ROW LEVEL SECURITY;
ALTER TABLE product_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant FORCE ROW LEVEL SECURITY;
ALTER TABLE physical_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE physical_asset FORCE ROW LEVEL SECURITY;
ALTER TABLE product_image ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_image FORCE ROW LEVEL SECURITY;
ALTER TABLE measurement_guide ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_guide FORCE ROW LEVEL SECURITY;
