-- Durable pre-tenant cleanup queue for Clerk organizations created by owner onboarding.
-- Abandonment and queue insertion happen in the same global transaction. The worker deletes
-- only organizations that are still provably unprovisioned; local onboarding/audit history is
-- retained even after the provider organization is removed.
CREATE TABLE clerk_organization_cleanup_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id uuid NOT NULL REFERENCES organization_onboarding (id),
  account_id uuid NOT NULL REFERENCES account (id),
  clerk_org_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'succeeded', 'dead')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  safe_last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clerk_organization_cleanup_job_onboarding_key UNIQUE (onboarding_id)
);

CREATE INDEX clerk_organization_cleanup_job_due_idx
  ON clerk_organization_cleanup_job (available_at)
  WHERE status IN ('pending', 'leased');

ALTER TABLE clerk_organization_cleanup_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE clerk_organization_cleanup_job FORCE ROW LEVEL SECURITY;

CREATE POLICY clerk_cleanup_account_access ON clerk_organization_cleanup_job
  FOR SELECT TO drezivo_app
  USING (
    EXISTS (
      SELECT 1 FROM account
      WHERE account.id = clerk_organization_cleanup_job.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

CREATE POLICY clerk_cleanup_account_insert ON clerk_organization_cleanup_job
  FOR INSERT TO drezivo_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account
      WHERE account.id = clerk_organization_cleanup_job.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

CREATE POLICY clerk_cleanup_worker_access ON clerk_organization_cleanup_job
  FOR ALL TO drezivo_worker
  USING (current_user = 'drezivo_worker')
  WITH CHECK (current_user = 'drezivo_worker');

-- The cleanup worker needs read-only access to the abandoned onboarding row for its destructive
-- safety check. This does not grant mutation or broaden the app role's owner isolation.
CREATE POLICY organization_onboarding_cleanup_worker_read ON organization_onboarding
  FOR SELECT TO drezivo_worker
  USING (current_user = 'drezivo_worker');

GRANT SELECT, INSERT ON clerk_organization_cleanup_job TO drezivo_app;
GRANT SELECT, UPDATE ON clerk_organization_cleanup_job TO drezivo_worker;
GRANT SELECT ON organization_onboarding TO drezivo_worker;
REVOKE DELETE ON clerk_organization_cleanup_job FROM drezivo_app, drezivo_worker;
