-- Business-owned workspace support boundary. No merchant impersonation or caller SQL.
-- Each operation rechecks the named Superadmin's expiring, tenant-scoped grant.
CREATE OR REPLACE FUNCTION operator_workspace_resource(p_resource text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE p_resource
 WHEN 'clothing' THEN '{"table":"product","columns":["id","code","name","description","subcategory","category_id","sizing_mode","status","updated_at"],"editable":["name","code","description","subcategory"],"deletable":true}'::jsonb
 WHEN 'variants' THEN '{"table":"product_variant","columns":["id","product_id","sku","size_label","color_label","rental_price_minor","security_deposit_minor","currency","status","updated_at"],"editable":["sku","size_label","color_label"],"deletable":false}'::jsonb
 WHEN 'assets' THEN '{"table":"physical_asset","columns":["id","variant_id","branch_id","asset_code","lifecycle_status","readiness","custody_kind","version","updated_at"],"editable":["asset_code"],"deletable":false}'::jsonb
 WHEN 'categories' THEN '{"table":"category","columns":["id","name","status","display_order"],"editable":["name","display_order"],"deletable":false}'::jsonb
 WHEN 'branches' THEN '{"table":"branch","columns":["id","name","code","status","timezone","is_default"],"editable":["name","code"],"deletable":false}'::jsonb
 WHEN 'reservations' THEN '{"table":"reservation","columns":["id","reference_code","branch_id","customer_id","status","pickup_at","due_at","rental_total_minor","currency","version"],"editable":[],"deletable":false}'::jsonb
 WHEN 'reservation-lines' THEN '{"table":"reservation_line","columns":["id","reservation_id","variant_id","line_number","rental_minor","deposit_minor","currency"],"editable":[],"deletable":false}'::jsonb
 WHEN 'fittings' THEN '{"table":"fitting_appointment","columns":["id","branch_id","customer_id","booking_channel","status","period","fee_minor","currency","version"],"editable":[],"deletable":false}'::jsonb
 WHEN 'fitting-lines' THEN '{"table":"fitting_line","columns":["id","fitting_id","variant_id","asset_id","garment_guaranteed","removed_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'customers' THEN '{"table":"customer","columns":["id","archived_at","anonymized_at","created_at","updated_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'memberships' THEN '{"table":"membership","columns":["id","role","status","authz_version","created_at","updated_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'payments' THEN '{"table":"payment","columns":["id","reservation_id","fitting_id","amount_minor","currency","status","verified_at","created_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'charges' THEN '{"table":"charge","columns":["id","reservation_id","fitting_id","kind","amount_minor","currency","reverses_id","created_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'deposits' THEN '{"table":"deposit_entry","columns":["id","reservation_id","payment_id","charge_id","refund_id","kind","amount_minor","currency","reverses_id","created_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'refunds' THEN '{"table":"refund","columns":["id","payment_id","amount_minor","currency","purpose","status","completed_at","created_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'maintenance' THEN '{"table":"maintenance_work_order","columns":["id","branch_id","asset_id","kind","status","opened_at","closed_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'allocations' THEN '{"table":"asset_allocation","columns":["id","branch_id","asset_id","reservation_line_id","maintenance_id","fitting_line_id","kind","period","is_blocking","released_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'custody' THEN '{"table":"custody_event","columns":["id","branch_id","asset_id","reservation_line_id","event_kind","occurred_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'disruptions' THEN '{"table":"disruption","columns":["id","asset_id","reservation_line_id","status","resolved_at","created_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'storefronts' THEN '{"table":"storefront","columns":["id","branch_id","slug","status","published_at","version","updated_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'files' THEN '{"table":"file_object","columns":["id","purpose","mime_type","byte_size","lifecycle_status","is_private","legal_hold","retention_until","deleted_at"],"editable":[],"deletable":false}'::jsonb
 WHEN 'jobs' THEN '{"table":"outbox_event","columns":["id","event_type","status","attempts","max_attempts","available_at","completed_at"],"editable":[],"deletable":false}'::jsonb
 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION operator_workspace_resource(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION operator_clothing_delete_preview(p_tenant uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target jsonb; variants uuid[]; assets uuid[]; dependencies jsonb; version_hash text;
BEGIN
 SELECT to_jsonb(p) INTO target FROM product p WHERE tenant_id=p_tenant AND id=p_id;
 IF target IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO variants FROM product_variant WHERE tenant_id=p_tenant AND product_id=p_id;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO assets FROM physical_asset WHERE tenant_id=p_tenant AND variant_id=ANY(variants);
 SELECT jsonb_build_object(
  'reservation_lines',(SELECT count(*) FROM reservation_line WHERE tenant_id=p_tenant AND variant_id=ANY(variants)),
  'fitting_lines',(SELECT count(*) FROM fitting_line WHERE tenant_id=p_tenant AND (variant_id=ANY(variants) OR asset_id=ANY(assets))),
  'allocations',(SELECT count(*) FROM asset_allocation WHERE tenant_id=p_tenant AND asset_id=ANY(assets)),
  'maintenance',(SELECT count(*) FROM maintenance_work_order WHERE tenant_id=p_tenant AND asset_id=ANY(assets)),
  'custody_events',(SELECT count(*) FROM custody_event WHERE tenant_id=p_tenant AND asset_id=ANY(assets)),
  'disruptions',(SELECT count(*) FROM disruption WHERE tenant_id=p_tenant AND asset_id=ANY(assets)),
  'away_assets',(SELECT count(*) FROM physical_asset WHERE tenant_id=p_tenant AND id=ANY(assets) AND custody_kind<>'at_branch')
 ) INTO dependencies;
 -- Bind confirmation to the entire inventory/media graph, not just product.updated_at.
 SELECT encode(digest(jsonb_build_object('product',target,
  'variants',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM product_variant v WHERE tenant_id=p_tenant AND product_id=p_id),
  'assets',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM physical_asset a WHERE tenant_id=p_tenant AND id=ANY(assets)),
  'images',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM product_image i WHERE tenant_id=p_tenant AND product_id=p_id),
  'blockers',dependencies)::text,'sha256'),'hex') INTO version_hash;
 RETURN jsonb_build_object('id',p_id,'name',target->>'name','code',target->>'code','fingerprint',version_hash,
  'variants',cardinality(variants),'assets',cardinality(assets),
  'images',(SELECT count(*) FROM product_image WHERE tenant_id=p_tenant AND product_id=p_id),
  'blockers',dependencies,'can_delete',NOT EXISTS(SELECT 1 FROM jsonb_each_text(dependencies) x WHERE x.value::bigint>0));
END $$;
REVOKE ALL ON FUNCTION operator_clothing_delete_preview(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION operator_workspace(p_operation text,p_subject text,p_tenant uuid,p_grant uuid,p_key text,p_request text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text:='operator:'||p_subject; grant_row support_grant%ROWTYPE; result jsonb; prior jsonb;
 spec jsonb; table_name text; pairs_sql text; changes_sql text; target jsonb; preview jsonb;
 resource text:=p_input->>'resource'; item_id uuid; action text; scope jsonb; fingerprint text; command_id uuid;
 payload_hash text:=encode(digest(jsonb_build_object('operation',p_operation,'tenant',p_tenant,'grant',p_grant,'body',p_input)::text,'sha256'),'hex');
BEGIN
 IF current_setting('app.actor_kind',true) IS DISTINCT FROM 'operator'
  OR current_setting('app.principal_id',true) IS DISTINCT FROM actor
  OR nullif(current_setting('app.tenant_id',true),'') IS NOT NULL
  OR p_subject IS NULL OR p_subject !~ '^[A-Za-z0-9_.:-]{1,200}$' THEN
  RAISE EXCEPTION 'operator required' USING ERRCODE='42501';
 END IF;
 IF p_operation NOT IN ('open','close','status','list','detail','delete-preview','correct','delete') OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN
  RAISE EXCEPTION 'unknown operation' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM tenant WHERE id=p_tenant) THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 IF p_operation<>'open' THEN
  SELECT * INTO grant_row FROM support_grant WHERE id=p_grant AND tenant_id=p_tenant AND operator_subject=p_subject FOR UPDATE;
  IF grant_row.id IS NULL OR (grant_row.revoked_at IS NOT NULL AND p_operation<>'close') OR (p_operation<>'close' AND (grant_row.starts_at>clock_timestamp() OR grant_row.expires_at<=clock_timestamp()))
   OR NOT(grant_row.permission_codes ? 'workspace.read')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(grant_row.permission_codes) p WHERE p NOT IN ('workspace.read','workspace.repair')) THEN
   RAISE EXCEPTION 'workspace access required' USING ERRCODE='42501';
  END IF;
  IF p_operation IN ('correct','delete') AND NOT(grant_row.permission_codes ? 'workspace.repair') THEN
   RAISE EXCEPTION 'repair access required' USING ERRCODE='42501';
  END IF;
 END IF;
 IF p_operation IN ('open','close','correct','delete') THEN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_.:-]{16,200}$' THEN RAISE EXCEPTION 'intent required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor||':'||p_key,0));
  SELECT redacted_summary INTO prior FROM global_audit_event WHERE actor_kind='operator' AND actor_key=actor AND entity_type='operator_command'
   AND redacted_summary->>'intent_hash'=encode(digest(p_key,'sha256'),'hex');
  IF prior IS NOT NULL THEN
   IF prior->>'payload_hash' IS DISTINCT FROM payload_hash THEN RAISE EXCEPTION 'intent changed' USING ERRCODE='23505'; END IF;
   RETURN prior->'result';
  END IF;
 END IF;
 IF p_operation='open' THEN
  IF p_input->>'mode' IS NULL OR p_input->>'mode' NOT IN ('read','repair') OR coalesce(length(btrim(p_input->>'reason')),0) NOT BETWEEN 3 AND 500
   OR coalesce((p_input->>'minutes')::int,0) NOT BETWEEN 5 AND 120 THEN RAISE EXCEPTION 'invalid access request' USING ERRCODE='22023'; END IF;
  scope:=CASE WHEN p_input->>'mode'='repair' THEN '["workspace.read","workspace.repair"]'::jsonb ELSE '["workspace.read"]'::jsonb END;
  INSERT INTO support_grant(tenant_id,operator_subject,granted_by,permission_codes,reason,starts_at,expires_at)
   VALUES(p_tenant,p_subject,p_subject,scope,btrim(p_input->>'reason'),now(),now()+make_interval(mins=>(p_input->>'minutes')::int)) RETURNING * INTO grant_row;
  result:=jsonb_build_object('grant_id',grant_row.id,'tenant_id',p_tenant,'mode',p_input->>'mode','operator_subject',p_subject,'expires_at',grant_row.expires_at);
  action:='operator.workspace.open';
 ELSIF p_operation='status' THEN
  result:=jsonb_build_object('grant_id',grant_row.id,'tenant_id',p_tenant,'mode',CASE WHEN grant_row.permission_codes ? 'workspace.repair' THEN 'repair' ELSE 'read' END,'operator_subject',p_subject,'expires_at',grant_row.expires_at);
  action:='operator.workspace.read';
 ELSIF p_operation='close' THEN
  IF grant_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'already closed' USING ERRCODE='23505'; END IF;
  UPDATE support_grant SET revoked_at=now() WHERE id=p_grant;
  result:=jsonb_build_object('grant_id',p_grant,'closed',true); action:='operator.workspace.close';
 ELSE
  spec:=operator_workspace_resource(resource);
  IF spec IS NULL THEN RAISE EXCEPTION 'unknown resource' USING ERRCODE='22023'; END IF;
  table_name:=spec->>'table';
  IF p_operation IN ('correct','delete') AND coalesce(length(btrim(p_input->>'reason')),0) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'reason required' USING ERRCODE='22023';
  END IF;
  IF p_operation='list' THEN
   SELECT string_agg(format('%L,to_jsonb(t)->%L',c,c),',') INTO pairs_sql FROM jsonb_array_elements_text(spec->'columns') c;
   EXECUTE format('SELECT coalesce(jsonb_agg(row ORDER BY id DESC),''[]'') FROM (SELECT t.id,jsonb_build_object(%s) AS row FROM public.%I t WHERE tenant_id=$1 AND ($2::uuid IS NULL OR t.id<$2) AND ($3::text IS NULL OR position(lower($3) IN lower(jsonb_build_object(%s)::text))>0) ORDER BY t.id DESC LIMIT 26) q',pairs_sql,table_name,pairs_sql)
    INTO target USING p_tenant,(p_input->>'after')::uuid,nullif(p_input->>'q','');
   result:=jsonb_build_object('resource',resource,'columns',spec->'columns','editable',spec->'editable','deletable',spec->'deletable',
    'items',(SELECT coalesce(jsonb_agg(value ORDER BY n),'[]') FROM jsonb_array_elements(target) WITH ORDINALITY x(value,n) WHERE n<=25),
    'next_cursor',CASE WHEN jsonb_array_length(target)>25 THEN target->24->>'id' END);
   action:='operator.workspace.read';
  ELSE
   item_id:=(p_input->>'id')::uuid;
   IF item_id IS NULL THEN RAISE EXCEPTION 'item required' USING ERRCODE='22023'; END IF;
   IF p_operation IN ('correct','delete') THEN
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE tenant_id=$1 AND id=$2 FOR UPDATE',table_name) INTO target USING p_tenant,item_id;
   ELSE
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE tenant_id=$1 AND id=$2',table_name) INTO target USING p_tenant,item_id;
   END IF;
   IF target IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
   fingerprint:=encode(digest(target::text,'sha256'),'hex');
   IF p_operation='detail' THEN
    result:=jsonb_build_object('id',item_id,'fingerprint',fingerprint,'data',(SELECT jsonb_object_agg(c,target->c) FROM jsonb_array_elements_text(spec->'columns') c),'editable',spec->'editable');
    action:='operator.workspace.read';
   ELSIF p_operation='correct' THEN
    IF p_input->>'fingerprint' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'stale item' USING ERRCODE='23505'; END IF;
    IF jsonb_typeof(p_input->'changes') IS DISTINCT FROM 'object' OR p_input->'changes'='{}'::jsonb
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input->'changes') k WHERE NOT(spec->'editable' ? k)) THEN
     RAISE EXCEPTION 'invalid correction' USING ERRCODE='22023';
    END IF;
    -- jsonb_populate_record casts only validated, allowlisted columns to their real DB types.
    SELECT string_agg(format('%I=c.%I',k,k),',') INTO changes_sql FROM jsonb_object_keys(p_input->'changes') k;
    EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$3) c WHERE t.tenant_id=$1 AND t.id=$2',table_name,changes_sql,table_name)
     USING p_tenant,item_id,p_input->'changes';
    IF resource IN ('clothing','variants','assets') THEN
     EXECUTE format('UPDATE public.%I SET updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2',table_name) USING p_tenant,item_id;
    END IF;
    result:=jsonb_build_object('id',item_id,'corrected',true); action:='operator.workspace.correct';
   ELSIF p_operation IN ('delete-preview','delete') THEN
    IF resource<>'clothing' THEN RAISE EXCEPTION 'unsupported deletion' USING ERRCODE='22023'; END IF;
    IF p_operation='delete' THEN
     -- These locks also serialize concurrent FK writers and inventory edits against deletion.
     PERFORM id FROM product_variant WHERE tenant_id=p_tenant AND product_id=item_id ORDER BY id FOR UPDATE;
     PERFORM a.id FROM physical_asset a JOIN product_variant v ON v.id=a.variant_id AND v.tenant_id=a.tenant_id WHERE a.tenant_id=p_tenant AND v.product_id=item_id ORDER BY a.id FOR UPDATE OF a;
     PERFORM id FROM storefront WHERE tenant_id=p_tenant ORDER BY id FOR UPDATE;
    END IF;
    preview:=operator_clothing_delete_preview(p_tenant,item_id);
    IF p_operation='delete-preview' THEN result:=preview; action:='operator.workspace.delete_preview';
    ELSE
     IF p_input->>'fingerprint' IS DISTINCT FROM preview->>'fingerprint' OR p_input->>'confirm_name' IS DISTINCT FROM target->>'name'
      OR p_input->>'confirm_id' IS DISTINCT FROM item_id::text OR p_input->>'acknowledge' IS DISTINCT FROM 'PERMANENTLY DELETE' THEN
      RAISE EXCEPTION 'confirmation changed' USING ERRCODE='23505';
     END IF;
     IF NOT (preview->>'can_delete')::boolean THEN RAISE EXCEPTION 'referenced clothing' USING ERRCODE='23503'; END IF;
     INSERT INTO outbox_event(tenant_id,dedupe_key,event_type,payload)
      SELECT p_tenant,'operator-clothing-cleanup:'||item_id::text||':'||file_id::text,'file.object_cleanup.requested',jsonb_build_object('file_id',file_id)
      FROM product_image WHERE tenant_id=p_tenant AND product_id=item_id ON CONFLICT(tenant_id,dedupe_key) DO NOTHING;
     DELETE FROM product_image WHERE tenant_id=p_tenant AND product_id=item_id;
     DELETE FROM physical_asset WHERE tenant_id=p_tenant AND variant_id IN (SELECT id FROM product_variant WHERE tenant_id=p_tenant AND product_id=item_id);
     DELETE FROM product_variant WHERE tenant_id=p_tenant AND product_id=item_id;
     UPDATE storefront SET content=jsonb_set(content,'{featured_product_ids}',coalesce((SELECT jsonb_agg(value ORDER BY n) FROM jsonb_array_elements(content->'featured_product_ids') WITH ORDINALITY x(value,n) WHERE value<>to_jsonb(item_id::text)),'[]')),version=version+1,updated_at=now()
      WHERE tenant_id=p_tenant AND content->'featured_product_ids' @> jsonb_build_array(item_id::text);
     DELETE FROM product WHERE tenant_id=p_tenant AND id=item_id;
     result:=jsonb_build_object('id',item_id,'deleted',true,'variants',preview->'variants','assets',preview->'assets','images',preview->'images');
     action:='operator.workspace.delete';
    END IF;
   ELSE RAISE EXCEPTION 'invalid operation' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF p_operation IN ('correct','delete') THEN
  INSERT INTO operator_command(tenant_id,operator_subject,command_kind,resource_kind,resource_id,intent_key,request_fingerprint,reason,status,request_id,accepted_at,completed_at)
   VALUES(p_tenant,p_subject,'workspace.'||p_operation,table_name,item_id,p_key,payload_hash,btrim(p_input->>'reason'),'completed',p_request,now(),now()) RETURNING id INTO command_id;
 END IF;
 INSERT INTO audit_event(tenant_id,actor_kind,actor_key,support_grant_id,operator_command_id,action,entity_type,entity_id,redacted_summary,request_id,occurred_at,outcome)
  VALUES(p_tenant,'operator',actor,grant_row.id,command_id,action,coalesce(resource,'workspace'),coalesce(item_id,p_tenant),
   jsonb_build_object('mode',CASE WHEN grant_row.permission_codes ? 'workspace.repair' THEN 'repair' ELSE 'read' END,
    'fields',CASE WHEN p_operation='correct' THEN (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_input->'changes') k) END),p_request,now(),'succeeded');
 IF p_operation IN ('open','close','correct','delete') THEN
  INSERT INTO global_audit_event(actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id)
   VALUES('operator',actor,action,'operator_command',p_tenant,'succeeded',jsonb_build_object('intent_hash',encode(digest(p_key,'sha256'),'hex'),'payload_hash',payload_hash,'result',result),p_request);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION operator_workspace(text,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_workspace(text,text,uuid,uuid,text,text,jsonb) TO drezivo_app;
