-- Preserve which staff Pickup milestones were entered without a specific time.
-- Existing reservations default to timed; saved boundary timestamps are not reliable evidence
-- that a staff member omitted the time.
ALTER TABLE public.reservation
  ADD COLUMN pickup_time_unspecified boolean NOT NULL DEFAULT false,
  ADD COLUMN return_time_unspecified boolean NOT NULL DEFAULT false;
