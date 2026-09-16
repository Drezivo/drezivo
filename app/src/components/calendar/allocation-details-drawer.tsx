"use client";

import { useRouter } from "next/navigation";
import type { CalendarAllocation } from "@drezivo/contracts";
import { Button } from "@/components/ui/button";
import { formatPhp } from "@/lib/money";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

export interface AllocationDetailsDrawerProps {
  allocation: CalendarAllocation | null;
  onClose: () => void;
}

/**
 * Matches "Details Drawer.png" — a side panel, not a modal, so staff can keep scanning the
 * calendar list while reading one allocation's buffers.
 */
export function AllocationDetailsDrawer({ allocation, onClose }: AllocationDetailsDrawerProps) {
  const router = useRouter();
  if (!allocation) return null;

  return (
    <aside
      aria-label="Allocation details"
      className="flex w-80 shrink-0 flex-col gap-4 border-l border-ink-300 bg-white p-4"
    >
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-ink-900">{allocation.assetCode}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="text-sm text-ink-500 hover:text-ink-900"
        >
          ✕
        </button>
      </div>

      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-ink-500">Customer</dt>
          <dd className="text-ink-900">{allocation.customerName}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Blocked from</dt>
          <dd className="text-ink-900">{DATE_FORMAT.format(new Date(allocation.blockedStart))}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Blocked until</dt>
          <dd className="text-ink-900">{DATE_FORMAT.format(new Date(allocation.blockedEnd))}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Rental</dt>
          <dd className="text-ink-900">{formatPhp(allocation.rentalAmount)}</dd>
        </div>
        {/* Buffers (prep/turnaround) push the blocked window past the customer-facing
            pickup/return times — surface both so staff don't read this as double-booked
            (TRD §5). */}
        <div>
          <dt className="text-ink-500">Includes prep/turnaround buffers</dt>
          <dd className="text-ink-900">Yes — blocked window is wider than the customer&apos;s dates.</dd>
        </div>
      </dl>

      <Button variant="secondary" onClick={() => router.push(`/reservations/${allocation.reservationId}`)}>
        Open reservation
      </Button>
    </aside>
  );
}
