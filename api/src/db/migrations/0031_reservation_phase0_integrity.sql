-- RSV-002 — reservation integrity, same-tenant relationships, and staff read-path indexes.
--
-- Forward-only migration. Historical reservation/allocation migrations remain immutable.
-- The reservation API is still disabled in the current release, so normalizing event_date from
-- timestamptz to a date-only value is safe before production reservation writes are enabled.
-- Existing rows are interpreted in their stored booking timezone snapshot so a local event date
-- is preserved instead of being coerced through UTC.

ALTER TABLE customer
  ADD CONSTRAINT customer_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE storefront
  ADD CONSTRAINT storefront_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE policy_snapshot
  ADD CONSTRAINT policy_snapshot_tenant_id_id_key UNIQUE (tenant_id, id),
  ADD CONSTRAINT policy_snapshot_tenant_storefront_id_id_key UNIQUE (tenant_id, storefront_id, id);

ALTER TABLE payment_method
  ADD CONSTRAINT payment_method_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE reservation
  ADD CONSTRAINT reservation_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE reservation_line
  ADD CONSTRAINT reservation_line_tenant_id_id_key UNIQUE (tenant_id, id);

-- Canonical model/contract: event date is a calendar date, not a physical instant. Existing
-- values are converted in the timezone snapshot captured with the booking.
ALTER TABLE reservation
  ALTER COLUMN event_date TYPE date
  USING CASE
    WHEN event_date IS NULL THEN NULL
    ELSE (event_date AT TIME ZONE timezone_snapshot)::date
  END;

ALTER TABLE reservation
  ADD CONSTRAINT reservation_version_positive
    CHECK (version > 0) NOT VALID,
  ADD CONSTRAINT reservation_reference_not_blank
    CHECK (length(btrim(reference_code)) BETWEEN 1 AND 120) NOT VALID;

ALTER TABLE reservation VALIDATE CONSTRAINT reservation_version_positive;
ALTER TABLE reservation VALIDATE CONSTRAINT reservation_reference_not_blank;

-- RLS is a request-isolation boundary, but tenant-paired FKs prevent privileged/admin paths or
-- future bugs from persisting a reservation graph whose child tenant does not match its parent.
ALTER TABLE reservation
  ADD CONSTRAINT reservation_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT reservation_customer_same_tenant_fk
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customer (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT reservation_storefront_same_tenant_fk
    FOREIGN KEY (tenant_id, storefront_id)
    REFERENCES storefront (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT reservation_policy_same_tenant_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshot (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT reservation_policy_storefront_same_tenant_fk
    FOREIGN KEY (tenant_id, storefront_id, policy_snapshot_id)
    REFERENCES policy_snapshot (tenant_id, storefront_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT reservation_payment_method_same_tenant_fk
    FOREIGN KEY (tenant_id, payment_method_id)
    REFERENCES payment_method (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE reservation_line
  ADD CONSTRAINT reservation_line_reservation_same_tenant_fk
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES reservation (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT reservation_line_variant_same_tenant_fk
    FOREIGN KEY (tenant_id, variant_id)
    REFERENCES product_variant (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE reservation VALIDATE CONSTRAINT reservation_branch_same_tenant_fk;
ALTER TABLE reservation VALIDATE CONSTRAINT reservation_customer_same_tenant_fk;
ALTER TABLE reservation VALIDATE CONSTRAINT reservation_storefront_same_tenant_fk;
ALTER TABLE reservation VALIDATE CONSTRAINT reservation_policy_same_tenant_fk;
ALTER TABLE reservation VALIDATE CONSTRAINT reservation_policy_storefront_same_tenant_fk;
ALTER TABLE reservation VALIDATE CONSTRAINT reservation_payment_method_same_tenant_fk;
ALTER TABLE reservation_line VALIDATE CONSTRAINT reservation_line_reservation_same_tenant_fk;
ALTER TABLE reservation_line VALIDATE CONSTRAINT reservation_line_variant_same_tenant_fk;

-- Deterministic staff list and calendar/schedule projections. The tenant-leading keys keep each
-- query bounded to one business before status/date ordering is evaluated.
CREATE INDEX reservation_tenant_status_pickup_idx
  ON reservation (tenant_id, status, pickup_at DESC, id DESC);

CREATE INDEX reservation_tenant_pickup_idx
  ON reservation (tenant_id, pickup_at DESC, id DESC);

CREATE INDEX reservation_tenant_due_idx
  ON reservation (tenant_id, due_at DESC, id DESC);

CREATE INDEX reservation_tenant_event_date_idx
  ON reservation (tenant_id, event_date DESC, id DESC)
  WHERE event_date IS NOT NULL;

CREATE INDEX reservation_tenant_customer_created_idx
  ON reservation (tenant_id, customer_id, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;

-- Reassert the existing defense-in-depth boundary on every reservation-owned table touched by
-- this phase. These statements are idempotent and do not grant any new access.
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer FORCE ROW LEVEL SECURITY;
ALTER TABLE reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation FORCE ROW LEVEL SECURITY;
ALTER TABLE reservation_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_line FORCE ROW LEVEL SECURITY;
ALTER TABLE custody_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_event FORCE ROW LEVEL SECURITY;
ALTER TABLE disruption ENABLE ROW LEVEL SECURITY;
ALTER TABLE disruption FORCE ROW LEVEL SECURITY;
ALTER TABLE guest_access_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_access_token FORCE ROW LEVEL SECURITY;
