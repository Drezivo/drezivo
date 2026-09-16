-- Invariant: `asset_allocation` is the ONLY planned-unavailability table (Data-Model §5). The
-- GiST exclusion constraint below is what makes "claim this garment for this period" correct
-- under concurrency — the application layer cannot substitute a "SELECT ... FOR UPDATE then
-- INSERT if free" pattern for this, because that still races against a second transaction that
-- passed its own SELECT check a moment earlier (classic check-then-insert TOCTOU). The
-- constraint makes the conflicting INSERT itself fail, atomically, inside the same statement
-- that would otherwise double-book the garment (TRD §5, adversarial test 1).
--
-- Invariant: `is_blocking` is a stored, deterministic column — never `now() < period_end` — so
-- the exclusion predicate `WHERE (is_blocking)` is immutable and indexable. Held/pending/
-- confirmed/turnaround rows are blocking; cancelled/expired/released rows are not, and a
-- transition between those states is what flips this flag, transactionally, not the clock.
--
-- Invariant: at most one CURRENT blocking allocation per reservation line, enforced with a
-- partial unique index rather than relying on service-layer discipline, since a service bug
-- that inserts a second blocking row for the same line would otherwise silently double-hold
-- capacity for one line.

CREATE TABLE maintenance_work_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  asset_id uuid NOT NULL REFERENCES physical_asset (id),
  kind text NOT NULL CHECK (kind IN ('cleaning', 'repair', 'manual_block')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  reason text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX maintenance_work_order_asset_id_idx ON maintenance_work_order (asset_id);

CREATE TABLE asset_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  asset_id uuid NOT NULL REFERENCES physical_asset (id),
  -- Forward reference: reservation_line does not exist until 0004_reservations.sql runs.
  -- The column and its NOT-a-FK-yet shape are declared here (this is where asset_allocation
  -- itself belongs, next to its exclusion constraint); 0004 adds the FK constraint once its
  -- target table exists. This is the expand step of the expand/backfill/validate/switch/
  -- contract rule described in migrations/README.md, applied to migration ordering itself.
  reservation_line_id uuid,
  maintenance_id uuid REFERENCES maintenance_work_order (id),
  fitting_line_id uuid,   -- V1.1; no FK in V1 (table does not exist yet — see Data-Model §1 migration boundary).
  transfer_line_id uuid,  -- V2; no FK in V1, same reason.
  kind text NOT NULL CHECK (kind IN ('reservation_hold', 'reservation_confirmed', 'maintenance', 'fitting', 'transfer')),
  period tstzrange NOT NULL,
  is_blocking boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Exactly one source is non-null, and it must match `kind`.
  CONSTRAINT asset_allocation_one_source CHECK (
    (num_nonnulls(reservation_line_id, maintenance_id, fitting_line_id, transfer_line_id) = 1)
  ),
  CONSTRAINT asset_allocation_kind_matches_source CHECK (
    (kind = 'reservation_hold' AND reservation_line_id IS NOT NULL) OR
    (kind = 'reservation_confirmed' AND reservation_line_id IS NOT NULL) OR
    (kind = 'maintenance' AND maintenance_id IS NOT NULL) OR
    (kind = 'fitting' AND fitting_line_id IS NOT NULL) OR
    (kind = 'transfer' AND transfer_line_id IS NOT NULL)
  ),
  -- Nonempty, finite, half-open range only — an unbounded or empty period would either block
  -- forever or fail to block at all, silently defeating the exclusion constraint's purpose.
  CONSTRAINT asset_allocation_period_bounded CHECK (
    NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)
    AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL
  )
);

-- The core correctness guarantee: no two blocking allocations for the same asset in the same
-- tenant may occupy overlapping periods. btree_gist (0000) registers the equality operator
-- classes that let asset_id/tenant_id participate in this GiST index alongside the range.
ALTER TABLE asset_allocation
  ADD CONSTRAINT asset_allocation_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    asset_id WITH =,
    period WITH &&
  )
  WHERE (is_blocking);

-- At most one CURRENT blocking allocation per reservation line (Data-Model §5: "at most one
-- current blocking asset allocation per line is allowed" — historical substitutions may leave
-- several RELEASED allocations, which this partial index correctly ignores).
CREATE UNIQUE INDEX asset_allocation_one_blocking_per_line
  ON asset_allocation (tenant_id, reservation_line_id)
  WHERE is_blocking AND reservation_line_id IS NOT NULL;

CREATE INDEX asset_allocation_asset_id_idx ON asset_allocation (asset_id);
CREATE INDEX asset_allocation_reservation_line_id_idx ON asset_allocation (reservation_line_id) WHERE reservation_line_id IS NOT NULL;
-- GiST index for interval-overlap reads (e.g. "what's booked for asset X in this window") that
-- do not go through the exclusion constraint's own index — an ordinary B-tree on `period`
-- cannot answer a range-overlap predicate efficiently.
CREATE INDEX asset_allocation_period_gist_idx ON asset_allocation USING gist (asset_id, period);
