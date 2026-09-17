-- TBF-011 — global pre-tenant owner onboarding and manual payment evidence.
--
-- These records intentionally exist before a tenant. Owner access is scoped by the Clerk
-- principal in app.principal_id and is denied whenever a tenant context is present, so a
-- tenant-scoped repository cannot accidentally list or mutate pre-tenant state. Operator
-- access is a separate transaction context; the application operator allowlist is owned by
-- TBF-050, while this migration makes the database boundary explicit now.

-- Account records are global too. Add the same no-tenant-context guard so an ordinary
-- tenant-scoped query cannot reach an account row merely because it sets the same principal.
DROP POLICY account_principal_isolation ON account;
CREATE POLICY account_principal_isolation ON account
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
  );

CREATE TABLE organization_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id),
  clerk_org_id text NOT NULL,
  status text NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'abandoned', 'payment_pending', 'provisioned')),
  selected_plan_code text
    CHECK (selected_plan_code IS NULL OR selected_plan_code IN ('starter', 'professional', 'business')),
  provisioned_tenant_id uuid REFERENCES tenant (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_onboarding_clerk_org_key UNIQUE (clerk_org_id)
);

CREATE INDEX organization_onboarding_account_status_idx
  ON organization_onboarding (account_id, status);

CREATE UNIQUE INDEX organization_onboarding_one_active_per_account_key
  ON organization_onboarding (account_id)
  WHERE status IN ('incomplete', 'payment_pending');

CREATE TABLE onboarding_payment_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_onboarding_id uuid NOT NULL REFERENCES organization_onboarding (id),
  operator_subject text NOT NULL CHECK (char_length(operator_subject) BETWEEN 1 AND 200),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
  payment_reference text NOT NULL CHECK (char_length(payment_reference) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'verified' CHECK (status = 'verified'),
  business_key text NOT NULL CHECK (char_length(business_key) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_payment_verification_business_key UNIQUE (business_key)
);

-- Owner policy: an account may see only its own onboarding records and safe payment projections
-- through the repository. Operator transactions can reconcile pre-tenant records, but their
-- operator allowlist is an application concern owned by TBF-050.
ALTER TABLE organization_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_onboarding FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_onboarding_owner_access ON organization_onboarding
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = organization_onboarding.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = organization_onboarding.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

CREATE POLICY organization_onboarding_operator_read ON organization_onboarding
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'operator'
  );

-- PostgreSQL evaluates SELECT ... FOR UPDATE against an UPDATE policy rather than a SELECT
-- policy. Operators need to serialize payment evidence against a future activation transition,
-- but must not be able to update the onboarding row in this slice. The lock-only policy grants
-- row visibility for the lock and makes every attempted write fail its WITH CHECK expression.
CREATE POLICY organization_onboarding_operator_lock ON organization_onboarding
  FOR UPDATE TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'operator'
  )
  WITH CHECK (false);

ALTER TABLE onboarding_payment_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_payment_verification FORCE ROW LEVEL SECURITY;

CREATE POLICY onboarding_payment_owner_read ON onboarding_payment_verification
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
      FROM organization_onboarding
      JOIN account ON account.id = organization_onboarding.account_id
      WHERE organization_onboarding.id = onboarding_payment_verification.organization_onboarding_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

CREATE POLICY onboarding_payment_operator_access ON onboarding_payment_verification
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'operator'
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'operator'
    AND operator_subject = NULLIF(current_setting('app.principal_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM organization_onboarding
      WHERE organization_onboarding.id = onboarding_payment_verification.organization_onboarding_id
        AND organization_onboarding.status = 'payment_pending'
        AND organization_onboarding.provisioned_tenant_id IS NULL
    )
  );

GRANT SELECT, INSERT, UPDATE ON organization_onboarding TO drezivo_app;
GRANT SELECT, INSERT ON onboarding_payment_verification TO drezivo_app;

-- Payment verification is an immutable evidence record. Future corrections are new records or
-- audited activation decisions; the runtime role has no update/delete privilege.
REVOKE UPDATE, DELETE ON onboarding_payment_verification FROM drezivo_app;
