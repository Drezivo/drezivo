-- FIT-BE-025 — fitting operational indexes and migration-readiness notes.
--
-- These indexes cover the approved BE-3/BE-8 read shapes without duplicating the correctness
-- indexes already created by exclusion constraints. All objects below are on V1.1 fitting tables
-- that are not yet serving production routes, so ordinary transactional CREATE INDEX is deliberate:
-- it takes the normal table/index build locks but avoids introducing a non-transactional migration
-- step. If this migration ever has to be replayed after fitting traffic exists, rehearse it on an
-- isolated production-like branch and consider a roll-forward replacement using CREATE INDEX
-- CONCURRENTLY outside the transaction-wrapped migration runner.
--
-- The canonical asset allocation table is intentionally untouched here. Its existing
-- `asset_allocation_no_overlap`, GiST period index, and fitting-line partial uniqueness already
-- arbitrate guaranteed-garment contention, so BE-025 does not add a redundant index to that hot V1
-- table.

-- Calendar/window reads: one tenant + branch and a bounded overlap period.
CREATE INDEX fitting_appointment_tenant_branch_period_gist_idx
  ON fitting_appointment USING gist (tenant_id, branch_id, period);

-- Deterministic upcoming/past list pagination by appointment start + id.
CREATE INDEX fitting_appointment_tenant_branch_start_id_idx
  ON fitting_appointment (tenant_id, branch_id, lower(period), id);

-- Status-filtered operational queues (pending/confirmed/action-required views).
CREATE INDEX fitting_appointment_tenant_branch_status_start_id_idx
  ON fitting_appointment (tenant_id, branch_id, status, lower(period), id);

-- Customer detail/history projection; the same index can scan forward or backward as needed.
CREATE INDEX fitting_appointment_tenant_branch_customer_start_id_idx
  ON fitting_appointment (tenant_id, branch_id, customer_id, lower(period), id);

-- Detail projection and variant-based operational/availability joins.
CREATE INDEX fitting_line_tenant_fitting_id_idx
  ON fitting_line (tenant_id, fitting_id, id);

CREATE INDEX fitting_line_tenant_variant_fitting_idx
  ON fitting_line (tenant_id, variant_id, fitting_id);

-- Supports active-guarantee checks when an asset is moved or its variant changes.
CREATE INDEX fitting_line_tenant_guaranteed_asset_idx
  ON fitting_line (tenant_id, asset_id, fitting_id)
  WHERE garment_guaranteed AND asset_id IS NOT NULL;

-- Hidden capacity allocator candidate lookup. Slot overlap itself remains protected by the GiST
-- exclusion constraint from 0043, which is authoritative under races.
CREATE INDEX fitting_capacity_slot_active_lookup_idx
  ON fitting_capacity_slot (tenant_id, branch_id, slot_number, id)
  WHERE active;

-- Retained released-claim history by fitting. The one-current-blocking partial unique index from
-- 0043 already handles the current claim lookup.
CREATE INDEX fitting_slot_allocation_tenant_fitting_history_idx
  ON fitting_slot_allocation (tenant_id, fitting_id, created_at DESC, id DESC);

-- Ordered settings projection for the seven-day weekly schedule.
CREATE INDEX fitting_hours_tenant_branch_weekday_start_idx
  ON fitting_hours (tenant_id, branch_id, weekday, starts_local, id);

-- Closure conflict checks and ordered closure management reads.
CREATE INDEX fitting_closure_tenant_branch_period_gist_idx
  ON fitting_closure USING gist (tenant_id, branch_id, period);

CREATE INDEX fitting_closure_tenant_branch_start_id_idx
  ON fitting_closure (tenant_id, branch_id, lower(period), id);
