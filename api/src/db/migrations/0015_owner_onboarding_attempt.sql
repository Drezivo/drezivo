-- Production hardening for TBF-021. This table is the durable single-flight record for the
-- external Clerk organization-create operation. A request with an unknown provider outcome is
-- left recoverable and is never automatically re-issued.
CREATE TABLE owner_onboarding_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id),
  idempotency_record_id uuid NOT NULL REFERENCES bootstrap_idempotency_record (id),
  attempt_id uuid NOT NULL UNIQUE,
  organization_name text NOT NULL
    CHECK (char_length(organization_name) BETWEEN 1 AND 160),
  requested_slug text
    CHECK (
      requested_slug IS NULL OR
      (char_length(requested_slug) BETWEEN 3 AND 100 AND
       requested_slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
    ),
  provider_org_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'provider_created', 'local_persisted', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX owner_onboarding_attempt_account_status_idx
  ON owner_onboarding_attempt (account_id, status);
CREATE INDEX owner_onboarding_attempt_idempotency_idx
  ON owner_onboarding_attempt (idempotency_record_id, created_at DESC);

ALTER TABLE owner_onboarding_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_onboarding_attempt FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_onboarding_attempt_account_access ON owner_onboarding_attempt
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'account'
    AND EXISTS (
      SELECT 1 FROM account
      WHERE account.id = owner_onboarding_attempt.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'account'
    AND EXISTS (
      SELECT 1 FROM account
      WHERE account.id = owner_onboarding_attempt.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

-- The signed Clerk repair consumer runs in the explicit system namespace. It may inspect and
-- complete only provider-attempt state; it cannot create tenant-side records in this slice.
CREATE POLICY owner_onboarding_attempt_system_access ON owner_onboarding_attempt
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  );

CREATE POLICY owner_onboarding_attempt_worker_read ON owner_onboarding_attempt
  FOR SELECT TO drezivo_worker
  USING (current_user = 'drezivo_worker');

CREATE POLICY owner_onboarding_attempt_worker_update ON owner_onboarding_attempt
  FOR UPDATE TO drezivo_worker
  USING (current_user = 'drezivo_worker')
  WITH CHECK (current_user = 'drezivo_worker');

CREATE POLICY account_webhook_repair_access ON account
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  );

CREATE POLICY account_webhook_repair_lock ON account
  FOR UPDATE TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  )
  WITH CHECK (false);

CREATE POLICY onboarding_webhook_repair_access ON organization_onboarding
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  );

GRANT SELECT, INSERT, UPDATE ON owner_onboarding_attempt TO drezivo_app;
REVOKE DELETE ON owner_onboarding_attempt FROM drezivo_app;
GRANT SELECT, UPDATE ON owner_onboarding_attempt TO drezivo_worker;
REVOKE INSERT, DELETE ON owner_onboarding_attempt FROM drezivo_worker;
