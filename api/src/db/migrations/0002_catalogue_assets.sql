-- Invariant: three distinct identities — product (style), product_variant (size/color SKU),
-- physical_asset (one serialized garment) — per Data-Model §5. There is deliberately no
-- quantity/stock column anywhere in this file: "a mutable clothing status or quantity is not
-- the source of future booking availability" (Data-Model §1). The only thing that can make a
-- physical_asset unavailable for a period is a row in asset_allocation (0003) — an application
-- bug that decrements some imaginary stock counter instead cannot desynchronize from reality,
-- because that counter does not exist.
--
-- Invariant: `physical_asset.version` backs an optimistic-concurrency conditional UPDATE for
-- readiness/custody changes (same pattern as reservation.version in 0004) — required because
-- two staff actions (e.g. "mark ready" racing "start cleaning") must not silently clobber each
-- other; the DB enforces "you were editing a stale row" instead of last-write-wins.

CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX category_tenant_id_idx ON category (tenant_id);

CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  category_id uuid REFERENCES category (id),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_tenant_status_idx ON product (tenant_id, status);

CREATE TABLE product_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  product_id uuid NOT NULL REFERENCES product (id),
  sku text NOT NULL,
  size_label text NOT NULL,
  color_label text NOT NULL,
  measurements jsonb NOT NULL DEFAULT '{}',
  measurement_unit text NOT NULL DEFAULT 'cm' CHECK (measurement_unit IN ('cm', 'in')),
  rental_price_minor integer NOT NULL CHECK (rental_price_minor >= 0),
  security_deposit_minor integer NOT NULL DEFAULT 0 CHECK (security_deposit_minor >= 0),
  currency text NOT NULL DEFAULT 'PHP',
  pricing_mode text NOT NULL DEFAULT 'fixed_duration' CHECK (pricing_mode IN ('fixed_duration', 'daily')),
  included_duration_minutes integer NOT NULL CHECK (included_duration_minutes > 0),
  extra_day_price_minor integer NOT NULL DEFAULT 0 CHECK (extra_day_price_minor >= 0),
  prep_minutes integer NOT NULL DEFAULT 0 CHECK (prep_minutes >= 0),
  turnaround_minutes integer NOT NULL DEFAULT 0 CHECK (turnaround_minutes >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variant_tenant_sku_key UNIQUE (tenant_id, sku)
);
CREATE INDEX product_variant_product_id_idx ON product_variant (product_id);
CREATE INDEX product_variant_tenant_status_idx ON product_variant (tenant_id, status);

CREATE TABLE physical_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  variant_id uuid NOT NULL REFERENCES product_variant (id),
  asset_code text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'retired', 'lost')),
  readiness text NOT NULL DEFAULT 'ready' CHECK (readiness IN ('ready', 'needs_cleaning', 'needs_repair', 'unready')),
  custody_kind text NOT NULL DEFAULT 'at_branch' CHECK (custody_kind IN ('at_branch', 'with_customer', 'in_transit')),
  condition_note text,
  measurement_overrides jsonb,
  alteration_note text,
  location_id uuid, -- V2 (transfers/location); column reserved now, populated and FK'd in its release migration.
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT physical_asset_tenant_code_key UNIQUE (tenant_id, asset_code)
);
CREATE INDEX physical_asset_variant_id_idx ON physical_asset (variant_id);
CREATE INDEX physical_asset_branch_id_idx ON physical_asset (branch_id);
-- Selectivity for the hold transaction's candidate-asset query: "ready assets of variant X at
-- branch Y", filtered before the exclusion-constraint check even runs (TRD §5 step 2).
CREATE INDEX physical_asset_variant_readiness_idx ON physical_asset (variant_id, readiness) WHERE lifecycle_status = 'active';

CREATE TABLE file_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  purpose text NOT NULL CHECK (purpose IN ('catalogue_image', 'payment_receipt', 'verification_document', 'storefront_asset', 'export_result')),
  storage_key text NOT NULL,
  version_id text,
  sha256 text,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  lifecycle_status text NOT NULL DEFAULT 'pending_upload' CHECK (lifecycle_status IN ('pending_upload', 'uploaded', 'scanning', 'accepted', 'rejected', 'deleted')),
  is_private boolean NOT NULL DEFAULT true,
  upload_expires_at timestamptz NOT NULL,
  frozen_at timestamptz,
  retention_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Evidence is not "accepted" without frozen bytes: an accepted file must have BOTH a frozen
  -- timestamp and at least one of version_id/sha256 pinning the exact accepted content
  -- (TRD §7 — a reused presigned URL must not be able to change already-approved evidence).
  CONSTRAINT file_object_accepted_is_frozen CHECK (
    lifecycle_status <> 'accepted' OR (frozen_at IS NOT NULL AND (version_id IS NOT NULL OR sha256 IS NOT NULL))
  )
);
CREATE INDEX file_object_tenant_id_idx ON file_object (tenant_id);

CREATE TABLE product_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  product_id uuid NOT NULL REFERENCES product (id),
  file_id uuid NOT NULL REFERENCES file_object (id),
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_image_product_order_key UNIQUE (product_id, display_order)
);
