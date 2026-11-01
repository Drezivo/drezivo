-- Operator announcements: one email to every client business (maintenance windows, product
-- updates), sent by the business worker because only this repository can send email.
--
-- The operator console calls operator_send_announcement once per compose intent. It records the
-- announcement and queues one `operator.announcement` outbox job per business that is not
-- cancelled, all in one transaction, so a retry with the same intent key returns the same
-- announcement and never queues a second copy. The worker emails each business's contact address.

CREATE TABLE public.operator_announcement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key text NOT NULL,
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  created_by text NOT NULL,
  request_id text NOT NULL,
  recipient_count integer NOT NULL CHECK (recipient_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_announcement_intent_key_key UNIQUE (intent_key)
);
CREATE INDEX operator_announcement_created_at_idx ON public.operator_announcement (created_at DESC);

-- Delivery progress joins an announcement to its jobs by dedupe key.
CREATE INDEX outbox_event_operator_announcement_idx
  ON public.outbox_event (dedupe_key) WHERE event_type = 'operator.announcement';

-- Written only through operator_send_announcement. The runtime role may read it only in the
-- worker's system context, to deliver it.
ALTER TABLE public.operator_announcement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_announcement FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_announcement FROM PUBLIC;
CREATE POLICY operator_announcement_system_read ON public.operator_announcement
  FOR SELECT USING (nullif(current_setting('app.actor_kind', true), '') = 'system');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drezivo_app') THEN
    REVOKE ALL ON public.operator_announcement FROM drezivo_app;
    GRANT SELECT ON public.operator_announcement TO drezivo_app;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.operator_send_announcement(
  p_subject_actor text, p_key text, p_request text, p_subject text, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor text := 'operator:' || p_subject_actor;
  existing public.operator_announcement%ROWTYPE;
  created public.operator_announcement%ROWTYPE;
  recipients integer;
BEGIN
  IF nullif(current_setting('app.actor_kind', true), '') IS DISTINCT FROM 'operator'
  OR nullif(current_setting('app.principal_id', true), '') IS DISTINCT FROM actor
  OR nullif(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'operator context required' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_key, '')) NOT BETWEEN 16 AND 200
  OR length(btrim(coalesce(p_subject, ''))) NOT BETWEEN 1 AND 160
  OR length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'invalid announcement' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('operator-announcement:' || p_key, 0));
  SELECT * INTO existing FROM public.operator_announcement WHERE intent_key = p_key;
  IF FOUND THEN
    IF existing.subject IS DISTINCT FROM btrim(p_subject) OR existing.body IS DISTINCT FROM btrim(p_body)
    OR existing.created_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'intent conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', existing.id, 'subject', existing.subject,
      'recipient_count', existing.recipient_count, 'created_at', existing.created_at, 'replayed', true);
  END IF;

  SELECT count(*) INTO recipients FROM public.tenant WHERE status <> 'cancelled';
  INSERT INTO public.operator_announcement (intent_key, subject, body, created_by, request_id, recipient_count)
  VALUES (p_key, btrim(p_subject), btrim(p_body), actor, coalesce(p_request, 'unknown'), recipients)
  RETURNING * INTO created;

  INSERT INTO public.outbox_event (tenant_id, dedupe_key, event_type, payload)
  SELECT t.id, 'operator.announcement:' || created.id, 'operator.announcement',
         jsonb_build_object('announcement_id', created.id)
    FROM public.tenant t
   WHERE t.status <> 'cancelled'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.global_audit_event (actor_kind, actor_key, action, entity_type, entity_id, outcome, redacted_summary, request_id)
  VALUES ('operator', actor, 'operator.announcement.sent', 'operator_announcement', created.id, 'succeeded',
          jsonb_build_object('recipient_count', recipients, 'subject_length', length(created.subject)), coalesce(p_request, 'unknown'));

  RETURN jsonb_build_object('id', created.id, 'subject', created.subject,
    'recipient_count', created.recipient_count, 'created_at', created.created_at, 'replayed', false);
END $$;

-- Recent announcements with delivery progress from their outbox jobs.
CREATE OR REPLACE FUNCTION public.operator_announcements(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF nullif(current_setting('app.actor_kind', true), '') IS DISTINCT FROM 'operator'
  OR nullif(current_setting('app.principal_id', true), '') IS NULL
  OR nullif(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'operator context required' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(item) ORDER BY item.created_at DESC)
      FROM (
        SELECT a.id, a.subject, a.body, a.created_by, a.recipient_count, a.created_at,
               count(o.id) FILTER (WHERE o.status = 'succeeded')::int AS delivered,
               count(o.id) FILTER (WHERE o.status IN ('pending', 'leased'))::int AS queued,
               count(o.id) FILTER (WHERE o.status = 'dead')::int AS failed
          FROM public.operator_announcement a
          LEFT JOIN public.outbox_event o
            ON o.event_type = 'operator.announcement' AND o.dedupe_key = 'operator.announcement:' || a.id
         GROUP BY a.id
         ORDER BY a.created_at DESC
         LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
      ) AS item
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.operator_send_announcement(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.operator_announcements(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drezivo_app') THEN
    GRANT EXECUTE ON FUNCTION public.operator_send_announcement(text, text, text, text, text) TO drezivo_app;
    GRANT EXECUTE ON FUNCTION public.operator_announcements(integer) TO drezivo_app;
  END IF;
END $$;

COMMENT ON TABLE public.operator_announcement IS
  'Operator-composed email to every client business. Written only by operator_send_announcement; delivered by the business worker (operator.announcement).';
