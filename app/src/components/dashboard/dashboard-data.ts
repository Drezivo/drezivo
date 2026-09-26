import type { LucideIcon } from "lucide-react";
import { CalendarDays, FileText, Shirt, Truck, Undo2 } from "lucide-react";

export type DashboardTone = "purple" | "mint" | "blue" | "orange" | "lavender";
export type ScheduleEventType = "Fitting" | "Pickup" | "Return" | "Reservation";
export type ScheduleStatus = "Confirmed" | "Upcoming" | "Pending";

export interface DashboardMetric {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone: DashboardTone;
}

export interface ScheduleEvent {
  time: string;
  type: ScheduleEventType;
  customer: string;
  clothing: string;
  status: ScheduleStatus;
  prototype?: boolean;
}

export interface UpcomingRental {
  customer: string;
  initials: string;
  clothing: string;
  rentalPeriod: string;
  status: Exclude<ScheduleStatus, "Upcoming"> | "Pending";
  avatarTone: DashboardTone;
}

export const DASHBOARD_METRICS: readonly DashboardMetric[] = [
  {
    label: "Rentals Today",
    value: "8",
    description: "Active rentals",
    icon: CalendarDays,
    tone: "purple",
  },
  { label: "Pickups Today", value: "4", description: "Scheduled", icon: Truck, tone: "mint" },
  { label: "Returns Today", value: "3", description: "Due today", icon: Undo2, tone: "blue" },
  {
    label: "Fittings Today",
    value: "5",
    description: "Prototype appointments",
    icon: Shirt,
    tone: "orange",
  },
  {
    label: "Pending Payments",
    value: "2",
    description: "Need confirmation",
    icon: FileText,
    tone: "lavender",
  },
];

export const TODAY_SCHEDULE: readonly ScheduleEvent[] = [
  {
    time: "09:00",
    type: "Fitting",
    customer: "Maria Santos",
    clothing: "Wedding Gown #24",
    status: "Confirmed",
    prototype: true,
  },
  {
    time: "10:30",
    type: "Pickup",
    customer: "Anna Reyes",
    clothing: "Black Satin Gown",
    status: "Confirmed",
  },
  {
    time: "13:00",
    type: "Return",
    customer: "Carla Dela Cruz",
    clothing: "Red Evening Dress",
    status: "Upcoming",
  },
  {
    time: "15:30",
    type: "Fitting",
    customer: "Jamie Cruz",
    clothing: "Debut Gown",
    status: "Confirmed",
    prototype: true,
  },
  {
    time: "16:30",
    type: "Reservation",
    customer: "Patricia Lim",
    clothing: "Beige Midi Dress",
    status: "Pending",
  },
  {
    time: "17:00",
    type: "Pickup",
    customer: "Sophia Garcia",
    clothing: "Blue Gown",
    status: "Confirmed",
  },
];

export const UPCOMING_RENTALS: readonly UpcomingRental[] = [
  {
    customer: "Alyssa Santos",
    initials: "AS",
    clothing: "Pink Gown",
    rentalPeriod: "Sep 12 - 14",
    status: "Confirmed",
    avatarTone: "purple",
  },
  {
    customer: "Bea Cruz",
    initials: "BC",
    clothing: "Filipiniana",
    rentalPeriod: "Sep 13 - 15",
    status: "Confirmed",
    avatarTone: "mint",
  },
  {
    customer: "Karen Lim",
    initials: "KL",
    clothing: "Blue Dress",
    rentalPeriod: "Sep 14 - 16",
    status: "Pending",
    avatarTone: "orange",
  },
  {
    customer: "Mika Reyes",
    initials: "MR",
    clothing: "White Gown",
    rentalPeriod: "Sep 16 - 18",
    status: "Confirmed",
    avatarTone: "blue",
  },
  {
    customer: "Trisha Garcia",
    initials: "TG",
    clothing: "Black Gown",
    rentalPeriod: "Sep 17 - 19",
    status: "Pending",
    avatarTone: "lavender",
  },
];
