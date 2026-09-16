import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

// This route intentionally renders only an explicit not-yet-available state. PRD §4 FR11
// is explicit: "V1 may store a note only and must not promise capacity or accept a fitting
// fee without resource controls." Room/staff/resource scheduling with overlap protection
// is a V1.1 requirement (PRD §10 "V1.1 requires evidence fittings/capacity ... block
// shops"). Building a calendar UI here ahead of that server-side capacity model would let
// staff believe a slot is reserved when nothing prevents a double-booking — do not add one
// until the API ships resource/exclusion checks.
export default function FittingScheduleAvailabilityPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Fitting schedule &amp; availability</h1>
        <p className="text-sm text-ink-500">Room, staff, and time-slot capacity for fitting appointments.</p>
      </div>

      <EmptyState
        heading="Not available in V1"
        description="Fitting capacity (rooms, staff, and overlap-protected time slots) ships in V1.1, once the API enforces resource exclusivity. Until then, coordinate fitting times by phone and record the outcome as a note on the Fittings page."
        action={
          <Link href="/fittings">
            <Button variant="secondary">Go to fitting notes</Button>
          </Link>
        }
      />
    </div>
  );
}
