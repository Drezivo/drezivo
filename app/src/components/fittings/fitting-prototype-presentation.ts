import type {
  FittingPrototypeGarment,
  FittingPrototypePaymentState,
  FittingPrototypeStatus,
} from "./fitting-prototype-data";

export const FITTING_STATUS_CLASSES: Record<FittingPrototypeStatus, string> = {
  Pending: "reservation-status-pending",
  Confirmed: "reservation-status-confirmed",
  Completed: "reservation-status-completed",
  Cancelled: "reservation-status-cancelled",
  Rejected: "reservation-status-danger",
  "No-show": "reservation-status-danger",
};

export const FITTING_PAYMENT_CLASSES: Record<FittingPrototypePaymentState, string> = {
  "Not required": "reservation-status-completed",
  "Pending review": "reservation-status-pending",
  Verified: "reservation-status-confirmed",
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});
const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});
const phpFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function fittingGarmentIntentLabel(guarantee: FittingPrototypeGarment["guarantee"]): string {
  if (guarantee === "Guaranteed") return "Guaranteed garment";
  if (guarantee === "Guaranteed intent") return "Guaranteed intent";
  return "Preference only";
}

export function formatFittingDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function formatFittingTimeRange(startsAt: string, endsAt: string): string {
  return `${timeFormatter.format(new Date(startsAt))}–${timeFormatter.format(new Date(endsAt))}`;
}

export function formatFittingMoney(minor: number): string {
  return phpFormatter.format(minor / 100);
}
