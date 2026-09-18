-- TBF-042 — persist the provider membership correlation used by verified invitation claims.
-- The local membership remains authoritative for Drezivo access; this opaque provider ID is
-- only a recovery/correlation field and is never exposed in ordinary projections.

ALTER TABLE membership
  ADD COLUMN clerk_membership_id text;

CREATE UNIQUE INDEX membership_tenant_clerk_membership_key
  ON membership (tenant_id, clerk_membership_id)
  WHERE clerk_membership_id IS NOT NULL;
