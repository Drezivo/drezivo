-- RSV-030/031: the hold-expiry worker now sweeps both initial held reservations and
-- pending-confirmation reviews. Keep that bounded due-work query index-backed.

CREATE INDEX IF NOT EXISTS reservation_review_expiry_idx
  ON reservation (hold_expires_at)
  WHERE status IN ('held', 'pending_confirmation')
    AND hold_expires_at IS NOT NULL;
