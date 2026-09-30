import type { LucideIcon } from "lucide-react";
import { CalendarDays, FileText, Shirt, Truck, Undo2 } from "lucide-react";

export type DashboardTone = "purple" | "mint" | "blue" | "orange" | "lavender";
export type DashboardMetricKey =
  | "active_rentals"
  | "pickups_today"
  | "returns_today"
  | "fittings_today"
  | "payments_to_review";
export type ScheduleEventType = "Fitting" | "Pickup" | "Return";

export interface DashboardMetricPresentation {
  label: string;
  description: string;
  icon: LucideIcon;
  tone: DashboardTone;
}

/** Presentation metadata only; all values and rows come from the dashboard API. */
export const DASHBOARD_METRIC_PRESENTATION: Record<DashboardMetricKey, DashboardMetricPresentation> = {
  active_rentals: {
    label: "Active Rentals",
    description: "Currently with customers",
    icon: CalendarDays,
    tone: "purple",
  },
  pickups_today: {
    label: "Pickups Today",
    description: "Scheduled for today",
    icon: Truck,
    tone: "mint",
  },
  returns_today: {
    label: "Returns Today",
    description: "Due for return today",
    icon: Undo2,
    tone: "blue",
  },
  fittings_today: {
    label: "Fittings Today",
    description: "Appointments scheduled today",
    icon: Shirt,
    tone: "orange",
  },
  payments_to_review: {
    label: "Payments to Review",
    description: "Uploaded evidence needing review",
    icon: FileText,
    tone: "lavender",
  },
};
