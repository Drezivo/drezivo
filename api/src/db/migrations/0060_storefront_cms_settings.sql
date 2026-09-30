-- Storefront CMS, business settings, and guest email verification.
--
-- 1. `storefront` gains the owner-edited `content` and `checkout` documents next to the existing
--    `branding`/`contact`, plus `version` for optimistic concurrency (every edit is a conditional
--    UPDATE ... WHERE version = $expected, so a double submit or stale tab cannot overwrite) and
--    `updated_at`. The documents are validated by the contracts package before they are written.
-- 2. `tenant_settings` holds workspace-level business information and email notification
--    preferences. One row per tenant, created lazily by the API and backfilled here.
-- 3. `guest_email_verification` stores only HMAC digests of the email and SHA-256 hashes of the
--    one-time code and verification token; plaintext never reaches the database.
-- 4. Audit rows gain a `guest` actor kind so storefront guest actions are recorded as what they are.
-- 5. `resolve_guest_access_tenant` lets a guest request that carries only a bearer token resolve
--    which tenant to scope its transaction to, without granting cross-tenant reads of the table.

ALTER TABLE audit_event
  DROP CONSTRAINT audit_event_actor_kind_check,
  ADD CONSTRAINT audit_event_actor_kind_check CHECK (actor_kind IN ('staff', 'operator', 'system', 'guest'));

-- Guests may request fittings from a published storefront; those rows are marked `storefront`.
ALTER TABLE fitting_appointment
  DROP CONSTRAINT fitting_appointment_booking_channel_check,
  ADD CONSTRAINT fitting_appointment_booking_channel_check CHECK (booking_channel IN ('staff', 'storefront'));

ALTER TABLE storefront
  ADD COLUMN content jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN checkout jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE storefront
  ADD CONSTRAINT storefront_version_positive CHECK (version > 0),
  ADD CONSTRAINT storefront_documents_are_objects CHECK (
    jsonb_typeof(branding) = 'object'
    AND jsonb_typeof(contact) = 'object'
    AND jsonb_typeof(content) = 'object'
    AND jsonb_typeof(checkout) = 'object'
  );

CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id) ON DELETE RESTRICT,
  business_email text,
  business_phone text,
  business_address text,
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_settings_version_positive CHECK (version > 0),
  CONSTRAINT tenant_settings_preferences_object CHECK (jsonb_typeof(notification_preferences) = 'object'),
  CONSTRAINT tenant_settings_email_length CHECK (business_email IS NULL OR char_length(business_email) <= 254),
  CONSTRAINT tenant_settings_phone_length CHECK (business_phone IS NULL OR char_length(business_phone) <= 32),
  CONSTRAINT tenant_settings_address_length CHECK (business_address IS NULL OR char_length(business_address) <= 300)
);

INSERT INTO tenant_settings (tenant_id)
SELECT id FROM tenant
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE guest_email_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE RESTRICT,
  email_digest text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  token_hash text,
  token_expires_at timestamptz,
  token_uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_email_verification_attempts_bounded CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT guest_email_verification_token_uses_bounded CHECK (token_uses BETWEEN 0 AND 5),
  CONSTRAINT guest_email_verification_token_pair CHECK ((token_hash IS NULL) = (token_expires_at IS NULL)),
  CONSTRAINT guest_email_verification_token_requires_verified CHECK (token_hash IS NULL OR verified_at IS NOT NULL),
  CONSTRAINT guest_email_verification_token_hash_key UNIQUE (token_hash)
);
-- Rate limiting and "latest code wins" both look up recent codes per tenant and address.
CREATE INDEX guest_email_verification_recent_idx
  ON guest_email_verification (tenant_id, email_digest, created_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings', 'guest_email_verification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'FOR ALL TO drezivo_app '
      || 'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM drezivo_worker', t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM drezivo_app', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON tenant_settings TO drezivo_app;
GRANT SELECT, INSERT, UPDATE ON guest_email_verification TO drezivo_app;

-- Returns the tenant for a live guest token, and nothing else. The argument is the SHA-256 of a
-- 256-bit random secret, so it cannot be enumerated; revoked and expired tokens resolve to NULL.
CREATE FUNCTION resolve_guest_access_tenant(p_token_hash text, p_reservation_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id
    FROM guest_access_token
   WHERE token_hash = p_token_hash
     AND reservation_id = p_reservation_id
     AND revoked_at IS NULL
     AND expires_at > statement_timestamp()
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION resolve_guest_access_tenant(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_guest_access_tenant(text, uuid) TO drezivo_app;
