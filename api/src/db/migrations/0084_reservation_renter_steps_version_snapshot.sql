-- A previous local version of 0080_shared_payment_renter_steps.sql was applied
-- before it included the reservation steps version snapshot. Keep 0080 immutable
-- and reconcile that older schema with a forward-only migration.

ALTER TABLE public.reservation
  ADD COLUMN IF NOT EXISTS renter_steps_version_snapshot integer;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.reservation'::regclass
       AND conname = 'reservation_renter_steps_version_snapshot_positive'
  ) THEN
    ALTER TABLE public.reservation
      ADD CONSTRAINT reservation_renter_steps_version_snapshot_positive
      CHECK (
        renter_steps_version_snapshot IS NULL
        OR renter_steps_version_snapshot > 0
      );
  END IF;
END
$migration$;
