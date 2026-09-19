-- Operator command durability v2: expand/backfill phase.
--
-- This migration is deliberately compatible with the pre-v2 API. The follow-up 0022 migration
-- adds NOT NULL/check constraints after the application that writes the new fields is deployed.
-- Existing audit rows are preserved; missing facts are conservatively marked as system/succeeded
-- at their original created_at because the old schema cannot prove a more specific actor/outcome.
ALTER TABLE audit_event
  ADD COLUMN actor_kind text,
  ADD COLUMN outcome text,
  ADD COLUMN occurred_at timestamptz,
  ADD COLUMN operator_command_id uuid;

DO $$
DECLARE
  rows_updated integer;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id
      FROM audit_event
      WHERE actor_kind IS NULL OR outcome IS NULL OR occurred_at IS NULL
      ORDER BY id
      LIMIT 10000
      FOR UPDATE SKIP LOCKED
    )
    UPDATE audit_event AS event
    SET actor_kind = COALESCE(event.actor_kind, 'system'),
        outcome = COALESCE(event.outcome, 'succeeded'),
        occurred_at = COALESCE(event.occurred_at, event.created_at)
    FROM batch
    WHERE event.id = batch.id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END $$;

CREATE TYPE operator_command_status AS ENUM ('accepted', 'completed', 'rejected', 'failed');

CREATE TABLE operator_command (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  operator_subject text NOT NULL,
  command_kind text NOT NULL,
  resource_kind text NOT NULL,
  resource_id uuid NOT NULL,
  intent_key text NOT NULL,
  reason text NOT NULL,
  status operator_command_status NOT NULL,
  request_id text NOT NULL,
  accepted_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_command_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT operator_command_tenant_subject_kind_intent_key UNIQUE (tenant_id, operator_subject, command_kind, intent_key),
  CONSTRAINT operator_command_status_timestamps_check CHECK (
    (status IN ('accepted', 'completed') AND accepted_at IS NOT NULL)
    OR (status IN ('rejected', 'failed'))
  ),
  CONSTRAINT operator_command_completion_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= accepted_at)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

ALTER TABLE operator_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_command FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operator_command
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON operator_command TO drezivo_app;
REVOKE DELETE ON operator_command FROM drezivo_app;
