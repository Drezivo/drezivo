/**
 * Display mapping for the two independent status tracks defined in
 * Drezivo-PRD.md §3: reservation lifecycle and payment evidence status.
 * These are separate concepts and must never be collapsed into one badge —
 * a "confirmed" reservation and a "verified" payment are different facts
 * that happen to usually arrive together.
 *
 * Payment status is intentionally never labeled "Paid" anywhere in this
 * repo (Drezivo-PRD.md §4 "Guest booking": "never 'Paid.'"). The customer
 * uploaded evidence; a human at the business verifies actual funds before
 * anything is confirmed — showing "Paid" earlier would overstate certainty
 * the system doesn't have yet.
 */

export type ReservationStatus =
  | 'held'
  | 'pending_confirmation'
  | 'confirmed'
  | 'picked_up'
  | 'returned'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'rejected';

export type PaymentEvidenceStatus =
  | 'not_required'
  | 'awaiting_upload'
  | 'uploaded'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'superseded';

const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  held: 'Held',
  pending_confirmation: 'Pending Confirmation',
  confirmed: 'Confirmed',
  picked_up: 'Picked Up',
  returned: 'Returned',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  rejected: 'Declined',
};

const RESERVATION_STATUS_TONE: Record<
  ReservationStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  held: 'warning',
  pending_confirmation: 'warning',
  confirmed: 'success',
  picked_up: 'success',
  returned: 'neutral',
  completed: 'success',
  cancelled: 'danger',
  expired: 'danger',
  rejected: 'danger',
};

const PAYMENT_STATUS_LABELS: Record<PaymentEvidenceStatus, string> = {
  not_required: 'Not Required',
  awaiting_upload: 'Awaiting Payment Evidence',
  uploaded: 'Evidence Submitted',
  under_review: 'Under Review',
  verified: 'Verified',
  rejected: 'Evidence Rejected',
  superseded: 'Superseded',
};

const PAYMENT_STATUS_TONE: Record<
  PaymentEvidenceStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  not_required: 'neutral',
  awaiting_upload: 'warning',
  uploaded: 'warning',
  under_review: 'warning',
  verified: 'success',
  rejected: 'danger',
  superseded: 'neutral',
};

export function describeReservationStatus(status: ReservationStatus) {
  return { label: RESERVATION_STATUS_LABELS[status], tone: RESERVATION_STATUS_TONE[status] };
}

export function describePaymentStatus(status: PaymentEvidenceStatus) {
  return { label: PAYMENT_STATUS_LABELS[status], tone: PAYMENT_STATUS_TONE[status] };
}
