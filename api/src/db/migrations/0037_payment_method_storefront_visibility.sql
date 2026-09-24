-- Payment methods are tenant-owned. `active` means staff may use the method for bookings;
-- `storefront_enabled` is an owner-controlled intent to expose a configured online method
-- publicly. Cash is never a storefront method.
ALTER TABLE payment_method
  ADD COLUMN storefront_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE payment_method
  ADD CONSTRAINT payment_method_cash_not_storefront
  CHECK (NOT storefront_enabled OR rail <> 'cash');

CREATE INDEX payment_method_tenant_storefront_enabled_idx
  ON payment_method (tenant_id)
  WHERE active = true AND storefront_enabled = true;

-- Existing workspaces receive the same safe defaults as newly bootstrapped workspaces.
-- Do not overwrite or duplicate an already configured method with the same display name.
INSERT INTO payment_method
  (id, tenant_id, name, rail, destination_snapshot, qr_file_id, active, storefront_enabled, version, created_at)
SELECT gen_random_uuid(), t.id, 'Cash', 'cash', '{}'::jsonb, NULL, true, false, 1, now()
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1
  FROM payment_method pm
  WHERE pm.tenant_id = t.id
    AND lower(pm.name) = 'cash'
);

INSERT INTO payment_method
  (id, tenant_id, name, rail, destination_snapshot, qr_file_id, active, storefront_enabled, version, created_at)
SELECT gen_random_uuid(), t.id, 'GCash', 'manual_qr', '{}'::jsonb, NULL, true, false, 1, now()
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1
  FROM payment_method pm
  WHERE pm.tenant_id = t.id
    AND lower(pm.name) = 'gcash'
);
