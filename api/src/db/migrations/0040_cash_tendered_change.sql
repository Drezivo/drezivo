-- Record physical cash tendered separately from the actual payment amount.
-- The verified payment remains the reservation amount due; any excess is change owed back to the customer.

ALTER TABLE payment_verification
  ADD COLUMN cash_tendered_minor integer,
  ADD COLUMN change_due_minor integer;

ALTER TABLE payment_verification
  ADD CONSTRAINT payment_verification_cash_tendered_nonnegative
    CHECK (cash_tendered_minor IS NULL OR cash_tendered_minor >= 0),
  ADD CONSTRAINT payment_verification_change_due_nonnegative
    CHECK (change_due_minor IS NULL OR change_due_minor >= 0),
  ADD CONSTRAINT payment_verification_cash_change_consistency
    CHECK (
      (cash_tendered_minor IS NULL AND change_due_minor IS NULL)
      OR (
        cash_tendered_minor IS NOT NULL
        AND change_due_minor IS NOT NULL
        AND verified_amount_minor IS NOT NULL
        AND cash_tendered_minor = verified_amount_minor + change_due_minor
      )
    );
