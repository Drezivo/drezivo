-- Keep dashboard month-over-month aggregates bounded as reservation and customer history grows.
CREATE INDEX reservation_tenant_branch_completed_at_idx
  ON reservation (tenant_id, branch_id, completed_at)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

CREATE INDEX customer_tenant_active_created_idx
  ON customer (tenant_id, created_at)
  WHERE archived_at IS NULL AND anonymized_at IS NULL;
