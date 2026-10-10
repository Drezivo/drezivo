-- Change only the default used for new branches; existing operating_hours values are untouched.
ALTER TABLE branch
  ALTER COLUMN operating_hours
  SET DEFAULT '{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":[]}'::jsonb;
