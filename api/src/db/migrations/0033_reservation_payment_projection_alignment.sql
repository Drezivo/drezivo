-- RSV-010: align the persisted payment/evidence vocabulary with the shared reservation contract
-- before reservation list reads expose it as authoritative operational state.
--
-- Historical `verified` means funds were verified/received, so it becomes `paid`. Historical
-- `voided` did not prove that money was returned, therefore it maps to `failed` rather than the
-- stronger `refunded` claim. Receipt `submitted`/`accepted` become `uploaded`/`verified`.
-- `not_required` and `awaiting_upload` remain derived payment-level evidence states when there is
-- no receipt row; an actual receipt starts at `uploaded`.

ALTER TABLE payment
  DROP CONSTRAINT IF EXISTS payment_status_check,
  DROP CONSTRAINT IF EXISTS payment_verified_has_timestamp;

UPDATE payment
   SET status = CASE status
     WHEN 'verified' THEN 'paid'
     WHEN 'voided' THEN 'failed'
     ELSE status
   END
 WHERE status IN ('verified', 'voided');

ALTER TABLE payment
  ADD CONSTRAINT payment_status_check
    CHECK (status IN ('pending', 'partially_paid', 'paid', 'failed', 'refunded')),
  ADD CONSTRAINT payment_received_has_timestamp
    CHECK (status NOT IN ('partially_paid', 'paid') OR verified_at IS NOT NULL);

ALTER TABLE payment_receipt
  DROP CONSTRAINT IF EXISTS payment_receipt_evidence_status_check;

ALTER TABLE payment_receipt
  ALTER COLUMN evidence_status DROP DEFAULT;

UPDATE payment_receipt
   SET evidence_status = CASE evidence_status
     WHEN 'submitted' THEN 'uploaded'
     WHEN 'accepted' THEN 'verified'
     ELSE evidence_status
   END
 WHERE evidence_status IN ('submitted', 'accepted');

ALTER TABLE payment_receipt
  ALTER COLUMN evidence_status SET DEFAULT 'uploaded',
  ADD CONSTRAINT payment_receipt_evidence_status_check
    CHECK (
      evidence_status IN (
        'uploaded',
        'under_review',
        'verified',
        'rejected',
        'superseded'
      )
    );
