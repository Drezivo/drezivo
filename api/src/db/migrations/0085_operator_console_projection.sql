ALTER TABLE operator_command ADD COLUMN IF NOT EXISTS request_fingerprint text;
-- Platform-only operator projections. See operator ADR 0026. No merchant activity browser.
CREATE UNIQUE INDEX IF NOT EXISTS global_operator_session_once
 ON global_audit_event (actor_key, entity_id, action)
 WHERE actor_kind = 'operator' AND entity_type = 'operator_session';
CREATE INDEX IF NOT EXISTS audit_event_operator_order_idx
 ON audit_event (occurred_at DESC, id DESC) WHERE actor_kind = 'operator';

CREATE OR REPLACE FUNCTION operator_console_projection(p_resource text, p_input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE result jsonb; bounded integer := greatest(1, least(coalesce((p_input->>'limit')::integer, 25), 101));
BEGIN
 IF nullif(current_setting('app.actor_kind', true), '') IS DISTINCT FROM 'operator'
 OR nullif(current_setting('app.principal_id', true), '') IS NULL
 OR nullif(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
  RAISE EXCEPTION 'operator context required' USING ERRCODE = '42501';
 END IF;
 CASE p_resource
 WHEN 'audit' THEN
  WITH events AS (
   SELECT a.id AS event_id, a.occurred_at, a.tenant_id, t.name AS business_name,
    a.actor_kind, a.actor_key, a.action, a.entity_type, a.entity_id, a.support_grant_id,
    a.outcome, a.request_id, NULL::text AS redacted_summary,
    CASE WHEN a.entity_type IN ('subscription','subscription_payment') OR a.action LIKE 'operator.subscription.%' THEN
     jsonb_build_object('amount_minor', CASE WHEN a.redacted_summary->>'amount_minor' ~ '^[0-9]{1,16}$' THEN a.redacted_summary->>'amount_minor' END,
      'currency', CASE WHEN a.redacted_summary->>'currency' ~ '^[A-Z]{3}$' THEN a.redacted_summary->>'currency' END,
      'payer_key',CASE WHEN a.redacted_summary->>'payer_key' ~ '^[A-Za-z0-9_.:-]{1,200}$' THEN a.redacted_summary->>'payer_key' END,
      'paid_at',CASE WHEN a.redacted_summary->>'paid_at' ~ '^[0-9]{4}-' THEN a.redacted_summary->>'paid_at' END,
      'due_at', CASE WHEN a.redacted_summary->>'current_period_end' ~ '^[0-9]{4}-' THEN a.redacted_summary->>'current_period_end' END)
     ELSE NULL END AS billing
   FROM audit_event a JOIN tenant t ON t.id = a.tenant_id
   WHERE a.actor_kind = 'operator'
    OR (a.action IN ('subscription.free_started','subscription.free_trial_started','subscription.free_upgrade_payment_approved',
     'subscription.plan_change.rejected','subscription.trial_expired','subscription.grace_expired','subscription.payment.submitted','subscription.payment.verified','subscription.payment.failed',
     'billing.subscription.created','billing.subscription.activated','billing.subscription.cancelled')
     AND a.entity_type IN ('subscription','subscription_payment'))
   UNION ALL
   SELECT g.id, g.created_at, NULL::uuid, NULL::text, g.actor_kind, g.actor_key, g.action,
    g.entity_type, g.entity_id, NULL::uuid, g.outcome, g.request_id, CASE WHEN g.entity_type='operator_access' AND g.redacted_summary->>'permission' ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN g.redacted_summary->>'permission' END, NULL::jsonb
   FROM global_audit_event g
   WHERE g.actor_kind = 'operator' AND g.entity_type IN ('operator_session','platform_payment_method','operator','operator_access')
   UNION ALL
   SELECT c.id, c.created_at, NULL::uuid, NULL::text, 'operator', 'operator:' || c.operator_subject,
    'operator.payment_method.' || c.action, 'platform_payment_method', c.platform_payment_method_id,
    NULL::uuid, 'succeeded', c.request_id, NULL::text, NULL::jsonb
   FROM platform_payment_method_change c
   UNION ALL
   SELECT e.id, e.effective_at, e.tenant_id, t.name, 'unrecorded', 'not-recorded',
    'subscription.' || e.event_type::text, 'subscription', e.subscription_id, NULL::uuid,
    'succeeded', 'subscription-event:' || e.id::text, NULL::text, NULL::jsonb
   FROM subscription_event e JOIN tenant t ON t.id=e.tenant_id
  ), filtered AS (
   SELECT * FROM events e WHERE
    (p_input->>'tenant_id' IS NULL OR e.tenant_id = (p_input->>'tenant_id')::uuid)
    AND (p_input->>'actor_kind' IS NULL OR e.actor_kind = p_input->>'actor_kind')
    AND (p_input->>'actor_key' IS NULL OR e.actor_key = p_input->>'actor_key')
    AND (p_input->>'action' IS NULL OR e.action = p_input->>'action')
    AND (p_input->>'entity_type' IS NULL OR e.entity_type = p_input->>'entity_type')
    AND (p_input->>'outcome' IS NULL OR e.outcome = p_input->>'outcome')
    AND (p_input->>'occurred_from' IS NULL OR e.occurred_at >= (p_input->>'occurred_from')::timestamptz)
    AND (p_input->>'occurred_to' IS NULL OR e.occurred_at < (p_input->>'occurred_to')::timestamptz)
    AND (p_input->>'at' IS NULL OR (e.occurred_at,e.event_id) < ((p_input->>'at')::timestamptz,(p_input->>'id')::uuid))
   ORDER BY occurred_at DESC,event_id DESC LIMIT bounded
  ) SELECT coalesce(jsonb_agg(to_jsonb(filtered) ORDER BY occurred_at DESC,event_id DESC),'[]') INTO result FROM filtered;
 WHEN 'subscriptions' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY current_period_end DESC NULLS LAST,tenant_id DESC),'[]') INTO result FROM (
   SELECT s.tenant_id,t.name AS business_name,p.code AS plan_code,s.status,p.currency,
    s.current_period_start,s.current_period_end,s.cancel_at_period_end,
    s.trial_ends_at,s.grace_ends_at,p.monthly_minor::text AS amount_minor,
    sp.reviewed_at AS paid_at,sp.reviewed_by AS reviewed_by,
    CASE WHEN sp.submitted_by_membership_id IS NOT NULL THEN 'membership:' || sp.submitted_by_membership_id::text END AS payer_key,
    sp.amount_minor::text AS paid_amount_minor,sp.status::text AS payment_status
   FROM subscription s JOIN tenant t ON t.id=s.tenant_id JOIN plan p ON p.id=s.plan_id
   LEFT JOIN LATERAL (SELECT sp.* FROM subscription_payment sp WHERE sp.tenant_id=s.tenant_id AND sp.status='verified' ORDER BY sp.reviewed_at DESC NULLS LAST,sp.id DESC LIMIT 1) sp ON true
   WHERE (p_input->>'status' IS NULL OR s.status::text=p_input->>'status')
    AND (p_input->>'plan_code' IS NULL OR p.code=p_input->>'plan_code')
    AND (NOT(p_input ? 'id') OR (p_input->>'at' IS NOT NULL AND (s.current_period_end<(p_input->>'at')::timestamptz OR s.current_period_end IS NULL OR (s.current_period_end=(p_input->>'at')::timestamptz AND s.tenant_id<(p_input->>'id')::uuid))) OR (p_input->>'at' IS NULL AND s.current_period_end IS NULL AND s.tenant_id<(p_input->>'id')::uuid))
   ORDER BY s.current_period_end DESC NULLS LAST,s.tenant_id DESC LIMIT bounded
  ) x;
 WHEN 'businesses' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,tenant_id DESC),'[]') INTO result FROM (
   SELECT t.id AS tenant_id,t.name AS business_name,t.slug,t.status,'PHP' AS currency,t.timezone,t.created_at,t.updated_at,
    (SELECT count(*)::int FROM branch b WHERE b.tenant_id=t.id) AS branch_count,
    (SELECT count(*)::int FROM membership m WHERE m.tenant_id=t.id AND m.status='active') AS active_member_count,
    CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('plan_code',p.code,'status',s.status,'current_period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end) END AS subscription
   FROM tenant t LEFT JOIN subscription s ON s.tenant_id=t.id LEFT JOIN plan p ON p.id=s.plan_id
   WHERE (p_input->>'q' IS NULL OR position(lower(p_input->>'q') IN lower(t.name || ' ' || t.slug))>0)
    AND (NOT(p_input ? 'status') OR jsonb_array_length(p_input->'status')=0 OR p_input->'status' ? t.status::text)
    AND (p_input->>'plan_code' IS NULL OR p.code=p_input->>'plan_code')
    AND (p_input->>'at' IS NULL OR (t.created_at,t.id)<((p_input->>'at')::timestamptz,(p_input->>'id')::uuid))
   ORDER BY t.created_at DESC,t.id DESC LIMIT bounded
  )x;
 WHEN 'business' THEN
  SELECT jsonb_build_object('tenant_id',t.id,'business_name',t.name,'slug',t.slug,'status',t.status,'currency','PHP','timezone',t.timezone,'created_at',t.created_at,'updated_at',t.updated_at,
   'branches',(SELECT coalesce(jsonb_agg(jsonb_build_object('branch_id',b.id,'name',b.name,'code',b.code,'status',b.status,'timezone',b.timezone)),'[]') FROM branch b WHERE b.tenant_id=t.id),
   'membership_summary',jsonb_build_object('active_count',(SELECT count(*) FROM membership WHERE tenant_id=t.id AND status='active'),'invited_count',0,'suspended_count',(SELECT count(*) FROM membership WHERE tenant_id=t.id AND status='suspended')),
   'subscription',CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('plan_code',p.code,'status',s.status,'current_period_start',s.current_period_start,'current_period_end',s.current_period_end,'trial_ends_at',s.trial_ends_at,'grace_ends_at',s.grace_ends_at,'cancel_at_period_end',s.cancel_at_period_end) END,
   'entitlement_summary',jsonb_build_object('capability_count',(SELECT count(*) FROM plan_entitlement WHERE plan_id=s.plan_id),'overridden_capability_count',0))
  INTO result FROM tenant t LEFT JOIN subscription s ON s.tenant_id=t.id LEFT JOIN plan p ON p.id=s.plan_id WHERE t.id=(p_input->>'tenant_id')::uuid;
 WHEN 'overview' THEN
  SELECT jsonb_build_object('as_of',now(),
   'verified_cash_collections',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT currency,sum(amount_minor)::text AS amount_minor,count(*)::int AS payment_count FROM subscription_payment WHERE status='verified' AND reviewed_at IS NOT NULL GROUP BY currency)x),
   'businesses',jsonb_build_object('total',(SELECT count(*) FROM tenant),'by_status',(SELECT jsonb_agg(jsonb_build_object('status',v,'count',(SELECT count(*) FROM tenant WHERE status::text=v))) FROM unnest(ARRAY['active','restricted','cancelled']) v)),
   'subscriptions',jsonb_build_object('active',count(*) FILTER(WHERE status='active'),'trial',count(*) FILTER(WHERE status='trialing'),
    'grace',count(*) FILTER(WHERE grace_ends_at>now()),'past_due',count(*) FILTER(WHERE status='past_due'),
    'restricted',count(*) FILTER(WHERE status='restricted'),'cancelled',count(*) FILTER(WHERE status='cancelled'),
    'missing',(SELECT count(*) FROM tenant t WHERE NOT EXISTS(SELECT 1 FROM subscription s WHERE s.tenant_id=t.id)),
    'lifecycle',jsonb_build_object('expired_trials',count(*) FILTER(WHERE status='trialing' AND trial_ends_at<=now()),
     'expired_grace',count(*) FILTER(WHERE grace_ends_at<=now()),'incomplete_trials',count(*) FILTER(WHERE status='trialing' AND trial_ends_at IS NULL),'incomplete_grace',0)),
   'attention',jsonb_build_object('failed_jobs',(SELECT count(*) FROM outbox_event WHERE status='dead'),
    'failed_notifications',(SELECT count(*) FROM notification_delivery WHERE status IN ('failed','bounced')),
    'active_support_grants',(SELECT count(*) FROM support_grant WHERE revoked_at IS NULL AND starts_at<=now() AND expires_at>now())),
   'recent_businesses',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,name,slug,status,created_at FROM tenant ORDER BY created_at DESC,id DESC LIMIT 10)x))
   INTO result FROM subscription;
 WHEN 'entitlements' THEN
  SELECT jsonb_build_object('tenant_id',s.tenant_id,'plan_code',p.code,'capability_count',count(e.id),
   'overridden_capability_count',0,'capabilities',coalesce(jsonb_agg(jsonb_build_object('capability',e.capability,'enabled',e.enabled,'limit_value',e.limit_value) ORDER BY e.capability) FILTER(WHERE e.id IS NOT NULL),'[]'))
  INTO result FROM subscription s JOIN plan p ON p.id=s.plan_id LEFT JOIN plan_entitlement e ON e.plan_id=p.id
  WHERE s.tenant_id=(p_input->>'tenant_id')::uuid GROUP BY s.tenant_id,p.code;
 WHEN 'jobs' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY available_at DESC,job_id DESC),'[]') INTO result FROM (
   SELECT id AS job_id,tenant_id,event_type,status,(status='dead') AS can_retry,attempts,max_attempts,available_at,lease_until,completed_at,
    CASE WHEN safe_last_error IS NOT NULL THEN 'Delivery failed. Inspect the scoped worker diagnostics.' END AS safe_last_error,created_at
   FROM outbox_event WHERE
    (p_input->>'tenant_id' IS NULL OR tenant_id=(p_input->>'tenant_id')::uuid)
    AND (p_input->>'status' IS NULL OR status=p_input->>'status')
    AND (p_input->>'event_type' IS NULL OR event_type=p_input->>'event_type')
    AND (p_input->>'available_from' IS NULL OR available_at>=(p_input->>'available_from')::timestamptz)
    AND (p_input->>'available_to' IS NULL OR available_at<(p_input->>'available_to')::timestamptz)
    AND (p_input->>'at' IS NULL OR (available_at,id)<((p_input->>'at')::timestamptz,(p_input->>'id')::uuid))
   ORDER BY available_at DESC,id DESC LIMIT bounded
  )x;
 WHEN 'notifications' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY accepted_at DESC NULLS LAST,delivery_id DESC),'[]') INTO result FROM (
   SELECT id AS delivery_id,tenant_id,outbox_id,channel,template_version,status,(status='failed' AND provider_message_id IS NULL AND EXISTS(SELECT 1 FROM outbox_event o WHERE o.id=notification_delivery.outbox_id AND o.tenant_id=notification_delivery.tenant_id AND o.status IN ('dead','succeeded'))) AS can_retry,NULL::text AS provider_message_id,accepted_at,delivered_at
   FROM notification_delivery WHERE
    (p_input->>'tenant_id' IS NULL OR tenant_id=(p_input->>'tenant_id')::uuid)
    AND (p_input->>'status' IS NULL OR status=p_input->>'status')
    AND (p_input->>'channel' IS NULL OR channel=p_input->>'channel')
    AND (p_input->>'accepted_from' IS NULL OR accepted_at>=(p_input->>'accepted_from')::timestamptz)
    AND (p_input->>'accepted_to' IS NULL OR accepted_at<(p_input->>'accepted_to')::timestamptz)
    AND (NOT(p_input ? 'id') OR ((p_input->>'at' IS NOT NULL AND (accepted_at<(p_input->>'at')::timestamptz OR accepted_at IS NULL OR (accepted_at=(p_input->>'at')::timestamptz AND id<(p_input->>'id')::uuid))) OR (p_input->>'at' IS NULL AND accepted_at IS NULL AND id<(p_input->>'id')::uuid)))
   ORDER BY accepted_at DESC NULLS LAST,id DESC LIMIT bounded
  )x;
 WHEN 'analytics' THEN
  SELECT jsonb_build_object(
   'businesses',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',at,'count',n)),'[]') FROM(SELECT date_trunc('day',created_at AT TIME ZONE 'Asia/Manila')::date::text AS at,count(*)::int n FROM tenant GROUP BY 1)x),
   'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',at,'count',n)),'[]') FROM(SELECT date_trunc('day',created_at AT TIME ZONE 'Asia/Manila')::date::text AS at,count(*)::int n FROM membership GROUP BY 1)x),
   'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',at,'count',n,'event_type',event_type)),'[]') FROM(SELECT date_trunc('day',effective_at AT TIME ZONE 'Asia/Manila')::date::text AS at,event_type::text,count(*)::int n FROM subscription_event WHERE event_type IN ('trial_started','past_due','restricted','plan_changed') GROUP BY 1,2)x),
   'subscriptions',(SELECT jsonb_build_object('active',count(*) FILTER(WHERE status='active'),'trialing',count(*) FILTER(WHERE status='trialing'),'past_due',count(*) FILTER(WHERE status='past_due'),'restricted',count(*) FILTER(WHERE status='restricted'),'cancelled',count(*) FILTER(WHERE status='cancelled')) FROM subscription),
   'run_rate',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT p.currency,sum(p.monthly_minor)::text AS amount_minor,count(*)::int AS active_subscription_count FROM subscription s JOIN plan p ON p.id=s.plan_id WHERE s.status='active' GROUP BY p.currency)x)
  ) INTO result;
 WHEN 'payment-targets' THEN
  IF jsonb_typeof(p_input->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'ids')>200 THEN RAISE EXCEPTION 'invalid payment ids' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('payment_id',sp.id,'target_plan_code',p.code)),'[]') INTO result
   FROM subscription_payment sp LEFT JOIN plan p ON p.id=sp.target_plan_id
   WHERE sp.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_input->'ids'));
 WHEN 'grants' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,grant_id DESC),'[]') INTO result FROM (
   SELECT g.id AS grant_id,g.tenant_id,t.name AS business_name,g.operator_subject,g.granted_by,g.permission_codes,
    g.starts_at,g.expires_at,g.revoked_at,g.created_at,
    CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked' WHEN g.expires_at<=now() THEN 'expired' WHEN g.starts_at>now() THEN 'scheduled' ELSE 'active' END AS status
   FROM support_grant g JOIN tenant t ON t.id=g.tenant_id
   WHERE (p_input->>'tenant_id' IS NULL OR g.tenant_id=(p_input->>'tenant_id')::uuid)
    AND (p_input->>'at' IS NULL OR (g.created_at,g.id)<((p_input->>'at')::timestamptz,(p_input->>'id')::uuid))
   ORDER BY g.created_at DESC,g.id DESC LIMIT bounded
  )x;
 ELSE RAISE EXCEPTION 'unknown operator projection' USING ERRCODE='22023';
 END CASE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION operator_console_projection(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_console_projection(text,jsonb) TO drezivo_app;

-- Commands record their redacted result in the existing append-only global audit ledger.
-- Key hashes and canonical-body hashes make replays durable across API restarts.
CREATE UNIQUE INDEX IF NOT EXISTS global_operator_command_once
 ON global_audit_event (actor_key, (redacted_summary->>'intent_hash'))
 WHERE actor_kind='operator' AND entity_type='operator_command';
CREATE OR REPLACE FUNCTION operator_console_command(p_kind text,p_subject text,p_key text,p_request text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text := 'operator:' || p_subject; prior jsonb; result jsonb; target uuid;
 tenant uuid; event_action text; payload_hash text := encode(digest(p_kind || ':' || p_body::text,'sha256'),'hex');
BEGIN
 IF nullif(current_setting('app.actor_kind',true),'') IS DISTINCT FROM 'operator'
 OR nullif(current_setting('app.principal_id',true),'') IS DISTINCT FROM actor
 OR nullif(current_setting('app.tenant_id',true),'') IS NOT NULL THEN
  RAISE EXCEPTION 'operator context required' USING ERRCODE='42501';
 END IF;
 IF p_kind NOT IN ('grant.create','grant.revoke','job.retry','notification.retry') OR length(p_key) NOT BETWEEN 16 AND 200 THEN
  RAISE EXCEPTION 'invalid command' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor || ':' || p_key,0));
 SELECT redacted_summary INTO prior FROM global_audit_event
 WHERE actor_key=actor AND actor_kind='operator' AND entity_type='operator_command'
 AND redacted_summary->>'intent_hash'=encode(digest(p_key,'sha256'),'hex');
 IF prior IS NOT NULL THEN
  IF prior->>'payload_hash' IS DISTINCT FROM payload_hash THEN RAISE EXCEPTION 'intent conflict' USING ERRCODE='23505'; END IF;
  RETURN prior->'result';
 END IF;
 IF p_kind='grant.create' THEN
  tenant := (p_body->>'tenant_id')::uuid;
  IF (p_body->>'expires_at')::timestamptz <= now()
   OR (p_body->>'expires_at')::timestamptz <= (p_body->>'starts_at')::timestamptz
   OR (p_body->>'expires_at')::timestamptz-(p_body->>'starts_at')::timestamptz > interval '8 hours'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_body->'permission_codes') v WHERE v NOT IN ('business.summary.read','subscription.read','entitlement.read','audit.read')) THEN
   RAISE EXCEPTION 'invalid grant' USING ERRCODE='22023';
  END IF;
  INSERT INTO support_grant(tenant_id,operator_subject,granted_by,permission_codes,reason,starts_at,expires_at)
   VALUES(tenant,p_subject,p_subject,p_body->'permission_codes',p_body->>'reason',(p_body->>'starts_at')::timestamptz,(p_body->>'expires_at')::timestamptz) RETURNING id INTO target;
  event_action := 'operator.support.grant.created';
 ELSIF p_kind='grant.revoke' THEN
  target := (p_body->>'grant_id')::uuid;
  SELECT tenant_id INTO tenant FROM support_grant WHERE id=target FOR UPDATE;
  IF tenant IS NULL THEN RAISE EXCEPTION 'resource not found' USING ERRCODE='P0002'; END IF;
  UPDATE support_grant SET revoked_at=coalesce(revoked_at,now()) WHERE id=target;
  event_action := 'operator.support.grant.revoked';
 ELSE
  target := (p_body->>'resource_id')::uuid;
  IF p_kind='job.retry' THEN
   SELECT tenant_id INTO tenant FROM outbox_event WHERE id=target FOR UPDATE;
   IF tenant IS NULL THEN RAISE EXCEPTION 'resource not found' USING ERRCODE='P0002'; END IF;
   UPDATE outbox_event SET status='pending',attempts=0,available_at=now(),lease_token=NULL,lease_until=NULL,safe_last_error=NULL,completed_at=NULL WHERE id=target AND status='dead';
   IF NOT FOUND THEN RAISE EXCEPTION 'retry state conflict' USING ERRCODE='23505'; END IF;
  ELSE
   SELECT tenant_id INTO tenant FROM notification_delivery WHERE id=target FOR UPDATE;
   IF tenant IS NULL THEN RAISE EXCEPTION 'resource not found' USING ERRCODE='P0002'; END IF;
   -- An ambiguous provider acceptance must never be resent. Only known failed delivery is retryable.
   UPDATE notification_delivery SET status='queued' WHERE id=target AND status='failed' AND provider_message_id IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'retry state conflict' USING ERRCODE='23505'; END IF;
   UPDATE outbox_event SET status='pending',attempts=0,available_at=now(),lease_token=NULL,lease_until=NULL,safe_last_error=NULL,completed_at=NULL
    WHERE id=(SELECT outbox_id FROM notification_delivery WHERE id=target) AND status IN ('dead','succeeded');
   IF NOT FOUND THEN RAISE EXCEPTION 'retry state conflict' USING ERRCODE='23505'; END IF;
  END IF;
  result := jsonb_build_object('command_kind',p_kind,'resource_id',target,'status','accepted','request_id',p_request,'accepted_at',now());
  event_action := 'operator.' || p_kind;
 END IF;
 IF p_kind IN ('grant.create','grant.revoke') THEN
  SELECT jsonb_build_object('grant_id',id,'tenant_id',tenant_id,'operator_subject',operator_subject,'permission_codes',permission_codes,
   'starts_at',starts_at,'expires_at',expires_at,'revoked_at',revoked_at,'created_at',created_at) INTO result FROM support_grant WHERE id=target;
 END IF;
 INSERT INTO global_audit_event(actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id)
 VALUES('operator',actor,event_action,'operator_command',target,'succeeded',jsonb_build_object('intent_hash',encode(digest(p_key,'sha256'),'hex'),'payload_hash',payload_hash,'result',result),p_request);
 INSERT INTO audit_event(tenant_id,actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id,occurred_at)
 VALUES(tenant,'operator',actor,event_action,CASE WHEN p_kind LIKE 'grant.%' THEN 'support_grant' WHEN p_kind='job.retry' THEN 'outbox_event' ELSE 'notification_delivery' END,target,'succeeded','{}',p_request,now());
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION operator_console_command(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_console_command(text,text,text,text,jsonb) TO drezivo_app;
