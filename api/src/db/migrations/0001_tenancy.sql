-- Invariant: tenant isolation is the root of every other guarantee in this schema. Every
-- tenant-owned table below carries a `tenant_id` that other migrations' RLS policies (0008)
-- key off of. The application layer cannot be trusted alone to filter every query by tenant —
-- a single missed WHERE clause in one repository call is a cross-tenant data leak (TRD §3
-- adversarial test 7); RLS makes that failure mode structurally unavailable, not just unlikely.
--
-- Invariant: exactly one default branch per tenant. Modeled as a partial unique index rather
-- than a boolean-with-trigger because Postgres can enforce "at most one TRUE per tenant" with
-- an index alone — cheaper and impossible to race around with concurrent writers.

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'cancelled')),
  currency text NOT NULL DEFAULT 'PHP',
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_clerk_org_id_key UNIQUE (clerk_org_id),
  CONSTRAINT tenant_slug_key UNIQUE (slug)
);

CREATE TABLE branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  code text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  timezone text NOT NULL,
  address jsonb,
  operating_hours jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_tenant_code_key UNIQUE (tenant_id, code)
);

-- At most one default branch per tenant. A missing default is a service-layer invariant
-- enforced at tenant-provisioning time (create the default branch in the same transaction as
-- the tenant row), since "at least one" cannot be expressed as a single-table constraint.
CREATE UNIQUE INDEX branch_tenant_default_key ON branch (tenant_id) WHERE is_default;
CREATE INDEX branch_tenant_id_idx ON branch (tenant_id);

CREATE TABLE membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  clerk_user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'frontdesk')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  authz_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_tenant_clerk_user_key UNIQUE (tenant_id, clerk_user_id)
);
CREATE INDEX membership_tenant_id_idx ON membership (tenant_id);

CREATE TABLE branch_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  branch_id uuid NOT NULL REFERENCES branch (id),
  membership_id uuid NOT NULL REFERENCES membership (id),
  permission_codes jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_membership_branch_membership_key UNIQUE (branch_id, membership_id)
);
CREATE INDEX branch_membership_tenant_id_idx ON branch_membership (tenant_id);

-- Cross-tenant consistency: a branch_membership's branch and membership must belong to the
-- same tenant as the row itself. A same-tenant FK alone does not prove this (branch and
-- membership could each independently belong to tenant_id but to a DIFFERENT tenant from each
-- other, which a plain FK on branch_id/membership_id cannot rule out) — enforced with a
-- deferred trigger rather than a CHECK, since CHECK cannot reference other tables.
CREATE OR REPLACE FUNCTION assert_branch_membership_same_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM branch b, membership m
    WHERE b.id = NEW.branch_id AND m.id = NEW.membership_id
      AND b.tenant_id = NEW.tenant_id AND m.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'branch_membership: branch and membership must belong to the same tenant as this row';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER branch_membership_same_tenant
  AFTER INSERT OR UPDATE ON branch_membership
  FOR EACH ROW EXECUTE FUNCTION assert_branch_membership_same_tenant();
