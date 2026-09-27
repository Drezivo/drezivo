import type {
  FittingFeePaymentSummary,
  FittingGarmentLineSummary,
  FittingGarmentMode,
  FittingState,
} from "@drezivo/contracts";

export const FITTING_STATUS_LABELS: Record<FittingState, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
  no_show: "No-show",
};

export const FITTING_STATUS_CLASSES: Record<FittingState, string> = {
  pending: "reservation-status-pending",
  confirmed: "reservation-status-confirmed",
  completed: "reservation-status-completed",
  cancelled: "reservation-status-cancelled",
  rejected: "reservation-status-danger",
  no_show: "reservation-status-danger",
};

export type FittingPaymentLabel =
  | "Not required"
  | "Not started"
  | "Pending"
  | "Pending review"
  | "Partially paid"
  | "Verified"
  | "Failed"
  | "Refunded"
  | "Evidence rejected";

export const FITTING_PAYMENT_CLASSES: Record<FittingPaymentLabel, string> = {
  "Not required": "reservation-status-completed",
  "Not started": "dashboard-event-fitting",
  Pending: "reservation-status-pending",
  "Pending review": "reservation-status-pending",
  "Partially paid": "reservation-status-pending",
  Verified: "reservation-status-confirmed",
  Failed: "reservation-status-danger",
  Refunded: "reservation-status-cancelled",
  "Evidence rejected": "reservation-status-danger",
};

export function fittingPaymentLabel(fee: FittingFeePaymentSummary): FittingPaymentLabel {
  if (BigInt(fee.fee_minor) === 0n) return "Not required";
  if (!fee.payment) return "Not started";
  if (fee.payment.status === "paid") return "Verified";
  if (fee.payment.status === "partially_paid") return "Partially paid";
  if (fee.payment.status === "failed") return "Failed";
  if (fee.payment.status === "refunded") return "Refunded";
  if (fee.payment.evidence_status === "rejected") return "Evidence rejected";
  if (
    fee.payment.evidence_status === "uploaded" ||
    fee.payment.evidence_status === "under_review"
  ) {
    return "Pending review";
  }
  return "Pending";
}

export function fittingGarmentModeLabel(mode: FittingGarmentMode): string {
  return mode === "guaranteed" ? "Guaranteed garment" : "Preference only";
}

export function fittingVariantLabel(line: Pick<FittingGarmentLineSummary, "variant">): string {
  const color = line.variant.color_label ? ` / ${line.variant.color_label}` : "";
  return `${line.variant.size_label}${color}`;
}

export function formatFittingDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

export function formatFittingTimeRange(startsAt: string, endsAt: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return `${formatter.format(new Date(startsAt))}–${formatter.format(new Date(endsAt))}`;
}

export function formatFittingMoney(minor: string | number, currency: string): string {
  const value = typeof minor === "string" ? Number(minor) : minor;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100);
}
