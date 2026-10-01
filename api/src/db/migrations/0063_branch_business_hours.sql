-- Branch Business Hours become the single schedule owner for the active branch.
--
-- This is a forward-only migration. Historical fitting schedule migrations remain immutable so
-- databases that already applied them can roll forward safely. Existing fitting hours are accepted
-- only when they can be represented by the V1 Business Hours model: at most one window per weekday
-- and the same opening/closing time on every open weekday. Anything else fails loudly instead of
-- silently broadening availability.

ALTER TABLE branch
  ADD COLUMN operating_hours_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN operating_hours_updated_at timestamptz NOT NULL DEFAULT statement_timestamp();

-- A split window or different hours by weekday cannot be represented by the new V1 model.
DO $$
DECLARE
  incompatible record;
BEGIN
  SELECT candidate.tenant_id, candidate.branch_id
    INTO incompatible
    FROM (
      SELECT fh.tenant_id,
             fh.branch_id,
             count(*) AS window_count,
             count(DISTINCT fh.weekday) AS open_day_count,
             count(DISTINCT (fh.starts_local, fh.ends_local)) AS distinct_windows
        FROM fitting_hours fh
       GROUP BY fh.tenant_id, fh.branch_id
    ) candidate
   WHERE candidate.window_count <> candidate.open_day_count
      OR candidate.distinct_windows > 1
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'legacy fitting schedule for tenant %s branch %s cannot be represented as one shared Business Hours window; normalize or reset this disposable development schedule before retrying migration 0063',
        incompatible.tenant_id,
        incompatible.branch_id
      );
  END IF;
END;
$$;

-- Derive canonical Business Hours from a representable legacy fitting schedule. Branches with no
-- legacy rows receive the product default: 08:00-20:00, Sunday closed.
WITH legacy_window AS (
  SELECT fh.tenant_id,
         fh.branch_id,
         min(fh.starts_local)::text AS opens_local,
         min(fh.ends_local)::text AS closes_local
    FROM fitting_hours fh
   GROUP BY fh.tenant_id, fh.branch_id
),
closed_days AS (
  SELECT b.tenant_id,
         b.id AS branch_id,
         COALESCE(
           jsonb_agg(day.weekday_name ORDER BY day.weekday_number)
             FILTER (
               WHERE NOT EXISTS (
                 SELECT 1
                   FROM fitting_hours fh
                  WHERE fh.tenant_id = b.tenant_id
                    AND fh.branch_id = b.id
                    AND fh.weekday = day.weekday_number
               )
             ),
           '[]'::jsonb
         ) AS closed_weekdays
    FROM branch b
   CROSS JOIN (
     VALUES
       (1, 'monday'),
       (2, 'tuesday'),
       (3, 'wednesday'),
       (4, 'thursday'),
       (5, 'friday'),
       (6, 'saturday'),
       (7, 'sunday')
   ) AS day(weekday_number, weekday_name)
   GROUP BY b.tenant_id, b.id
)
UPDATE branch b
   SET operating_hours = jsonb_build_object(
         'opens_local', COALESCE(left(lw.opens_local, 5), '08:00'),
         'closes_local', COALESCE(left(lw.closes_local, 5), '20:00'),
         'closed_weekdays',
           CASE
             WHEN lw.branch_id IS NULL THEN '["sunday"]'::jsonb
             ELSE cd.closed_weekdays
           END
       ),
       operating_hours_version = 1,
       operating_hours_updated_at = statement_timestamp()
  FROM closed_days cd
  LEFT JOIN legacy_window lw
    ON lw.tenant_id = cd.tenant_id
   AND lw.branch_id = cd.branch_id
 WHERE b.tenant_id = cd.tenant_id
   AND b.id = cd.branch_id;

ALTER TABLE branch
  ALTER COLUMN operating_hours SET DEFAULT '{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":["sunday"]}'::jsonb,
  ALTER COLUMN operating_hours SET NOT NULL,
  ADD CONSTRAINT branch_operating_hours_shape
    CHECK (
      jsonb_typeof(operating_hours) = 'object'
      AND operating_hours ?& ARRAY['opens_local', 'closes_local', 'closed_weekdays']
      AND jsonb_typeof(operating_hours->'closed_weekdays') = 'array'
      AND (operating_hours->>'opens_local') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND (operating_hours->>'closes_local') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND (operating_hours->>'opens_local') < (operating_hours->>'closes_local')
    ),
  ADD CONSTRAINT branch_operating_hours_version_positive
    CHECK (operating_hours_version > 0);

CREATE TABLE branch_closure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  branch_id uuid NOT NULL,
  local_date date NOT NULL,
  reason text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT branch_closure_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT branch_closure_branch_same_tenant_fk
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branch(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT branch_closure_tenant_branch_date_key UNIQUE (tenant_id, branch_id, local_date),
  CONSTRAINT branch_closure_reason_bounded CHECK (length(btrim(reason)) BETWEEN 1 AND 240),
  CONSTRAINT branch_closure_version_positive CHECK (version > 0)
);

CREATE INDEX branch_closure_tenant_branch_date_idx
  ON branch_closure (tenant_id, branch_id, local_date, id);

ALTER TABLE branch_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_closure FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_closure
  FOR ALL TO drezivo_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE ALL PRIVILEGES ON TABLE branch_closure FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE branch_closure FROM drezivo_worker;
REVOKE ALL PRIVILEGES ON TABLE branch_closure FROM drezivo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON branch_closure TO drezivo_app;

-- Preserve only closures that already mean "closed for the whole branch-local date". Partial-day
-- legacy fitting closures cannot be widened safely, so fail instead of changing their meaning.
DO $$
DECLARE
  incompatible record;
BEGIN
  SELECT fc.id, fc.tenant_id, fc.branch_id
    INTO incompatible
    FROM fitting_closure fc
    JOIN branch b
      ON b.tenant_id = fc.tenant_id
     AND b.id = fc.branch_id
   WHERE lower(fc.period) IS DISTINCT FROM
           (((lower(fc.period) AT TIME ZONE b.timezone)::date)::timestamp AT TIME ZONE b.timezone)
      OR upper(fc.period) IS DISTINCT FROM
           ((((lower(fc.period) AT TIME ZONE b.timezone)::date + 1)::timestamp) AT TIME ZONE b.timezone)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'legacy fitting closure %s for tenant %s branch %s is partial-day and cannot become a whole-day branch closure; normalize or reset this disposable development closure before retrying migration 0063',
        incompatible.id,
        incompatible.tenant_id,
        incompatible.branch_id
      );
  END IF;
END;
$$;

INSERT INTO branch_closure
  (id, tenant_id, branch_id, local_date, reason, version, created_at, updated_at)
SELECT fc.id,
       fc.tenant_id,
       fc.branch_id,
       (lower(fc.period) AT TIME ZONE b.timezone)::date,
       fc.reason,
       1,
       fc.created_at,
       fc.created_at
  FROM fitting_closure fc
  JOIN branch b
    ON b.tenant_id = fc.tenant_id
   AND b.id = fc.branch_id
ON CONFLICT (tenant_id, branch_id, local_date) DO NOTHING;

-- The runtime is cut over to branch.operating_hours / branch_closure in the same code change as
-- this migration. Remove fitting-owned schedule persistence and its schedule-only guards.
DROP TRIGGER IF EXISTS fitting_hours_window_count_guard_trigger ON fitting_hours;
DROP FUNCTION IF EXISTS fitting_hours_window_count_guard();
DROP TRIGGER IF EXISTS fitting_closure_timezone_guard_trigger ON fitting_closure;
DROP FUNCTION IF EXISTS fitting_closure_timezone_guard();

DROP TABLE fitting_hours;
DROP TABLE fitting_closure;
