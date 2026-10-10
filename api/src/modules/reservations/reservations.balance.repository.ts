import type { PoolClient } from 'pg';

/**
 * Balance payments: money owed after an edit raised the total of a booking the renter had already
 * paid for. Each is its own payment row next to the initial one, keyed
 * `reservation:<id>:balance:<reservation version>`, so the initial payment's verified facts never
 * change. At most one balance is open (pending) at a time.
 */
export interface ReservationBalancePaymentRow {
  payment_id: string;
  amount_minor: number;
  status: 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded';
  verified_at: Date | null;
}

export function balanceBusinessKey(reservationId: string, version: number): string {
  return `reservation:${reservationId}:balance:${version}`;
}

/** Locks every balance payment of a reservation, oldest first. */
export async function lockReservationBalancePayments(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<ReservationBalancePaymentRow[]> {
  const result = await client.query<ReservationBalancePaymentRow>(
    `SELECT id AS payment_id, amount_minor, status, verified_at
       FROM payment
      WHERE tenant_id = $1
        AND reservation_id = $2::uuid
        AND business_key LIKE ('reservation:' || $2::text || ':balance:%')
      ORDER BY created_at ASC, id ASC
      FOR UPDATE`,
    [input.tenantId, input.reservationId],
  );
  return result.rows;
}

/** Read-only list for the reservation detail. */
export async function readReservationBalancePayments(
  client: PoolClient,
  input: { tenantId: string; reservationId: string },
): Promise<ReservationBalancePaymentRow[]> {
  const result = await client.query<ReservationBalancePaymentRow>(
    `SELECT id AS payment_id, amount_minor, status, verified_at
       FROM payment
      WHERE tenant_id = $1
        AND reservation_id = $2::uuid
        AND business_key LIKE ('reservation:' || $2::text || ':balance:%')
      ORDER BY created_at ASC, id ASC`,
    [input.tenantId, input.reservationId],
  );
  return result.rows;
}

export async function insertReservationBalancePayment(
  client: PoolClient,
  input: { paymentId: string; tenantId: string; reservationId: string; paymentMethodId: string; amountMinor: number; businessKey: string },
): Promise<void> {
  await client.query(
    `INSERT INTO payment (id, tenant_id, reservation_id, payment_method_id, amount_minor, currency, status, business_key)
     VALUES ($1, $2, $3, $4, $5, 'PHP', 'pending', $6)`,
    [input.paymentId, input.tenantId, input.reservationId, input.paymentMethodId, input.amountMinor, input.businessKey],
  );
}

/** Re-amounts an open balance; collected money is never rewritten. */
export async function updateOpenBalanceAmount(
  client: PoolClient,
  input: { tenantId: string; paymentId: string; amountMinor: number },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE payment SET amount_minor = $3
      WHERE tenant_id = $1 AND id = $2::uuid AND status = 'pending' AND verified_at IS NULL`,
    [input.tenantId, input.paymentId, input.amountMinor],
  );
  return result.rowCount === 1;
}

/**
 * Closes an open balance that is no longer owed (a later edit lowered the total). `failed` is the
 * payment state for an intent that will not be collected; the row stays for the audit trail.
 */
export async function closeOpenBalance(
  client: PoolClient,
  input: { tenantId: string; paymentId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE payment SET status = 'failed'
      WHERE tenant_id = $1 AND id = $2::uuid AND status = 'pending' AND verified_at IS NULL`,
    [input.tenantId, input.paymentId],
  );
  return result.rowCount === 1;
}

/** Records that staff received an open balance: payment verified plus its verification decision. */
export async function recordBalanceCollected(
  client: PoolClient,
  input: {
    tenantId: string;
    paymentId: string;
    verifierMembershipId: string;
    amountMinor: number;
    merchantReference: string | null;
  },
): Promise<Date | null> {
  const paid = await client.query<{ verified_at: Date }>(
    `UPDATE payment
        SET status = 'paid', verified_at = statement_timestamp(), merchant_reference = $3
      WHERE tenant_id = $1 AND id = $2::uuid AND status = 'pending' AND verified_at IS NULL AND amount_minor = $4
      RETURNING verified_at`,
    [input.tenantId, input.paymentId, input.merchantReference, input.amountMinor],
  );
  const verifiedAt = paid.rows[0]?.verified_at ?? null;
  if (!verifiedAt) return null;
  await client.query(
    `INSERT INTO payment_verification
       (tenant_id, payment_id, verifier_membership_id, decision, verified_amount_minor, evidence_note, business_key)
     VALUES ($1, $2, $3, 'verified', $4, 'Balance collected by staff.', $5)`,
    [input.tenantId, input.paymentId, input.verifierMembershipId, input.amountMinor, `verify:${input.paymentId}`],
  );
  return verifiedAt;
}
