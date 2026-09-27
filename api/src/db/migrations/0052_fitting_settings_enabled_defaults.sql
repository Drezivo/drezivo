-- FIT-BE-101 — enable fitting acceptance for missing branch settings.
--
-- 0051 may already be recorded in deployed environments. Do not alter its behavior;
-- provision only branches that still lack settings, preserving any Owner configuration.

WITH inserted_settings AS (
  INSERT INTO fitting_settings
    (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
  SELECT b.tenant_id, b.id, true, 1, 60, 0, t.currency
    FROM branch b
    JOIN tenant t ON t.id = b.tenant_id
    LEFT JOIN fitting_settings fs
      ON fs.tenant_id = b.tenant_id
     AND fs.branch_id = b.id
   WHERE fs.id IS NULL
  ON CONFLICT (tenant_id, branch_id) DO NOTHING
  RETURNING tenant_id, branch_id
)
INSERT INTO fitting_hours (tenant_id, branch_id, weekday, starts_local, ends_local)
SELECT settings.tenant_id, settings.branch_id, weekday, time '08:00', time '20:00'
  FROM inserted_settings settings
 CROSS JOIN generate_series(1, 6) AS weekdays(weekday)
 ORDER BY settings.tenant_id, settings.branch_id, weekday;
