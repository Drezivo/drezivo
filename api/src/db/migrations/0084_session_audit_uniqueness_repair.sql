-- Preserve legacy operator-session audit evidence while selecting one canonical row per event
-- for the idempotency constraint introduced by 0085. The runtime role cannot alter this marker.
ALTER TABLE global_audit_event
  ADD COLUMN IF NOT EXISTS operator_session_unique_guard boolean;

WITH ranked_session_events AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY actor_key, entity_id, action
      ORDER BY created_at, id
    ) = 1 AS is_canonical
  FROM global_audit_event
  WHERE actor_kind = 'operator'
    AND entity_type = 'operator_session'
)
UPDATE global_audit_event AS event
SET operator_session_unique_guard = ranked.is_canonical
FROM ranked_session_events AS ranked
WHERE event.id = ranked.id
  AND event.operator_session_unique_guard IS DISTINCT FROM ranked.is_canonical;

ALTER TABLE global_audit_event
  ALTER COLUMN operator_session_unique_guard SET DEFAULT true;

REVOKE INSERT ON global_audit_event FROM drezivo_app;
GRANT INSERT (
  id,
  account_id,
  actor_kind,
  actor_key,
  action,
  entity_type,
  entity_id,
  outcome,
  redacted_summary,
  request_id,
  created_at
) ON global_audit_event TO drezivo_app;

-- Preview may already have the original 0085 index. Replacing it gives preview and production
-- the same definition without changing or deleting historical audit facts.
DROP INDEX IF EXISTS global_operator_session_once;
CREATE UNIQUE INDEX global_operator_session_once
  ON global_audit_event (actor_key, entity_id, action)
  WHERE actor_kind = 'operator'
    AND entity_type = 'operator_session'
    AND operator_session_unique_guard IS TRUE;
