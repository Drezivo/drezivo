-- TBF-010 (TENANCY-ONBOARDING-V1-CHECKLIST.md) / Data-Model §4 entity dictionary:
-- `account` is the global, pre-tenant identity record. A verified Clerk person has exactly one
-- account; it is deliberately NOT a Clerk profile mirror — clerk_user_id is the only identity
-- field (no name, email, token, or session data), so nothing here needs erasure-sync when a
-- Clerk profile changes and nothing here can leak profile PII through a wrong projection.
--
-- Invariant: one lifetime trial and one CURRENT owned tenant per account. The current-owned
-- link is stored here, separately from membership history, because a person can be Front Desk
-- in many tenants while owning at most one — the account row is the single serialization point
-- that makes "one current owned tenant" race-proof (conditional updates under the row lock in
-- account.repository.ts). The UNIQUE on current_owned_tenant_id is the reverse guarantee: at
-- most one account may hold a given tenant as current — Postgres treats NULLs as distinct, so
-- any number of accounts may hold a free slot.
--
-- `account` is global rather than tenant-owned, but it is still private to the authenticated
-- Clerk subject. RLS uses the transaction-local principal established by withGlobalTransaction:
-- a pre-tenant flow cannot turn a known account UUID into another person's trial or ownership
-- mutation. FORCE is required because the migration role owns this table, while drezivo_app
-- must never bypass this boundary.

CREATE TABLE account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  trial_consumed_at timestamptz,
  current_owned_tenant_id uuid REFERENCES tenant (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_clerk_user_id_key UNIQUE (clerk_user_id),
  CONSTRAINT account_current_owned_tenant_id_key UNIQUE (current_owned_tenant_id)
);

ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;

CREATE POLICY account_principal_isolation ON account
  FOR ALL TO drezivo_app
  USING (clerk_user_id = NULLIF(current_setting('app.principal_id', true), ''))
  WITH CHECK (clerk_user_id = NULLIF(current_setting('app.principal_id', true), ''));

-- 0008's `ON ALL TABLES` grants only covered tables that existed when it ran, so new
-- migrations carry their own. Accounts are lifetime records: the app role never gets DELETE,
-- making "account rows are never deleted, only transitioned" a database-level fact rather
-- than a convention (closure releases the owned-tenant link; it does not remove the account).
GRANT SELECT, INSERT, UPDATE ON account TO drezivo_app;
