-- TBF-022: keep provider webhook ingestion separate from webhook reconciliation.
-- The HTTP API only accepts an authenticated event and inserts it. It cannot read or mutate
-- provider event history. The dedicated worker owns inbox reads and status transitions.

-- `webhook_inbox` predates the Clerk intake route and did not retain the event family. Keep the
-- column nullable for any legacy rows, but constrain every newly ingested event to the canonical
-- contract allowlist; the repository always supplies a non-null value for new rows.
ALTER TABLE webhook_inbox
  ADD COLUMN event_type text;

ALTER TABLE webhook_inbox
  ADD CONSTRAINT webhook_inbox_event_type_check CHECK (
    event_type IS NULL OR event_type IN (
      'organization.created',
      'organization.updated',
      'organization.deleted',
      'organization_invitation.created',
      'organization_invitation.accepted',
      'organization_invitation.revoked',
      'organization_membership.created',
      'organization_membership.updated',
      'organization_membership.deleted'
    )
  );

REVOKE SELECT, UPDATE, DELETE ON webhook_inbox FROM drezivo_app;
GRANT INSERT ON webhook_inbox TO drezivo_app;

-- PostgreSQL's ON CONFLICT path also requires table-level SELECT, which would violate the
-- API's insert-only boundary. Keep the duplicate-safe write in a narrowly scoped SECURITY
-- DEFINER function owned by the migration role; it returns only whether a new row was inserted.
CREATE OR REPLACE FUNCTION ingest_clerk_webhook_inbox(
  p_provider_event_id text,
  p_event_type text,
  p_payload_digest text,
  p_safe_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
BEGIN
  INSERT INTO webhook_inbox
    (provider, provider_event_id, event_type, payload_digest, safe_payload, status)
  VALUES ('clerk', p_provider_event_id, p_event_type, p_payload_digest, p_safe_payload, 'received')
  ON CONFLICT (provider, provider_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION ingest_clerk_webhook_inbox(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ingest_clerk_webhook_inbox(text, text, text, jsonb) TO drezivo_app;

REVOKE INSERT, DELETE ON webhook_inbox FROM drezivo_worker;
GRANT SELECT, UPDATE ON webhook_inbox TO drezivo_worker;

-- Organization-created marker repair runs later in the durable worker, but it needs a narrowly
-- scoped system context to lock the matching account and insert one incomplete onboarding row.
-- The exact system principal is set by clerk-reconciliation.service.ts; ordinary account/operator/system
-- transactions cannot use these policies as a read side door.
CREATE POLICY account_clerk_webhook_repair_lock ON account
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  );

CREATE POLICY account_clerk_webhook_repair_update_lock ON account
  FOR UPDATE TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  )
  WITH CHECK (false);

CREATE POLICY organization_onboarding_clerk_webhook_repair_read ON organization_onboarding
  FOR SELECT TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  );

CREATE POLICY organization_onboarding_clerk_webhook_repair_lock ON organization_onboarding
  FOR UPDATE TO drezivo_app
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
  )
  WITH CHECK (false);

CREATE POLICY organization_onboarding_clerk_webhook_repair_insert ON organization_onboarding
  FOR INSERT TO drezivo_app
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'system'
    AND current_setting('app.principal_id', true) = 'clerk:webhook-repair'
    AND status = 'incomplete'
    AND provisioned_tenant_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM account
      WHERE account.id = organization_onboarding.account_id
        AND account.current_owned_tenant_id IS NULL
    )
  );
