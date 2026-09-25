-- Backfill an effective internal reservation policy for workspaces created before bootstrap
-- seeded one. Staff reservations must retain an immutable policy reference for historical
-- accuracy, but they must not require merchants to configure or publish a public storefront.
--
-- A draft storefront row already exists for bootstrapped workspaces and acts only as the
-- existing policy-snapshot parent required by the V1 schema. If that storefront has no policy
-- effective at migration time, create a minimal default snapshot. Existing effective policies
-- are left untouched.
INSERT INTO policy_snapshot (
  tenant_id,
  storefront_id,
  version,
  rental_rules,
  deposit_rules,
  cancellation_rules,
  delivery_rules,
  privacy_notice,
  effective_at
)
SELECT
  sf.tenant_id,
  sf.id,
  COALESCE(MAX(existing.version), 0) + 1,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '',
  statement_timestamp()
FROM storefront sf
LEFT JOIN policy_snapshot existing
  ON existing.tenant_id = sf.tenant_id
 AND existing.storefront_id = sf.id
WHERE NOT EXISTS (
  SELECT 1
  FROM policy_snapshot effective
  WHERE effective.tenant_id = sf.tenant_id
    AND effective.storefront_id = sf.id
    AND effective.effective_at <= statement_timestamp()
)
GROUP BY sf.tenant_id, sf.id;
