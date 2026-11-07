-- Existing database bytes remain authoritative until the verified backfill is finalized.
ALTER TABLE platform_payment_method
  ADD COLUMN qr_object_key text,
  ADD COLUMN qr_size_bytes integer,
  ADD COLUMN qr_sha256 text;

ALTER TABLE platform_payment_method
  DROP CONSTRAINT platform_payment_method_qr_pair_check,
  ADD CONSTRAINT platform_payment_method_qr_pair_check CHECK (
    (qr_image IS NULL AND qr_object_key IS NULL) = (qr_mime IS NULL)
  ),
  ADD CONSTRAINT platform_payment_method_qr_object_metadata_check CHECK (
    (qr_object_key IS NULL AND qr_size_bytes IS NULL AND qr_sha256 IS NULL)
    OR (qr_object_key IS NOT NULL AND qr_size_bytes IS NOT NULL AND qr_sha256 IS NOT NULL
      AND qr_object_key LIKE 'platform-files/payment-methods/%'
      AND qr_size_bytes BETWEEN 1 AND 524288
      AND qr_sha256 ~ '^[0-9a-f]{64}$')
  );

-- This global queue records uploads before contacting R2 so abandoned objects can be reclaimed.
CREATE TABLE platform_payment_qr_object (
  storage_key text PRIMARY KEY CHECK (storage_key LIKE 'platform-files/payment-methods/%'),
  state text NOT NULL CHECK (state IN ('uploading', 'referenced', 'delete_pending', 'failed')),
  available_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_payment_qr_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payment_qr_object FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_payment_qr_object FROM PUBLIC, drezivo_app, drezivo_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_payment_qr_object TO drezivo_app, drezivo_worker;
CREATE POLICY platform_qr_operator ON platform_payment_qr_object TO drezivo_app
  USING (current_setting('app.actor_kind', true) = 'operator')
  WITH CHECK (current_setting('app.actor_kind', true) = 'operator');
CREATE POLICY platform_qr_worker ON platform_payment_qr_object TO drezivo_worker
  USING (true) WITH CHECK (true);

-- Cleanup can inspect only object keys, including keys belonging to inactive methods.
GRANT SELECT (qr_object_key) ON platform_payment_method TO drezivo_worker;
CREATE POLICY platform_payment_method_qr_cleanup_read ON platform_payment_method
  FOR SELECT TO drezivo_worker USING (true);
