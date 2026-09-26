-- FIT-BE-024 — fitting row-level security and least-privilege runtime access.
--
-- Fitting tables were deliberately introduced before any fitting route is enabled. This migration
-- closes that gap by applying the same tenant GUC isolation pattern used by the rest of Drezivo,
-- forcing RLS even for table owners, and granting only the runtime privileges the first fitting
-- slice actually needs.
--
-- The durable worker has no first-slice fitting job: no reminder delivery, no automatic lifecycle
-- transition, and no background schedule mutation. It therefore receives no fitting-table access.
-- If a later worker feature needs fitting rows, that access must be introduced explicitly in a
-- later migration rather than inheriting broad/global privileges.

DO $$
DECLARE
  fitting_tables text[] := ARRAY[
    'fitting_settings',
    'fitting_appointment',
    'fitting_line',
    'fitting_capacity_slot',
    'fitting_slot_allocation',
    'fitting_hours',
    'fitting_closure'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY fitting_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- The tables are new in V1.1, but drop defensively so a partially rehearsed branch can be
    -- corrected by roll-forward without accumulating a second permissive tenant policy.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'FOR ALL TO drezivo_app '
      || 'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );

    -- Do not let future default/public/worker grants accidentally make a fitting table global.
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM drezivo_worker', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM drezivo_app', t);
  END LOOP;
END $$;

-- Staff/API runtime privileges. Authorization (Owner versus Front Desk) remains an application
-- concern layered above tenant isolation; database grants only define which persistence operations
-- the HTTP runtime can ever perform.
GRANT SELECT, INSERT, UPDATE ON fitting_settings TO drezivo_app;
GRANT SELECT, INSERT, UPDATE ON fitting_appointment TO drezivo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitting_line TO drezivo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitting_capacity_slot TO drezivo_app;
GRANT SELECT, INSERT, UPDATE ON fitting_slot_allocation TO drezivo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitting_hours TO drezivo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitting_closure TO drezivo_app;

-- History-bearing tables are intentionally not deletable through the runtime. Appointment mistakes
-- are cancelled, not hard-deleted; released slot claims remain history; fitting settings are
-- versioned/mutated rather than removed in normal operation.
REVOKE DELETE ON fitting_settings, fitting_appointment, fitting_slot_allocation FROM drezivo_app;
