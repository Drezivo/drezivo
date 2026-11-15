-- Derived scheduling metadata only. Reservation state remains authoritative and tenant-scoped.
-- Backfilling through a tenant-filtered role could silently omit other businesses' holds.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Reservation expiry backfill requires a migration owner that can read all tenants';
  END IF;
END;
$$;
CREATE TABLE public.reservation_expiry_schedule (
  reservation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT reservation_expiry_schedule_same_tenant_fk
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES public.reservation (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX reservation_expiry_schedule_due_idx
  ON public.reservation_expiry_schedule (expires_at, tenant_id);
CREATE INDEX reservation_expiry_schedule_tenant_due_idx
  ON public.reservation_expiry_schedule (tenant_id, expires_at, reservation_id);

ALTER TABLE public.reservation_expiry_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_expiry_schedule FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_expiry_schedule FROM PUBLIC, drezivo_app, drezivo_worker;
CREATE POLICY worker_expiry_discovery ON public.reservation_expiry_schedule
  FOR SELECT TO drezivo_worker USING (true);
GRANT SELECT ON public.reservation_expiry_schedule TO drezivo_worker;

-- Only the reservation trigger maintains the schedule. Runtime roles cannot forge or remove
-- entries. The function is owned by the migration owner, never a runtime role.
CREATE FUNCTION public.sync_reservation_expiry_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status IN ('held', 'pending_confirmation') AND NEW.hold_expires_at IS NOT NULL THEN
    INSERT INTO public.reservation_expiry_schedule (reservation_id, tenant_id, expires_at)
    VALUES (NEW.id, NEW.tenant_id, NEW.hold_expires_at)
    ON CONFLICT (reservation_id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id, expires_at = EXCLUDED.expires_at
      WHERE (reservation_expiry_schedule.tenant_id, reservation_expiry_schedule.expires_at)
        IS DISTINCT FROM (EXCLUDED.tenant_id, EXCLUDED.expires_at);
  ELSE
    DELETE FROM public.reservation_expiry_schedule WHERE reservation_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_reservation_expiry_schedule() FROM PUBLIC;

CREATE TRIGGER reservation_expiry_schedule_insert
  AFTER INSERT ON public.reservation FOR EACH ROW
  EXECUTE FUNCTION public.sync_reservation_expiry_schedule();
CREATE TRIGGER reservation_expiry_schedule_update
  AFTER UPDATE OF status, hold_expires_at ON public.reservation FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.hold_expires_at IS DISTINCT FROM NEW.hold_expires_at)
  EXECUTE FUNCTION public.sync_reservation_expiry_schedule();

-- Installing the triggers and backfilling in this migration's transaction prevents a gap
-- between existing reservations and concurrent writers. Include already-overdue reservations.
INSERT INTO public.reservation_expiry_schedule (reservation_id, tenant_id, expires_at)
SELECT id, tenant_id, hold_expires_at FROM public.reservation
WHERE status IN ('held', 'pending_confirmation') AND hold_expires_at IS NOT NULL;

-- Supabase default ACLs can otherwise expose newly created objects.
DO $$
DECLARE runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('REVOKE ALL ON public.reservation_expiry_schedule FROM %I', runtime_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.sync_reservation_expiry_schedule() FROM %I', runtime_role);
    END IF;
  END LOOP;
END;
$$;
