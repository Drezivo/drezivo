-- Invariant: `charge`, `payment_allocation`, and `deposit_entry` are APPEND-ONLY postings
-- (Data-Model §7). The database — not application discipline — enforces this: 0008's RLS/grant
-- setup revokes UPDATE and DELETE on these three tables from the runtime application role, so
-- even a bug in a service method cannot silently mutate a posted financial fact. A correction
-- is always a new row with `reverses_id` pointing at the original.
--
-- Invariant: every financial command carries a permanent `(tenant_id, business_key)` unique
-- key that outlives the idempotency-record retention window (TRD §4/§6) — an HTTP idempotency
-- record may expire after ~7 days, but "did this exact refund already happen" must remain
-- answerable indefinitely, because a merchant reconciling books six months later still needs
-- that guarantee.
--
-- Invariant: the balance formula U = P − A − H − R (Data-Model §7) is NOT a row-level CHECK —
-- it is an aggregate across many rows, which a CHECK constraint cannot see. It is instead
-- enforced by application code that locks the payment row (`SELECT ... FOR UPDATE`) before
-- summing existing postings and inserting a new one, inside one transaction — see
-- reservations/reservations.repository.ts's posting helpers for the pattern this finance
-- module's own repository re-uses. The per-row CHECKs below catch malformed amounts; they
-- cannot catch an over-refund, which is a cross-row concern.

CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  reservation_id uuid REFERENCES reservation (id),
  payment_method_id uuid NOT NULL REFERENCES payment_method (id),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'PHP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'voided')),
  merchant_reference text,
  verified_at timestamptz,
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_tenant_business_key_key UNIQUE (tenant_id, business_key),
  -- Once verified, amount/currency/reference are conceptually frozen; the application layer
  -- never issues an UPDATE to those columns after verified_at is set (enforced by the finance
  -- repository, not a trigger, since "which columns changed" is awkward to express in SQL and
  -- the append-only postings below are the tables that actually need database-level immutability).
  CONSTRAINT payment_verified_has_timestamp CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);
CREATE INDEX payment_reservation_id_idx ON payment (reservation_id) WHERE reservation_id IS NOT NULL;
-- Merchant reference uniqueness is scoped to (tenant, payment_method) per Data-Model §12, not global.
CREATE UNIQUE INDEX payment_tenant_method_reference_key ON payment (tenant_id, payment_method_id, merchant_reference) WHERE merchant_reference IS NOT NULL;

CREATE TABLE payment_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  payment_id uuid NOT NULL REFERENCES payment (id),
  file_id uuid NOT NULL REFERENCES file_object (id),
  evidence_status text NOT NULL DEFAULT 'submitted' CHECK (evidence_status IN ('submitted', 'accepted', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_receipt_payment_id_idx ON payment_receipt (payment_id);

CREATE TABLE payment_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  payment_id uuid NOT NULL REFERENCES payment (id),
  verifier_membership_id uuid NOT NULL REFERENCES membership (id),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  verified_amount_minor integer CHECK (verified_amount_minor IS NULL OR verified_amount_minor > 0),
  evidence_note text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  business_key text NOT NULL,
  CONSTRAINT payment_verification_tenant_business_key_key UNIQUE (tenant_id, business_key)
);
CREATE INDEX payment_verification_payment_id_idx ON payment_verification (payment_id);

CREATE TABLE charge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  reservation_id uuid REFERENCES reservation (id),
  kind text NOT NULL CHECK (kind IN ('rental', 'delivery', 'late_fee', 'damage_fee', 'credit')),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'PHP',
  reverses_id uuid REFERENCES charge (id),
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charge_tenant_business_key_key UNIQUE (tenant_id, business_key)
);
CREATE INDEX charge_reservation_id_idx ON charge (reservation_id) WHERE reservation_id IS NOT NULL;

CREATE TABLE payment_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  payment_id uuid NOT NULL REFERENCES payment (id),
  charge_id uuid NOT NULL REFERENCES charge (id),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  direction text NOT NULL CHECK (direction IN ('apply', 'reverse')),
  reverses_id uuid REFERENCES payment_allocation (id),
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocation_tenant_business_key_key UNIQUE (tenant_id, business_key),
  CONSTRAINT payment_allocation_reverse_has_target CHECK (direction <> 'reverse' OR reverses_id IS NOT NULL)
);
CREATE INDEX payment_allocation_payment_id_idx ON payment_allocation (payment_id);
CREATE INDEX payment_allocation_charge_id_idx ON payment_allocation (charge_id);

CREATE TABLE refund (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  payment_id uuid NOT NULL REFERENCES payment (id),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'PHP',
  purpose text NOT NULL CHECK (purpose IN ('rental', 'security_deposit')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'failed', 'cancelled')),
  merchant_reference text,
  requested_by uuid NOT NULL REFERENCES membership (id),
  completed_at timestamptz,
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_tenant_business_key_key UNIQUE (tenant_id, business_key),
  CONSTRAINT refund_completed_has_timestamp CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX refund_payment_id_idx ON refund (payment_id);
-- The refund-exception/reconciliation worker's due-work query.
CREATE INDEX refund_pending_idx ON refund (tenant_id) WHERE status IN ('requested', 'processing');

CREATE TABLE deposit_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  reservation_id uuid NOT NULL REFERENCES reservation (id),
  payment_id uuid NOT NULL REFERENCES payment (id),
  charge_id uuid REFERENCES charge (id),
  refund_id uuid REFERENCES refund (id),
  kind text NOT NULL CHECK (kind IN ('receive', 'apply', 'release', 'reverse')),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'PHP',
  reverses_id uuid REFERENCES deposit_entry (id),
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposit_entry_tenant_business_key_key UNIQUE (tenant_id, business_key),
  -- `apply` pairs with a charge; `release` pairs with a refund instruction — Data-Model §7.
  CONSTRAINT deposit_entry_apply_has_charge CHECK (kind <> 'apply' OR charge_id IS NOT NULL),
  CONSTRAINT deposit_entry_release_has_refund CHECK (kind <> 'release' OR refund_id IS NOT NULL)
);
CREATE INDEX deposit_entry_reservation_id_idx ON deposit_entry (reservation_id);
CREATE INDEX deposit_entry_payment_id_idx ON deposit_entry (payment_id);
