-- TBF-040 — local Front Desk invitation intent.
-- Recipient material is protected application data: the digest supports exact tenant-local
-- dedupe and the ciphertext is decrypted only by the later outbox dispatcher.

CREATE TYPE membership_invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE membership_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  recipient_email_digest varchar(128) NOT NULL,
  recipient_email_ciphertext text NOT NULL,
  status membership_invitation_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  clerk_invitation_id varchar(200),
  business_key varchar(160) NOT NULL,
  dispatch_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_invitation_tenant_business_key UNIQUE (tenant_id, business_key),
  CONSTRAINT membership_invitation_dispatch_version_positive CHECK (dispatch_version > 0),
  CONSTRAINT membership_invitation_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX membership_invitation_tenant_expiry_idx
  ON membership_invitation (tenant_id, expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX membership_invitation_pending_recipient_key
  ON membership_invitation (tenant_id, recipient_email_digest)
  WHERE status = 'pending';

CREATE UNIQUE INDEX membership_invitation_clerk_invitation_id_key
  ON membership_invitation (clerk_invitation_id)
  WHERE clerk_invitation_id IS NOT NULL;

ALTER TABLE membership_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_invitation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_invitation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON membership_invitation TO drezivo_app;
GRANT SELECT, UPDATE ON membership_invitation TO drezivo_worker;
REVOKE DELETE ON membership_invitation FROM drezivo_app, drezivo_worker;
