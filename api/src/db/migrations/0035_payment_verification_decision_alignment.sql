-- RSV-031: align persisted merchant verification decisions with the canonical Finance contract
-- before Reservation confirmation consumes them as authoritative approval state.
--
-- Historical `approved` is semantically the canonical `verified` decision. `ask_info` is additive:
-- it records a merchant request for clarification without treating uploaded evidence as verified and
-- without extending the reservation review deadline.

ALTER TABLE payment_verification
  DROP CONSTRAINT IF EXISTS payment_verification_decision_check;

UPDATE payment_verification
   SET decision = 'verified'
 WHERE decision = 'approved';

ALTER TABLE payment_verification
  ADD CONSTRAINT payment_verification_decision_check
    CHECK (decision IN ('verified', 'rejected', 'ask_info')),
  ADD CONSTRAINT payment_verification_verified_amount_check
    CHECK (decision <> 'verified' OR verified_amount_minor IS NOT NULL) NOT VALID;

-- `NOT VALID` avoids blocking an upgrade if a historical approved decision lacked an amount.
-- PostgreSQL still enforces the check for new/updated rows; RSV-031 also fails closed when it
-- encounters any legacy verified decision without a verified amount. A later finance backfill can
-- validate this constraint after those legacy rows have been reconciled.
