-- Customer operational archive lifecycle and read-path indexes.
--
-- `archived_at` is deliberately separate from `anonymized_at`: archive is a reversible
-- operational exclusion from new work, while anonymization remains the privacy/deletion lifecycle.
-- `updated_at` is the optimistic-concurrency token used by customer Edit/Archive commands.
ALTER TABLE customer
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Stable keyset order for the directory. The general index supports Active/Archived/All reads;
-- the smaller partial index optimizes the default active-only directory path.
CREATE INDEX customer_tenant_name_sort_idx
  ON customer (tenant_id, lower(full_name), id)
  WHERE anonymized_at IS NULL;

CREATE INDEX customer_tenant_active_name_sort_idx
  ON customer (tenant_id, lower(full_name), id)
  WHERE anonymized_at IS NULL AND archived_at IS NULL;

-- Search is intentionally limited to name, phone, and email. pg_trgm + btree_gin are installed
-- by earlier migrations and let the tenant key and approved fuzzy-search document share one index.
CREATE INDEX customer_tenant_staff_search_trgm_idx
  ON customer USING gin (
    tenant_id,
    lower(
      full_name || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(email, '')
    ) gin_trgm_ops
  )
  WHERE anonymized_at IS NULL;

-- Reassert the existing defense-in-depth boundary after changing the tenant-owned table.
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer FORCE ROW LEVEL SECURITY;
