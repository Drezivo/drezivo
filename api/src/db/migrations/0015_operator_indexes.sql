-- Operator activity, grant, and retry adapters reuse the existing append-only audit,
-- time-boxed grant, idempotency, and outbox rows. These indexes keep their bounded
-- tenant-scoped reads and retry lookup indexed without introducing a second command table.
CREATE INDEX audit_event_tenant_action_created_idx
  ON audit_event (tenant_id, action, created_at DESC);
CREATE INDEX audit_event_tenant_entity_created_idx
  ON audit_event (tenant_id, entity_type, created_at DESC);
CREATE INDEX support_grant_tenant_subject_created_idx
  ON support_grant (tenant_id, operator_subject, created_at DESC);
CREATE INDEX outbox_event_tenant_status_available_idx
  ON outbox_event (tenant_id, status, available_at);
