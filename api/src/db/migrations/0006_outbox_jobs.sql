-- Invariant: `outbox_event` rows are written in the SAME transaction as the business event
-- that causes them (TRD §8) — this migration only creates the table; the atomicity guarantee
-- itself comes from every INSERT into this table living inside the same `withTenantTransaction`
-- call as the domain write it announces (see reservations.service.ts). A worker claims a due
-- row by moving it to `leased` with a lease token/deadline using `FOR UPDATE SKIP LOCKED`
-- (worker/runner.ts) — SKIP LOCKED is what lets multiple worker replicas poll the same table
-- concurrently without doubling up on the same event, which an application-level "claim" flag
-- alone cannot do atomically under concurrent pollers.
--
-- Invariant: a crashed worker's lease simply expires (`lease_until` passes) and becomes
-- reclaimable by any worker — this is why `attempts`/`max_attempts`/terminal `dead` status
-- exist: TRD §8 adversarial test 3 requires that a worker outage never duplicates a financial
-- effect on resume, which means completion must be idempotent on the CONSUMER side
-- (`dedupe_key`), not merely "assume the lease means only one worker ever tried".
--
-- This file also creates the platform-billing, audit, and import/export job tables — grouped
-- here because they are all durable-job/infrastructure concerns without their own dedicated
-- migration slot in this repo's fixed numbering, not because they are the same domain module
-- as outbox_event (they are not; see db/schema/billing.ts and db/schema/audit.ts for the
-- actual module boundaries these tables belong to).

CREATE TABLE outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  dedupe_key text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'succeeded', 'dead')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  safe_last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_event_tenant_dedupe_key_key UNIQUE (tenant_id, dedupe_key)
);
-- The worker's claim query: "pending or lease-expired rows due now, oldest first" — this is
-- the one index the whole worker loop depends on for throughput at scale.
CREATE INDEX outbox_event_due_idx ON outbox_event (available_at) WHERE status IN ('pending', 'leased');

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload_digest text NOT NULL,
  safe_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'rejected')),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Global table, no tenant_id: a provider event is deduplicated by (provider, its own event
  -- id) BEFORE any tenant is resolved from the payload — this is what makes replayed webhook
  -- delivery a safe no-op (TRD §8) rather than a second effect.
  CONSTRAINT webhook_inbox_provider_event_key UNIQUE (provider, provider_event_id)
);

CREATE TABLE notification_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  outbox_id uuid NOT NULL REFERENCES outbox_event (id),
  channel text NOT NULL,
  template_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'provider_accepted', 'delivered', 'bounced', 'failed')),
  provider_message_id text,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_delivery_outbox_id_idx ON notification_delivery (outbox_id);

CREATE TABLE import_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  requested_by uuid NOT NULL REFERENCES membership (id),
  file_id uuid NOT NULL REFERENCES file_object (id),
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'committed', 'failed')),
  content_hash text NOT NULL,
  intent_key text NOT NULL,
  result_summary jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Same intent replayed (same file content + same declared intent) must not commit twice.
  CONSTRAINT import_job_tenant_intent_key_key UNIQUE (tenant_id, intent_key)
);

CREATE TABLE export_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  requested_by uuid NOT NULL REFERENCES membership (id),
  scope_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  result_file_id uuid REFERENCES file_object (id),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX export_job_tenant_id_idx ON export_job (tenant_id);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  actor_key text NOT NULL,
  support_grant_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  redacted_summary jsonb NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_tenant_created_idx ON audit_event (tenant_id, created_at DESC);

CREATE TABLE support_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  operator_subject text NOT NULL,
  granted_by text NOT NULL,
  permission_codes jsonb NOT NULL DEFAULT '[]',
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_grant_window_valid CHECK (expires_at > starts_at)
);
CREATE INDEX support_grant_active_idx ON support_grant (tenant_id) WHERE revoked_at IS NULL;

ALTER TABLE audit_event
  ADD CONSTRAINT audit_event_support_grant_fk FOREIGN KEY (support_grant_id) REFERENCES support_grant (id);

-- Platform (Drezivo-owned) subscription billing — distinct ledger from renter-facing finance.sql tables.
CREATE TABLE plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version integer NOT NULL,
  monthly_minor integer NOT NULL CHECK (monthly_minor >= 0),
  currency text NOT NULL DEFAULT 'PHP',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_code_version_key UNIQUE (code, version)
);

CREATE TABLE plan_entitlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plan (id),
  capability text NOT NULL,
  limit_value integer,
  enabled boolean NOT NULL DEFAULT true,
  CONSTRAINT plan_entitlement_plan_capability_key UNIQUE (plan_id, capability)
);

CREATE TABLE subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  plan_id uuid NOT NULL REFERENCES plan (id),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'restricted', 'cancelled')),
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One current subscription per tenant (Data-Model §8).
CREATE UNIQUE INDEX subscription_tenant_key ON subscription (tenant_id);

CREATE TABLE subscription_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  subscription_id uuid NOT NULL REFERENCES subscription (id),
  prior_plan_id uuid REFERENCES plan (id),
  next_plan_id uuid NOT NULL REFERENCES plan (id),
  event_type text NOT NULL CHECK (event_type IN ('trial_started', 'converted', 'renewed', 'plan_changed', 'past_due', 'restricted', 'cancelled')),
  effective_at timestamptz NOT NULL,
  business_key text NOT NULL,
  CONSTRAINT subscription_event_tenant_business_key_key UNIQUE (tenant_id, business_key)
);
CREATE INDEX subscription_event_subscription_id_idx ON subscription_event (subscription_id);

CREATE TABLE subscription_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  subscription_id uuid NOT NULL REFERENCES subscription (id),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'PHP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
  collection_method text NOT NULL,
  provider_reference text,
  business_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_payment_tenant_business_key_key UNIQUE (tenant_id, business_key)
);
CREATE INDEX subscription_payment_subscription_id_idx ON subscription_payment (subscription_id);
