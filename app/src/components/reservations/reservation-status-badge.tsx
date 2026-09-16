import type { ReservationStatus } from "@drezivo/contracts";
import { Badge } from "@/components/ui/badge";

// Canonical states from PRD §3: held, pending_confirmation, confirmed, picked_up,
// returned, completed, cancelled, expired, rejected.
const STATUS_TONE: Record<ReservationStatus, "neutral" | "success" | "warning" | "danger" | "brand"> = {
  held: "warning",
  pending_confirmation: "warning",
  confirmed: "brand",
  picked_up: "brand",
  returned: "success",
  completed: "success",
  cancelled: "neutral",
  expired: "neutral",
  rejected: "danger",
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  held: "Held",
  pending_confirmation: "Pending confirmation",
  confirmed: "Confirmed",
  picked_up: "Picked up",
  returned: "Returned",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  rejected: "Rejected",
};

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
