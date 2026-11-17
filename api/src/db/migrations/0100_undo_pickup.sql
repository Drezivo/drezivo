-- The runtime role cannot delete custody facts directly. Only this guarded correction
-- may remove a mistaken pickup, and it changes custody and audit in the same transaction.
CREATE SCHEMA IF NOT EXISTS reservation_private;
REVOKE ALL ON SCHEMA reservation_private FROM PUBLIC;
GRANT USAGE ON SCHEMA reservation_private TO drezivo_app;

CREATE FUNCTION reservation_private.undo_pickup(p_reservation uuid, p_branch uuid, p_version integer, p_request_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  v_principal text := nullif(current_setting('app.principal_id', true), '');
  v_lines integer;
  v_allocations integer;
  v_events integer;
  v_deleted integer;
  v_version integer;
BEGIN
  IF v_tenant IS NULL OR v_principal IS NULL OR p_request_id IS NULL OR length(p_request_id) = 0 OR NOT EXISTS (
    SELECT 1 FROM public.membership m
    JOIN public.branch_membership bm ON bm.tenant_id = m.tenant_id AND bm.membership_id = m.id
    JOIN public.branch b ON b.tenant_id = bm.tenant_id AND b.id = bm.branch_id
    WHERE m.tenant_id = v_tenant AND m.clerk_user_id = v_principal AND m.status = 'active'
      AND bm.branch_id = p_branch AND b.status = 'active'
      AND bm.permission_codes ? 'reservations.manage' AND bm.permission_codes ? 'reservations.custody'
  ) THEN RAISE EXCEPTION 'reservation custody permission required' USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM public.reservation r WHERE r.tenant_id = v_tenant AND r.branch_id = p_branch
    AND r.id = p_reservation AND r.status = 'picked_up' AND r.version = p_version FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1 FROM public.reservation_line rl
    JOIN public.asset_allocation aa ON aa.tenant_id = rl.tenant_id AND aa.reservation_line_id = rl.id
    JOIN public.physical_asset pa ON pa.tenant_id = aa.tenant_id AND pa.id = aa.asset_id
    WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation AND aa.branch_id = p_branch
    ORDER BY pa.id, aa.id FOR UPDATE OF aa, pa;

  SELECT count(*) INTO v_lines FROM public.reservation_line rl
    WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation;
  SELECT count(*) INTO v_allocations FROM public.reservation_line rl
    JOIN public.asset_allocation aa ON aa.tenant_id = rl.tenant_id AND aa.reservation_line_id = rl.id
    JOIN public.physical_asset pa ON pa.tenant_id = aa.tenant_id AND pa.id = aa.asset_id
    WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation AND aa.branch_id = p_branch
      AND aa.kind = 'reservation_confirmed' AND aa.is_blocking AND aa.released_at IS NULL
      AND pa.branch_id = p_branch AND pa.lifecycle_status = 'active' AND pa.custody_kind = 'with_customer';
  SELECT count(*) INTO v_events FROM public.custody_event ce
    JOIN public.reservation_line rl ON rl.tenant_id = ce.tenant_id AND rl.id = ce.reservation_line_id
    WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation;
  IF v_lines = 0 OR v_allocations <> v_lines OR v_events <> v_lines OR EXISTS (
    SELECT 1 FROM public.reservation_line rl WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation
      AND (SELECT count(*) FROM public.asset_allocation aa JOIN public.custody_event ce
        ON ce.tenant_id = aa.tenant_id AND ce.reservation_line_id = aa.reservation_line_id
        AND ce.asset_id = aa.asset_id AND ce.branch_id = p_branch AND ce.event_kind = 'pickup'
        WHERE aa.tenant_id = rl.tenant_id AND aa.reservation_line_id = rl.id AND aa.branch_id = p_branch
          AND aa.kind = 'reservation_confirmed' AND aa.is_blocking AND aa.released_at IS NULL) <> 1
  ) THEN RAISE EXCEPTION 'pickup custody is inconsistent' USING ERRCODE = 'P0001'; END IF;

  DELETE FROM public.custody_event ce USING public.reservation_line rl
    WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation
      AND ce.tenant_id = rl.tenant_id AND ce.reservation_line_id = rl.id
      AND ce.branch_id = p_branch AND ce.event_kind = 'pickup';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_lines THEN RAISE EXCEPTION 'pickup custody changed' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.physical_asset pa SET custody_kind = 'at_branch', version = pa.version + 1,
    updated_at = statement_timestamp()
    FROM public.asset_allocation aa JOIN public.reservation_line rl
      ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
    WHERE rl.tenant_id = v_tenant AND rl.reservation_id = p_reservation AND aa.branch_id = p_branch
      AND aa.kind = 'reservation_confirmed' AND aa.is_blocking AND aa.released_at IS NULL
      AND pa.tenant_id = aa.tenant_id AND pa.id = aa.asset_id;
  UPDATE public.reservation SET status = 'confirmed', version = version + 1
    WHERE tenant_id = v_tenant AND branch_id = p_branch AND id = p_reservation
      AND status = 'picked_up' AND version = p_version RETURNING version INTO v_version;
  INSERT INTO public.audit_event (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
    redacted_summary, request_id, occurred_at, outcome)
    VALUES (v_tenant, 'staff', v_principal, 'reservation.pickup_undone', 'reservation', p_reservation,
      jsonb_build_object('version', v_version, 'garment_count', v_lines), p_request_id, statement_timestamp(), 'succeeded');
  RETURN v_version;
END $$;
REVOKE ALL ON FUNCTION reservation_private.undo_pickup(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reservation_private.undo_pickup(uuid, uuid, integer, text) TO drezivo_app;
