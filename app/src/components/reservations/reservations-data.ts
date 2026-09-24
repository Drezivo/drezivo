import type { PaymentEvidenceStatus, PaymentStatus, ReservationState } from "@drezivo/contracts";

export const RESERVATION_STATUS_FILTERS: ReadonlyArray<{
  label: string;
  value: ReservationState | null;
}> = [
  { label: "All", value: null },
  { label: "Held", value: "held" },
  { label: "Pending Confirmation", value: "pending_confirmation" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Picked Up", value: "picked_up" },
  { label: "Returned", value: "returned" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Expired", value: "expired" },
  { label: "Rejected", value: "rejected" },
] as const;

export const RESERVATION_STATUS_LABELS: Record<ReservationState, string> = {
  held: "Held",
  pending_confirmation: "Pending Confirmation",
  confirmed: "Confirmed",
  picked_up: "Picked Up",
  returned: "Returned",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  rejected: "Rejected",
};

export const RESERVATION_STATUS_CLASSES: Record<ReservationState, string> = {
  held: "reservation-status-new",
  pending_confirmation: "reservation-status-pending",
  confirmed: "reservation-status-confirmed",
  picked_up: "reservation-status-picked-up",
  returned: "reservation-status-returned",
  completed: "reservation-status-completed",
  cancelled: "reservation-status-cancelled",
  expired: "reservation-status-cancelled",
  rejected: "reservation-status-danger",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partially_paid: "Partially Paid",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_CLASSES: Record<PaymentStatus, string> = {
  pending: "reservation-status-pending",
  partially_paid: "reservation-status-pending",
  paid: "reservation-status-confirmed",
  failed: "reservation-status-danger",
  refunded: "reservation-status-returned",
};

export const PAYMENT_EVIDENCE_LABELS: Record<PaymentEvidenceStatus, string> = {
  not_required: "No evidence required",
  awaiting_upload: "Awaiting upload",
  uploaded: "Uploaded",
  under_review: "Under review",
  verified: "Verified",
  rejected: "Rejected",
  superseded: "Superseded",
};
