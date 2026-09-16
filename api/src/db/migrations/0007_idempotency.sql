-- Invariant: the idempotency scope key is (tenant_id, principal_key, operation, intent_key) —
-- FOUR columns, not just the client-supplied key alone (TRD §4). A client-only key would let
-- one tenant's checkout guest collide with another tenant's guest who happened to generate the
-- same random string, or let a retried request on one operation accidentally match a record
-- meant for a different route. The application layer cannot safely narrow this to "just check
-- the key" because that narrowing IS the isolation bug — the unique index below is what makes
-- "same key, different canonical payload hash" a guaranteed 409 rather than a race between two
-- concurrent requests that both think they are first.
--
-- Invariant: this table cannot substitute for the permanent `business_key` columns in
-- finance.ts/reservations.ts. `idempotency_record` rows expire (retention window, proposed
-- 7 days per TRD §4) and are cleanup-eligible; `business_key` uniqueness on posted financial
-- and custody rows must outlive that window indefinitely, since a reconciliation dispute can
-- surface months later.

CREATE TABLE idempotency_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  principal_key text NOT NULL,
  operation text NOT NULL,
  intent_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  resource_id uuid,
  response_code integer,
  safe_response jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_record_scope_key UNIQUE (tenant_id, principal_key, operation, intent_key)
);
-- The retention-window cleanup job's due-work query.
CREATE INDEX idempotency_record_expires_at_idx ON idempotency_record (expires_at);
