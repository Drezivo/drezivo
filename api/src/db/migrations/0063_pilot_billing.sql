-- Pilot billing: one plan (Standard, internal code `starter`), a 14-day trial, manual payment of
-- Drezivo's subscription with uploaded proof that an operator approves, and businesses' own
-- payment-method material (PDF/image) for renters.
--
-- Idempotent: every statement can run twice (IF NOT EXISTS, guarded DO blocks, value-conditional
-- UPDATEs). Access (full / read_only / locked) is derived at request time from `subscription`
-- (api/src/modules/billing/access.ts); nothing here schedules a state change.
--
-- Reversal (manual, in this order, only if the pilot model is abandoned):
--   1. DROP INDEX subscription_payment_one_pending_per_tenant;
--      ALTER TABLE subscription_payment DROP COLUMN payment_method_id, reference, proof_file_id,
--        submitted_by_membership_id, reviewed_at, reviewed_by, review_note;
--   2. DROP TABLE tenant_operator_note; DROP TABLE platform_payment_method;
--   3. ALTER TABLE payment_method DROP COLUMN presentation, material_file_id;
--   4. Restore file_object_purpose_check to the 0023 list (after deleting/reclassifying rows that
--      use the two new purposes).
--   5. UPDATE plan SET active = true WHERE code IN ('professional', 'business') AND version = 1;
--      restore starter v1 limits to 125 assets / 0 seats (0053). Subscriptions moved to starter and
--      past_due/restricted rows reset to trialing are NOT restored automatically; the
--      `subscription_event` rows with business_key 'migration:0063:*' record the prior plan.

-- 1. Plans -----------------------------------------------------------------------------------
-- Documented exception to plan immutability: the operator app accepts only plan_version 1 and
-- the codes starter|professional|business, so "Standard" keeps the internal code `starter`, v1,
-- with its entitlements raised to 1,000 garments and 10 front-desk seats. Price stays 30000 PHP
-- minor units (P300).
DO $$
DECLARE
  starter_id uuid;
BEGIN
  SELECT id INTO starter_id FROM plan WHERE code = 'starter' AND version = 1;
  IF starter_id IS NULL THEN
    RAISE EXCEPTION 'starter v1 plan is missing';
  END IF;

  UPDATE plan SET active = true WHERE id = starter_id AND active IS NOT TRUE;
  UPDATE plan SET active = false WHERE code IN ('professional', 'business') AND version = 1 AND active;

  INSERT INTO plan_entitlement (plan_id, capability, limit_value, enabled)
  VALUES (starter_id, 'physical_assets.max', 1000, true), (starter_id, 'frontdesk_seats.max', 10, true)
  ON CONFLICT (plan_id, capability) DO UPDATE SET limit_value = EXCLUDED.limit_value, enabled = true;

  -- Every workspace moves to the one plan. The event keeps the prior plan for audit/reversal.
  INSERT INTO subscription_event (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
  SELECT s.tenant_id, s.id, s.plan_id, starter_id, 'plan_changed', now(), 'migration:0063:plan_starter'
    FROM subscription s
   WHERE s.plan_id <> starter_id
  ON CONFLICT (tenant_id, business_key) DO NOTHING;
  UPDATE subscription SET plan_id = starter_id WHERE plan_id <> starter_id;

  UPDATE organization_onboarding
     SET selected_plan_code = 'starter', updated_at = now()
   WHERE status IN ('incomplete', 'payment_pending')
     AND selected_plan_code IS NOT NULL
     AND selected_plan_code <> 'starter';
END $$;

-- 2. Subscription lifecycle ------------------------------------------------------------------
-- The old sweep moved trials to past_due and then restricted (also restricting the tenant).
-- Those rows become trialing with their original trial end, so they read as "trial ended" in the
-- derived access model. A tenant restricted BY BILLING (its subscription is also restricted) goes
-- back to active; a tenant an operator restricted by hand keeps its restriction.
UPDATE tenant t
   SET status = 'active', updated_at = now()
  FROM subscription s
 WHERE s.tenant_id = t.id AND s.status = 'restricted' AND t.status = 'restricted';

UPDATE subscription
   SET status = 'trialing',
       trial_ends_at = COALESCE(trial_ends_at, current_period_end),
       grace_ends_at = NULL
 WHERE status IN ('past_due', 'restricted');

COMMENT ON COLUMN subscription.grace_ends_at IS
  'Pilot billing: operator-granted read-only extension end ("read-only until"). While it is in the '
  'future and after the trial/paid end, the workspace is read-only and its storefront stays online.';

-- 3. Drezivo's own payment methods (global, operator-managed) -----------------------------------
CREATE TABLE IF NOT EXISTS platform_payment_method (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CONSTRAINT platform_payment_method_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  account_name text CONSTRAINT platform_payment_method_account_name_check CHECK (account_name IS NULL OR char_length(account_name) <= 160),
  account_number text CONSTRAINT platform_payment_method_account_number_check CHECK (account_number IS NULL OR char_length(account_number) <= 120),
  instructions text CONSTRAINT platform_payment_method_instructions_check CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  qr_image bytea CONSTRAINT platform_payment_method_qr_size_check CHECK (qr_image IS NULL OR octet_length(qr_image) BETWEEN 1 AND 524288),
  qr_mime text CONSTRAINT platform_payment_method_qr_mime_check CHECK (qr_mime IS NULL OR qr_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1 CONSTRAINT platform_payment_method_version_check CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_payment_method_qr_pair_check CHECK ((qr_image IS NULL) = (qr_mime IS NULL))
);
CREATE INDEX IF NOT EXISTS platform_payment_method_active_order_idx
  ON platform_payment_method (sort_order, id) WHERE active;

-- SECURITY: the business API only READS this table. The operator API (separate repository) writes
-- it through its direct-DB adapter, which also connects as drezivo_app (ADR 0025), so INSERT and
-- UPDATE must be granted to that role. Business API code must never write here; every operator
-- change is audited on the operator side (operator_command + audit_event). DELETE is never
-- granted: methods are retired with active = false so past payments keep their label.
-- Follow-up hardening: a dedicated operator DB role.
REVOKE ALL PRIVILEGES ON TABLE platform_payment_method FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE platform_payment_method FROM drezivo_worker;
REVOKE ALL PRIVILEGES ON TABLE platform_payment_method FROM drezivo_app;
GRANT SELECT, INSERT, UPDATE ON platform_payment_method TO drezivo_app;

-- 3b. Operator audit + idempotency log for global payment-method writes ------------------------
-- operator_command and audit_event require a tenant, and these methods belong to no tenant. The
-- operator API records every create/update/(de)activation here, and (operator_subject, intent_key)
-- is its idempotency key. Append-only for the runtime role.
CREATE TABLE IF NOT EXISTS platform_payment_method_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_payment_method_id uuid NOT NULL REFERENCES platform_payment_method (id),
  operator_subject text NOT NULL,
  action text NOT NULL CONSTRAINT platform_payment_method_change_action_check
    CHECK (action IN ('created', 'updated', 'activated', 'deactivated')),
  intent_key text NOT NULL,
  reason text NOT NULL CONSTRAINT platform_payment_method_change_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  redacted_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_payment_method_change_intent_key UNIQUE (operator_subject, intent_key)
);
CREATE INDEX IF NOT EXISTS platform_payment_method_change_method_idx
  ON platform_payment_method_change (platform_payment_method_id, created_at DESC);
REVOKE ALL PRIVILEGES ON TABLE platform_payment_method_change FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE platform_payment_method_change FROM drezivo_worker;
REVOKE ALL PRIVILEGES ON TABLE platform_payment_method_change FROM drezivo_app;
GRANT SELECT, INSERT ON platform_payment_method_change TO drezivo_app;

-- 4. Subscription payment proof and review --------------------------------------------------
ALTER TABLE subscription_payment
  ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES platform_payment_method (id),
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS proof_file_id uuid,
  ADD COLUMN IF NOT EXISTS submitted_by_membership_id uuid REFERENCES membership (id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS review_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_payment_reference_check') THEN
    ALTER TABLE subscription_payment ADD CONSTRAINT subscription_payment_reference_check
      CHECK (reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_payment_review_note_check') THEN
    ALTER TABLE subscription_payment ADD CONSTRAINT subscription_payment_review_note_check
      CHECK (review_note IS NULL OR char_length(review_note) <= 500);
  END IF;
  -- Composite key: a proof must be a file of the SAME tenant (file_object_tenant_id_id_key, 0023).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_payment_proof_file_fk') THEN
    ALTER TABLE subscription_payment ADD CONSTRAINT subscription_payment_proof_file_fk
      FOREIGN KEY (tenant_id, proof_file_id) REFERENCES file_object (tenant_id, id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM subscription_payment WHERE status = 'pending' GROUP BY tenant_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'several pending subscription payments exist for one tenant; resolve them before running 0063';
  END IF;
END $$;

-- One payment waits for review at a time; the submit command also checks this under a row lock.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_one_pending_per_tenant
  ON subscription_payment (tenant_id) WHERE status = 'pending';
-- The operator queue lists pending and recent payments across tenants, newest first.
CREATE INDEX IF NOT EXISTS subscription_payment_status_created_idx
  ON subscription_payment (status, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payment_tenant_created_idx
  ON subscription_payment (tenant_id, created_at DESC);

-- 5. Operator notes per business (append-only) -----------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_operator_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  body text NOT NULL CONSTRAINT tenant_operator_note_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  author_label text NOT NULL CONSTRAINT tenant_operator_note_author_check CHECK (char_length(btrim(author_label)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_operator_note_tenant_created_idx
  ON tenant_operator_note (tenant_id, created_at DESC, id DESC);

-- Tenant-scoped like every tenant-owned table, so a business session can never read another
-- tenant's notes. No business API route reads this table at all; the operator API writes and
-- reads it (as drezivo_app, ADR 0025). Append-only: no UPDATE or DELETE for anyone at runtime.
ALTER TABLE tenant_operator_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_operator_note FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_operator_note;
CREATE POLICY tenant_isolation ON tenant_operator_note
  FOR ALL TO drezivo_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE ALL PRIVILEGES ON TABLE tenant_operator_note FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE tenant_operator_note FROM drezivo_worker;
REVOKE ALL PRIVILEGES ON TABLE tenant_operator_note FROM drezivo_app;
GRANT SELECT, INSERT ON tenant_operator_note TO drezivo_app;

-- 6. File purposes ---------------------------------------------------------------------------
ALTER TABLE file_object DROP CONSTRAINT IF EXISTS file_object_purpose_check;
ALTER TABLE file_object
  ADD CONSTRAINT file_object_purpose_check
  CHECK (purpose IN (
    'catalogue_image',
    'measurement_guide',
    'payment_receipt',
    'verification_document',
    'storefront_asset',
    'export_result',
    'subscription_payment_proof',
    'payment_method_material'
  ));

-- 7. Business payment methods: typed details or the business's own instructions file ----------
ALTER TABLE payment_method
  ADD COLUMN IF NOT EXISTS presentation text NOT NULL DEFAULT 'details',
  ADD COLUMN IF NOT EXISTS material_file_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_method_presentation_check') THEN
    ALTER TABLE payment_method ADD CONSTRAINT payment_method_presentation_check
      CHECK (presentation IN ('details', 'material'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_method_material_required_check') THEN
    ALTER TABLE payment_method ADD CONSTRAINT payment_method_material_required_check
      CHECK (presentation <> 'material' OR material_file_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_method_material_file_fk') THEN
    ALTER TABLE payment_method ADD CONSTRAINT payment_method_material_file_fk
      FOREIGN KEY (tenant_id, material_file_id) REFERENCES file_object (tenant_id, id);
  END IF;
END $$;

-- The online-method limit counts active non-cash methods per tenant.
CREATE INDEX IF NOT EXISTS payment_method_tenant_active_online_idx
  ON payment_method (tenant_id) WHERE active AND rail <> 'cash';

-- 8. Worker read of the business email ------------------------------------------------------
-- The operator API cannot seal emails, so on approve/reject it enqueues a
-- 'subscription.payment_reviewed' outbox row and the worker composes the owner email. The worker
-- role needs to read the business email of THAT tenant only (tenant-scoped, read-only).
GRANT SELECT ON tenant_settings TO drezivo_worker;
DROP POLICY IF EXISTS worker_tenant_read ON tenant_settings;
CREATE POLICY worker_tenant_read ON tenant_settings
  FOR SELECT TO drezivo_worker
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
