-- Normal post-return cleaning is governed by the reservation Recovery allocation rather than
-- behaving like an indefinite readiness block. This flag records provenance only; timing remains
-- authoritative in asset_allocation.period.
ALTER TABLE physical_asset
  ADD COLUMN recovery_managed_readiness boolean NOT NULL DEFAULT false;

ALTER TABLE physical_asset
  ADD CONSTRAINT physical_asset_recovery_managed_readiness_check
  CHECK (
    recovery_managed_readiness = false
    OR (
      lifecycle_status = 'active'
      AND readiness = 'needs_cleaning'
      AND custody_kind = 'at_branch'
    )
  );
