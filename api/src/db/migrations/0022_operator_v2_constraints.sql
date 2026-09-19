-- Operator command durability v2: validate/switch phase.
--
-- Run after the API version that writes actor_kind, outcome, and occurred_at is deployed. The
-- expand/backfill phase is 0021; keeping enforcement here avoids breaking an older application
-- during a rolling deploy.
ALTER TABLE audit_event
  ALTER COLUMN actor_kind SET NOT NULL,
  ALTER COLUMN outcome SET NOT NULL,
  ALTER COLUMN occurred_at SET NOT NULL,
  ADD CONSTRAINT audit_event_actor_kind_check CHECK (actor_kind IN ('staff', 'operator', 'system')),
  ADD CONSTRAINT audit_event_outcome_check CHECK (outcome IN ('succeeded', 'rejected', 'failed'));

ALTER TABLE audit_event
  ADD CONSTRAINT audit_event_operator_command_fk
  FOREIGN KEY (tenant_id, operator_command_id) REFERENCES operator_command (tenant_id, id);

CREATE INDEX audit_event_tenant_occurred_idx
  ON audit_event (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX audit_event_operator_command_idx
  ON audit_event (operator_command_id)
  WHERE operator_command_id IS NOT NULL;
CREATE INDEX operator_command_tenant_created_idx
  ON operator_command (tenant_id, created_at DESC);
CREATE INDEX operator_command_resource_created_idx
  ON operator_command (tenant_id, resource_kind, resource_id, created_at DESC);
