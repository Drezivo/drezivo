-- Invariant: the reservation state machine (Data-Model §6) only ever moves through a
-- conditional UPDATE guarded by both `status` and `version` — `reservation.version` is what
-- makes "approve/reject/expire the same hold concurrently" resolve to exactly one legal
-- outcome (TRD §5 adversarial test 2) instead of a last-write-wins race. The application never
-- performs a bare `UPDATE reservation SET status = ...`; every write goes through
-- `WHERE id = $1 AND status = $2 AND version = $3`.
--
-- Invariant: `custody_event` is append-only and lives OUTSIDE the asset_allocation exclusion
-- constraint on purpose — an actual late return must always be recordable even though it
-- overlaps a future planned block (Data-Model §5 "Actual truth"; TRD §5 adversarial test 5).
-- Its `business_key` unique constraint makes recording the same real-world event twice
-- (e.g. a double-tapped "confirm return" button) a no-op rather than a duplicate fact.
--
-- This file also creates the storefront/policy/payment-method tables the reservation table's
-- foreign keys require, since they have no earlier natural home in the fixed migration
-- sequence and reservation cannot be created without them existing first.

CREATE TABLE storefront (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'suspended')),
  branding jsonb NOT NULL DEFAULT '{}',
  contact jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Global uniqueness: the public route resolves a storefront by slug alone, with no tenant
  -- in the URL, so the slug namespace is shared across all tenants.
  CONSTRAINT storefront_slug_key UNIQUE (slug)
);
CREATE INDEX storefront_tenant_id_idx ON storefront (tenant_id);

CREATE TABLE policy_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  storefront_id uuid NOT NULL REFERENCES storefront (id),
  version integer NOT NULL,
  rental_rules jsonb NOT NULL,
  deposit_rules jsonb NOT NULL,
  cancellation_rules jsonb NOT NULL,
  delivery_rules jsonb NOT NULL,
  privacy_notice text NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_snapshot_storefront_version_key UNIQUE (storefront_id, version)
);

CREATE TABLE payment_method (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  rail text NOT NULL CHECK (rail IN ('cash', 'manual_qr', 'manual_transfer')),
  destination_snapshot jsonb NOT NULL,
  qr_file_id uuid REFERENCES file_object (id),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_method_tenant_active_idx ON payment_method (tenant_id) WHERE active;

CREATE TABLE customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  full_name text NOT NULL,
  email text,
  phone text,
  notes text,
  privacy_notice_version integer NOT NULL DEFAULT 1,
  anonymized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Guest checkout requires SOME usable contact, but not both — do not force a phone number
  -- on an email-only anonymous hold.
  CONSTRAINT customer_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL OR anonymized_at IS NOT NULL)
);
CREATE INDEX customer_tenant_id_idx ON customer (tenant_id);

CREATE TABLE reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  customer_id uuid REFERENCES customer (id), -- nullable: an anonymous short hold may lack a customer row.
  storefront_id uuid NOT NULL REFERENCES storefront (id),
  policy_snapshot_id uuid NOT NULL REFERENCES policy_snapshot (id),
  payment_method_id uuid NOT NULL REFERENCES payment_method (id),
  reference_code text NOT NULL,
  status text NOT NULL DEFAULT 'held' CHECK (
    status IN ('held', 'pending_confirmation', 'confirmed', 'picked_up', 'returned', 'completed', 'cancelled', 'expired', 'rejected')
  ),
  event_date timestamptz,
  pickup_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  timezone_snapshot text NOT NULL,
  customer_snapshot jsonb,
  delivery_snapshot jsonb,
  price_snapshot jsonb NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  rental_total_minor integer NOT NULL CHECK (rental_total_minor >= 0),
  security_required_minor integer NOT NULL DEFAULT 0 CHECK (security_required_minor >= 0),
  due_now_minor integer NOT NULL CHECK (due_now_minor >= 0),
  hold_acquired_at timestamptz NOT NULL DEFAULT now(),
  hold_expires_at timestamptz,
  terms_accepted_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_tenant_reference_key UNIQUE (tenant_id, reference_code),
  CONSTRAINT reservation_due_after_pickup CHECK (due_at > pickup_at)
);
CREATE INDEX reservation_tenant_status_idx ON reservation (tenant_id, status);
CREATE INDEX reservation_customer_id_idx ON reservation (customer_id) WHERE customer_id IS NOT NULL;
-- The hold-expirer worker's due-work query: "held reservations whose hold_expires_at has passed".
CREATE INDEX reservation_hold_expiry_idx ON reservation (hold_expires_at) WHERE status = 'held' AND hold_expires_at IS NOT NULL;

CREATE TABLE reservation_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  reservation_id uuid NOT NULL REFERENCES reservation (id),
  variant_id uuid NOT NULL REFERENCES product_variant (id),
  line_number integer NOT NULL DEFAULT 1,
  name_snapshot text NOT NULL,
  measurements_snapshot jsonb NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  rental_minor integer NOT NULL CHECK (rental_minor >= 0),
  deposit_minor integer NOT NULL DEFAULT 0 CHECK (deposit_minor >= 0),
  currency text NOT NULL DEFAULT 'PHP',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_line_reservation_number_key UNIQUE (reservation_id, line_number)
);
CREATE INDEX reservation_line_reservation_id_idx ON reservation_line (reservation_id);

-- Complete the forward reference declared in 0003: now that reservation_line exists, wire the
-- FK so asset_allocation.reservation_line_id is referentially enforced going forward.
ALTER TABLE asset_allocation
  ADD CONSTRAINT asset_allocation_reservation_line_fk
  FOREIGN KEY (reservation_line_id) REFERENCES reservation_line (id);

CREATE TABLE custody_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  asset_id uuid NOT NULL REFERENCES physical_asset (id),
  reservation_line_id uuid REFERENCES reservation_line (id),
  actor_membership_id uuid NOT NULL REFERENCES membership (id),
  event_kind text NOT NULL CHECK (event_kind IN ('pickup', 'return')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  condition_snapshot jsonb,
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custody_event_tenant_business_key_key UNIQUE (tenant_id, business_key)
);
CREATE INDEX custody_event_asset_id_idx ON custody_event (asset_id);
CREATE INDEX custody_event_reservation_line_id_idx ON custody_event (reservation_line_id) WHERE reservation_line_id IS NOT NULL;

CREATE TABLE disruption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  asset_id uuid NOT NULL REFERENCES physical_asset (id),
  reservation_line_id uuid NOT NULL REFERENCES reservation_line (id),
  cause_custody_event_id uuid REFERENCES custody_event (id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX disruption_open_idx ON disruption (tenant_id) WHERE status = 'open';

CREATE TABLE guest_access_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  reservation_id uuid NOT NULL REFERENCES reservation (id),
  token_hash text NOT NULL,
  scope_codes jsonb NOT NULL DEFAULT '[]',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Only the hash is ever stored (TRD §3): the raw bearer secret exists only in the one
  -- response that mints it and is never written to any table, including this one.
  CONSTRAINT guest_access_token_hash_key UNIQUE (token_hash)
);
CREATE INDEX guest_access_token_reservation_id_idx ON guest_access_token (reservation_id);
