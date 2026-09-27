-- FIT-BE-101 — provision safe branch fitting defaults.
--
-- 0041 introduced the fitting tables after some tenant branches already existed. A schedule
-- settings row is required as the branch-scoped serialization point for every fitting command,
-- so those branches otherwise return NOT_FOUND before an Owner can configure the feature.
--
-- Backfill only missing rows and preserve any Owner-configured settings/hours. Defaults
-- deliberately fail closed: fittings stay disabled and a zero fee is used until an Owner
-- enables the feature, while Monday through Saturday are ready to configure as 08:00–20:00.

WITH inserted_settings AS (
  INSERT INTO fitting_settings
    (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
  SELECT b.tenant_id, b.id, false, 1, 60, 0, t.currency
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
