-- TBF-012 — bootstrap-safe idempotency and append-only global audit history.
--
-- These tables are deliberately separate from tenant idempotency/audit records. They exist
-- before a tenant and are visible only through an explicit global transaction context. Every
-- timestamp is database time so retries and concurrent claims do not depend on application
-- clocks.

CREATE TABLE bootstrap_idempotency_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id),
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 100),
  intent_key text NOT NULL CHECK (char_length(intent_key) BETWEEN 1 AND 255),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  response_code integer
    CHECK (response_code IS NULL OR response_code BETWEEN 100 AND 599),
  safe_response jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bootstrap_idempotency_record_scope_key
    UNIQUE (account_id, operation, intent_key),
  CONSTRAINT bootstrap_idempotency_record_terminal_fields
    CHECK (
      (status = 'in_progress' AND response_code IS NULL AND safe_response IS NULL)
      OR (status IN ('succeeded', 'failed') AND response_code IS NOT NULL AND safe_response IS NOT NULL)
    ),
  CONSTRAINT bootstrap_idempotency_record_safe_response_size
    CHECK (safe_response IS NULL OR pg_column_size(safe_response) <= 65536)
);

CREATE INDEX bootstrap_idempotency_record_expires_at_idx
  ON bootstrap_idempotency_record (expires_at);

CREATE TABLE global_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES account (id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('account', 'operator', 'system')),
  actor_key text NOT NULL CHECK (char_length(actor_key) BETWEEN 1 AND 200),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 100),
  entity_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'rejected', 'failed')),
  redacted_summary jsonb NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_audit_event_account_actor_key
    CHECK (actor_kind <> 'account' OR account_id IS NOT NULL),
  CONSTRAINT global_audit_event_summary_size
    CHECK (pg_column_size(redacted_summary) <= 65536)
);

CREATE INDEX global_audit_event_account_created_idx
  ON global_audit_event (account_id, created_at DESC);
CREATE INDEX global_audit_event_entity_created_idx
  ON global_audit_event (entity_type, entity_id, created_at DESC);

ALTER TABLE bootstrap_idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootstrap_idempotency_record FORCE ROW LEVEL SECURITY;

CREATE POLICY bootstrap_idempotency_account_access ON bootstrap_idempotency_record
  FOR ALL TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = bootstrap_idempotency_record.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = bootstrap_idempotency_record.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

ALTER TABLE global_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_audit_event FORCE ROW LEVEL SECURITY;

CREATE POLICY global_audit_event_account_read ON global_audit_event
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = global_audit_event.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

CREATE POLICY global_audit_event_account_insert ON global_audit_event
  FOR INSERT TO drezivo_app
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') = 'account'
    AND actor_kind = 'account'
    AND actor_key = NULLIF(current_setting('app.principal_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = global_audit_event.account_id
        AND account.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
    )
  );

-- Operator allowlisting is an application concern owned by TBF-050. Once a caller has selected
-- an explicit operator transaction context, the repository still requires an account/entity
-- filter for reads; this policy only establishes the database actor namespace.
CREATE POLICY global_audit_event_operator_system_read ON global_audit_event
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND NULLIF(current_setting('app.actor_kind', true), '') IN ('operator', 'system')
  );

CREATE POLICY global_audit_event_operator_system_insert ON global_audit_event
  FOR INSERT TO drezivo_app
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND actor_kind = NULLIF(current_setting('app.actor_kind', true), '')
    AND actor_kind IN ('operator', 'system')
    AND actor_key = NULLIF(current_setting('app.principal_id', true), '')
  );

GRANT SELECT, INSERT, UPDATE ON bootstrap_idempotency_record TO drezivo_app;
REVOKE DELETE ON bootstrap_idempotency_record FROM drezivo_app;

GRANT SELECT, INSERT ON global_audit_event TO drezivo_app;
REVOKE UPDATE, DELETE ON global_audit_event FROM drezivo_app;
