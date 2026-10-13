-- Authenticated account-level acceptance of the current Drezivo Terms of Service.
-- Each published version is a separate immutable fact; the runtime can only read/append.
CREATE TABLE account_terms_acceptance (
  account_id uuid NOT NULL REFERENCES account (id),
  terms_version text NOT NULL CHECK (terms_version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT account_terms_acceptance_account_version_key PRIMARY KEY (account_id, terms_version)
);

ALTER TABLE account_terms_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_terms_acceptance FORCE ROW LEVEL SECURITY;

CREATE POLICY account_terms_acceptance_principal_read ON account_terms_acceptance
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
    AND EXISTS (
      SELECT 1 FROM account
      WHERE account.id = account_terms_acceptance.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

CREATE POLICY account_terms_acceptance_principal_insert ON account_terms_acceptance
  FOR INSERT TO drezivo_app
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
    AND EXISTS (
      SELECT 1 FROM account
      WHERE account.id = account_terms_acceptance.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

GRANT SELECT, INSERT ON account_terms_acceptance TO drezivo_app;
REVOKE UPDATE, DELETE ON account_terms_acceptance FROM drezivo_app;
