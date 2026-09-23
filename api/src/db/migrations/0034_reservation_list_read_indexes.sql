-- RSV-010: indexes for deterministic reservation list sorting and tenant-scoped search.

CREATE INDEX reservation_tenant_created_idx
  ON reservation (tenant_id, created_at DESC, id DESC);

CREATE INDEX reservation_tenant_reference_sort_idx
  ON reservation (tenant_id, lower(reference_code), id);

CREATE INDEX reservation_tenant_staff_search_trgm_idx
  ON reservation USING gin (
    tenant_id,
    lower(
      reference_code || ' ' ||
      coalesce(customer_snapshot ->> 'full_name', '') || ' ' ||
      coalesce(customer_snapshot ->> 'phone', '') || ' ' ||
      coalesce(customer_snapshot ->> 'email', '')
    ) gin_trgm_ops
  );

CREATE INDEX reservation_line_tenant_name_search_trgm_idx
  ON reservation_line USING gin (tenant_id, lower(name_snapshot) gin_trgm_ops);
