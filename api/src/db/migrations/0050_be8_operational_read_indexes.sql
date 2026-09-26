-- FIT-BE-080/083 — bounded operational read indexes for Calendar and central Payments.
-- These are read accelerators only; reservation/fitting/payment source tables remain authoritative.

CREATE INDEX reservation_tenant_branch_pickup_calendar_idx
  ON reservation (tenant_id, branch_id, pickup_at, id)
  WHERE status IN ('pending_confirmation','confirmed','picked_up','returned','completed');

CREATE INDEX reservation_tenant_branch_due_calendar_idx
  ON reservation (tenant_id, branch_id, due_at, id)
  WHERE status IN ('pending_confirmation','confirmed','picked_up','returned','completed');

CREATE INDEX payment_tenant_created_read_idx
  ON payment (tenant_id, created_at DESC, id DESC);
