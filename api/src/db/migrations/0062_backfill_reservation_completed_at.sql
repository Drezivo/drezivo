-- Earlier Complete Rental commands recorded the completed status and audit event but omitted
-- reservation.completed_at. Recover only missing timestamps from the successful transition audit.
WITH completion_events AS (
  SELECT tenant_id, entity_id, min(occurred_at) AS completed_at
    FROM audit_event
   WHERE action = 'reservation.completed'
     AND entity_type = 'reservation'
     AND outcome = 'succeeded'
     AND entity_id IS NOT NULL
   GROUP BY tenant_id, entity_id
)
UPDATE reservation AS r
   SET completed_at = event.completed_at
  FROM completion_events AS event
 WHERE r.tenant_id = event.tenant_id
   AND r.id = event.entity_id
   AND r.status = 'completed'
   AND r.completed_at IS NULL;
