-- FIT-BE-020 — V1.1 fitting persistence expansion.
--
-- This migration introduces only the approved persistence graph and the release-boundary links
-- into canonical availability/finance tables. The follow-up BE-2 migrations add the deeper
-- state/range/guarantee checks, slot exclusion, schedule integrity, RLS/runtime grants, and
-- operational indexes before any fitting route is enabled. Keeping those concerns explicit makes
-- this an expand step rather than silently treating table creation as production certification.
--
-- The product does not expose rooms, assigned staff, named fitting resources, or user-visible
-- capacity slots. `fitting_capacity_slot` is an internal concurrency primitive only.

CREATE TABLE fitting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  enabled boolean NOT NULL,
  capacity integer NOT NULL,
  duration_minutes integer NOT NULL,
  fee_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_settings_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_settings_tenant_branch_key UNIQUE (tenant_id, branch_id),
  CONSTRAINT fitting_settings_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE fitting_appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  booking_channel varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  period tstzrange NOT NULL,
  timezone_snapshot varchar(64) NOT NULL,
  currency char(3) NOT NULL,
  fee_minor bigint NOT NULL,
  internal_note text,
  terminal_reason text,
  business_key varchar(160) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_appointment_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_appointment_tenant_business_key_key UNIQUE (tenant_id, business_key),
  CONSTRAINT fitting_appointment_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fitting_appointment_customer_same_tenant_fk
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customer (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE fitting_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  fitting_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  asset_id uuid,
  garment_guaranteed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_line_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_line_fitting_same_tenant_fk
    FOREIGN KEY (tenant_id, fitting_id)
    REFERENCES fitting_appointment (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fitting_line_variant_same_tenant_fk
    FOREIGN KEY (tenant_id, variant_id)
    REFERENCES product_variant (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fitting_line_asset_same_tenant_fk
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES physical_asset (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE fitting_capacity_slot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  slot_number integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_capacity_slot_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_capacity_slot_tenant_branch_number_key UNIQUE (tenant_id, branch_id, slot_number),
  CONSTRAINT fitting_capacity_slot_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE fitting_slot_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL,
  fitting_id uuid NOT NULL,
  period tstzrange NOT NULL,
  is_blocking boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_slot_allocation_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_slot_allocation_tenant_fitting_key UNIQUE (tenant_id, fitting_id),
  CONSTRAINT fitting_slot_allocation_slot_same_tenant_fk
    FOREIGN KEY (tenant_id, slot_id)
    REFERENCES fitting_capacity_slot (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fitting_slot_allocation_fitting_same_tenant_fk
    FOREIGN KEY (tenant_id, fitting_id)
    REFERENCES fitting_appointment (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE fitting_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  weekday integer NOT NULL,
  starts_local time NOT NULL,
  ends_local time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_hours_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_hours_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE fitting_closure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  period tstzrange NOT NULL,
  timezone_snapshot varchar(64) NOT NULL,
  reason varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitting_closure_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT fitting_closure_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
);

-- V1 reserved the fitting source column on the canonical physical-asset allocation table. Now
-- that `fitting_line` exists, activate its tenant-paired FK instead of introducing a second
-- garment-unavailability table.
ALTER TABLE asset_allocation
  ADD CONSTRAINT asset_allocation_fitting_line_same_tenant_fk
    FOREIGN KEY (tenant_id, fitting_line_id)
    REFERENCES fitting_line (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE asset_allocation
  VALIDATE CONSTRAINT asset_allocation_fitting_line_same_tenant_fk;

-- Finance remains one shared domain. Fittings link into the existing payment/charge graph; they do
-- not get a duplicate fitting-specific payment-status table. Source-exclusivity and cross-row
-- currency/amount invariants are tightened in the next integrity migration.
ALTER TABLE payment
  ADD COLUMN fitting_id uuid;

ALTER TABLE payment
  ADD CONSTRAINT payment_fitting_same_tenant_fk
    FOREIGN KEY (tenant_id, fitting_id)
    REFERENCES fitting_appointment (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE payment VALIDATE CONSTRAINT payment_fitting_same_tenant_fk;

ALTER TABLE charge
  ADD COLUMN fitting_id uuid;

ALTER TABLE charge
  DROP CONSTRAINT IF EXISTS charge_kind_check,
  ADD CONSTRAINT charge_kind_check
    CHECK (kind IN ('rental', 'delivery', 'late_fee', 'damage_fee', 'fitting_fee', 'credit'))
    NOT VALID,
  ADD CONSTRAINT charge_fitting_same_tenant_fk
    FOREIGN KEY (tenant_id, fitting_id)
    REFERENCES fitting_appointment (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE charge VALIDATE CONSTRAINT charge_kind_check;
ALTER TABLE charge VALIDATE CONSTRAINT charge_fitting_same_tenant_fk;

-- Lightweight FK-supporting indexes for the newly activated extension links. BE-025 still owns
-- list/calendar/filter and overlap-read index design after the repository access patterns exist.
CREATE INDEX asset_allocation_fitting_line_id_idx
  ON asset_allocation (tenant_id, fitting_line_id)
  WHERE fitting_line_id IS NOT NULL;

CREATE INDEX payment_fitting_id_idx
  ON payment (tenant_id, fitting_id)
  WHERE fitting_id IS NOT NULL;

CREATE INDEX charge_fitting_id_idx
  ON charge (tenant_id, fitting_id)
  WHERE fitting_id IS NOT NULL;
